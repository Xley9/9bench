-- Read-cache for the aggregate endpoints (stats, percentile, leaderboard).
--
-- WHY: every request used to full-scan `results` several times (COUNT(*), COUNT(DISTINCT
-- gpu_name), two percentile counts, leaderboard totals). At ~10.5k rows that is ~25-50k
-- D1 rows read per visitor and ~4.6M/day in total — right at the Cloudflare free-tier
-- limit of 5M rows read per DAY (account-wide). Edge caching does not help: Pages
-- Functions answer `cf-cache-status: DYNAMIC`, so every call reaches D1.
--
-- WHAT: a tiny key/value table. A snapshot of the aggregates is computed at most every
-- few minutes to hours (TTL scales with table size, see functions/_lib/cache.ts) by
-- whichever request finds it stale, guarded by a lease row so only one request refreshes.
-- Every other request reads ONE row. If this table is missing or unreadable the endpoints
-- fall back to the original live queries, so the site never depends on it.
--
-- RUN BEFORE DEPLOYING (migration only adds a table, nothing is altered or deleted):
--   npx wrangler d1 execute 9bench-results --remote --file schema-cache.sql

CREATE TABLE IF NOT EXISTS site_cache (
  key         TEXT PRIMARY KEY,
  value       TEXT    NOT NULL DEFAULT '',   -- JSON payload (empty for lease rows)
  updated_at  INTEGER NOT NULL DEFAULT 0,    -- ms epoch of the snapshot the payload describes
  expires_at  INTEGER NOT NULL DEFAULT 0,    -- ms epoch after which the payload counts as stale
  lease_until INTEGER NOT NULL DEFAULT 0     -- refresh lease (ms epoch); only used by `lease:*` rows
);
