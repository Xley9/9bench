// 9bench — Orchestrator
// Runs WebGPU + CPU + RAM benchmarks, composes overall 9bench Score.
//
// Score Methodology (transparent, documented):
//   GPU Score    = round(GFLOPS × 1.5)         — 1000 GFLOPS (RTX 4070-ish) = 1500
//   CPU Single   = log10(SHA/sec / 1000) × 100 — 1M SHA/sec = ~600
//   CPU Multi    = same formula on multi-core throughput
//   RAM Score    = avg(read+write GB/s) × 20    — DDR5 50GB/s = ~1000
//   Overall      = weighted geometric mean (GPU 35% · CPU 45% · RAM 20%)
//
// The geometric mean prevents a single weak component from being masked
// by strong ones — better than arithmetic mean for hardware composites.

import { runWebGPUBench, type WebGPUResult } from './webgpu-test';
import { runCPUBench, type CPUResult } from './cpu-test';
import { runRAMBench, type RAMResult } from './ram-test';
import { detectHardware, type HardwareInfo } from './hardware-detect';

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
  scores: {
    gpu: number;
    cpuSingle: number;
    cpuMulti: number;
    ram: number;
    overall: number;
  };
  verdict: {
    label: string;
    color: string;
    snark: string;
    percentileEstimate: number; // local estimate before backend ranking
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

  // ── Calibrated scoring (v3, browser-API-aware) ───────────────────────
  // Browser APIs cap real measurable performance (Web Crypto serialization,
  // Worker pool limits, JIT inconsistency). Score formulas adjusted for what's
  // achievable in browser, not native ceiling.
  // Target: typical 2024 laptop ≈ 1200, mainstream ≈ 1800, high-end ≈ 3000+
  const scoreGpu = gpu.supported ? Math.round(gpu.gflops * 3) : 0;       // 500 GFLOPS → 1500
  const scoreCpuS = Math.round(cpu.hashesPerSecondSingle / 300);           // 400K h/s → 1333
  const scoreCpuM = Math.round(cpu.hashesPerSecondMulti / 600);            // 1.2M h/s → 2000
  const scoreRam = Math.round(((ram.readBandwidthGBs + ram.writeBandwidthGBs) / 2) * 60);

  // Geometric mean weighted: GPU 35%, CPU-multi 45%, RAM 20%
  // Use max(score, 1) to avoid log(0)
  const overall = Math.round(Math.exp(
    0.35 * Math.log(Math.max(scoreGpu, 1)) +
    0.45 * Math.log(Math.max(scoreCpuM, 1)) +
    0.20 * Math.log(Math.max(scoreRam, 1))
  ));

  const verdict = computeVerdict(overall, scoreGpu, scoreCpuM, scoreRam);
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
    scores: {
      gpu: scoreGpu,
      cpuSingle: scoreCpuS,
      cpuMulti: scoreCpuM,
      ram: scoreRam,
      overall
    },
    verdict
  };
}

function computeVerdict(overall: number, gpu: number, cpuM: number, ram: number) {
  // Score brackets calibrated to REAL browser-API output:
  //   Elite (M5 Max, 9950X3D + RTX 5090) ≈ 4000+
  //   High-end (M4 Pro, 7950X + RTX 4080) ≈ 2500-4000
  //   Strong mainstream (M3 Pro, 7800X3D + RTX 4060) ≈ 1700-2500
  //   Mid-range standard (16-core laptop, mid-GPU) ≈ 1000-1700
  //   Budget / older ≈ 500-1000
  //   Office laptop / Chromebook ≈ <500

  let label: string, color: string, snark: string;

  if (overall >= 4000) {
    label = '🏆 Elite tier — top 5%';
    color = '#10B981';
    snark = `Your hardware doesn't need motivation. It needs an audience. The bottleneck on this machine is no longer silicon — it's how fast you can think of things to make it do.`;
  } else if (overall >= 2500) {
    label = '✓ High-end performer';
    color = '#10B981';
    snark = `Strong configuration. You're paying enough that this should be expected. Anything you do badly here is a you problem, not a hardware problem.`;
  } else if (overall >= 1700) {
    label = '◯ Strong mainstream';
    color = '#0EA5E9';
    snark = `Capable of nearly anything. Gaming at high settings, video editing, 4K work, ML inference — all fine. Most of what slows you down isn't the hardware.`;
  } else if (overall >= 1000) {
    label = '~ Mid-range standard';
    color = '#0EA5E9';
    snark = `Solid working machine. Office work, light gaming, browser-everything, normal 2024-era loads — totally fine. Demanding 2026 tasks (local LLMs, 4K video editing) will feel the squeeze.`;
  } else if (overall >= 500) {
    label = '~ Mainstream / older';
    color = '#F59E0B';
    snark = `Functional everyday machine. CPU- or GPU-heavy tasks are going to feel slow, but everything normal works. Replacement cycle approaching if you do creative or technical work.`;
  } else {
    label = '⚠ Office / Chromebook tier';
    color = '#DC2626';
    snark = `Your machine is built for spreadsheets, not silicon-flexing. That's totally fine — just calibrate expectations. Don't expect 4K video editing or modern gaming.`;
  }

  // Detect imbalances — but be honest about RAM browser-API limits
  const components = [gpu, cpuM, ram];
  const max = Math.max(...components);
  const min = Math.min(...components);
  if (max > 0 && min / max < 0.4) {
    if (ram === min) {
      // RAM scoring is structurally lower in browsers (V8 doesn't vectorize Float32Array
      // operations fully). Be honest about this rather than blame the user's hardware.
      snark += ` Heads up: RAM scores low in all browser benchmarks (typically 30-50% of native) — not necessarily your hardware.`;
    } else {
      const weakest = gpu === min ? 'GPU' : 'CPU';
      snark += ` Imbalance detected: ${weakest} is significantly behind the other components — likely the upgrade target.`;
    }
  }

  // Local percentile estimate (before backend ranking exists)
  // v3 brackets:
  let percentileEstimate: number;
  if (overall >= 4000) percentileEstimate = 95;
  else if (overall >= 2500) percentileEstimate = 80;
  else if (overall >= 1700) percentileEstimate = 60;
  else if (overall >= 1000) percentileEstimate = 40;
  else if (overall >= 500) percentileEstimate = 18;
  else percentileEstimate = 5;

  return { label, color, snark, percentileEstimate };
}
