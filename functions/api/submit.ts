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

  // Consistency: component scores must match the documented formulas.
  if (!roughlyEqual(s.gpu, body.gpu.gflops * 3)) return 'Inconsistent GPU score';
  if (!roughlyEqual(s.cpuSingle, body.cpu.hashesPerSecondSingle / 300)) return 'Inconsistent CPU single score';
  if (!roughlyEqual(s.cpuMulti, body.cpu.hashesPerSecondMulti / 600)) return 'Inconsistent CPU multi score';
  if (!roughlyEqual(s.ram, ((body.ram.readBandwidthGBs + body.ram.writeBandwidthGBs) / 2) * 60)) return 'Inconsistent RAM score';

  // Overall: weighted geometric mean — GPU 35 / CPU-multi 45 / RAM 20.
  // When the GPU couldn't be measured (no WebGPU) the client renormalizes
  // over CPU+RAM; accept both formulas depending on scores.gpu.
  const ln = (v: number) => Math.log(Math.max(v, 1));
  if (s.gpu > 0) {
    const expected = Math.exp(0.35 * ln(s.gpu) + 0.45 * ln(s.cpuMulti) + 0.20 * ln(s.ram));
    if (!roughlyEqual(s.overall, expected)) return 'Inconsistent overall score';
  } else {
    // No-WebGPU clients renormalize over CPU+RAM; clients running a stale
    // cached page still use the old collapsed formula — accept either.
    const renormalized = Math.exp((0.45 * ln(s.cpuMulti) + 0.20 * ln(s.ram)) / 0.65);
    const legacy = Math.exp(0.45 * ln(s.cpuMulti) + 0.20 * ln(s.ram));
    if (!roughlyEqual(s.overall, renormalized) && !roughlyEqual(s.overall, legacy)) return 'Inconsistent overall score';
  }

  return null;
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
    await env.DB.prepare(`
      INSERT INTO results
        (id, created_at, score_overall, score_gpu, score_cpu_single, score_cpu_multi, score_ram,
         gpu_gflops, gpu_name, cpu_cores, cpu_hashes_single, cpu_hashes_multi,
         ram_read_gbs, ram_write_gbs, ram_latency_ns, ua_short,
         ai_score, ai_tier, ai_max_alloc_gb, ai_fp16)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      aiFp16
    ).run();

    // Compute percentile: count rows with score < this user's overall, divide by total.
    // Percentiles are computed within the same measurement class — runs with a
    // measured GPU compare only against other GPU runs, no-WebGPU runs only
    // against no-WebGPU runs. Mixing the two bases would be unfair to both.
    const hasGpu = Math.round(s.gpu) > 0 ? 1 : 0;
    const totalRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE (score_gpu > 0) = ?')
      .bind(hasGpu)
      .first<{ c: number }>();
    const lowerRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE score_overall < ? AND (score_gpu > 0) = ?')
      .bind(Math.round(s.overall), hasGpu)
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
