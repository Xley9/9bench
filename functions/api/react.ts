// POST /api/react — record a reaction (match/off/surprised) on a result

interface Env {
  DB: D1Database;
}

const VALID_REACTIONS = new Set(['match', 'off', 'surprised']);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { id?: string; reaction?: string };
    const id = String(body.id || '').slice(0, 16);
    const reaction = String(body.reaction || '');

    if (!/^[a-f0-9]{8}$/.test(id) || !VALID_REACTIONS.has(reaction)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid input' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    await env.DB.prepare('INSERT INTO reactions (result_id, reaction, created_at) VALUES (?, ?, ?)')
      .bind(id, reaction, Date.now())
      .run();

    return new Response(JSON.stringify({ ok: true }), {
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
