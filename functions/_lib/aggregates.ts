// Cached aggregates over `results`: row count, distinct GPUs, last-24h counter, percentile
// pools and the leaderboards. Semantics are identical to the live queries they replace
// (kept as the fallback in every endpoint); only the cost differs.
//
//   live query (before)                          cost per call     cached (now)
//   COUNT(*) / COUNT(DISTINCT gpu_name)          ~10k rows each    1 row
//   percentile: COUNT(*) pool + COUNT(*) lower   ~10k + ~5k rows   1 row (+ binary search)
//   leaderboard: ORDER BY + 2 x COUNT(*)         ~30k rows         1 row
//
// Refresh cost is ~N rows per snapshot, paid once per TTL by one request — independent of
// traffic. The TTL of the big snapshot scales with N so the daily cost stays flat as the
// table grows (see aggTtl).

import { CacheCtx, MIN, HOUR, readFresh, getEntry, putStatements } from './cache';

/** A "full run": every component measured. The leaderboard ranks only these. */
const FULL = 'gpu_gflops > 0 AND cpu_hashes_multi > 0 AND ram_read_gbs > 0 AND ram_write_gbs > 0';

/**
 * Estimator pool as a sargable condition (so idx_results_estimator_score can serve the
 * ORDER BY). `COALESCE(estimator_version, 1) = 1` is `IS NULL` because no row carries an
 * explicit 1: legacy rows are NULL, v3.6+ rows are 2 (submit.ts accepts nothing else).
 */
const estCond = (e: 1 | 2) => (e === 2 ? 'estimator_version = 2' : 'estimator_version IS NULL');

const TOP_N = 200; // the endpoint allows limit <= 200
const DAY = 86_400_000;

/**
 * TTL of the big snapshot (the pass over all rows): 0.12 s of snapshot age per row in the table
 * => at most ~0.7M rows read per day, whatever N is (86.4M ms / (120 ms x N) refreshes x N rows).
 * At today's 10.5k rows that is ~21 min. Between refreshes the pools miss the newest runs: `total`
 * lags by the runs of the last TTL (a handful at today's traffic, ~5 % in a 1,500-runs/hour burst);
 * the percentile moves far less than that. The caller's own row is always accounted for (see
 * poolPercentile).
 */
export function aggTtl(n: number): number {
  return Math.min(3 * HOUR, Math.max(15 * MIN, n * 120));
}

// ── refresh functions (one request runs these, guarded by a lease) ─────────────────────────

/**
 * One pass over the table: row count + one sorted score list per percentile pool.
 *
 * CPU matters here: the free plan allows ~10 ms per request and a refresh may land on a cold
 * isolate. Shipping 10.5k rows as arrays-of-columns cost ~9 ms to parse cold (measured), so SQLite
 * packs every row into ONE integer and returns a single JSON array of them (~56 KB, parsed in
 * well under a millisecond):  value = score*16 + gpu_measured*8 + ram_measured*4 + (estimator==2)*2 + multi_measured
 * (booleans exactly as in the pool definition). Rows read stay at N (one scan).
 */
export async function refreshAgg(db: D1Database): Promise<void> {
  const at = Date.now();
  const res = await db.prepare(
    `SELECT '[' || COALESCE(GROUP_CONCAT(
              score_overall * 16
              + (gpu_gflops > 0) * 8
              + (ram_read_gbs > 0 AND ram_write_gbs > 0) * 4
              + (COALESCE(estimator_version, 1) = 2) * 2
              + (cpu_hashes_multi > 0)), '') || ']' AS j
       FROM results`,
  ).first<{ j: string }>();
  const packed: number[] = JSON.parse(res?.j || '[]');

  // bucket index = gpu*4 + ram*2 + (estimator==2); only rows with a measured multi-core score are in a pool
  const buckets: number[][] = Array.from({ length: 8 }, () => []);
  for (let i = 0, n = packed.length; i < n; i++) {
    const v = packed[i];
    if (!(v & 1)) continue;
    buckets[(v >> 1) & 7].push(v >> 4);
  }

  const sizes: Record<string, number> = {};
  const entries: { key: string; value: string; updatedAt: number; expiresAt: number }[] = [];
  const expiresAt = at + aggTtl(packed.length);
  for (let b = 0; b < 8; b++) {
    const sorted = Int32Array.from(buckets[b]).sort();
    const key = `${b >> 2}:${(b >> 1) & 1}:${(b & 1) + 1}`;   // "<gpu>:<ram>:<estimator 1|2>"
    sizes[key] = sorted.length;
    entries.push({ key: 'pool:' + key, value: '[' + sorted.join(',') + ']', updatedAt: at, expiresAt });
  }
  entries.push({ key: 'meta:agg', value: JSON.stringify({ n: packed.length, sizes }), updatedAt: at, expiresAt });
  await db.batch(putStatements(db, entries));
}

export async function refreshGpus(db: D1Database): Promise<void> {
  const at = Date.now();
  const row = await db.prepare(
    "SELECT COUNT(DISTINCT gpu_name) AS n FROM results WHERE gpu_name IS NOT NULL AND gpu_name != ''",
  ).first<{ n: number }>();
  await db.batch(putStatements(db, [{ key: 'gpus', value: JSON.stringify({ n: row?.n ?? 0 }), updatedAt: at, expiresAt: at + 6 * HOUR }]));
}

export async function refreshLast24(db: D1Database): Promise<void> {
  const at = Date.now();
  // created_at is stored in MILLISECONDS (Date.now() in submit.ts).
  const row = await db.prepare('SELECT COUNT(*) AS n FROM results WHERE created_at > ?').bind(at - DAY).first<{ n: number }>();
  await db.batch(putStatements(db, [{ key: 'last24', value: JSON.stringify({ n: row?.n ?? 0 }), updatedAt: at, expiresAt: at + 5 * MIN }]));
}

const TOP_COLS = 'id, created_at, score_overall, score_gpu, score_cpu_multi, score_ram, gpu_gflops, gpu_name, cpu_cores';

/** Deterministic order: score desc, then oldest first (the live query left ties unspecified). */
const byRank = (a: any[], b: any[]) => (b[2] - a[2]) || (a[1] - b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** All six leaderboard payloads (all / week / month x estimator 1 / 2) from ~3k rows read. */
export async function refreshTop(db: D1Database): Promise<void> {
  const at = Date.now();

  // Totals for the all-time board come from the pool sizes (same "full run" set as pool 1:1:e).
  let sizes: Record<string, number> | null = null;
  const meta = await getEntry(db, 'meta:agg');
  if (meta) { try { sizes = JSON.parse(meta.value).sizes; } catch { sizes = null; } }

  const out: Record<string, { total: number; other: number; rows: any[][] }> = {};
  const allTotal: Record<number, number> = {};
  const allRows: Record<number, any[][]> = {};
  for (const e of [1, 2] as const) {
    allRows[e] = (await db.prepare(
      `SELECT ${TOP_COLS} FROM results WHERE ${estCond(e)} AND ${FULL}
        ORDER BY score_overall DESC, created_at ASC, id ASC LIMIT ${TOP_N}`,
    ).raw()) as any[][];
    if (sizes && typeof sizes[`1:1:${e}`] === 'number') {
      allTotal[e] = sizes[`1:1:${e}`];
    } else {
      const c = await db.prepare(`SELECT COUNT(*) AS c FROM results WHERE ${estCond(e)} AND ${FULL}`).first<{ c: number }>();
      allTotal[e] = c?.c ?? 0;
    }
  }
  out['all:1'] = { total: allTotal[1], other: allTotal[2], rows: allRows[1] };
  out['all:2'] = { total: allTotal[2], other: allTotal[1], rows: allRows[2] };

  // Week / month: one range scan over the created_at index, split in memory.
  const recent = (await db.prepare(
    `SELECT ${TOP_COLS}, COALESCE(estimator_version, 1) FROM results WHERE created_at > ? AND ${FULL}`,
  ).bind(at - 30 * DAY).raw()) as any[][];
  const sets: Record<number, any[][]> = { 1: [], 2: [] };
  for (const r of recent) (r[9] === 2 ? sets[2] : sets[1]).push(r);
  for (const e of [1, 2]) sets[e].sort(byRank);
  for (const [period, span] of [['month', 30 * DAY], ['week', 7 * DAY]] as const) {
    const cut = at - span;
    const win: Record<number, any[][]> = { 1: sets[1].filter((r) => r[1] > cut), 2: sets[2].filter((r) => r[1] > cut) };
    for (const e of [1, 2] as const) {
      const other = e === 1 ? 2 : 1;
      out[`${period}:${e}`] = { total: win[e].length, other: win[other].length, rows: win[e].slice(0, TOP_N).map((r) => r.slice(0, 9)) };
    }
  }

  const expiresAt = at + 10 * MIN;
  await db.batch(putStatements(db, Object.entries(out).map(([k, v]) => ({
    key: 'top:' + k, value: JSON.stringify(v), updatedAt: at, expiresAt,
  }))));
}

// ── readers used by the endpoints (every one returns null => caller runs its live query) ───

const lowerBound = (sorted: number[], x: number): number => {
  // number of elements strictly below x (the live query: score_overall < ?)
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
};

async function getPool(ctx: CacheCtx, g: number, r: number, e: number): Promise<{ scores: number[]; at: number } | null> {
  const ent = await readFresh(ctx, `pool:${g}:${r}:${e}`, 'agg', () => refreshAgg(ctx.db), 5 * MIN);
  if (!ent) return null;
  try { return { scores: JSON.parse(ent.value), at: ent.updatedAt }; } catch { return null; }
}

/**
 * Percentile within a measurement class, as the live queries compute it:
 *   total = rows in the pool, lower = rows with a strictly lower score, percentile = round(lower / total * 100).
 * `est` is the estimator pool (1 legacy / 2 v3.6+) or 'any' (og.ts historically ranks across both).
 * `createdAt` is the caller's own row: if it is newer than the snapshot it is not in the pool yet,
 * and the live query would have counted it in `total`, so it is added here.
 */
export async function poolPercentile(
  ctx: CacheCtx,
  o: { gpu: 0 | 1; ram: 0 | 1; est: 1 | 2 | 'any'; score: number; createdAt?: number },
): Promise<{ percentile: number; total: number } | null> {
  const ests = o.est === 'any' ? [1, 2] : [o.est];
  const pools = await Promise.all(ests.map((e) => getPool(ctx, o.gpu, o.ram, e)));
  if (pools.some((p) => !p)) return null;
  let lower = 0, total = 0, at = Infinity;
  for (const p of pools as { scores: number[]; at: number }[]) {
    lower += lowerBound(p.scores, o.score);
    total += p.scores.length;
    at = Math.min(at, p.at);
  }
  if (o.createdAt != null && o.createdAt > at) total += 1;
  total = total || 1;
  return { percentile: Math.round((lower / total) * 100), total };
}

export async function getStats(ctx: CacheCtx): Promise<{ total_runs: number; gpu_models_seen: number; last_24h: number } | null> {
  const [agg, gpus, last] = await Promise.all([
    readFresh(ctx, 'meta:agg', 'agg', () => refreshAgg(ctx.db), 5 * MIN),
    readFresh(ctx, 'gpus', 'gpus', () => refreshGpus(ctx.db), 10 * MIN),
    readFresh(ctx, 'last24', 'last24', () => refreshLast24(ctx.db), 1 * MIN),
  ]);
  if (!agg || !gpus || !last) return null;
  try {
    return { total_runs: JSON.parse(agg.value).n, gpu_models_seen: JSON.parse(gpus.value).n, last_24h: JSON.parse(last.value).n };
  } catch { return null; }
}

export async function getTop(
  ctx: CacheCtx, est: 1 | 2, period: 'all' | 'week' | 'month',
): Promise<{ total: number; other: number; rows: any[][] } | null> {
  const ent = await readFresh(ctx, `top:${period}:${est}`, 'top', () => refreshTop(ctx.db), 2 * MIN);
  if (!ent) return null;
  try { return JSON.parse(ent.value); } catch { return null; }
}
