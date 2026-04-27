-- 9bench Results Schema
-- Stores anonymous benchmark submissions for global percentile ranking

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  score_overall INTEGER NOT NULL,
  score_gpu INTEGER NOT NULL,
  score_cpu_single INTEGER NOT NULL,
  score_cpu_multi INTEGER NOT NULL,
  score_ram INTEGER NOT NULL,
  gpu_gflops REAL NOT NULL,
  gpu_name TEXT,
  cpu_cores INTEGER NOT NULL,
  cpu_hashes_single INTEGER NOT NULL,
  cpu_hashes_multi INTEGER NOT NULL,
  ram_read_gbs REAL NOT NULL,
  ram_write_gbs REAL NOT NULL,
  ram_latency_ns REAL NOT NULL,
  ua_short TEXT,
  fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_score_overall ON results(score_overall);
CREATE INDEX IF NOT EXISTS idx_created_at ON results(created_at DESC);

-- Reaction table (lightweight, no FK to allow non-blocking writes)
CREATE TABLE IF NOT EXISTS reactions (
  result_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reactions_result ON reactions(result_id);
