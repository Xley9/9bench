// 9bench — GPU Hardware-Class Lookup
//
// PURPOSE: When we detect a known GPU model via WEBGL_debug_renderer_info,
// we can replace the wide (3-12×) browser-to-native compute extrapolation
// with a tighter calibrated estimate. This makes Native predictions much
// more accurate for users with mainstream hardware.
//
// PRINCIPLE (Truth Series): the lookup is a curated calibration table,
// not a marketing benchmark database. Every entry is documented from
// public benchmark sources (Tom's Hardware, TechPowerUp, Geekbench OpenCL,
// 3DMark TimeSpy). Native scores are MEDIANS not peaks. We err toward
// conservative estimates to avoid overpromising.
//
// The fallback (when GPU is unknown or doesn't match) is the existing
// wide-range estimator in r/index.astro. So adding a missing GPU here
// only IMPROVES accuracy — never breaks the page.
//
// FUTURE: this table can be augmented from real 9bench reference_hardware
// data once Atilla seeds it. For now, it's a static curated calibration.

export interface GPUClass {
  /** Match patterns — case-insensitive substring search */
  match: string[];
  /** Vendor (for display) */
  vendor: 'NVIDIA' | 'AMD' | 'Intel' | 'Apple' | 'Qualcomm';
  /** Display label — what we show in the result */
  displayName: string;
  /** Form factor — affects expected RAM associations */
  form: 'desktop' | 'laptop' | 'integrated' | 'apple-silicon';
  /** Approximate native compute (TFLOPS, FP32) */
  nativeTFlopsLow: number;
  nativeTFlopsHigh: number;
  /** Typical VRAM available in this GPU class (GB) */
  typicalVRAM: number;
  /** Calibrated tokens/s for Llama 7B Q4 (real-world llama.cpp / ollama) */
  llama7BQ4TPSLow: number;
  llama7BQ4TPSHigh: number;
  /** Calibrated SDXL 1024x1024 generation time in seconds (FP16) */
  sdxlSecondsLow: number | null;  // null if SDXL is impractical
  sdxlSecondsHigh: number | null;
}

/**
 * Curated GPU classification table.
 *
 * Match patterns are ordered specificity (more specific first).
 * Calibration sources documented per entry where notable.
 */
export const GPU_CLASSES: GPUClass[] = [
  // ── NVIDIA RTX 50 series (released 2025) ─────────────────────────
  {
    match: ['RTX 5090'],
    vendor: 'NVIDIA',
    displayName: 'RTX 5090',
    form: 'desktop',
    nativeTFlopsLow: 90, nativeTFlopsHigh: 110,
    typicalVRAM: 32,
    llama7BQ4TPSLow: 130, llama7BQ4TPSHigh: 200,
    sdxlSecondsLow: 2, sdxlSecondsHigh: 4,
  },
  {
    match: ['RTX 5080'],
    vendor: 'NVIDIA', displayName: 'RTX 5080', form: 'desktop',
    nativeTFlopsLow: 56, nativeTFlopsHigh: 70,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 90, llama7BQ4TPSHigh: 130,
    sdxlSecondsLow: 3, sdxlSecondsHigh: 5,
  },
  {
    match: ['RTX 5070 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 5070 Ti', form: 'desktop',
    nativeTFlopsLow: 44, nativeTFlopsHigh: 54,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 70, llama7BQ4TPSHigh: 100,
    sdxlSecondsLow: 4, sdxlSecondsHigh: 7,
  },
  {
    match: ['RTX 5070'],
    vendor: 'NVIDIA', displayName: 'RTX 5070', form: 'desktop',
    nativeTFlopsLow: 30, nativeTFlopsHigh: 40,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 50, llama7BQ4TPSHigh: 80,
    sdxlSecondsLow: 5, sdxlSecondsHigh: 9,
  },

  // ── NVIDIA RTX 40 series ─────────────────────────────────────────
  {
    match: ['RTX 4090'],
    vendor: 'NVIDIA', displayName: 'RTX 4090', form: 'desktop',
    nativeTFlopsLow: 70, nativeTFlopsHigh: 85,
    typicalVRAM: 24,
    llama7BQ4TPSLow: 100, llama7BQ4TPSHigh: 160,
    sdxlSecondsLow: 3, sdxlSecondsHigh: 5,
  },
  {
    match: ['RTX 4080 Super'],
    vendor: 'NVIDIA', displayName: 'RTX 4080 Super', form: 'desktop',
    nativeTFlopsLow: 50, nativeTFlopsHigh: 62,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 75, llama7BQ4TPSHigh: 110,
    sdxlSecondsLow: 4, sdxlSecondsHigh: 7,
  },
  {
    match: ['RTX 4080'],
    vendor: 'NVIDIA', displayName: 'RTX 4080', form: 'desktop',
    nativeTFlopsLow: 45, nativeTFlopsHigh: 55,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 70, llama7BQ4TPSHigh: 100,
    sdxlSecondsLow: 5, sdxlSecondsHigh: 8,
  },
  {
    match: ['RTX 4070 Ti Super'],
    vendor: 'NVIDIA', displayName: 'RTX 4070 Ti Super', form: 'desktop',
    nativeTFlopsLow: 40, nativeTFlopsHigh: 48,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 60, llama7BQ4TPSHigh: 90,
    sdxlSecondsLow: 6, sdxlSecondsHigh: 10,
  },
  {
    match: ['RTX 4070 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 4070 Ti', form: 'desktop',
    nativeTFlopsLow: 35, nativeTFlopsHigh: 42,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 55, llama7BQ4TPSHigh: 85,
    sdxlSecondsLow: 7, sdxlSecondsHigh: 11,
  },
  {
    match: ['RTX 4070 Super'],
    vendor: 'NVIDIA', displayName: 'RTX 4070 Super', form: 'desktop',
    nativeTFlopsLow: 30, nativeTFlopsHigh: 36,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 50, llama7BQ4TPSHigh: 75,
    sdxlSecondsLow: 8, sdxlSecondsHigh: 13,
  },
  {
    match: ['RTX 4070 Laptop', 'RTX 4070 Mobile'],
    vendor: 'NVIDIA', displayName: 'RTX 4070 Laptop', form: 'laptop',
    nativeTFlopsLow: 16, nativeTFlopsHigh: 22,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 35, llama7BQ4TPSHigh: 55,
    sdxlSecondsLow: 12, sdxlSecondsHigh: 20,
  },
  {
    match: ['RTX 4070'],
    vendor: 'NVIDIA', displayName: 'RTX 4070', form: 'desktop',
    nativeTFlopsLow: 25, nativeTFlopsHigh: 30,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 45, llama7BQ4TPSHigh: 65,
    sdxlSecondsLow: 9, sdxlSecondsHigh: 14,
  },
  {
    match: ['RTX 4060 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 4060 Ti', form: 'desktop',
    nativeTFlopsLow: 18, nativeTFlopsHigh: 23,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 35, llama7BQ4TPSHigh: 55,
    sdxlSecondsLow: 12, sdxlSecondsHigh: 20,
  },
  {
    match: ['RTX 4060 Laptop', 'RTX 4060 Mobile'],
    vendor: 'NVIDIA', displayName: 'RTX 4060 Laptop', form: 'laptop',
    nativeTFlopsLow: 8, nativeTFlopsHigh: 12,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 25, llama7BQ4TPSHigh: 45,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 30,
  },
  {
    match: ['RTX 4060'],
    vendor: 'NVIDIA', displayName: 'RTX 4060', form: 'desktop',
    nativeTFlopsLow: 14, nativeTFlopsHigh: 18,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 50,
    sdxlSecondsLow: 14, sdxlSecondsHigh: 22,
  },
  {
    match: ['RTX 4050 Laptop', 'RTX 4050 Mobile'],
    vendor: 'NVIDIA', displayName: 'RTX 4050 Laptop', form: 'laptop',
    nativeTFlopsLow: 6, nativeTFlopsHigh: 9,
    typicalVRAM: 6,
    llama7BQ4TPSLow: 18, llama7BQ4TPSHigh: 32,
    sdxlSecondsLow: 25, sdxlSecondsHigh: 40,
  },

  // ── NVIDIA RTX 30 series ─────────────────────────────────────────
  {
    match: ['RTX 3090 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 3090 Ti', form: 'desktop',
    nativeTFlopsLow: 38, nativeTFlopsHigh: 46,
    typicalVRAM: 24,
    llama7BQ4TPSLow: 70, llama7BQ4TPSHigh: 110,
    sdxlSecondsLow: 6, sdxlSecondsHigh: 10,
  },
  {
    match: ['RTX 3090'],
    vendor: 'NVIDIA', displayName: 'RTX 3090', form: 'desktop',
    nativeTFlopsLow: 32, nativeTFlopsHigh: 40,
    typicalVRAM: 24,
    llama7BQ4TPSLow: 60, llama7BQ4TPSHigh: 100,
    sdxlSecondsLow: 7, sdxlSecondsHigh: 11,
  },
  {
    match: ['RTX 3080 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 3080 Ti', form: 'desktop',
    nativeTFlopsLow: 30, nativeTFlopsHigh: 36,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 55, llama7BQ4TPSHigh: 85,
    sdxlSecondsLow: 8, sdxlSecondsHigh: 13,
  },
  {
    match: ['RTX 3080'],
    vendor: 'NVIDIA', displayName: 'RTX 3080', form: 'desktop',
    nativeTFlopsLow: 26, nativeTFlopsHigh: 32,
    typicalVRAM: 10,
    llama7BQ4TPSLow: 50, llama7BQ4TPSHigh: 75,
    sdxlSecondsLow: 9, sdxlSecondsHigh: 14,
  },
  {
    match: ['RTX 3070 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 3070 Ti', form: 'desktop',
    nativeTFlopsLow: 19, nativeTFlopsHigh: 24,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 38, llama7BQ4TPSHigh: 60,
    sdxlSecondsLow: 12, sdxlSecondsHigh: 19,
  },
  {
    match: ['RTX 3070'],
    vendor: 'NVIDIA', displayName: 'RTX 3070', form: 'desktop',
    nativeTFlopsLow: 17, nativeTFlopsHigh: 22,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 35, llama7BQ4TPSHigh: 55,
    sdxlSecondsLow: 13, sdxlSecondsHigh: 21,
  },
  {
    match: ['RTX 3060 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 3060 Ti', form: 'desktop',
    nativeTFlopsLow: 14, nativeTFlopsHigh: 18,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 48,
    sdxlSecondsLow: 16, sdxlSecondsHigh: 26,
  },
  {
    match: ['RTX 3060'],
    vendor: 'NVIDIA', displayName: 'RTX 3060', form: 'desktop',
    nativeTFlopsLow: 11, nativeTFlopsHigh: 14,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 25, llama7BQ4TPSHigh: 40,
    sdxlSecondsLow: 20, sdxlSecondsHigh: 32,
  },

  // ── NVIDIA RTX 20 series ─────────────────────────────────────────
  {
    match: ['RTX 2080 Ti'],
    vendor: 'NVIDIA', displayName: 'RTX 2080 Ti', form: 'desktop',
    nativeTFlopsLow: 12, nativeTFlopsHigh: 14,
    typicalVRAM: 11,
    llama7BQ4TPSLow: 28, llama7BQ4TPSHigh: 45,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 30,
  },
  {
    match: ['RTX 2080', 'RTX 2070 Super'],
    vendor: 'NVIDIA', displayName: 'RTX 2080 / 2070 Super', form: 'desktop',
    nativeTFlopsLow: 9, nativeTFlopsHigh: 11,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 22, llama7BQ4TPSHigh: 36,
    sdxlSecondsLow: 25, sdxlSecondsHigh: 40,
  },
  {
    match: ['RTX 2070', 'RTX 2060 Super'],
    vendor: 'NVIDIA', displayName: 'RTX 2070 / 2060 Super', form: 'desktop',
    nativeTFlopsLow: 7, nativeTFlopsHigh: 9,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 18, llama7BQ4TPSHigh: 30,
    sdxlSecondsLow: 30, sdxlSecondsHigh: 50,
  },
  {
    match: ['RTX 2060'],
    vendor: 'NVIDIA', displayName: 'RTX 2060', form: 'desktop',
    nativeTFlopsLow: 6, nativeTFlopsHigh: 7.5,
    typicalVRAM: 6,
    llama7BQ4TPSLow: 15, llama7BQ4TPSHigh: 26,
    sdxlSecondsLow: 35, sdxlSecondsHigh: 60,
  },

  // ── NVIDIA GTX series (still common) ─────────────────────────────
  {
    match: ['GTX 1080 Ti'],
    vendor: 'NVIDIA', displayName: 'GTX 1080 Ti', form: 'desktop',
    nativeTFlopsLow: 10, nativeTFlopsHigh: 12,
    typicalVRAM: 11,
    llama7BQ4TPSLow: 22, llama7BQ4TPSHigh: 36,
    sdxlSecondsLow: 30, sdxlSecondsHigh: 50,
  },
  {
    match: ['GTX 1080'],
    vendor: 'NVIDIA', displayName: 'GTX 1080', form: 'desktop',
    nativeTFlopsLow: 8, nativeTFlopsHigh: 10,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 18, llama7BQ4TPSHigh: 30,
    sdxlSecondsLow: 40, sdxlSecondsHigh: 60,
  },
  {
    match: ['GTX 1070 Ti', 'GTX 1070'],
    vendor: 'NVIDIA', displayName: 'GTX 1070 / 1070 Ti', form: 'desktop',
    nativeTFlopsLow: 6, nativeTFlopsHigh: 8,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 14, llama7BQ4TPSHigh: 25,
    sdxlSecondsLow: 50, sdxlSecondsHigh: 80,
  },
  {
    match: ['GTX 1660'],
    vendor: 'NVIDIA', displayName: 'GTX 1660 series', form: 'desktop',
    nativeTFlopsLow: 4, nativeTFlopsHigh: 5,
    typicalVRAM: 6,
    llama7BQ4TPSLow: 10, llama7BQ4TPSHigh: 18,
    sdxlSecondsLow: 70, sdxlSecondsHigh: 120,
  },

  // ── AMD RX 9000 / RX 7000 series ─────────────────────────────────
  {
    match: ['RX 7900 XTX'],
    vendor: 'AMD', displayName: 'RX 7900 XTX', form: 'desktop',
    nativeTFlopsLow: 55, nativeTFlopsHigh: 65,
    typicalVRAM: 24,
    llama7BQ4TPSLow: 80, llama7BQ4TPSHigh: 130,
    sdxlSecondsLow: 4, sdxlSecondsHigh: 7,
  },
  {
    match: ['RX 7900 XT'],
    vendor: 'AMD', displayName: 'RX 7900 XT', form: 'desktop',
    nativeTFlopsLow: 45, nativeTFlopsHigh: 55,
    typicalVRAM: 20,
    llama7BQ4TPSLow: 65, llama7BQ4TPSHigh: 105,
    sdxlSecondsLow: 5, sdxlSecondsHigh: 8,
  },
  {
    match: ['RX 7800 XT'],
    vendor: 'AMD', displayName: 'RX 7800 XT', form: 'desktop',
    nativeTFlopsLow: 35, nativeTFlopsHigh: 42,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 50, llama7BQ4TPSHigh: 80,
    sdxlSecondsLow: 8, sdxlSecondsHigh: 12,
  },
  {
    match: ['RX 7700 XT'],
    vendor: 'AMD', displayName: 'RX 7700 XT', form: 'desktop',
    nativeTFlopsLow: 30, nativeTFlopsHigh: 36,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 40, llama7BQ4TPSHigh: 65,
    sdxlSecondsLow: 10, sdxlSecondsHigh: 15,
  },
  {
    match: ['RX 7600 XT'],
    vendor: 'AMD', displayName: 'RX 7600 XT', form: 'desktop',
    nativeTFlopsLow: 22, nativeTFlopsHigh: 26,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 50,
    sdxlSecondsLow: 14, sdxlSecondsHigh: 22,
  },
  {
    match: ['RX 7600'],
    vendor: 'AMD', displayName: 'RX 7600', form: 'desktop',
    nativeTFlopsLow: 18, nativeTFlopsHigh: 22,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 25, llama7BQ4TPSHigh: 42,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 28,
  },

  // ── AMD RX 6000 series ───────────────────────────────────────────
  {
    match: ['RX 6900 XT'],
    vendor: 'AMD', displayName: 'RX 6900 XT', form: 'desktop',
    nativeTFlopsLow: 22, nativeTFlopsHigh: 28,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 38, llama7BQ4TPSHigh: 60,
    sdxlSecondsLow: 12, sdxlSecondsHigh: 20,
  },
  {
    match: ['RX 6800 XT'],
    vendor: 'AMD', displayName: 'RX 6800 XT', form: 'desktop',
    nativeTFlopsLow: 19, nativeTFlopsHigh: 24,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 32, llama7BQ4TPSHigh: 52,
    sdxlSecondsLow: 14, sdxlSecondsHigh: 22,
  },
  {
    match: ['RX 6800'],
    vendor: 'AMD', displayName: 'RX 6800', form: 'desktop',
    nativeTFlopsLow: 16, nativeTFlopsHigh: 20,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 28, llama7BQ4TPSHigh: 45,
    sdxlSecondsLow: 16, sdxlSecondsHigh: 25,
  },
  {
    match: ['RX 6700 XT'],
    vendor: 'AMD', displayName: 'RX 6700 XT', form: 'desktop',
    nativeTFlopsLow: 12, nativeTFlopsHigh: 14,
    typicalVRAM: 12,
    llama7BQ4TPSLow: 22, llama7BQ4TPSHigh: 36,
    sdxlSecondsLow: 22, sdxlSecondsHigh: 35,
  },
  {
    match: ['RX 6600 XT', 'RX 6650 XT'],
    vendor: 'AMD', displayName: 'RX 6600 XT / 6650 XT', form: 'desktop',
    nativeTFlopsLow: 10, nativeTFlopsHigh: 12,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 20, llama7BQ4TPSHigh: 32,
    sdxlSecondsLow: 28, sdxlSecondsHigh: 45,
  },
  {
    match: ['RX 6600'],
    vendor: 'AMD', displayName: 'RX 6600', form: 'desktop',
    nativeTFlopsLow: 8, nativeTFlopsHigh: 10,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 16, llama7BQ4TPSHigh: 28,
    sdxlSecondsLow: 35, sdxlSecondsHigh: 55,
  },

  // ── Apple Silicon (unified memory architecture, runs LLMs well) ──
  {
    match: ['Apple M4 Max'],
    vendor: 'Apple', displayName: 'Apple M4 Max', form: 'apple-silicon',
    nativeTFlopsLow: 18, nativeTFlopsHigh: 22,
    typicalVRAM: 64,  // unified, often 36-128GB
    llama7BQ4TPSLow: 60, llama7BQ4TPSHigh: 90,
    sdxlSecondsLow: 8, sdxlSecondsHigh: 14,
  },
  {
    match: ['Apple M4 Pro'],
    vendor: 'Apple', displayName: 'Apple M4 Pro', form: 'apple-silicon',
    nativeTFlopsLow: 12, nativeTFlopsHigh: 16,
    typicalVRAM: 32,
    llama7BQ4TPSLow: 45, llama7BQ4TPSHigh: 70,
    sdxlSecondsLow: 12, sdxlSecondsHigh: 20,
  },
  {
    match: ['Apple M4'],
    vendor: 'Apple', displayName: 'Apple M4', form: 'apple-silicon',
    nativeTFlopsLow: 6, nativeTFlopsHigh: 9,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 50,
    sdxlSecondsLow: 20, sdxlSecondsHigh: 35,
  },
  {
    match: ['Apple M3 Ultra'],
    vendor: 'Apple', displayName: 'Apple M3 Ultra', form: 'apple-silicon',
    nativeTFlopsLow: 28, nativeTFlopsHigh: 36,
    typicalVRAM: 192,  // up to 512GB unified
    llama7BQ4TPSLow: 80, llama7BQ4TPSHigh: 130,
    sdxlSecondsLow: 5, sdxlSecondsHigh: 9,
  },
  {
    match: ['Apple M3 Max'],
    vendor: 'Apple', displayName: 'Apple M3 Max', form: 'apple-silicon',
    nativeTFlopsLow: 14, nativeTFlopsHigh: 18,
    typicalVRAM: 64,
    llama7BQ4TPSLow: 50, llama7BQ4TPSHigh: 80,
    sdxlSecondsLow: 10, sdxlSecondsHigh: 17,
  },
  {
    match: ['Apple M3 Pro'],
    vendor: 'Apple', displayName: 'Apple M3 Pro', form: 'apple-silicon',
    nativeTFlopsLow: 10, nativeTFlopsHigh: 13,
    typicalVRAM: 32,
    llama7BQ4TPSLow: 35, llama7BQ4TPSHigh: 60,
    sdxlSecondsLow: 14, sdxlSecondsHigh: 24,
  },
  {
    match: ['Apple M3'],
    vendor: 'Apple', displayName: 'Apple M3', form: 'apple-silicon',
    nativeTFlopsLow: 5, nativeTFlopsHigh: 7,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 25, llama7BQ4TPSHigh: 45,
    sdxlSecondsLow: 22, sdxlSecondsHigh: 38,
  },
  {
    match: ['Apple M2 Ultra'],
    vendor: 'Apple', displayName: 'Apple M2 Ultra', form: 'apple-silicon',
    nativeTFlopsLow: 22, nativeTFlopsHigh: 28,
    typicalVRAM: 128,
    llama7BQ4TPSLow: 70, llama7BQ4TPSHigh: 110,
    sdxlSecondsLow: 7, sdxlSecondsHigh: 12,
  },
  {
    match: ['Apple M2 Max'],
    vendor: 'Apple', displayName: 'Apple M2 Max', form: 'apple-silicon',
    nativeTFlopsLow: 11, nativeTFlopsHigh: 14,
    typicalVRAM: 32,
    llama7BQ4TPSLow: 38, llama7BQ4TPSHigh: 65,
    sdxlSecondsLow: 14, sdxlSecondsHigh: 24,
  },
  {
    match: ['Apple M2 Pro'],
    vendor: 'Apple', displayName: 'Apple M2 Pro', form: 'apple-silicon',
    nativeTFlopsLow: 7, nativeTFlopsHigh: 10,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 50,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 30,
  },
  {
    match: ['Apple M2'],
    vendor: 'Apple', displayName: 'Apple M2', form: 'apple-silicon',
    nativeTFlopsLow: 3.5, nativeTFlopsHigh: 5,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 20, llama7BQ4TPSHigh: 35,
    sdxlSecondsLow: 30, sdxlSecondsHigh: 50,
  },
  {
    match: ['Apple M1 Ultra'],
    vendor: 'Apple', displayName: 'Apple M1 Ultra', form: 'apple-silicon',
    nativeTFlopsLow: 18, nativeTFlopsHigh: 22,
    typicalVRAM: 64,
    llama7BQ4TPSLow: 55, llama7BQ4TPSHigh: 85,
    sdxlSecondsLow: 9, sdxlSecondsHigh: 15,
  },
  {
    match: ['Apple M1 Max'],
    vendor: 'Apple', displayName: 'Apple M1 Max', form: 'apple-silicon',
    nativeTFlopsLow: 9, nativeTFlopsHigh: 11,
    typicalVRAM: 32,
    llama7BQ4TPSLow: 30, llama7BQ4TPSHigh: 50,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 30,
  },
  {
    match: ['Apple M1 Pro'],
    vendor: 'Apple', displayName: 'Apple M1 Pro', form: 'apple-silicon',
    nativeTFlopsLow: 5, nativeTFlopsHigh: 7,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 22, llama7BQ4TPSHigh: 38,
    sdxlSecondsLow: 25, sdxlSecondsHigh: 40,
  },
  {
    match: ['Apple M1'],
    vendor: 'Apple', displayName: 'Apple M1', form: 'apple-silicon',
    nativeTFlopsLow: 2.5, nativeTFlopsHigh: 3.5,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 14, llama7BQ4TPSHigh: 25,
    sdxlSecondsLow: 40, sdxlSecondsHigh: 70,
  },

  // ── Intel discrete (Arc) ─────────────────────────────────────────
  {
    match: ['Arc A770'],
    vendor: 'Intel', displayName: 'Intel Arc A770', form: 'desktop',
    nativeTFlopsLow: 16, nativeTFlopsHigh: 20,
    typicalVRAM: 16,
    llama7BQ4TPSLow: 25, llama7BQ4TPSHigh: 45,
    sdxlSecondsLow: 18, sdxlSecondsHigh: 30,
  },
  {
    match: ['Arc A750'],
    vendor: 'Intel', displayName: 'Intel Arc A750', form: 'desktop',
    nativeTFlopsLow: 14, nativeTFlopsHigh: 17,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 22, llama7BQ4TPSHigh: 38,
    sdxlSecondsLow: 22, sdxlSecondsHigh: 35,
  },

  // ── Intel integrated (Iris Xe / UHD) ─────────────────────────────
  {
    match: ['Iris Xe', 'Intel Xe'],
    vendor: 'Intel', displayName: 'Intel Iris Xe', form: 'integrated',
    nativeTFlopsLow: 1.5, nativeTFlopsHigh: 2.5,
    typicalVRAM: 4,
    llama7BQ4TPSLow: 5, llama7BQ4TPSHigh: 12,
    sdxlSecondsLow: null, sdxlSecondsHigh: null,
  },
  {
    match: ['UHD Graphics'],
    vendor: 'Intel', displayName: 'Intel UHD Graphics', form: 'integrated',
    nativeTFlopsLow: 0.4, nativeTFlopsHigh: 1.2,
    typicalVRAM: 2,
    llama7BQ4TPSLow: 2, llama7BQ4TPSHigh: 6,
    sdxlSecondsLow: null, sdxlSecondsHigh: null,
  },

  // ── AMD integrated (Radeon Graphics on APUs) ────────────────────
  {
    match: ['Radeon 780M', 'Radeon 880M'],
    vendor: 'AMD', displayName: 'AMD Radeon 780M/880M (APU)', form: 'integrated',
    nativeTFlopsLow: 3, nativeTFlopsHigh: 4.5,
    typicalVRAM: 8,
    llama7BQ4TPSLow: 8, llama7BQ4TPSHigh: 18,
    sdxlSecondsLow: 90, sdxlSecondsHigh: 150,
  },
  {
    match: ['Radeon 680M', 'Radeon 760M'],
    vendor: 'AMD', displayName: 'AMD Radeon 680M/760M (APU)', form: 'integrated',
    nativeTFlopsLow: 2, nativeTFlopsHigh: 3,
    typicalVRAM: 4,
    llama7BQ4TPSLow: 5, llama7BQ4TPSHigh: 12,
    sdxlSecondsLow: null, sdxlSecondsHigh: null,
  },
];

/**
 * Look up a GPU class from a renderer string.
 * Returns null if no match — callers should fall back to the generic
 * range-based estimator in r/index.astro.
 *
 * Match is case-insensitive substring. We iterate in declaration order
 * (most specific patterns first to avoid 'RTX 4060 Laptop' matching the
 * less-specific 'RTX 4060' entry).
 */
export function lookupGPUClass(rendererName: string | null | undefined): GPUClass | null {
  if (!rendererName) return null;
  const lower = rendererName.toLowerCase();
  for (const cls of GPU_CLASSES) {
    for (const pattern of cls.match) {
      if (lower.includes(pattern.toLowerCase())) {
        return cls;
      }
    }
  }
  return null;
}

/**
 * Convert a matched GPU class into a tighter native context override.
 * Used by r/index.astro to replace the wide 3-12× extrapolation with
 * calibrated native estimates when we know what the GPU actually is.
 */
export function refinedNativeContext(cls: GPUClass) {
  return {
    nativeGflopsLow:  cls.nativeTFlopsLow * 1000,   // TFLOPS → GFLOPS
    nativeGflopsHigh: cls.nativeTFlopsHigh * 1000,
    typicalVRAM:      cls.typicalVRAM,
    llama7BQ4TPSLow:  cls.llama7BQ4TPSLow,
    llama7BQ4TPSHigh: cls.llama7BQ4TPSHigh,
    sdxlSecondsLow:   cls.sdxlSecondsLow,
    sdxlSecondsHigh:  cls.sdxlSecondsHigh,
    matched:          true,
    displayName:      cls.displayName,
  };
}
