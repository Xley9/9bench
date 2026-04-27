// POST /api/submit — store benchmark result, return short ID + percentile
// Body: { scores, gpu, cpu, ram, hardware, durationMs, ua_short, fingerprint }

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
  fingerprint?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as Submission;

    // Sanity-check: refuse obviously bad data
    const s = body?.scores;
    if (!s || typeof s.overall !== 'number' || s.overall < 0 || s.overall > 50000) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid scores' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Try a few times if random ID collides (extremely rare)
    let id = makeId();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await env.DB.prepare('SELECT id FROM results WHERE id = ?').bind(id).first();
      if (!existing) break;
      id = makeId();
      attempts++;
    }

    const ua = (request.headers.get('user-agent') || '').slice(0, 200);
    const ua_short = clean(ua, 200);

    await env.DB.prepare(`
      INSERT INTO results
        (id, created_at, score_overall, score_gpu, score_cpu_single, score_cpu_multi, score_ram,
         gpu_gflops, gpu_name, cpu_cores, cpu_hashes_single, cpu_hashes_multi,
         ram_read_gbs, ram_write_gbs, ram_latency_ns, ua_short, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      clean(body.fingerprint || '', 64)
    ).run();

    // Compute percentile: count rows with score < this user's overall, divide by total
    const totalRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results').first<{ c: number }>();
    const lowerRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE score_overall < ?')
      .bind(Math.round(s.overall))
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
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'Server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};
