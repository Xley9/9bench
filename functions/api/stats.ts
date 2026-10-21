// GET /api/stats — public site statistics for Landing page counters.
//
// NOT cached at the edge: Pages Functions responses are served `cf-cache-status: DYNAMIC`,
// so the Cache-Control header below only helps browsers. Every call used to full-scan
// `results` twice (COUNT(*) + COUNT(DISTINCT gpu_name)) — ~21k D1 rows per page view, the
// main driver behind exhausting the free tier's 5M rows read per day.
// Now: the numbers come from a snapshot in D1 (functions/_lib/aggregates.ts, 1 row read per
// call, refreshed at most every few minutes to hours). The original live queries below are
// the fallback when the snapshot is unavailable. Stats don't need real-time precision.
//
// Returned shape (consumed by index.astro <Landing>):
//   {
//     total_runs:           number  // COUNT(*) FROM results
//     gpu_models_seen:      number  // COUNT(DISTINCT gpu_name)
//     avg_duration_seconds: number  // hardcoded 14.2 until duration_ms column exists
//     last_24h:             number  // recent activity counter
//     vendor_payments:      0       // by design — never increases
//   }

import { getStats } from '../_lib/aggregates';

interface Env {
  DB: D1Database;
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Edge cache: 60s with stale-while-revalidate so the next request after
  // expiry still returns instantly (refresh in background).
  'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
};

export const onRequestGet: PagesFunction<Env> = async ({ env, waitUntil }) => {
  try {
    let totalRuns: number;
    let gpuModelsSeen: number;
    let last24h: number;

    const snap = await getStats({ db: env.DB, waitUntil });
    if (snap) {
      totalRuns = snap.total_runs;
      gpuModelsSeen = snap.gpu_models_seen;
      last24h = snap.last_24h;
    } else {
      // Fallback: the original live queries (snapshot table missing or refresh failing).
      // Run all three count queries in parallel — D1 batches well at this scale.
      // created_at is stored in MILLISECONDS (Date.now() in submit.ts) — the
      // cutoff must be in ms too, or the comparison is always true and
      // last_24h silently equals total_runs.
      const oneDayAgo = Date.now() - 86400 * 1000;
      const [totalRow, gpuRow, recentRow] = await env.DB.batch([
        env.DB.prepare('SELECT COUNT(*) AS n FROM results'),
        env.DB.prepare("SELECT COUNT(DISTINCT gpu_name) AS n FROM results WHERE gpu_name IS NOT NULL AND gpu_name != ''"),
        env.DB.prepare('SELECT COUNT(*) AS n FROM results WHERE created_at > ?').bind(oneDayAgo),
      ]);

      totalRuns     = (totalRow.results?.[0] as any)?.n  ?? 0;
      gpuModelsSeen = (gpuRow.results?.[0] as any)?.n    ?? 0;
      last24h       = (recentRow.results?.[0] as any)?.n ?? 0;
    }

    // avg_duration_seconds: there's no duration_ms column yet in `results`.
    // Schema migration is Phase F.1 — until then this is the conservative
    // baseline from observed test runs (~8-15s, depending on hardware).
    // We expose 14.2 as a representative figure; it's transparent (matches
    // what the Methodology page documents) rather than fabricated daily.
    const avgDurationSeconds = totalRuns > 0 ? 14.2 : 0;

    return new Response(JSON.stringify({
      total_runs: totalRuns,
      gpu_models_seen: gpuModelsSeen,
      avg_duration_seconds: avgDurationSeconds,
      last_24h: last24h,
      vendor_payments: 0,  // hardcoded — by design, never increases
      ts: Date.now(),
    }), { headers: HEADERS });
  } catch (e: any) {
    // On D1 failure, return zeros rather than 500 — Landing page is
    // resilient and shows zeros gracefully ("Early days" framing).
    // Log to console (Cloudflare captures) for ops visibility.
    console.error('stats endpoint error', e?.message || e);
    return new Response(JSON.stringify({
      total_runs: 0,
      gpu_models_seen: 0,
      avg_duration_seconds: 0,
      last_24h: 0,
      vendor_payments: 0,
      ts: Date.now(),
      error: 'stats unavailable',
    }), {
      status: 200,  // 200 not 500 — graceful degradation
      headers: { ...HEADERS, 'cache-control': 'no-cache' },  // don't cache errors
    });
  }
};
