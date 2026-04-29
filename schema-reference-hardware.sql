-- 9bench — reference_hardware migration (Phase F.1)
--
-- Powers the "VS. KNOWN HARDWARE" comparison bars on the Result page.
-- Each row is a representative build with a known 9bench score, used
-- to give users a relative anchor ("you're +18% vs M1 MacBook Pro").
--
-- Seed strategy: Atilla seeds these from real tests on hardware he
-- can access (his own machines + family + friends + potential future
-- crowdsourced contributions). NEVER fabricated — if we don't have
-- a real test, the row doesn't exist and the comparison-bar Phase 2
-- placeholder shows instead.
--
-- Apply with:
--   wrangler d1 execute 9bench-results --file=schema-reference-hardware.sql

CREATE TABLE IF NOT EXISTS reference_hardware (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,           -- "M1 MacBook Pro 14\""
  category        TEXT NOT NULL,           -- 'desktop' | 'laptop' | 'mobile' | 'handheld'
  baseline_score  INTEGER NOT NULL,        -- 9bench overall score
  source_run_id   TEXT,                    -- optional: link to a `results` row that was the source
  notes           TEXT,                    -- "Tested by Atilla, Apr 2026, Chrome 124"
  added_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ref_hw_category ON reference_hardware(category);
CREATE INDEX IF NOT EXISTS idx_ref_hw_score    ON reference_hardware(baseline_score DESC);

-- ────────────────────────────────────────────────────────────────────
-- Seed examples — uncomment and adjust after running real tests.
-- DO NOT seed with guessed scores. Run 9bench on the actual hardware,
-- copy the score, and insert the row with the source_run_id from the
-- `results` table.
-- ────────────────────────────────────────────────────────────────────

-- Example shape (commented out so this migration is a no-op without seeds):
-- INSERT INTO reference_hardware (name, category, baseline_score, source_run_id, notes) VALUES
--   ('M1 MacBook Pro 14"',   'laptop',  1180, 'abc12345', 'Apple Silicon · Chrome 124 · Apr 2026'),
--   ('M2 Pro MacBook Pro',   'laptop',  1420, 'def67890', 'Apple Silicon · Safari 26 · Apr 2026'),
--   ('Ryzen 7 5800X3D + RX 6800 XT', 'desktop', 1170, 'fed09876', 'Windows 11 · Firefox 147 · Apr 2026'),
--   ('Intel i7-12700K + RTX 4070',   'desktop', 1280, 'cab54321', 'Windows 11 · Edge 123 · Apr 2026'),
--   ('Steam Deck OLED',      'handheld', 660,  'ade87654', 'SteamOS · Chrome 124 · Apr 2026');
