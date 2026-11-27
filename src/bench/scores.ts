// 9bench — per-component score formulas.
//
// Single source for the transforms documented on /methodology#formulas.
// Used by the full run (runner.ts) and by the single-component test pages
// (/ram-test/, /gpu-test/, /cpu-test/) so the two can never drift apart.
// Callers must check the component's `measured` flag first — these functions
// turn raw numbers into scores, they do not decide whether a number is real.

/** GPU score = round(GFLOPS × 3) — 500 GFLOPS → 1500 */
export const gpuScore = (gflops: number): number => Math.round(gflops * 3);

/** CPU single-core score = round(SHA-256 hashes/sec ÷ 300) — 400K h/s → 1333 */
export const cpuSingleScore = (hashesPerSecond: number): number => Math.round(hashesPerSecond / 300);

/** CPU multi-core score = round(SHA-256 hashes/sec ÷ 600) — 1.2M h/s → 2000 */
export const cpuMultiScore = (hashesPerSecond: number): number => Math.round(hashesPerSecond / 600);

/** RAM score = round(avg(read GB/s, write GB/s) × 60) */
export const ramScore = (readGBs: number, writeGBs: number): number =>
  Math.round(((readGBs + writeGBs) / 2) * 60);
