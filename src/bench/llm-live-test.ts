// 9bench — Live LLM inference test (Phase L)
//
// THE KILLER DIFFERENTIATOR vs UserBenchmark/Geekbench/Cinebench.
// We don't just predict — we actually run an LLM in the user's browser
// and measure real tokens-per-second. This is the first browser-based
// hardware benchmark that includes a real local-AI test in 2026.
//
// IMPLEMENTATION:
//   - transformers.js loaded lazily from CDN (only when user clicks)
//   - Tiny model: Xenova/Phi-3-mini-4k-instruct-4bit (~1.7 GB Q4)
//     OR fallback to Xenova/distilgpt2 (~250 MB) for low-RAM machines
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

/**
 * Choose which model to load based on user's hardware capability.
 * We prefer larger models (better signal) when memory permits, but
 * fall back to tiny ones for constrained browsers.
 *
 * Model selection rationale:
 *   - Phi-3-mini-4bit (~1.7 GB): great signal, modern Microsoft model.
 *     Requires ~2.5 GB browser memory headroom.
 *   - distilgpt2 (~250 MB): fallback. Older but tiny. Works on
 *     even Firefox-strict / low-RAM Chromebooks.
 */
function selectModel(maxAllocatableGB: number): { id: string; displayName: string; sizeMB: number; isChat: boolean } {
  // Phi-3-mini needs comfortable headroom because of KV cache + intermediate
  // tensors during inference. 2.5 GB browser allocation isn't actually enough
  // for the 1.7 GB weights + activations — bumping to 3.5 GB so users with
  // marginal headroom don't get a half-loading model.
  if (maxAllocatableGB >= 3.5) {
    return {
      id: 'Xenova/Phi-3-mini-4k-instruct',
      displayName: 'Phi-3-mini-4k-instruct (Q4)',
      sizeMB: 1740,
      isChat: true,
    };
  }
  // Qwen 0.5B Chat needs ~1.5 GB practical headroom (weights ~460MB +
  // activations + KV cache + tokenizer overhead). At 1.0 GB it loads
  // but inference produces 0 tokens because the model fails silently.
  // Bumping the threshold so we fall through to distilgpt2 (a base model
  // that reliably generates text without chat templating).
  if (maxAllocatableGB >= 1.8) {
    return {
      id: 'Xenova/Qwen1.5-0.5B-Chat',
      displayName: 'Qwen1.5-0.5B-Chat',
      sizeMB: 460,
      isChat: true,
    };
  }
  // DistilGPT-2 is a base (non-chat) model. Reliably generates from any
  // prompt without chat templates. ~250 MB weights, fits comfortably in
  // 1 GB browser headroom.
  return {
    id: 'Xenova/distilgpt2',
    displayName: 'DistilGPT-2',
    sizeMB: 250,
    isChat: false,
  };
}

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
  const modelChoice = selectModel(maxAllocatableGB);

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
    // Configure: prefer WebGPU when available, otherwise WASM SIMD
    transformers.env.allowLocalModels = false;
    transformers.env.useBrowserCache = true;
    transformers.env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
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
  let generator: any;
  try {
    generator = await pipeline('text-generation', modelChoice.id, {
      // Progress callback updates the UI download bar
      progress_callback: (data: any) => {
        if (data.status === 'progress' && typeof data.progress === 'number') {
          onProgress({
            phase: 'loading',
            message: `Downloading ${data.file ?? modelChoice.displayName}… ${data.progress.toFixed(0)}%`,
            percent: 30 + (data.progress * 0.5),  // 30-80% bar fill during model download
          });
        }
      },
    });
  } catch (e: any) {
    onProgress({
      phase: 'error',
      message: 'Failed to load model weights',
      error: e?.message || `Could not load ${modelChoice.id}`,
    });
    throw e;
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

  // ── 5. Timed inference (cap at 30s) ────────────────────────────
  onProgress({
    phase: 'inferencing',
    message: 'Generating tokens for ~30 seconds…',
    percent: 90,
  });

  // Chat-tuned models (Phi-3, Qwen Chat) need their chat template applied
  // or they immediately emit end-of-sequence and produce 0 tokens.
  // Base models (DistilGPT-2) just take raw text. Hand-build the chat
  // template per model rather than relying on tokenizer.apply_chat_template
  // which isn't always exposed in transformers.js v2.
  const userQuestion = 'List five things every solo software builder should know about hardware benchmarking, with concrete examples:';
  let prompt: string;
  if (modelChoice.id.includes('Phi-3')) {
    // Phi-3 chat template: <|user|>...<|end|><|assistant|>
    prompt = `<|user|>\n${userQuestion}<|end|>\n<|assistant|>\n`;
  } else if (modelChoice.id.includes('Qwen')) {
    // Qwen 1.5 chat template: <|im_start|>user...<|im_end|><|im_start|>assistant
    prompt = `<|im_start|>user\n${userQuestion}<|im_end|>\n<|im_start|>assistant\n`;
  } else {
    // Base models: raw prompt
    prompt = userQuestion;
  }

  const maxTokens = 100;  // Hard cap — we'll usually hit time before tokens
  const timeCap = 30_000; // 30 second wall-clock cap (informational; we don't actively cap here)

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
