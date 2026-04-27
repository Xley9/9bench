// GET /api/r/[id] — fetch a stored benchmark result + its current percentile

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id || '').slice(0, 16);
  if (!/^[a-f0-9]{8}$/.test(id)) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const row = await env.DB.prepare(`
      SELECT id, created_at, score_overall, score_gpu, score_cpu_single, score_cpu_multi, score_ram,
             gpu_gflops, gpu_name, cpu_cores, cpu_hashes_single, cpu_hashes_multi,
             ram_read_gbs, ram_write_gbs, ram_latency_ns
      FROM results WHERE id = ?
    `).bind(id).first<any>();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Recompute percentile against current global distribution
    const totalRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results').first<{ c: number }>();
    const lowerRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE score_overall < ?')
      .bind(row.score_overall)
      .first<{ c: number }>();

    const total = totalRow?.c || 1;
    const lower = lowerRow?.c || 0;
    const percentile = Math.round((lower / total) * 100);

    return new Response(JSON.stringify({
      ok: true,
      result: {
        id: row.id,
        createdAt: row.created_at,
        scores: {
          overall: row.score_overall,
          gpu: row.score_gpu,
          cpuSingle: row.score_cpu_single,
          cpuMulti: row.score_cpu_multi,
          ram: row.score_ram
        },
        gpu: { gflops: row.gpu_gflops, name: row.gpu_name },
        cpu: { cores: row.cpu_cores, hashesSingle: row.cpu_hashes_single, hashesMulti: row.cpu_hashes_multi },
        ram: { readGBs: row.ram_read_gbs, writeGBs: row.ram_write_gbs, latencyNs: row.ram_latency_ns }
      },
      percentile,
      total
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
