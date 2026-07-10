// 9bench — Orchestrator
// Runs WebGPU + CPU + RAM benchmarks, composes overall 9bench Score.
//
// Score Methodology (transparent, documented — matches /methodology page):
//   GPU Score    = round(GFLOPS × 3)                     — 500 GFLOPS → 1500
//   CPU Single   = round(SHA-hashes/sec ÷ 300)           — 400K h/s → 1333
//   CPU Multi    = round(SHA-hashes/sec ÷ 600)           — 1.2M h/s → 2000
//   RAM Score    = round(avg(read+write GB/s) × 60)
//   Overall      = weighted geometric mean (GPU 35% · CPU-multi 45% · RAM 20%)
//                  If WebGPU is unavailable, weights renormalize over
//                  CPU+RAM (45/65 · 20/65) so the missing GPU term doesn't
//                  collapse the score — those runs are excluded from the
//                  GPU leaderboard and ranked in their own percentile pool.
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
  const scoreGpu = gpu.supported ? Math.round(gpu.gflops * 3) : 0;       // 500 GFLOPS → 1500
  const scoreCpuS = Math.round(cpu.hashesPerSecondSingle / 300);           // 400K h/s → 1333
  const scoreCpuM = Math.round(cpu.hashesPerSecondMulti / 600);            // 1.2M h/s → 2000
  const scoreRam = Math.round(((ram.readBandwidthGBs + ram.writeBandwidthGBs) / 2) * 60);

  // Geometric mean weighted: GPU 35%, CPU-multi 45%, RAM 20%.
  // Use max(score, 1) to avoid log(0).
  // When WebGPU is unavailable the GPU term would be ln(1)=0 and collapse
  // the whole score — identical hardware would rank far lower on a browser
  // without WebGPU. Instead, renormalize the remaining weights over CPU+RAM
  // (0.45/0.65 and 0.20/0.65) so the score stays comparable within the
  // no-GPU measurement class. The backend keeps the two classes in separate
  // percentile pools and the leaderboard only ranks GPU-measured runs.
  const ln = (v: number) => Math.log(Math.max(v, 1));
  const overall = Math.round(
    scoreGpu > 0
      ? Math.exp(0.35 * ln(scoreGpu) + 0.45 * ln(scoreCpuM) + 0.20 * ln(scoreRam))
      : Math.exp((0.45 * ln(scoreCpuM) + 0.20 * ln(scoreRam)) / 0.65)
  );

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
    }
  };
}
