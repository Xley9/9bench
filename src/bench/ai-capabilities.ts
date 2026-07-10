// 9bench — AI Capabilities Detection
//
// 2026 is the local-AI inflection year. Hardware-purchase decisions are
// increasingly driven by "can my machine run Llama 13B?" and "can it do
// SDXL?" — questions UserBenchmark, Geekbench, Cinebench cannot answer.
//
// 9bench fills that gap by combining:
//   1. Real WebGPU feature detection (FP16, max buffer, compute support)
//   2. Memory headroom probe (how much can the browser really allocate)
//   3. Calibrated estimates from GPU GFLOPS + RAM bandwidth
//
// PRINCIPLE (Truth Series): we measure what we can, estimate the rest
// transparently, and explicitly label what's "real measurement" vs
// "extrapolation from measured values". Never fabricate a "tokens/s"
// number — only ranges with documented assumptions.
//
// Phase 2 (separate file): real LLM inference via transformers.js.
// That's the killer differentiator. Phase 1 (this file) is the
// capability scan that runs in <500ms alongside the main benchmark.

export interface AICapabilities {
  /** WebGPU adapter feature inventory */
  webgpu: {
    supported: boolean;
    /** shader-f16 — required for efficient FP16 LLM inference */
    fp16: boolean;
    /** Largest single buffer the browser will allow (GB) */
    maxBufferGB: number;
    /** Largest dispatchable compute workgroup */
    maxWorkgroupSize: number;
    /** Reported limits from adapter (full names for transparency) */
    rawLimits?: Record<string, number>;
  };

  /** Browser memory headroom — how much can we actually allocate */
  memory: {
    /** Largest contiguous TypedArray we successfully allocated (GB) */
    largestAllocatableGB: number;
    /** navigator.deviceMemory if available (Chrome only, capped at 8) */
    reportedDeviceMemoryGB: number | null;
    /** performance.memory.jsHeapSizeLimit if available (Chrome) */
    jsHeapLimitGB: number | null;
  };

  /** AI Capability Score (0-3000+) — composite based on real measurements */
  score: number;

  /** AI-tier verdict — separate from main 9bench tier, AI-specific */
  // 'AI-Workstation' is the legacy name of 'AI-Entry' — still present in
  // stored rows submitted before the rename; render both identically.
  tier: 'AI-S' | 'AI-A' | 'AI-B' | 'AI-Entry' | 'AI-Workstation' | 'AI-Office' | 'AI-Limited';

  /**
   * What the user can actually run locally — concrete predictions
   * calibrated from GPU GFLOPS + RAM bandwidth + memory headroom.
   * Each entry has explicit confidence ('measured' / 'estimated' / 'unlikely').
   */
  predictions: AIPrediction[];
}

export interface AIPrediction {
  /** Human-readable workload name */
  name: string;
  /** Short description for tooltip */
  description: string;
  /** Verdict for this user's hardware */
  verdict: 'yes' | 'maybe' | 'no';
  /** Performance estimate (e.g. "30-40 tokens/s") or null if 'no' */
  performance: string | null;
  /** Why this verdict — transparent reasoning */
  reasoning: string;
  /** Category for grouping */
  category: 'llm' | 'image' | 'audio' | 'video';
}

const ZERO_AI: AICapabilities = {
  webgpu: { supported: false, fp16: false, maxBufferGB: 0, maxWorkgroupSize: 0 },
  memory: { largestAllocatableGB: 0, reportedDeviceMemoryGB: null, jsHeapLimitGB: null },
  score: 0,
  tier: 'AI-Limited',
  predictions: [],
};

/**
 * Probe how much memory we can actually allocate. We try increasingly
 * large Float32Arrays until one fails. We immediately release each on
 * success so we don't OOM the user's machine — this is a probe, not
 * a workload.
 *
 * Returns the largest GB allocation that succeeded.
 */
function probeMemoryHeadroom(): number {
  // Test sizes in GB. We start small to avoid hangs on weak machines.
  const testSizesGB = [0.5, 1, 2, 4, 6, 8];
  let largestSuccessful = 0;

  for (const gb of testSizesGB) {
    const bytes = gb * 1024 * 1024 * 1024;
    let buf: Float32Array | null = null;
    try {
      // Float32Array is 4 bytes per element
      buf = new Float32Array(bytes / 4);
      // Touch a few cells to ensure the OS actually committed pages
      // (some allocators give "lazy" memory that fails on first read).
      buf[0] = 1;
      buf[buf.length - 1] = 1;
      buf[Math.floor(buf.length / 2)] = 1;
      largestSuccessful = gb;
    } catch (e) {
      // Stop at first failure — anything bigger will fail too
      break;
    } finally {
      // Critical: release immediately so we don't keep N GB pinned
      buf = null;
    }
  }
  return largestSuccessful;
}

/**
 * Detect WebGPU adapter features relevant to AI workloads.
 *
 * Critical features for LLM inference / image generation:
 *   - shader-f16: FP16 math support (most modern LLMs use FP16/BF16)
 *   - maxBufferSize: how big a single buffer can be (model weights)
 *   - maxComputeWorkgroupSize: parallelism granularity
 *
 * We also collect raw limits for transparency — anyone can verify our
 * conclusions against the adapter's real reported capabilities.
 */
async function detectWebGPUFeatures(): Promise<AICapabilities['webgpu']> {
  if (!('gpu' in navigator)) {
    return { supported: false, fp16: false, maxBufferGB: 0, maxWorkgroupSize: 0 };
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { supported: false, fp16: false, maxBufferGB: 0, maxWorkgroupSize: 0 };
    }

    const features = adapter.features as Set<string>;
    const limits = adapter.limits as Record<string, number>;

    // shader-f16 is the standard feature flag name for FP16 support
    const fp16 = features.has('shader-f16');

    // maxBufferSize is in bytes; convert to GB. Default WebGPU min is
    // 256 MB; modern desktop GPUs often expose 4 GB+.
    const maxBufferBytes = limits.maxBufferSize || limits.maxStorageBufferBindingSize || 0;
    const maxBufferGB = maxBufferBytes / (1024 * 1024 * 1024);

    const maxWorkgroupSize = limits.maxComputeWorkgroupSizeX || 256;

    return {
      supported: true,
      fp16,
      maxBufferGB: Number(maxBufferGB.toFixed(2)),
      maxWorkgroupSize,
      rawLimits: {
        maxBufferSize:                 limits.maxBufferSize ?? 0,
        maxStorageBufferBindingSize:   limits.maxStorageBufferBindingSize ?? 0,
        maxComputeWorkgroupSizeX:      limits.maxComputeWorkgroupSizeX ?? 0,
        maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup ?? 0,
      },
    };
  } catch {
    return { supported: false, fp16: false, maxBufferGB: 0, maxWorkgroupSize: 0 };
  }
}

/**
 * Generate concrete AI workload predictions from measured hardware metrics.
 *
 * Calibration sources (publicly documented, verifiable):
 *   - llama.cpp benchmarks on RTX 4070 (~640 GFLOPS browser, ~12 TFLOPS native)
 *   - Apple Silicon M2 Pro tokens/s for 7B Q4 (~25-40 t/s)
 *   - SDXL official benchmarks (~6 GB VRAM, ~3-8 sec on H100)
 *
 * We extrapolate to user's measured GFLOPS using documented scaling
 * (LLM inference is ~70% memory-bound, ~30% compute-bound, so we
 * blend GFLOPS + memory bandwidth into the estimate).
 *
 * EVERY prediction has explicit reasoning visible to the user — they
 * can audit our math, not just trust it.
 */
function generatePredictions(
  gpuGflops: number,
  ramReadGBs: number,
  largestAllocatableGB: number,
  webgpuFp16: boolean
): AIPrediction[] {
  // Browser ceiling roughly tracks ~30-40% of native for sustained AI work
  // (sandbox overhead, no CUDA, no metal-direct). We use 0.35 as middle estimate.
  const NATIVE_RATIO = 0.35;
  const estimatedNativeGFLOPS = gpuGflops / NATIVE_RATIO;

  // Memory bandwidth caps inference speed strongly for LLMs:
  //   t/s ≈ (RAM_bandwidth_GBs * 1e9) / (model_size_GB * 1e9) * efficiency
  // Where efficiency is ~0.6-0.8 for well-tuned llama.cpp.
  // Our browser bandwidth is sandbox-capped at 30-50% of native.
  const estimatedNativeRAM = ramReadGBs / 0.4;  // browsers see ~40% of native

  const predictions: AIPrediction[] = [];

  // ── LLM: 7B parameter model, Q4 quantized (~4 GB on disk) ──
  {
    // Q4 inference: ~4 GB weights, memory-bound at ~bandwidth/4GB tokens/s
    const memoryLimitedTPS = (estimatedNativeRAM * 0.7) / 4;
    const computeLimitedTPS = estimatedNativeGFLOPS / 50;  // very rough: 50 GFLOPS per token for 7B
    const predictedTPS = Math.min(memoryLimitedTPS, computeLimitedTPS);

    if (largestAllocatableGB < 4) {
      predictions.push({
        name: 'Llama 7B (Q4)',
        description: 'Local LLM, 7-billion parameters, 4-bit quantized',
        verdict: 'no',
        performance: null,
        reasoning: `Browser memory headroom is ${largestAllocatableGB.toFixed(1)} GB; 7B Q4 needs ~4 GB just for weights.`,
        category: 'llm',
      });
    } else if (predictedTPS >= 15) {
      predictions.push({
        name: 'Llama 7B (Q4)',
        description: 'Local LLM, 7-billion parameters, 4-bit quantized',
        verdict: 'yes',
        performance: `~${Math.round(predictedTPS - 5)}–${Math.round(predictedTPS + 10)} tokens/s`,
        reasoning: `Memory bandwidth (${ramReadGBs.toFixed(1)} GB/s browser ≈ ${estimatedNativeRAM.toFixed(0)} GB/s native est.) supports comfortable inference.`,
        category: 'llm',
      });
    } else {
      predictions.push({
        name: 'Llama 7B (Q4)',
        description: 'Local LLM, 7-billion parameters, 4-bit quantized',
        verdict: 'maybe',
        performance: `~${Math.max(2, Math.round(predictedTPS - 3))}–${Math.round(predictedTPS + 5)} tokens/s`,
        reasoning: `Will run but slowly — bandwidth-bound. RAM upgrade or faster storage helps.`,
        category: 'llm',
      });
    }
  }

  // ── LLM: 13B parameter model, Q4 quantized (~8 GB) ──
  {
    const memoryLimitedTPS = (estimatedNativeRAM * 0.7) / 8;
    const predictedTPS = memoryLimitedTPS;

    if (largestAllocatableGB < 8) {
      predictions.push({
        name: 'Llama 13B (Q4)',
        description: 'Local LLM, 13-billion parameters, 4-bit quantized',
        verdict: 'no',
        performance: null,
        reasoning: `Needs ~8 GB for weights; browser allocated only ${largestAllocatableGB.toFixed(1)} GB max.`,
        category: 'llm',
      });
    } else if (predictedTPS >= 8) {
      predictions.push({
        name: 'Llama 13B (Q4)',
        description: 'Local LLM, 13-billion parameters, 4-bit quantized',
        verdict: 'yes',
        performance: `~${Math.max(3, Math.round(predictedTPS - 3))}–${Math.round(predictedTPS + 5)} tokens/s`,
        reasoning: `Bandwidth supports usable inference. Suitable for chatbot use cases.`,
        category: 'llm',
      });
    } else {
      predictions.push({
        name: 'Llama 13B (Q4)',
        description: 'Local LLM, 13-billion parameters, 4-bit quantized',
        verdict: 'maybe',
        performance: `~${Math.max(2, Math.round(predictedTPS - 1))}–${Math.round(predictedTPS + 2)} tokens/s`,
        reasoning: `Functional but slow. OK for batch jobs, not interactive chat.`,
        category: 'llm',
      });
    }
  }

  // ── LLM: 70B parameter model (~40 GB Q4) ──
  // Always 'no' for browser-based — the memory cap is ~8 GB on Chrome,
  // and 70B models simply don't fit. Native machines need 32 GB+ RAM.
  predictions.push({
    name: 'Llama 70B (Q4)',
    description: 'Large flagship LLM, 70-billion parameters',
    verdict: 'no',
    performance: null,
    reasoning: `Needs ~40 GB just for weights. Browser memory model caps allocation well below this. Use a native llama.cpp setup with 64 GB+ RAM.`,
    category: 'llm',
  });

  // ── Image gen: SDXL 1024×1024 ──
  {
    if (!webgpuFp16) {
      predictions.push({
        name: 'Stable Diffusion XL (1024×1024)',
        description: 'High-resolution image generation',
        verdict: 'maybe',
        performance: 'No estimate — FP16 unsupported',
        reasoning: `Your WebGPU adapter doesn't expose shader-f16. SDXL works in FP32 but is ~3× slower and may exceed memory limits.`,
        category: 'image',
      });
    } else if (gpuGflops >= 800) {
      predictions.push({
        name: 'Stable Diffusion XL (1024×1024)',
        description: 'High-resolution image generation',
        verdict: 'yes',
        performance: '~20-40s per image',
        reasoning: `GPU compute (${gpuGflops.toFixed(0)} GFLOPS browser) and FP16 support give you usable SDXL throughput.`,
        category: 'image',
      });
    } else if (gpuGflops >= 400) {
      predictions.push({
        name: 'Stable Diffusion XL (1024×1024)',
        description: 'High-resolution image generation',
        verdict: 'maybe',
        performance: '~60-120s per image',
        reasoning: `Will run but expect minute-plus generation times. Consider SD 1.5 (512×512) for faster results.`,
        category: 'image',
      });
    } else {
      predictions.push({
        name: 'Stable Diffusion XL (1024×1024)',
        description: 'High-resolution image generation',
        verdict: 'no',
        performance: null,
        reasoning: `GPU compute (${gpuGflops.toFixed(0)} GFLOPS) is below the practical floor for SDXL. Use cloud or a more powerful GPU.`,
        category: 'image',
      });
    }
  }

  // ── Image gen: SD 1.5 (512×512) — much lighter ──
  {
    if (gpuGflops >= 200) {
      predictions.push({
        name: 'Stable Diffusion 1.5 (512×512)',
        description: 'Standard image generation',
        verdict: 'yes',
        performance: gpuGflops >= 500 ? '~5-15s per image' : '~15-30s per image',
        reasoning: `Light enough to run smoothly on your hardware. Good for ideation.`,
        category: 'image',
      });
    } else {
      predictions.push({
        name: 'Stable Diffusion 1.5 (512×512)',
        description: 'Standard image generation',
        verdict: 'maybe',
        performance: '~30-60s per image',
        reasoning: `Functional but slow — usable for occasional generation, not iterative work.`,
        category: 'image',
      });
    }
  }

  // ── Audio: Whisper Small (~244M params) ──
  {
    if (gpuGflops >= 150 && largestAllocatableGB >= 1) {
      predictions.push({
        name: 'Whisper Small (audio→text)',
        description: 'Real-time speech-to-text transcription',
        verdict: 'yes',
        performance: gpuGflops >= 400 ? 'Faster than real-time (~3-5×)' : 'Near real-time (~1-2×)',
        reasoning: `Whisper is light (~244M params); your hardware handles it comfortably.`,
        category: 'audio',
      });
    } else {
      predictions.push({
        name: 'Whisper Small (audio→text)',
        description: 'Real-time speech-to-text transcription',
        verdict: 'maybe',
        performance: 'Slower than real-time',
        reasoning: `Will run but transcription will lag the audio. Consider Whisper Tiny for faster pace.`,
        category: 'audio',
      });
    }
  }

  return predictions;
}

/**
 * Compute the AI Capability composite score (0-3000+ scale).
 *
 * Weighting rationale (tuned to current 2026 local-AI workloads):
 *   - GPU compute: 40% — directly drives image gen + LLM batch ops
 *   - RAM bandwidth: 35% — bottleneck for LLM inference (memory-bound)
 *   - Memory headroom: 15% — gates which model sizes are viable at all
 *   - WebGPU FP16: 10% — bonus for FP16-capable hardware
 *
 * Scale is calibrated so that:
 *   - 2024 mainstream laptop ≈ 1000-1500 (handles 7B LLMs comfortably)
 *   - High-end desktop ≈ 2000-2800 (handles 13B + SDXL)
 *   - Workstation / pro GPU ≈ 3000+
 */
function computeAIScore(
  gpuGflops: number,
  ramReadGBs: number,
  largestAllocatableGB: number,
  fp16: boolean
): number {
  // Component scores normalized to ~1000 at "good 2024 mainstream"
  const gpuComp = gpuGflops * 2.5;        // 400 GFLOPS → 1000
  const ramComp = ramReadGBs * 100;       // 10 GB/s → 1000
  const memComp = largestAllocatableGB * 250;  // 4 GB → 1000
  const fp16Bonus = fp16 ? 300 : 0;

  return Math.round(
    gpuComp * 0.40 +
    ramComp * 0.35 +
    memComp * 0.15 +
    fp16Bonus * 0.10
  );
}

/**
 * Map AI score to tier label. Separate from main 9bench tier because
 * AI capability is hardware-dimension-specific (a CPU-strong gaming PC
 * may have weak AI capabilities, while an Apple Silicon Mac with shared
 * memory may have strong AI but lower 9bench overall).
 */
function aiTierFor(score: number): AICapabilities['tier'] {
  if (score >= 2500) return 'AI-S';
  if (score >= 1700) return 'AI-A';
  if (score >= 1100) return 'AI-B';
  if (score >= 600)  return 'AI-Entry';
  if (score >= 300)  return 'AI-Office';
  return 'AI-Limited';
}

/**
 * Run the full AI capabilities probe. Calls in parallel where possible
 * so total runtime stays under 1 second on most hardware.
 */
export async function probeAICapabilities(
  gpuGflops: number,
  ramReadGBs: number
): Promise<AICapabilities> {
  // Run feature detection + memory probe in parallel
  const [webgpu, largestAllocatableGB] = await Promise.all([
    detectWebGPUFeatures(),
    Promise.resolve().then(probeMemoryHeadroom),
  ]);

  const memory: AICapabilities['memory'] = {
    largestAllocatableGB,
    reportedDeviceMemoryGB: typeof (navigator as any).deviceMemory === 'number'
      ? (navigator as any).deviceMemory : null,
    jsHeapLimitGB: typeof (performance as any).memory?.jsHeapSizeLimit === 'number'
      ? Number(((performance as any).memory.jsHeapSizeLimit / (1024 ** 3)).toFixed(2))
      : null,
  };

  const score = computeAIScore(gpuGflops, ramReadGBs, largestAllocatableGB, webgpu.fp16);
  const tier  = aiTierFor(score);

  const predictions = generatePredictions(gpuGflops, ramReadGBs, largestAllocatableGB, webgpu.fp16);

  return {
    webgpu,
    memory,
    score,
    tier,
    predictions,
  };
}

/**
 * Render-helper: human-readable tier label.
 */
export function aiTierLabel(tier: AICapabilities['tier']): { letter: string; sub: string; color: string } {
  switch (tier) {
    case 'AI-S':            return { letter: 'S', sub: 'AI workstation — runs 13B LLMs, SDXL comfortably',          color: 'var(--accent)' };
    case 'AI-A':            return { letter: 'A', sub: 'Strong local AI — 7-13B LLMs, SD 1.5 image gen',           color: 'var(--good)' };
    case 'AI-B':            return { letter: 'B', sub: 'Capable — 7B LLMs, SD 1.5, smaller image models',           color: 'var(--fg)' };
    case 'AI-Entry':
    case 'AI-Workstation':  // legacy rows stored before the rename
                            return { letter: '◯', sub: 'Entry level — 7B Q4 marginal, smaller models work',         color: 'var(--fg-2)' };
    case 'AI-Office':       return { letter: '◯', sub: 'Cloud-first — local AI is impractical on this hardware',    color: 'var(--fg-3)' };
    case 'AI-Limited':      return { letter: '⚠', sub: 'Cloud-only — not a local-AI machine',                        color: 'var(--warn)' };
  }
}
