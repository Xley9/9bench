-- v3.6 estimator migration
--
-- The multi-core estimator changed from `total work / wall clock` (bounded by
-- the slowest worker) to `sum of per-worker rates` over a fixed time window,
-- and the GPU headline changed from a max-of-samples to a true median.
--
-- Neither change can be back-computed for existing rows: only the aggregate was
-- ever stored, never the per-worker breakdown. So the pool FORKS rather than
-- migrates. Existing rows keep their numbers and their permalinks; they are
-- simply ranked separately and labelled.
--
-- estimator_version: NULL / absent  => pre-v3.6 (the old estimator)
--                    2              => v3.6+ (fixed window, summed rates, median GPU)
--
-- worker_elapsed_*: per-worker spread of the multi-core window, in ms. The gap
-- between min and max is a direct read on core heterogeneity. Collected since
-- v3.4 and discarded until now.
--
-- RUN THIS BEFORE DEPLOYING THE v3.6 CODE. Inserting into a column that does
-- not exist yet fails the whole submission with a 500.
--
--   npx wrangler d1 execute 9bench-results --remote --file schema-estimator-v36.sql

ALTER TABLE results ADD COLUMN estimator_version INTEGER;
ALTER TABLE results ADD COLUMN worker_elapsed_min_ms INTEGER;
ALTER TABLE results ADD COLUMN worker_elapsed_median_ms INTEGER;
ALTER TABLE results ADD COLUMN worker_elapsed_max_ms INTEGER;

-- Ranking queries filter on estimator_version, so index it alongside the score.
CREATE INDEX IF NOT EXISTS idx_results_estimator_score
  ON results (estimator_version, score_overall DESC);
