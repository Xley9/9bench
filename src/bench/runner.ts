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

export interface BenchResult {
  timestamp: number;
  durationMs: number;
  hardware: {
    cores: number;
    gpu: string;
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

  onProgress?.('gpu', 0, 'Probing GPU…');
  const gpu = await runWebGPUBench(1024, 5);
  onProgress?.('gpu', 100, gpu.supported ? `GPU ${gpu.gflops.toFixed(0)} GFLOPS` : 'GPU not available');

  onProgress?.('cpu', 0, 'Hashing on single core…');
  const cpu = await runCPUBench();
  onProgress?.('cpu', 100, `CPU ${Math.round(cpu.hashesPerSecondSingle)} h/s`);

  onProgress?.('ram', 0, 'Pumping memory…');
  const ram = await runRAMBench(64);
  onProgress?.('ram', 100, `RAM ${ram.readBandwidthGBs.toFixed(1)} GB/s read`);

  const scoreGpu = gpu.supported ? Math.round(gpu.gflops * 1.5) : 0;
  const scoreCpuS = Math.round(cpu.singleCoreScore);
  const scoreCpuM = Math.round(cpu.multiCoreScore);
  const scoreRam = ram.score;

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

  return {
    timestamp: Date.now(),
    durationMs,
    hardware: {
      cores: cpu.cores,
      gpu: gpu.adapterName || 'Unknown',
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
  // Score brackets calibrated to typical 2026 hardware:
  //   M5 Max 18-core ≈ 4500-5500
  //   Ryzen 9 9950X3D ≈ 3500-4500
  //   M3 Pro / Ryzen 7 7800X3D ≈ 2500-3500
  //   Mid-range 2024 laptop ≈ 1500-2500
  //   Budget / older ≈ 800-1500
  //   Office laptop / Chromebook ≈ <800

  let label: string, color: string, snark: string;

  if (overall >= 4500) {
    label = '🏆 Elite tier — top 5% globally';
    color = '#10B981';
    snark = `Your hardware doesn\'t need motivation. It needs an audience. Whatever job you\'re doing on this machine, the bottleneck is no longer silicon.`;
  } else if (overall >= 3500) {
    label = '✓ High-end performer';
    color = '#10B981';
    snark = `Solid configuration. You\'re paying enough that you should expect this. Anything you do badly here is a you problem, not a hardware problem.`;
  } else if (overall >= 2500) {
    label = '◯ Strong mainstream';
    color = '#0EA5E9';
    snark = `Capable of nearly anything you throw at it. Gaming at high settings, video editing, 4K work — all fine. The hardware isn\'t what\'s slowing you down.`;
  } else if (overall >= 1500) {
    label = '~ Mid-range standard';
    color = '#F59E0B';
    snark = `Standard 2024-era machine. Office work, light gaming, browser-everything — totally fine. Will start feeling slow on demanding 2026 tasks. Two more years before upgrade pressure.`;
  } else if (overall >= 800) {
    label = '⚠ Budget / older hardware';
    color = '#F59E0B';
    snark = `Functional. Not exciting. Your machine is doing its best, but anything CPU- or GPU-intensive is going to hurt. Replacement cycle approaching.`;
  } else {
    label = '🚨 Office / Chromebook tier';
    color = '#DC2626';
    snark = `This benchmark probably took longer than it should have. Your machine is built for spreadsheets, not silicon-flexing. That\'s totally fine — just don\'t expect gaming miracles.`;
  }

  // Detect imbalances
  const components = [gpu, cpuM, ram];
  const max = Math.max(...components);
  const min = Math.min(...components);
  if (max > 0 && min / max < 0.4) {
    const weakest = gpu === min ? 'GPU' : cpuM === min ? 'CPU' : 'RAM';
    snark += ` Imbalance detected: ${weakest} is significantly behind the rest. Upgrade target is obvious.`;
  }

  // Local percentile estimate (before backend ranking exists)
  // Rough mapping of overall → percentile based on expected 2026 distribution:
  let percentileEstimate: number;
  if (overall >= 5000) percentileEstimate = 99;
  else if (overall >= 4000) percentileEstimate = 95;
  else if (overall >= 3000) percentileEstimate = 85;
  else if (overall >= 2000) percentileEstimate = 65;
  else if (overall >= 1200) percentileEstimate = 40;
  else if (overall >= 700) percentileEstimate = 20;
  else percentileEstimate = 5;

  return { label, color, snark, percentileEstimate };
}
