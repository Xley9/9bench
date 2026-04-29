#!/usr/bin/env node
/**
 * 9bench — Reference Hardware Seed Helper
 *
 * Usage:
 *   node scripts/seed-reference-hardware.mjs <hashId> "<displayName>" <category> ["<notes>"]
 *
 * Examples:
 *   # Seed your RTX 4060 Laptop test as a reference
 *   node scripts/seed-reference-hardware.mjs 0007b3b1 "RTX 4060 Laptop · Atilla" laptop "Test Apr 2026"
 *
 *   # Seed an M2 Pro MacBook
 *   node scripts/seed-reference-hardware.mjs abc123de "M2 Pro MacBook 14\"" laptop "Tested via Safari 26"
 *
 *   # Seed a workstation
 *   node scripts/seed-reference-hardware.mjs 9b020c11 "Ryzen 9 + RTX 4090" desktop "Friend's build"
 *
 * What it does:
 *   1. Looks up the hash in `results` table to get the score_overall
 *   2. INSERTs a row into `reference_hardware` linking back to that result
 *   3. The /api/reference-hardware endpoint will pick it up automatically
 *   4. Result page <HardwareComparisonBars> stops showing Phase 2 placeholder
 *      once you have ≥3 reference rows
 *
 * Categories: 'desktop' | 'laptop' | 'mobile' | 'handheld'
 *
 * Requires: wrangler installed (already in this repo's package.json).
 * Run from the project root.
 */

import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
if (argv.length < 3) {
  console.error('Usage: node scripts/seed-reference-hardware.mjs <hashId> "<displayName>" <category> ["<notes>"]');
  console.error('  category must be one of: desktop, laptop, mobile, handheld');
  process.exit(1);
}

const [hashId, displayName, category, notes = ''] = argv;

if (!/^[a-f0-9]{8}$/i.test(hashId)) {
  console.error(`Invalid hash: "${hashId}". Must be 8 hex characters.`);
  process.exit(1);
}

if (!['desktop', 'laptop', 'mobile', 'handheld'].includes(category)) {
  console.error(`Invalid category: "${category}". Use: desktop | laptop | mobile | handheld`);
  process.exit(1);
}

if (displayName.length < 3 || displayName.length > 80) {
  console.error(`displayName must be 3-80 characters. Got ${displayName.length}.`);
  process.exit(1);
}

// Step 1 — fetch the score from the source result
console.log(`\n[1/2] Looking up score for hash ${hashId}…`);
let score;
try {
  const queryResult = execSync(
    `npx wrangler d1 execute 9bench-results --remote --command "SELECT score_overall FROM results WHERE id = '${hashId}'" --json`,
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  // Wrangler output is wrapped in array; parse it
  const parsed = JSON.parse(queryResult);
  const rows = parsed?.[0]?.results;
  if (!rows || rows.length === 0) {
    console.error(`No result found for hash ${hashId}. Did you submit this test?`);
    process.exit(1);
  }
  score = rows[0].score_overall;
  console.log(`     ✓ Found score: ${score.toLocaleString()}`);
} catch (e) {
  console.error(`Failed to query D1: ${e.message}`);
  console.error('Make sure you have wrangler installed and authenticated.');
  process.exit(1);
}

// Step 2 — insert the reference_hardware row
console.log(`\n[2/2] Inserting reference_hardware row…`);
// Escape single quotes in user input for SQL safety
const safeName = displayName.replace(/'/g, "''");
const safeNotes = notes.replace(/'/g, "''");
const sql = `INSERT INTO reference_hardware (name, category, baseline_score, source_run_id, notes) VALUES ('${safeName}', '${category}', ${score}, '${hashId}', '${safeNotes}');`;

try {
  execSync(
    `npx wrangler d1 execute 9bench-results --remote --command "${sql}"`,
    { encoding: 'utf-8', stdio: 'inherit' }
  );
  console.log(`\n✓ SEEDED: "${displayName}" (${category}) → score ${score.toLocaleString()}`);
  console.log(`  Linked to /r/${hashId}/`);
  console.log(`\nVerify on: https://9bench.com/api/reference-hardware`);
  console.log(`Result pages will show comparison bars once you have ≥3 reference entries.\n`);
} catch (e) {
  console.error(`Insert failed: ${e.message}`);
  process.exit(1);
}
