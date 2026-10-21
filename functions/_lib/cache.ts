// Tiny snapshot cache on top of the D1 table `site_cache` (see schema-cache.sql).
//
// Why a D1 table and not the edge cache: Pages Functions responses come back as
// `cf-cache-status: DYNAMIC` — Cloudflare never serves them from its CDN cache, and the
// Cache API is per data centre, so a site with a few hundred visits a day almost never
// hits it. A D1 row is global: one row read per request, whatever the table size.
//
// Contract:
//   readFresh(...)  returns the entry or null. It NEVER throws. null means "no usable cache
//                   (table missing, lease held and nothing stored yet, refresh failed)" and the
//                   caller is expected to run its original live query instead.
//   fresh entry     -> returned as is (1 row read).
//   stale entry     -> returned immediately (stale-while-revalidate); one request refreshes it
//                      in the background (waitUntil), guarded by a lease row.
//   missing entry   -> this request refreshes it (or briefly waits for whoever holds the lease).
//
// A failed refresh keeps its lease until it expires, so a broken refresh is retried every few
// minutes at most — never on every request.

export interface CacheCtx {
  db: D1Database;
  waitUntil: (p: Promise<unknown>) => void;
}

export interface Entry {
  value: string;
  updatedAt: number; // ms epoch of the snapshot the payload describes
  expiresAt: number; // ms epoch after which the payload counts as stale
}

export const MIN = 60_000;
export const HOUR = 3_600_000;

export async function getEntry(db: D1Database, key: string): Promise<Entry | null> {
  const row = await db.prepare('SELECT value, updated_at, expires_at FROM site_cache WHERE key = ?')
    .bind(key).first<any>();
  if (!row || !row.value) return null;
  return { value: String(row.value), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at) };
}

/** Upsert statements for a batch — the lease column of the same key is left alone. */
export function putStatements(
  db: D1Database,
  entries: { key: string; value: string; updatedAt: number; expiresAt: number }[],
): D1PreparedStatement[] {
  return entries.map((e) =>
    db.prepare(
      `INSERT INTO site_cache (key, value, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
    ).bind(e.key, e.value, e.updatedAt, e.expiresAt),
  );
}

async function acquireLease(db: D1Database, group: string, ms: number): Promise<boolean> {
  const name = 'lease:' + group;
  const now = Date.now();
  const res = await db.batch([
    db.prepare('INSERT OR IGNORE INTO site_cache (key) VALUES (?)').bind(name),
    db.prepare('UPDATE site_cache SET lease_until = ? WHERE key = ? AND lease_until < ?').bind(now + ms, name, now),
  ]);
  return (res[1]?.meta?.changes ?? 0) === 1;
}

async function releaseLease(db: D1Database, group: string): Promise<void> {
  await db.prepare('UPDATE site_cache SET lease_until = 0 WHERE key = ?').bind('lease:' + group).run();
}

/**
 * Run `refresh` if (and only if) this caller wins the lease. Returns true when it ran to
 * completion. On failure the lease is deliberately NOT released: it expires on its own after
 * `leaseMs`, which is the back-off for a refresh that keeps failing.
 */
async function runRefresh(db: D1Database, group: string, refresh: () => Promise<void>, leaseMs: number): Promise<boolean> {
  try {
    if (!(await acquireLease(db, group, leaseMs))) return false;
  } catch (e: any) {
    console.error(`cache lease ${group} failed:`, e?.message || e);
    return false;
  }
  try {
    await refresh();
    await releaseLease(db, group);
    return true;
  } catch (e: any) {
    console.error(`cache refresh ${group} failed:`, e?.message || e);
    return false;
  }
}

export async function readFresh(
  ctx: CacheCtx,
  key: string,
  group: string,
  refresh: () => Promise<void>,
  leaseMs: number,
): Promise<Entry | null> {
  try {
    const entry = await getEntry(ctx.db, key);
    if (entry && entry.expiresAt > Date.now()) return entry;

    if (entry) {
      // Stale: answer now with what we have, refresh behind the response.
      ctx.waitUntil(runRefresh(ctx.db, group, refresh, leaseMs));
      return entry;
    }

    // Nothing stored yet: refresh here, or wait a moment for the request that is already doing it.
    // The job is also handed to waitUntil: if the visitor disconnects while we wait, the runtime
    // would otherwise cancel this request mid-refresh and the lease would stay set until it expires
    // (seen once right after the first deploy). runRefresh never rejects, so this is safe.
    const job = runRefresh(ctx.db, group, refresh, leaseMs);
    ctx.waitUntil(job);
    const ran = await job;
    if (!ran) {
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const e = await getEntry(ctx.db, key);
        if (e) return e;
      }
      return null;
    }
    return await getEntry(ctx.db, key);
  } catch (e: any) {
    console.error('cache read failed:', e?.message || e);
    return null;
  }
}
