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
  fingerprint TEXT,
  -- ── Phase G — AI capabilities (added 2026-04-29) ───────────────────
  -- Stored alongside the main result so visitors of /r/[id] see the
  -- ORIGINAL machine's AI capabilities, not their own. Critical for
  -- shareable links. Nullable so old rows (pre-Phase-G) still work.
  ai_score        INTEGER,    -- 0-3000+ AI Capability composite
  ai_tier         TEXT,       -- 'AI-S' | 'AI-A' | 'AI-B' | 'AI-Workstation' | 'AI-Office' | 'AI-Limited'
  ai_max_alloc_gb REAL,       -- Largest single TypedArray allocation in GB
  ai_fp16         INTEGER     -- WebGPU shader-f16 supported (0 or 1, nullable for unknown)
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
