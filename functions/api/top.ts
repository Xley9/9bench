// GET /api/top?limit=100 — return top N benchmark results (anonymous)
// Used by /top leaderboard page
//
// Each call used to cost three full scans of `results` (~30k D1 rows): the ORDER BY could not use
// the estimator index because of COALESCE(estimator_version, 1), plus two COUNT(*) totals. The
// boards (all / week / month x estimator) now come from a snapshot refreshed every few minutes
// (functions/_lib/aggregates.ts, 1 row read per call, top 200 each; `limit` slices it). New
// results therefore reach the board after the next refresh (<= ~10 min), not instantly. The
// original live queries below remain as the fallback.

import { getTop } from '../_lib/aggregates';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') || '50') || 50));
  const period = url.searchParams.get('period') || 'all'; // all|week|month
  // Which estimator generation to rank. v3.6 changed how multi-core throughput
  // and the GPU headline are computed; the old numbers cannot be converted, so
  // the board forks rather than migrates. Default stays on the legacy pool
  // until the v3.6 pool has enough entries to be a meaningful ranking.
  const estimator = url.searchParams.get('estimator') === '2' ? 2 : 1;

  // Leaderboard ranks FULL runs only — every component measured. Partial runs
  // use a renormalized formula and compete on a different basis; runs with a
  // failed sub-test (raw metric exactly 0) are excluded entirely.
  let timeFilter = ' WHERE gpu_gflops > 0 AND cpu_hashes_multi > 0'
                 + ' AND ram_read_gbs > 0 AND ram_write_gbs > 0'
                 + ` AND COALESCE(estimator_version, 1) = ${estimator}`;
  if (period === 'week') {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    timeFilter += ` AND created_at > ${weekAgo}`;
  } else if (period === 'month') {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    timeFilter += ` AND created_at > ${monthAgo}`;
  }

  try {
    // Cached boards. Unknown `period` values behave like 'all' (as in the live filter below).
    const board = await getTop(
      { db: env.DB, waitUntil },
      estimator as 1 | 2,
      period === 'week' || period === 'month' ? period : 'all',
    );
    if (board) {
      return new Response(JSON.stringify({
        ok: true,
        period,
        estimator,
        otherEstimatorTotal: board.other,
        total: board.total,
        results: board.rows.slice(0, limit).map((r: any[], i: number) => ({
          rank: i + 1,
          id: r[0],
          createdAt: r[1],
          scores: { overall: r[2], gpu: r[3], cpuMulti: r[4], ram: r[5] },
          gpu: { gflops: r[6], name: r[7] },
          cpu: { cores: r[8] }
        }))
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=60'
        }
      });
    }

    // Fallback: the original live queries.
    const rows = await env.DB.prepare(`
      SELECT id, created_at, score_overall, score_gpu, score_cpu_multi, score_ram,
             gpu_gflops, gpu_name, cpu_cores
      FROM results${timeFilter}
      ORDER BY score_overall DESC
      LIMIT ?
    `).bind(limit).all<any>();

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM results${timeFilter}`).first<{ c: number }>();

    // Size of the other pool, so the UI can offer the switch honestly.
    const otherFilter = timeFilter.replace(
      `COALESCE(estimator_version, 1) = ${estimator}`,
      `COALESCE(estimator_version, 1) = ${estimator === 2 ? 1 : 2}`
    );
    const otherRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM results${otherFilter}`).first<{ c: number }>();

    return new Response(JSON.stringify({
      ok: true,
      period,
      estimator,
      otherEstimatorTotal: otherRow?.c || 0,
      total: totalRow?.c || 0,
      results: (rows.results || []).map((r: any, i: number) => ({
        rank: i + 1,
        id: r.id,
        createdAt: r.created_at,
        scores: {
          overall: r.score_overall,
          gpu: r.score_gpu,
          cpuMulti: r.score_cpu_multi,
          ram: r.score_ram
        },
        gpu: { gflops: r.gpu_gflops, name: r.gpu_name },
        cpu: { cores: r.cpu_cores }
      }))
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60'
      }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'Server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};
