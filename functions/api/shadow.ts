// POST /api/shadow — store one v4.0-candidate shadow measurement.
//
// UNRANKED, UNSCORED telemetry. This endpoint exists so the v4.0 validation
// gate (methodology, "The v4.0 gate") can be evaluated on fleet data. It
// deliberately does NOT touch the `results` table, compute any score, or
// affect any percentile — the scored submit path is a separate endpoint that
// is byte-identical to v3.6.
//
// Rows with verify_ok=0 or an error ARE accepted and stored: the gate counts
// failure rates, and dropping failures would bias the very statistic that
// decides whether the candidate ships.

interface Env {
  DB: D1Database;
}

interface ShadowBody {
  resultId: string;
  wl: number;
  probeHashesSingle?: number;
  intSingle: number;
  fpSingle: number;
  intMulti: number;
  fpMulti: number;
  singleElapsedMs: number;
  multiWindowMs: number;
  workersSpawned: number;
  workersReported: number;
  intWorkerRates?: number[];
  fpWorkerRates?: number[];
  clockSkewMs: number;
  verifyOk: boolean;
  verifyFailKernel?: string;
  wentHidden?: boolean;
  shadowElapsedMs: number;
  cores?: number;
  error?: string;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function bad(error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
}

/** Same low-entropy UA bucketing as submit.ts — no raw UA is ever stored. */
function shortenUA(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const ua = String(raw);
  let browser = 'Unknown';
  let m: RegExpMatchArray | null;
  if      ((m = ua.match(/Edg\/(\d+)/)))             browser = 'Edge ' + m[1];
  else if ((m = ua.match(/OPR\/(\d+)/)))             browser = 'Opera ' + m[1];
  else if ((m = ua.match(/Firefox\/(\d+)/)))         browser = 'Firefox ' + m[1];
  else if ((m = ua.match(/Chrome\/(\d+)/)))          browser = 'Chrome ' + m[1];
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) browser = 'Safari ' + m[1];
  let os = 'Unknown';
  if      (/Windows/.test(ua))         os = 'Windows';
  else if (/Mac OS X|macOS/.test(ua))  os = 'macOS';
  else if (/Android/.test(ua))         os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua))           os = 'Linux';
  return `${browser} / ${os}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    let body: ShadowBody;
    try {
      body = await request.json() as ShadowBody;
    } catch {
      return bad('Invalid JSON');
    }

    // ── Provenance: must reference a real, RECENT scored result ─────
    if (typeof body.resultId !== 'string' || !/^[0-9a-f]{8}$/.test(body.resultId)) {
      return bad('Invalid resultId');
    }
    const parent = await env.DB.prepare('SELECT created_at FROM results WHERE id = ?')
      .bind(body.resultId).first<{ created_at: number }>();
    if (!parent) return bad('Unknown resultId');
    if (Date.now() - parent.created_at > 60 * 60 * 1000) return bad('Result too old for shadow attach');

    // ── Plausibility bounds — hard walls against junk ───────────────
    // Scalar wasm SHA-256 tops out around 6M chain steps/s per core; the
    // Mandelbrot kernel around 400M pixel-iterations/s per core. Generous
    // headroom above both, but nothing absurd gets stored.
    if (!Number.isInteger(body.wl) || body.wl < 1 || body.wl > 100) return bad('Invalid wl');
    const rateFields: Array<[string, number, number]> = [
      ['intSingle', body.intSingle, 1e8],
      ['fpSingle',  body.fpSingle,  5e9],
      ['intMulti',  body.intMulti,  1e10],
      ['fpMulti',   body.fpMulti,   5e11],
    ];
    for (const [name, v, max] of rateFields) {
      if (!isNum(v) || v < 0 || v > max) return bad(`Implausible ${name}`);
    }
    if (body.probeHashesSingle !== undefined && (!isNum(body.probeHashesSingle) || body.probeHashesSingle < 0 || body.probeHashesSingle > 1e9)) {
      return bad('Implausible probe');
    }
    for (const [name, v] of [['singleElapsedMs', body.singleElapsedMs], ['multiWindowMs', body.multiWindowMs], ['shadowElapsedMs', body.shadowElapsedMs], ['clockSkewMs', body.clockSkewMs]] as Array<[string, number]>) {
      if (!isNum(v) || v < 0 || v > 120_000) return bad(`Invalid ${name}`);
    }
    if (!Number.isInteger(body.workersSpawned) || body.workersSpawned < 0 || body.workersSpawned > 64) return bad('Invalid workersSpawned');
    if (!Number.isInteger(body.workersReported) || body.workersReported < 0 || body.workersReported > body.workersSpawned) return bad('Invalid workersReported');

    const ratesOk = (a: unknown) => a === undefined ||
      (Array.isArray(a) && a.length <= 64 && a.every(v => isNum(v) && v >= 0 && v < 1e10));
    if (!ratesOk(body.intWorkerRates) || !ratesOk(body.fpWorkerRates)) return bad('Invalid worker rates');
    const ratesJson = JSON.stringify({ int: body.intWorkerRates ?? [], fp: body.fpWorkerRates ?? [] });
    if (ratesJson.length > 4096) return bad('Worker rates too large');

    const intRates = (body.intWorkerRates ?? []).slice().sort((a, b) => a - b);
    const err = typeof body.error === 'string' ? body.error.slice(0, 200) : null;
    const failKernel = body.verifyFailKernel === 'int' || body.verifyFailKernel === 'fp' ? body.verifyFailKernel : null;
    const ua = shortenUA(request.headers.get('user-agent')).slice(0, 64);

    await env.DB.prepare(`
      INSERT INTO shadow_runs
        (result_id, created_at, wl, probe_hashes_single,
         int_single, fp_single, int_multi, fp_multi,
         single_elapsed_ms, multi_window_ms, workers_spawned, workers_reported,
         int_rate_min, int_rate_median, int_rate_max, worker_rates_json,
         clock_skew_ms, verify_ok, verify_fail_kernel, went_hidden,
         shadow_elapsed_ms, ua_short, cores, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.resultId,
      Date.now(),
      body.wl,
      body.probeHashesSingle ?? null,
      body.intSingle,
      body.fpSingle,
      body.intMulti,
      body.fpMulti,
      Math.round(body.singleElapsedMs),
      Math.round(body.multiWindowMs),
      body.workersSpawned,
      body.workersReported,
      intRates.length ? intRates[0] : null,
      intRates.length ? intRates[Math.floor(intRates.length / 2)] : null,
      intRates.length ? intRates[intRates.length - 1] : null,
      ratesJson,
      Math.round(body.clockSkewMs),
      body.verifyOk ? 1 : 0,
      failKernel,
      body.wentHidden ? 1 : 0,
      Math.round(body.shadowElapsedMs),
      ua,
      Number.isInteger(body.cores) && (body.cores as number) >= 1 && (body.cores as number) <= 64 ? body.cores : null,
      err
    ).run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    // UNIQUE(result_id) violation = replay — say so rather than 500.
    if (/UNIQUE/i.test(e?.message || '')) {
      return new Response(JSON.stringify({ ok: false, error: 'Shadow row already recorded for this result' }), {
        status: 409, headers: { 'content-type': 'application/json' },
      });
    }
    console.error('shadow endpoint error:', e?.message);
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
};
