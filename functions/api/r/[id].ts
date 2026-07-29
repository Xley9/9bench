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
             ram_read_gbs, ram_write_gbs, ram_latency_ns,
             ai_score, ai_tier, ai_max_alloc_gb, ai_fp16,
             estimator_version, worker_elapsed_min_ms, worker_elapsed_median_ms, worker_elapsed_max_ms
      FROM results WHERE id = ?
    `).bind(id).first<any>();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Which components this run actually measured. Derived from the raw
    // columns: every metric is work/elapsed with a non-zero numerator, so a
    // real measurement is never exactly 0. Same discriminator as submit.ts,
    // top.ts and og.ts — no stored flag, no migration.
    // Which estimator produced this row. Legacy rows have no value.
    const estimatorVersion = Number(row.estimator_version) === 2 ? 2 : 1;
    const measured = {
      gpu:        Number(row.gpu_gflops) > 0,
      cpuSingle:  Number(row.cpu_hashes_single) > 0,
      cpuMulti:   Number(row.cpu_hashes_multi) > 0,
      ram:        Number(row.ram_read_gbs) > 0 && Number(row.ram_write_gbs) > 0,
      ramLatency: Number(row.ram_latency_ns) > 0,
    };
    const scorable = measured.cpuMulti && (measured.gpu || measured.ram);
    const basis: 'full' | 'cpu+ram' | 'gpu+cpu' | 'insufficient' =
      !scorable ? 'insufficient'
      : measured.gpu && measured.ram ? 'full'
      : measured.gpu ? 'gpu+cpu' : 'cpu+ram';

    // Percentile only within the same measurement class, and only for runs
    // that clear the scoring floor.
    let percentile = 0;
    let total = 0;
    if (scorable) {
      // Also split by estimator version — v3.6 changed the multi-core and GPU
      // computation and the old numbers cannot be converted.
      const POOL = `FROM results WHERE cpu_hashes_multi > 0
        AND (gpu_gflops > 0) = ?
        AND (ram_read_gbs > 0 AND ram_write_gbs > 0) = ?
        AND COALESCE(estimator_version, 1) = ?`;
      const hasGpu = measured.gpu ? 1 : 0;
      const hasRam = measured.ram ? 1 : 0;
      const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL}`)
        .bind(hasGpu, hasRam, estimatorVersion)
        .first<{ c: number }>();
      const lowerRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL} AND score_overall < ?`)
        .bind(hasGpu, hasRam, estimatorVersion, row.score_overall)
        .first<{ c: number }>();
      total = totalRow?.c || 1;
      percentile = Math.round(((lowerRow?.c || 0) / total) * 100);
    }

    // AI block is included only when this row was captured post-Phase-G
    // (older rows have NULL ai_* columns). UI should treat null as
    // "AI capability not measured for this run" and offer a re-test prompt.
    const aiBlock = row.ai_score != null ? {
      score: row.ai_score as number,
      tier: row.ai_tier as string,
      memory: { largestAllocatableGB: row.ai_max_alloc_gb as number | null },
      webgpu: { fp16: row.ai_fp16 === 1 },
    } : null;

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
        ram: { readGBs: row.ram_read_gbs, writeGBs: row.ram_write_gbs, latencyNs: row.ram_latency_ns },
        ai: aiBlock,
      },
      measured,
      basis,
      scorable,
      estimatorVersion,
      workerElapsedMs: estimatorVersion === 2 && row.worker_elapsed_min_ms != null ? {
        min: row.worker_elapsed_min_ms,
        median: row.worker_elapsed_median_ms,
        max: row.worker_elapsed_max_ms,
      } : null,
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
