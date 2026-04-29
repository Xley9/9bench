// GET /api/reference-hardware — fetch baseline reference scores for the
// "VS. KNOWN HARDWARE" comparison bars on the Result page.
//
// Returns up to 8 reference builds (closest to user's score by default,
// or filtered by ?category= if specified). Each row includes name +
// baseline_score so the frontend can render delta % bars against the
// user's actual score.
//
// Empty table → empty results array → Result page shows Phase2Placeholder.
// Never fabricate; if Atilla hasn't seeded data, the bars stay hidden.

interface Env {
  DB: D1Database;
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // 5min edge cache — reference data changes rarely (only when Atilla seeds new builds)
  'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=900',
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '8') || 8));
  const category = url.searchParams.get('category');     // 'desktop' | 'laptop' | 'mobile' | 'handheld'
  const around = parseInt(url.searchParams.get('around') || '0') || 0;  // user's score, for "closest match" sort

  try {
    let query: D1PreparedStatement;
    if (category) {
      query = env.DB.prepare(`
        SELECT id, name, category, baseline_score, notes
        FROM reference_hardware
        WHERE category = ?
        ORDER BY ${around > 0 ? 'ABS(baseline_score - ?)' : 'baseline_score DESC'}
        LIMIT ?
      `);
      query = around > 0
        ? query.bind(category, around, limit)
        : query.bind(category, limit);
    } else if (around > 0) {
      query = env.DB.prepare(`
        SELECT id, name, category, baseline_score, notes
        FROM reference_hardware
        ORDER BY ABS(baseline_score - ?)
        LIMIT ?
      `).bind(around, limit);
    } else {
      query = env.DB.prepare(`
        SELECT id, name, category, baseline_score, notes
        FROM reference_hardware
        ORDER BY baseline_score DESC
        LIMIT ?
      `).bind(limit);
    }

    const rows = await query.all<any>();
    const items = (rows.results || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      score: r.baseline_score,
      notes: r.notes,
    }));

    return new Response(JSON.stringify({
      ok: true,
      items,
      total: items.length,
    }), { headers: HEADERS });
  } catch (e: any) {
    // Most common: table doesn't exist yet (migration not run). Fail
    // gracefully so the Result page falls back to Phase 2 placeholder.
    console.error('reference-hardware endpoint error', e?.message || e);
    return new Response(JSON.stringify({
      ok: true,        // ok:true so frontend treats as "no data" not "broken"
      items: [],
      total: 0,
      reason: 'reference_hardware table empty or not migrated',
    }), {
      status: 200,
      headers: { ...HEADERS, 'cache-control': 'no-cache' },
    });
  }
};
