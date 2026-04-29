-- 9bench — AI capabilities migration (Phase G)
--
-- Adds 4 columns to existing `results` table for storing AI capability
-- data captured during the benchmark run. Existing rows get NULL —
-- /api/r/[id] returns those as "ai capability not measured for this run"
-- on the result page, with a "test again to get AI assessment" hint.
--
-- Apply ONCE with:
--   npx wrangler d1 execute 9bench-results --file=schema-ai-migration.sql
--
-- Idempotent: ALTER TABLE ... ADD COLUMN IF NOT EXISTS pattern.
-- (SQLite supports `ADD COLUMN` natively but not `IF NOT EXISTS` directly;
-- the safe fallback is to check before running, or run once and accept
-- the error on second run.)

ALTER TABLE results ADD COLUMN ai_score        INTEGER;
ALTER TABLE results ADD COLUMN ai_tier         TEXT;
ALTER TABLE results ADD COLUMN ai_max_alloc_gb REAL;
ALTER TABLE results ADD COLUMN ai_fp16         INTEGER;

-- Index for AI score queries (e.g. "top AI machines this week")
CREATE INDEX IF NOT EXISTS idx_ai_score ON results(ai_score) WHERE ai_score IS NOT NULL;
