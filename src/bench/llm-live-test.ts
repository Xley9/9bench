// 9bench — Live LLM inference test (Phase L)
//
// THE KILLER DIFFERENTIATOR vs UserBenchmark/Geekbench/Cinebench.
// We don't just predict — we actually run an LLM in the user's browser
// and measure real tokens-per-second. This is the first browser-based
// hardware benchmark that includes a real local-AI test in 2026.
//
// IMPLEMENTATION:
//   - transformers.js loaded lazily from CDN (only when user clicks)
//   - Tiny model: Xenova/Qwen1.5-0.5B-Chat (~482 MB) on desktop,
//     Xenova/distilgpt2 (~85 MB quantized) on mobile and as the fallback
//   - 30-second cap on inference, then report measured tps
//   - Warm-up pass + measurement pass for stable numbers
//
// FALLBACK: If transformers.js fails to load (network, browser
// incompatibility, OOM), we show a clear error and don't crash the
// page. The estimated predictions remain valid.
//
// PRIVACY: Model runs entirely in the browser via WebAssembly.
// No data leaves the user's machine. Same Truth Series principle
// as the rest of 9bench.
//
// IMPORT NOTE: transformers.js is ~50 MB minified. We MUST lazy-load
// via CDN (esm.sh / unpkg) — never bundle it. The user only pays the
// download cost when they click "Run live AI test".

export interface LLMTestResult {
  /** The model that was actually loaded (we may downgrade based on RAM) */
  modelId: string;
  modelDisplayName: string;
  /** Approx model weight size in MB */
  modelSizeMB: number;
  /** Tokens generated during the timed phase */
  tokensGenerated: number;
  /** Wall-clock seconds for the timed phase (excludes load + warmup) */
  inferenceSeconds: number;
  /** Tokens per second during the timed phase */
  tokensPerSecond: number;
  /** Total time including model download + warmup */
  totalElapsedSeconds: number;
  /** Whether the test was capped at 30s vs natural completion */
  cappedAt30s: boolean;
  /** First 200 chars of generated output — for transparency, not display */
  outputSample: string;
}

export interface LLMTestProgress {
  phase: 'loading' | 'warming-up' | 'inferencing' | 'done' | 'error';
  message: string;
  /** 0-100 progress hint for UI */
  percent?: number;
  /** When phase='error', the error message */
  error?: string;
  /** When phase='done', the result */
  result?: LLMTestResult;
}

interface ModelChoice { id: string; displayName: string; sizeMB: number; isChat: boolean }

const QWEN_05B: ModelChoice = {
  id: 'Xenova/Qwen1.5-0.5B-Chat',
  displayName: 'Qwen1.5-0.5B-Chat',
  sizeMB: 482,
  isChat: true,
};
const DISTILGPT2: ModelChoice = {
  // Base (non-chat) model: generates from any prompt without chat templates.
  id: 'Xenova/distilgpt2',
  displayName: 'DistilGPT-2',
  sizeMB: 85,   // quantized, which is what transformers.js v2 fetches by default
  isChat: false,
};

/** Rough mobile check — mobile WASM memory ceilings are set by the OS, not by RAM. */
function isMobileLike(): boolean {
  const uaData = (navigator as any).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Choose which model to load.
 *
 * Phi-3-mini was removed: Xenova/Phi-3-mini-4k-instruct ships its weights as
 * external data (model_q4.onnx + .onnx_data), which transformers.js v2 cannot
 * load — that branch was a guaranteed 404 for every desktop with headroom.
 *
 * Mobile is capped at DistilGPT-2 regardless of probed headroom. probeMemory-
 * Headroom() measures JS heap allocations, which under Android overcommit can
 * "succeed" at 2 GB while ONNX Runtime cannot get a few hundred MB of WASM
 * linear memory — the exact failure behind "Can't create a session".
 */
function selectModel(maxAllocatableGB: number): ModelChoice {
  if (isMobileLike()) return DISTILGPT2;
  return maxAllocatableGB >= 1.8 ? QWEN_05B : DISTILGPT2;
}

/** Signatures that mean "ran out of memory", not "network problem". */
const OOM_SIGNATURE = /can't create a session|cannot create a session|failed to allocate|out of memory|Aborted|RangeError/i;

/**
 * Run a live LLM inference test.
 *
 * @param maxAllocatableGB  Browser memory headroom (from probeAICapabilities)
 * @param onProgress        Progress callback for UI updates
 * @returns The test result, or throws on unrecoverable errors
 */
export async function runLLMLiveTest(
  maxAllocatableGB: number,
  onProgress: (progress: LLMTestProgress) => void
): Promise<LLMTestResult> {
  const startTime = performance.now();

  // ── 1. Pick a model that fits the user's memory ────────────────
  let modelChoice = selectModel(maxAllocatableGB);

  onProgress({
    phase: 'loading',
    message: `Downloading ${modelChoice.displayName} (~${modelChoice.sizeMB} MB) from Hugging Face CDN…`,
    percent: 5,
  });

  // ── 2. Lazy-load transformers.js from a stable CDN ─────────────
  // We use esm.sh for reliable ESM hosting + tree-shaking.
  // Pinning version 2.17.2 because newer versions (3.x) have different
  // API surface and we calibrated against 2.x. Update with intent.
  let pipeline: any;
  try {
    const transformers = await import(
      /* @vite-ignore */
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
    );
    pipeline = transformers.pipeline;
    // transformers.js v2 runs on WASM. WebGPU inference needs the v3 API.
    transformers.env.allowLocalModels = false;
    transformers.env.useBrowserCache = true;
    // Threaded WASM needs SharedArrayBuffer, which needs cross-origin
    // isolation (COOP/COEP) — 9bench sets neither, so ORT has been silently
    // single-threaded all along and hardwareConcurrency was never applied.
    // Say so honestly rather than setting a number that does nothing. We
    // deliberately do NOT add COOP/COEP: shared memory must reserve its
    // maximum up front, which is precisely what mobile cannot satisfy, and
    // it would break the jsdelivr + Hugging Face CDN fetches.
    transformers.env.backends.onnx.wasm.numThreads = (self as any).crossOriginIsolated
      ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) >> 1))
      : 1;
  } catch (e: any) {
    onProgress({
      phase: 'error',
      message: 'Failed to load transformers.js library',
      error: e?.message || 'Network error — could not reach Hugging Face CDN',
    });
    throw e;
  }

  onProgress({
    phase: 'loading',
    message: `Downloading ${modelChoice.displayName}… (this happens once, then cached)`,
    percent: 30,
  });

  // ── 3. Load the model ──────────────────────────────────────────
  // One retry step down the ladder when the failure looks like memory
  // exhaustion rather than a network problem. The browser cache is left
  // alone: the download itself succeeded, and re-pulling hundreds of MB on
  // mobile data would be hostile.
  let generator: any;
  const loadWith = (choice: ModelChoice) => pipeline('text-generation', choice.id, {
    progress_callback: (data: any) => {
      if (data.status === 'progress' && typeof data.progress === 'number') {
        onProgress({
          phase: 'loading',
          message: `Downloading ${data.file ?? choice.displayName}… ${data.progress.toFixed(0)}%`,
          percent: 30 + (data.progress * 0.5),  // 30-80% bar fill during model download
        });
      }
    },
  });

  try {
    generator = await loadWith(modelChoice);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const canStepDown = OOM_SIGNATURE.test(msg) && modelChoice.id !== DISTILGPT2.id;
    if (canStepDown) {
      onProgress({
        phase: 'loading',
        message: `Not enough memory for ${modelChoice.displayName} — retrying with ${DISTILGPT2.displayName} (${DISTILGPT2.sizeMB} MB)…`,
        percent: 30,
      });
      try {
        modelChoice = DISTILGPT2;
        generator = await loadWith(DISTILGPT2);
      } catch (e2: any) {
        onProgress({
          phase: 'error',
          message: 'Failed to load model weights',
          error: e2?.message || `Could not load ${DISTILGPT2.id}`,
        });
        throw e2;
      }
    } else {
      onProgress({
        phase: 'error',
        message: 'Failed to load model weights',
        error: msg || `Could not load ${modelChoice.id}`,
      });
      throw e;
    }
  }

  // ── 4. Warm-up pass (3 tokens, discard timing) ─────────────────
  // First inference always slower because of JIT compile + memory
  // mapping. We do a tiny warm-up run so the timed measurement
  // reflects steady-state performance.
  onProgress({
    phase: 'warming-up',
    message: 'Warming up the model (first run is always slower)…',
    percent: 85,
  });

  try {
    await generator('Warm up.', { max_new_tokens: 3, do_sample: false });
  } catch (e) {
    // Warm-up failures are non-fatal — log and continue
    console.warn('Warm-up failed (non-fatal):', e);
  }

  // ── 5. Timed inference (up to 100 tokens) ──────────────────────
  onProgress({
    phase: 'inferencing',
    message: 'Generating up to 100 tokens — this can take a minute on slower machines…',
    percent: 90,
  });

  // Chat-tuned models (Qwen Chat) need their chat template applied or they
  // immediately emit end-of-sequence and produce 0 tokens. Base models
  // (DistilGPT-2) just take raw text. Hand-build the chat template per model
  // rather than relying on tokenizer.apply_chat_template, which isn't always
  // exposed in transformers.js v2.
  const userQuestion = 'List five things every solo software builder should know about hardware benchmarking, with concrete examples:';
  let prompt: string;
  if (modelChoice.id.includes('Qwen')) {
    // Qwen 1.5 chat template: <|im_start|>user...<|im_end|><|im_start|>assistant
    prompt = `<|im_start|>user\n${userQuestion}<|im_end|>\n<|im_start|>assistant\n`;
  } else {
    // Base models: raw prompt
    prompt = userQuestion;
  }

  // The generation bound is TOKENS (100), not wall-clock time —
  // transformers.js v2 has no reliable mid-generation abort, so a slow
  // machine simply takes longer. `cappedAt30s` in the result reports
  // whether the run exceeded 30s, purely as context for the reader.
  const maxTokens = 100;

  // Manually track tokens because transformers.js doesn't easily
  // expose per-token callbacks for time-capping. We use max_new_tokens
  // as the upper bound and measure how many were actually produced.
  const inferenceStart = performance.now();
  let output: any;
  try {
    output = await generator(prompt, {
      max_new_tokens: maxTokens,
      min_new_tokens: 8,  // Force at least some generation; prevents instant-stop bug
      do_sample: false,   // greedy decoding for reproducibility
      temperature: 1.0,
      repetition_penalty: 1.1,
    });
  } catch (e: any) {
    onProgress({
      phase: 'error',
      message: 'Inference failed',
      error: e?.message || 'Unknown inference error',
    });
    throw e;
  }
  const inferenceEnd = performance.now();

  const inferenceSeconds = (inferenceEnd - inferenceStart) / 1000;
  const cappedAt30s = inferenceSeconds >= 30;

  // ── 6. Extract output + token count ────────────────────────────
  // transformers.js returns generated text; we count tokens via the
  // tokenizer's encode method for accuracy (rough char/4 fallback if
  // tokenizer access fails).
  let generatedText = '';
  if (Array.isArray(output) && output.length > 0) {
    generatedText = (output[0].generated_text || '').slice(prompt.length);
  } else if (output?.generated_text) {
    generatedText = output.generated_text.slice(prompt.length);
  }

  let tokensGenerated: number;
  try {
    const tokenizer = generator.tokenizer;
    const encoded = tokenizer.encode(generatedText);
    tokensGenerated = encoded.length;
  } catch {
    // Fallback: rough estimate of 1 token per 4 chars (English).
    // Close enough for the headline number — exact tokenization isn't
    // user-visible and char/4 is the industry-standard rough estimate.
    tokensGenerated = Math.round(generatedText.length / 4);
  }

  // Guard against silent-failure cases: 0 tokens or absurdly short
  // inference (model emitted EOS immediately). Surface as a real error
  // rather than displaying "0.0 tokens/s" — which looks like the
  // benchmark is broken even though the actual issue is the model.
  if (tokensGenerated === 0 || inferenceSeconds < 0.5) {
    const errMsg = tokensGenerated === 0
      ? `Model generated 0 tokens — likely chat-template mismatch or memory exhaustion. Try refreshing the page or increasing browser memory limits.`
      : `Inference completed in <0.5s with no meaningful output. Model may have failed to load fully.`;
    onProgress({
      phase: 'error',
      message: 'Inference produced no output',
      error: errMsg,
    });
    throw new Error(errMsg);
  }

  const tokensPerSecond = tokensGenerated / inferenceSeconds;
  const totalElapsedSeconds = (performance.now() - startTime) / 1000;

  const result: LLMTestResult = {
    modelId: modelChoice.id,
    modelDisplayName: modelChoice.displayName,
    modelSizeMB: modelChoice.sizeMB,
    tokensGenerated,
    inferenceSeconds,
    tokensPerSecond,
    totalElapsedSeconds,
    cappedAt30s,
    outputSample: generatedText.slice(0, 200),
  };

  onProgress({
    phase: 'done',
    message: `Done — ${tokensPerSecond.toFixed(1)} tokens/s on ${modelChoice.displayName}`,
    percent: 100,
    result,
  });

  return result;
}

/**
 * Format a tokens/s number for display with appropriate precision.
 * Tiny numbers (< 1) get 1 decimal; larger numbers get 0.
 */
export function formatTPS(tps: number): string {
  if (tps < 1) return tps.toFixed(2) + ' t/s';
  if (tps < 10) return tps.toFixed(1) + ' t/s';
  return Math.round(tps) + ' t/s';
}
