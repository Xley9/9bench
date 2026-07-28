// 9bench — Orchestrator
// Runs WebGPU + CPU + RAM benchmarks, composes overall 9bench Score.
//
// Score Methodology (transparent, documented — matches /methodology page):
//   GPU Score    = round(GFLOPS × 3)                     — 500 GFLOPS → 1500
//   CPU Single   = round(SHA-hashes/sec ÷ 300)           — 400K h/s → 1333
//   CPU Multi    = round(SHA-hashes/sec ÷ 600)           — 1.2M h/s → 2000
//   RAM Score    = round(avg(read+write GB/s) × 60)
//   Overall      = weighted geometric mean over the MEASURED components
//                  (GPU 35% · CPU-multi 45% · RAM 20%), weights renormalized
//                  over whatever was measured. A component that could not be
//                  measured is never entered as a zero. Runs measuring less
//                  than 65% of the total weight are not scored at all.
//                  Measurement classes are ranked in separate percentile
//                  pools; the leaderboard lists full runs only.
//
// The geometric mean prevents a single weak component from being masked
// by strong ones — better than arithmetic mean for hardware composites.

import { runWebGPUBench, type WebGPUResult } from './webgpu-test';
import { runCPUBench, type CPUResult } from './cpu-test';
import { runRAMBench, type RAMResult } from './ram-test';
import { detectHardware, type HardwareInfo } from './hardware-detect';
import { probeAICapabilities, type AICapabilities } from './ai-capabilities';

export interface BenchResult {
  timestamp: number;
  durationMs: number;
  hardware: {
    cores: number;
    /** Human-readable GPU name (best effort). Falls back to '' when browser blocks. */
    gpu: string;
    /** Full honest hardware detection result — UI uses this for richer display. */
    info: HardwareInfo;
    ua: string;
  };
  gpu: WebGPUResult;
  cpu: CPUResult;
  ram: RAMResult;
  /** AI workload capabilities (Phase G — local-AI differentiator vs UserBenchmark/Geekbench) */
  ai?: AICapabilities;
  scores: {
    gpu: number;
    cpuSingle: number;
    cpuMulti: number;
    ram: number;
    overall: number;
  };
  /**
   * Which components actually produced a measurement. An unmeasured component
   * keeps a score of 0 (the D1 columns are NOT NULL) — these flags are what
   * distinguish that from a genuine zero, and every renderer must consult them
   * before printing a number.
   */
  measured: {
    gpu: boolean;
    cpuSingle: boolean;
    cpuMulti: boolean;
    ram: boolean;
    ramLatency: boolean;
  };
  /** false ⇒ too little was measured to be a benchmark: don't score, don't submit */
  scorable: boolean;
}

export type Stage = 'gpu' | 'cpu' | 'ram' | 'done';
export type ProgressCallback = (stage: Stage, percent: number, message: string) => void;

export async function runFullBench(onProgress?: ProgressCallback): Promise<BenchResult> {
  const startTotal = performance.now();

  // Honest hardware detection runs first so even if a benchmark fails
  // we still know what hardware we're on. Detection is fast (<50ms),
  // never blocks, and never invents data.
  const hardwareInfo = await detectHardware();

  onProgress?.('gpu', 0, 'Probing GPU…');
  const gpu = await runWebGPUBench(1024, 5);
  onProgress?.('gpu', 100, gpu.supported ? `GPU ${gpu.gflops.toFixed(0)} GFLOPS` : 'GPU not available');

  onProgress?.('cpu', 0, 'Hashing on single core…');
  const cpu = await runCPUBench();
  onProgress?.('cpu', 100, `CPU ${Math.round(cpu.hashesPerSecondSingle)} h/s`);

  onProgress?.('ram', 0, 'Pumping memory…');
  const ram = await runRAMBench(256);
  onProgress?.('ram', 100, `RAM ${ram.readBandwidthGBs.toFixed(1)} GB/s read`);

  // ── AI capabilities probe (Phase G) ────────────────────────────────
  // Quick (<1s) capability scan that produces "what your PC can run
  // locally" predictions — Llama 7B/13B/70B, SDXL, SD 1.5, Whisper.
  // This is the differentiator vs UserBenchmark/Geekbench for 2026.
  // Failures here must NOT break the main bench result — wrap defensively.
  let ai: AICapabilities | undefined;
  try {
    ai = await probeAICapabilities(gpu.gflops || 0, ram.readBandwidthGBs || 0);
  } catch (e) {
    console.warn('AI capabilities probe failed (non-fatal):', e);
    ai = undefined;
  }

  // ── Calibrated scoring (v3, browser-API-aware) ───────────────────────
  // Browser APIs cap real measurable performance (Web Crypto serialization,
  // Worker pool limits, JIT inconsistency). Score formulas adjusted for what's
  // achievable in browser, not native ceiling.
  // Target: typical 2024 laptop ≈ 1200, mainstream ≈ 1800, high-end ≈ 3000+
  const measured = {
    gpu:        gpu.supported && gpu.gflops > 0,
    cpuSingle:  cpu.singleMeasured,
    cpuMulti:   cpu.multiMeasured,
    ram:        ram.measured,
    ramLatency: ram.latencyMeasured,
  };

  const scoreGpu = measured.gpu ? Math.round(gpu.gflops * 3) : 0;          // 500 GFLOPS → 1500
  const scoreCpuS = measured.cpuSingle ? Math.round(cpu.hashesPerSecondSingle / 300) : 0;  // 400K h/s → 1333
  const scoreCpuM = measured.cpuMulti ? Math.round(cpu.hashesPerSecondMulti / 600) : 0;    // 1.2M h/s → 2000
  const scoreRam = measured.ram
    ? Math.round(((ram.readBandwidthGBs + ram.writeBandwidthGBs) / 2) * 60)
    : 0;

  // ── Composite: weighted geometric mean over the MEASURED components ──
  // Weights GPU 0.35 · CPU-multi 0.45 · RAM 0.20, renormalized over whatever
  // was actually measured. This is the general form of the two cases already
  // documented on /methodology — it reproduces both exactly:
  //   {gpu,cpuM,ram} → exp(0.35·ln g + 0.45·ln c + 0.20·ln r)      (W = 1.00)
  //   {cpuM,ram}     → exp((0.45·ln c + 0.20·ln r) / 0.65)         (W = 0.65)
  //   {gpu,cpuM}     → exp((0.35·ln g + 0.45·ln c) / 0.80)         (W = 0.80, new)
  // so no stored score changes.
  //
  // An unmeasured component must never contribute ln(1)=0 as if it were a
  // real zero — that collapsed the composite (a phone whose multi-core test
  // timed out scored 5) and then got that component named as the user's
  // bottleneck. max(score,1) still applies to genuinely measured values.
  const ln = (v: number) => Math.log(Math.max(v, 1));
  const terms: Array<[number, number]> = [];
  if (measured.gpu)      terms.push([0.35, scoreGpu]);
  if (measured.cpuMulti) terms.push([0.45, scoreCpuM]);
  if (measured.ram)      terms.push([0.20, scoreRam]);
  const W = terms.reduce((a, [w]) => a + w, 0);

  // Floor: W ≥ 0.65 ⟺ CPU-multi measured AND (GPU or RAM measured).
  // CPU-multi alone would renormalize to exactly the CPU multi-core score
  // published under the name "overall" — a comparability lie no label fixes.
  const scorable = W >= 0.65 - 1e-9;
  const overall = scorable
    ? Math.round(Math.exp(terms.reduce((a, [w, s]) => a + w * ln(s), 0) / W))
    : 0;

  const durationMs = performance.now() - startTotal;

  onProgress?.('done', 100, 'Done');

  // Hardware GPU name preference order:
  //   1. WebGL/WebGPU detection result (more human-readable)
  //   2. WebGPU adapter.info.description from the benchmark itself
  //   3. Empty string + unknown:true flag in info — UI handles fallback
  // We never substitute a placeholder string here; the UI must explicitly
  // render the unknown state.
  const gpuName = !hardwareInfo.gpu.unknown
    ? hardwareInfo.gpu.name
    : (gpu.adapterName && gpu.adapterName !== 'Unknown' ? gpu.adapterName : '');

  return {
    timestamp: Date.now(),
    durationMs,
    hardware: {
      cores: cpu.cores,
      gpu: gpuName,
      info: hardwareInfo,
      ua: navigator.userAgent
    },
    gpu,
    cpu,
    ram,
    ai,
    scores: {
      gpu: scoreGpu,
      cpuSingle: scoreCpuS,
      cpuMulti: scoreCpuM,
      ram: scoreRam,
      overall
    },
    measured,
    scorable
  };
}
