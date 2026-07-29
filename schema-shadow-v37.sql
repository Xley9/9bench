-- v3.7 shadow telemetry — the v4.0 candidate workload's data collection.
--
-- Separate table on purpose: shadow rows are UNRANKED, UNSCORED telemetry
-- with a different trust regime from `results`. The scored pipeline
-- (submit.ts, results) is byte-identical in v3.7 — mixing shadow data into
-- `results` would couple the two and make that guarantee unprovable.
--
-- One row per submitted result whose browser completed the shadow phase.
-- Rows with verify_ok=0 or an error are stored too: the validation gate
-- (methodology, "The v4.0 gate") counts failure rates as a pass criterion.
--
-- RUN BEFORE DEPLOYING v3.7:
--   npx wrangler d1 execute 9bench-results --remote --file schema-shadow-v37.sql

CREATE TABLE IF NOT EXISTS shadow_runs (
  result_id            TEXT NOT NULL UNIQUE,  -- FK-by-convention -> results.id; UNIQUE blocks replay
  created_at           INTEGER NOT NULL,      -- ms epoch
  wl                   INTEGER NOT NULL,      -- candidate revision; the gate evaluates the final wl only
  probe_hashes_single  REAL,                  -- 0.4s old-workload re-run: throttle index vs scored phase
  int_single           REAL,                  -- SHA-256 chain steps/s, 1 worker
  fp_single            REAL,                  -- Mandelbrot pixel-iterations/s, 1 worker
  int_multi            REAL,                  -- sum of per-worker rates (v3.6 estimator, unchanged)
  fp_multi             REAL,
  single_elapsed_ms    INTEGER,
  multi_window_ms      INTEGER,               -- config may change across wl revisions
  workers_spawned      INTEGER,
  workers_reported     INTEGER,
  int_rate_min         REAL,                  -- per-worker RATE spread — the heterogeneity signal
  int_rate_median      REAL,                  -- (elapsed spread only diagnosed the old barrier;
  int_rate_max         REAL,                  --  with a fixed window, rates carry the information)
  worker_rates_json    TEXT,                  -- {"int":[...],"fp":[...]}, rounded — audit detail
  clock_skew_ms        INTEGER,               -- max |Δperf − ΔDate| across workers; sleep detector
  verify_ok            INTEGER,               -- 0/1; failures stored and counted, never dropped
  verify_fail_kernel   TEXT,                  -- 'int' | 'fp' | NULL
  went_hidden          INTEGER NOT NULL DEFAULT 0,  -- tab hidden DURING shadow; stored, excluded in analysis
  shadow_elapsed_ms    INTEGER,
  ua_short             TEXT,                  -- same low-entropy Browser/OS/Arch bucket as results
  cores                INTEGER,
  error                TEXT
);

CREATE INDEX IF NOT EXISTS idx_shadow_result ON shadow_runs(result_id);
CREATE INDEX IF NOT EXISTS idx_shadow_wl ON shadow_runs(wl, created_at);
