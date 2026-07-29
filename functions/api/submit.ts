// POST /api/submit — store benchmark result, return short ID + percentile
// Body: { scores, gpu, cpu, ram, hardware, durationMs }

interface Env {
  DB: D1Database;
}

function makeId(): string {
  // 8-char hex ID (~ 4 billion combos, plenty for our scale)
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function clean(s: string | undefined | null, max = 200): string {
  if (!s) return '';
  return String(s).replace(/[\x00-\x1F\x7F]/g, '').slice(0, max);
}

/**
 * Parse a raw User-Agent into a short, low-entropy string of the form
 * "Browser-Major / OS / Arch" (e.g. "Chrome 130 / Windows / x64").
 *
 * WHY: the privacy policy promises a truncated UA. Storing the raw UA
 * (even truncated to 200 chars) leaks build numbers, OS patch level,
 * mobile device models — combined with GPU + RAM + cores that's a
 * fingerprintable identifier under GDPR. This parser strips everything
 * down to broad-category info that has thousands of users per bucket.
 */
function shortenUA(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const ua = String(raw);

  // Browser detection — order matters (Edge before Chrome, etc.)
  let browser = 'Unknown';
  let m: RegExpMatchArray | null;
  if      ((m = ua.match(/Edg\/(\d+)/)))                browser = 'Edge ' + m[1];
  else if ((m = ua.match(/OPR\/(\d+)/)))                browser = 'Opera ' + m[1];
  else if ((m = ua.match(/Firefox\/(\d+)/)))            browser = 'Firefox ' + m[1];
  else if ((m = ua.match(/Chrome\/(\d+)/)))             browser = 'Chrome ' + m[1];
  else if ((m = ua.match(/Version\/(\d+).*Safari/)))    browser = 'Safari ' + m[1];
  else if ((m = ua.match(/Safari\/(\d+)/)))             browser = 'Safari ' + m[1];

  // OS detection — broad buckets only
  let os = 'Unknown';
  if      (/Windows/.test(ua))   os = 'Windows';
  else if (/Mac OS X|macOS/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua))   os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua))     os = 'Linux';
  else if (/CrOS/.test(ua))      os = 'ChromeOS';

  // Architecture — only x64/arm64/x86 distinction
  let arch = '';
  if      (/Win64|x64|x86_64|WOW64/.test(ua)) arch = 'x64';
  else if (/arm64|aarch64/.test(ua))          arch = 'arm64';
  else if (/i686|i386|x86/.test(ua))          arch = 'x86';
  else if (/Mac OS X|macOS/.test(ua))         arch = 'arm64'; // M-series default

  return arch ? `${browser} / ${os} / ${arch}` : `${browser} / ${os}`;
}

interface Submission {
  scores: {
    overall: number;
    gpu: number;
    cpuSingle: number;
    cpuMulti: number;
    ram: number;
  };
  gpu: { gflops: number; adapterName?: string };
  cpu: { cores: number; hashesPerSecondSingle: number; hashesPerSecondMulti: number };
  ram: { readBandwidthGBs: number; writeBandwidthGBs: number; randomAccessLatencyNs: number };
  hardware: { gpu: string; cores: number; ua: string };
  durationMs: number;
  /**
   * Which measurement estimator produced these numbers.
   * Absent => pre-v3.6 client (old multi-core estimator, max-of-samples GPU).
   * 2      => v3.6+ (fixed-time window, summed per-worker rates, median GPU).
   * The two are not comparable and are ranked in separate pools.
   */
  estimatorVersion?: number;
  /** Per-worker elapsed spread of the multi-core window, ms (v3.6+). */
  workerElapsedMs?: { min: number; median: number; max: number };
  /**
   * AI capability snapshot from probeAICapabilities (Phase G).
   * Optional — pre-Phase-G clients don't send this; submission still
   * succeeds with NULL ai_* fields. Empty object also accepted.
   */
  ai?: {
    score?: number;
    tier?: string;
    memory?: { largestAllocatableGB?: number };
    webgpu?: { fp16?: boolean };
  };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** true when a is within tol (relative) of b, with a small absolute floor for rounding noise */
function roughlyEqual(a: number, b: number, tol = 0.05, absFloor = 3): boolean {
  return Math.abs(a - b) <= Math.max(absFloor, Math.abs(b) * tol);
}

function bad(error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Validate a submission against physical plausibility AND internal
 * consistency. Component scores are pure functions of the raw metrics
 * (documented on /methodology and in runner.ts) — so we recompute them
 * server-side and reject rows that don't match. This blocks both
 * hand-crafted curl submissions and corrupted client measurements from
 * polluting the shared leaderboard/percentile pool.
 */
function validate(body: Submission): string | null {
  const s = body?.scores;
  if (!s || !body.gpu || !body.cpu || !body.ram || !body.hardware) return 'Missing fields';

  for (const [name, v] of Object.entries({
    overall: s.overall, gpu: s.gpu, cpuSingle: s.cpuSingle, cpuMulti: s.cpuMulti, ram: s.ram,
  })) {
    if (!isNum(v) || v < 0) return `Invalid score: ${name}`;
  }
  if (s.overall > 50000) return 'Invalid score: overall';

  // Plausibility ceilings — generous headroom above anything a browser
  // can legitimately measure today, but a hard wall against absurd junk.
  if (!isNum(body.gpu.gflops) || body.gpu.gflops < 0 || body.gpu.gflops > 120000) return 'Implausible GPU GFLOPS';
  if (!isNum(body.cpu.cores) || body.cpu.cores < 1 || body.cpu.cores > 512) return 'Implausible core count';
  if (!isNum(body.cpu.hashesPerSecondSingle) || body.cpu.hashesPerSecondSingle < 0 || body.cpu.hashesPerSecondSingle > 1e9) return 'Implausible CPU single';
  if (!isNum(body.cpu.hashesPerSecondMulti) || body.cpu.hashesPerSecondMulti < 0 || body.cpu.hashesPerSecondMulti > 1e10) return 'Implausible CPU multi';
  if (!isNum(body.ram.readBandwidthGBs) || body.ram.readBandwidthGBs < 0 || body.ram.readBandwidthGBs > 500) return 'Implausible RAM read';
  if (!isNum(body.ram.writeBandwidthGBs) || body.ram.writeBandwidthGBs < 0 || body.ram.writeBandwidthGBs > 500) return 'Implausible RAM write';
  if (!isNum(body.ram.randomAccessLatencyNs) || body.ram.randomAccessLatencyNs < 0 || body.ram.randomAccessLatencyNs > 1e6) return 'Implausible RAM latency';

  // Which components were actually measured. Derived server-side from the raw
  // metrics, never from a client flag — a trusted flag would let a submitter
  // pick whichever denominator flatters them. No stored column is needed:
  // every raw metric is `work / elapsed` with a non-zero numerator, so a
  // genuine measurement can never be exactly 0.
  const mGpu = body.gpu.gflops > 0;
  const mSingle = body.cpu.hashesPerSecondSingle > 0;
  const mMulti = body.cpu.hashesPerSecondMulti > 0;
  const mRam = body.ram.readBandwidthGBs > 0 && body.ram.writeBandwidthGBs > 0;

  // Consistency: a measured component's score must match the documented
  // formula; an unmeasured one must be exactly 0 on both sides.
  if (mGpu ? !roughlyEqual(s.gpu, body.gpu.gflops * 3) : s.gpu !== 0) return 'Inconsistent GPU score';
  if (mSingle ? !roughlyEqual(s.cpuSingle, body.cpu.hashesPerSecondSingle / 300) : s.cpuSingle !== 0) return 'Inconsistent CPU single score';
  if (mMulti ? !roughlyEqual(s.cpuMulti, body.cpu.hashesPerSecondMulti / 600) : s.cpuMulti !== 0) return 'Inconsistent CPU multi score';
  if (mRam ? !roughlyEqual(s.ram, ((body.ram.readBandwidthGBs + body.ram.writeBandwidthGBs) / 2) * 60) : s.ram !== 0) return 'Inconsistent RAM score';

  // Overall: weighted geometric mean over the measured components, weights
  // renormalized over that set (GPU .35 / CPU-multi .45 / RAM .20).
  const ln = (v: number) => Math.log(Math.max(v, 1));
  const W = (mGpu ? 0.35 : 0) + (mMulti ? 0.45 : 0) + (mRam ? 0.20 : 0);
  const sum = (mGpu ? 0.35 * ln(s.gpu) : 0)
            + (mMulti ? 0.45 * ln(s.cpuMulti) : 0)
            + (mRam ? 0.20 * ln(s.ram) : 0);
  let ok = roughlyEqual(s.overall, Math.exp(sum / W));
  if (!ok && !mGpu && mRam && mMulti) {
    // Clients running a stale cached page still use the pre-v3.2 collapsed form.
    ok = roughlyEqual(s.overall, Math.exp(0.45 * ln(s.cpuMulti) + 0.20 * ln(s.ram)));
  }
  if (!ok) return 'Inconsistent overall score';

  return null;
}

/**
 * Scoring floor: W >= 0.65, i.e. CPU-multi measured AND (GPU or RAM measured).
 * Below that the composite is mostly a statement about our measurement
 * failing rather than about the hardware — those runs are shown to the user
 * but never stored, ranked or leaderboarded.
 */
function belowFloor(body: Submission): boolean {
  const mGpu = body.gpu.gflops > 0;
  const mMulti = body.cpu.hashesPerSecondMulti > 0;
  const mRam = body.ram.readBandwidthGBs > 0 && body.ram.writeBandwidthGBs > 0;
  return !mMulti || !(mGpu || mRam);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    let body: Submission;
    try {
      body = await request.json() as Submission;
    } catch {
      return bad('Invalid JSON');
    }

    const invalid = validate(body);
    if (invalid) return bad(invalid);

    // 422, not 400: the payload is well-formed, it just doesn't contain
    // enough measurement to be a benchmark result.
    if (belowFloor(body)) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Run did not measure enough components to be scored',
      }), { status: 422, headers: { 'content-type': 'application/json' } });
    }

    const s = body.scores;

    // Try a few times if random ID collides (extremely rare)
    let id = makeId();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await env.DB.prepare('SELECT id FROM results WHERE id = ?').bind(id).first();
      if (!existing) break;
      id = makeId();
      attempts++;
    }

    // Parse User-Agent into low-entropy short form server-side.
    // Privacy policy promises "Browser-Major / OS / Arch" — this matches.
    // Never store the raw UA (would be a GDPR fingerprint risk).
    const ua_short = clean(shortenUA(request.headers.get('user-agent')), 64);

    // ── AI capability fields (Phase G — optional) ───────────────────
    // Defensive coercion: legitimately-missing fields → NULL, malformed
    // values (negative, NaN) → NULL. Never insert nonsense.
    const aiScore       = typeof body.ai?.score === 'number' && body.ai.score >= 0 && body.ai.score < 100000
                          ? Math.round(body.ai.score) : null;
    const aiTier        = typeof body.ai?.tier === 'string' && body.ai.tier.length <= 30
                          ? clean(body.ai.tier, 30) : null;
    const aiMaxAllocGB  = typeof body.ai?.memory?.largestAllocatableGB === 'number'
                          && body.ai.memory.largestAllocatableGB >= 0
                          && body.ai.memory.largestAllocatableGB < 1000
                          ? body.ai.memory.largestAllocatableGB : null;
    const aiFp16        = typeof body.ai?.webgpu?.fp16 === 'boolean'
                          ? (body.ai.webgpu.fp16 ? 1 : 0) : null;

    // NOTE: fingerprint column removed (Issue: privacy policy contradiction).
    // The schema column may still exist in the DB — we just don't write to it.
    // Migrating the column away requires a separate migration. Until then,
    // any reads should ignore it. r/[id].ts already does (selects specific cols).
    // Estimator version. A client that doesn't declare one is pre-v3.6 and
    // lands in the legacy pool. Only the known value is accepted — anything
    // else is treated as legacy rather than trusted.
    const estimatorVersion = body.estimatorVersion === 2 ? 2 : null;
    const we = body.workerElapsedMs;
    const okMs = (v: unknown) => isNum(v) && v >= 0 && v < 600_000 ? Math.round(v as number) : null;
    const weMin    = estimatorVersion === 2 ? okMs(we?.min) : null;
    const weMedian = estimatorVersion === 2 ? okMs(we?.median) : null;
    const weMax    = estimatorVersion === 2 ? okMs(we?.max) : null;

    await env.DB.prepare(`
      INSERT INTO results
        (id, created_at, score_overall, score_gpu, score_cpu_single, score_cpu_multi, score_ram,
         gpu_gflops, gpu_name, cpu_cores, cpu_hashes_single, cpu_hashes_multi,
         ram_read_gbs, ram_write_gbs, ram_latency_ns, ua_short,
         ai_score, ai_tier, ai_max_alloc_gb, ai_fp16,
         estimator_version, worker_elapsed_min_ms, worker_elapsed_median_ms, worker_elapsed_max_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      Date.now(),
      Math.round(s.overall),
      Math.round(s.gpu),
      Math.round(s.cpuSingle),
      Math.round(s.cpuMulti),
      Math.round(s.ram),
      body.gpu.gflops,
      clean(body.hardware.gpu, 80),
      body.cpu.cores,
      Math.round(body.cpu.hashesPerSecondSingle),
      Math.round(body.cpu.hashesPerSecondMulti),
      body.ram.readBandwidthGBs,
      body.ram.writeBandwidthGBs,
      body.ram.randomAccessLatencyNs,
      ua_short,
      aiScore,
      aiTier,
      aiMaxAllocGB,
      aiFp16,
      estimatorVersion,
      weMin,
      weMedian,
      weMax
    ).run();

    // Compute percentile: count rows with score < this user's overall, divide by total.
    // Percentiles are computed within the same measurement class — runs with a
    // measured GPU compare only against other GPU runs, no-WebGPU runs only
    // against no-WebGPU runs. Mixing the two bases would be unfair to both.
    // Percentile pools, keyed on which components were measured. Raw columns
    // are the discriminator everywhere (api/r/[id].ts, top.ts, og.ts) — no
    // stored flag, because a genuine measurement can never be exactly 0.
    // Rows below the scoring floor match no pool and skew no percentile.
    // Pools are also split by estimator version: v3.6 changed how multi-core
    // throughput and the GPU headline are computed, and the old numbers cannot
    // be converted (only the aggregate was ever stored). Ranking across the
    // break would compare two different measurements.
    const POOL = `FROM results WHERE cpu_hashes_multi > 0
      AND (gpu_gflops > 0) = ?
      AND (ram_read_gbs > 0 AND ram_write_gbs > 0) = ?
      AND COALESCE(estimator_version, 1) = ?`;
    const hasGpu = body.gpu.gflops > 0 ? 1 : 0;
    const hasRam = (body.ram.readBandwidthGBs > 0 && body.ram.writeBandwidthGBs > 0) ? 1 : 0;
    const est = estimatorVersion ?? 1;
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL}`)
      .bind(hasGpu, hasRam, est)
      .first<{ c: number }>();
    const lowerRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL} AND score_overall < ?`)
      .bind(hasGpu, hasRam, est, Math.round(s.overall))
      .first<{ c: number }>();

    const total = totalRow?.c || 1;
    const lower = lowerRow?.c || 0;
    const percentile = Math.round((lower / total) * 100);

    return new Response(JSON.stringify({
      ok: true,
      id,
      url: `https://9bench.com/r/${id}`,
      percentile,
      total
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    // Don't leak server-side details (D1 column names, stack traces) to client.
    // Log for debug, return generic message.
    console.error('submit error:', e?.message);
    return new Response(JSON.stringify({ ok: false, error: 'Server error — please try again' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};
