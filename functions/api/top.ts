// GET /api/top?limit=100 — return top N benchmark results (anonymous)
// Used by /top leaderboard page

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') || '50') || 50));
  const period = url.searchParams.get('period') || 'all'; // all|week|month

  let timeFilter = '';
  if (period === 'week') {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    timeFilter = ` WHERE created_at > ${weekAgo}`;
  } else if (period === 'month') {
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    timeFilter = ` WHERE created_at > ${monthAgo}`;
  }

  try {
    const rows = await env.DB.prepare(`
      SELECT id, created_at, score_overall, score_gpu, score_cpu_multi, score_ram,
             gpu_gflops, gpu_name, cpu_cores
      FROM results${timeFilter}
      ORDER BY score_overall DESC
      LIMIT ?
    `).bind(limit).all<any>();

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM results${timeFilter}`).first<{ c: number }>();

    return new Response(JSON.stringify({
      ok: true,
      period,
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
