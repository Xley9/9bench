// 9bench — CPU Benchmark
// Single-Core: SHA-256 hash chain (cryptographic, CPU-bound, deterministic)
// Multi-Core: parallel work via Web Workers + same workload
// Output: hashes/sec normalized to a "9bench CPU score"
//
// Why SHA-256: deterministic, CPU-bound, parallelizable, real-world relevant
// (used in TLS, blockchain, file integrity), and platform-independent.
//
// WORKLOAD SIZING (v3.4): iteration counts are calibrated per device instead
// of fixed. The reported number is a THROUGHPUT RATE (hashes/sec), so the
// length of the measurement window does not change it — but a fixed 500,000
// iterations per worker could not finish inside the timeout on slow devices,
// which returned no multi-core result at all.
//
// MULTI-CORE ESTIMATOR (v3.6): fixed-time window, aggregate = SUM of per-worker
// rates. Not total-work/wall-clock, which is bounded by the slowest worker and
// therefore discards every fast core on a hybrid CPU. See /methodology#validation.
// This is a deliberate break: v3.6+ multi-core numbers are NOT comparable to
// earlier ones and are ranked in a separate pool.
//
// HONEST FAILURE (v3.4): a phase that fails reports measured=false rather than
// a zero. A zero is indistinguishable from "very slow hardware" downstream, and
// it previously collapsed the composite score and got the CPU named as the
// user's bottleneck when in fact nothing had been measured.

export interface CPUResult {
  singleCoreScore: number;
  multiCoreScore: number;
  cores: number;
  durationMs: number;
  hashesPerSecondSingle: number;
  hashesPerSecondMulti: number;
  /** null when either phase is unmeasured — a ratio needs both sides */
  speedup: number | null;
  efficiency: number | null;
  /** True only on the success path of the single-core leg. */
  singleMeasured: boolean;
  /** True only when every spawned worker reported a result. */
  multiMeasured: boolean;
  /** Diagnostic: how many workers reported out of `cores`. */
  workersReported: number;
  /**
   * Per-worker elapsed spread (ms) for the multi-core window. The gap between
   * min and max is a direct read on core heterogeneity — on a hybrid CPU the
   * E-core workers finish the same wall-clock window having done far less work.
   */
  workerElapsedMs?: { min: number; median: number; max: number };
  singleError?: string;
  multiError?: string;
  error?: string;
}

// Inline worker source — runs the same SHA-256 chain.
// Reports its own iteration count so a worker that stops early at its deadline
// still contributes real work instead of being discarded. try/catch + a
// self.onerror handler are required: an unhandled rejection inside a worker
// does NOT fire Worker.onerror, so without this a throw became 60s of silence.
const WORKER_SOURCE = `
self.onerror = function (msg) {
  try { self.postMessage({ ok: false, error: String(msg) }); } catch (e) {}
};
self.onmessage = async (e) => {
  try {
    // deadlineEpoch is a Date.now() timestamp, NOT performance.now():
    // a worker has its own performance timeOrigin, so a main-thread
    // performance.now() value is meaningless here. Date.now() shares an
    // epoch across threads, and ms resolution is ample for a 10s window.
    const deadlineEpoch = e.data.deadlineEpoch;
    const maxIterations = e.data.maxIterations;
    let buf = new Uint8Array(64);
    for (let i = 0; i < 64; i++) buf[i] = i;
    const t0 = performance.now();
    let i = 0;
    for (; i < maxIterations; i++) {
      buf = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      if ((i & 255) === 255 && Date.now() >= deadlineEpoch) { i++; break; }
    }
    // Each worker reports its OWN elapsed time. The aggregate is the sum of
    // per-worker rates — never total/wallclock, which is bounded by the
    // slowest worker and discards every fast core's contribution.
    self.postMessage({ ok: true, elapsed: performance.now() - t0, iters: i });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
`;

/**
 * SHA-256 chain on the calling thread.
 * The deadline check costs one integer AND per iteration against a digest call
 * measured in microseconds — free, and it guarantees the phase is bounded.
 */
// Exported for the v4.0 shadow probe (cpu-test-v4.ts) — an export-only
// change; the scored path in this file is untouched by v3.7.
export async function shaChain(
  iterations: number,
  deadlineMs = Infinity
): Promise<{ elapsed: number; iters: number }> {
  let buf = new Uint8Array(64);
  for (let i = 0; i < 64; i++) buf[i] = i;
  const t0 = performance.now();
  let i = 0;
  for (; i < iterations; i++) {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    buf = new Uint8Array(hash);
    if ((i & 511) === 511 && performance.now() - t0 >= deadlineMs) { i++; break; }
  }
  return { elapsed: performance.now() - t0, iters: i };
}

interface WorkerOutcome { elapsed: number; iters: number }

/**
 * Spawn `k` workers from ONE blob URL and wait for all of them.
 *
 * Uses allSettled, not all: previously a single failing worker rejected the
 * whole batch while the other workers kept running — orphaned SHA-256 threads
 * that then saturated the machine during the RAM test that starts immediately
 * afterwards, corrupting that measurement too. Now every worker is terminated
 * on the way out, whatever happened.
 */
async function spawnWorkers(
  k: number,
  maxIterations: number,
  deadlineEpoch: number,
  hardTimeoutMs: number
): Promise<PromiseSettledResult<WorkerOutcome>[]> {
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const workers: Worker[] = [];

  try {
    const jobs: Promise<WorkerOutcome>[] = [];
    for (let i = 0; i < k; i++) {
      jobs.push(new Promise<WorkerOutcome>((resolve, reject) => {
        let w: Worker;
        try {
          w = new Worker(url);
        } catch (e: any) {
          reject(new Error('Worker creation blocked: ' + (e?.message || e)));
          return;
        }
        workers.push(w);
        const timer = setTimeout(
          () => reject(new Error('Worker did not report within ' + hardTimeoutMs + 'ms')),
          hardTimeoutMs
        );
        w.onmessage = (ev: MessageEvent) => {
          clearTimeout(timer);
          const d = ev.data;
          if (d && d.ok) resolve({ elapsed: d.elapsed, iters: d.iters });
          else reject(new Error(d?.error || 'Worker reported failure'));
        };
        w.onerror = (ev: any) => {
          clearTimeout(timer);
          reject(new Error(ev?.message || 'Worker error'));
        };
        w.postMessage({ maxIterations, deadlineEpoch });
      }));
    }
    return await Promise.allSettled(jobs);
  } finally {
    for (const w of workers) { try { w.terminate(); } catch {} }
    URL.revokeObjectURL(url);
  }
}

// Time budgets. The measurement is a rate, so these bound the wall clock
// without changing the number that comes out.
const TARGET_SINGLE_S = 2.0;
/** Multi-core measurement window. Every worker runs until the same absolute deadline. */
const MULTI_WINDOW_MS = 10_000;
/** Iteration ceiling per worker — a safety stop only; the deadline is what ends the run. */
const MULTI_MAX_ITERATIONS = 50_000_000;
/** Anti-hang backstop for a worker that never reports at all. */
const WORKER_HARD_TIMEOUT_MS = MULTI_WINDOW_MS + 20_000;

export async function runCPUBench(
  // Raised from 200,000 in v3.6: the old cap bound on fast hardware, which
  // collapsed the single-core window to ~0.4s — the shortest measurement on
  // exactly the machines where a scheduler migration does the most damage.
  // It is a rate, so a longer window does not change the number, only its
  // variance. The TARGET_SINGLE_S budget is what actually ends the phase.
  maxSingleCoreIterations = 5_000_000
): Promise<CPUResult> {
  // Resource sanity bound only. Deliberately NOT clamped to 16: that would
  // halve a 32-thread machine's score against its own stored history.
  const cores = Math.min(Math.max(1, navigator.hardwareConcurrency || 4), 64);

  const result: CPUResult = {
    singleCoreScore: 0,
    multiCoreScore: 0,
    cores,
    durationMs: 0,
    hashesPerSecondSingle: 0,
    hashesPerSecondMulti: 0,
    speedup: null,
    efficiency: null,
    singleMeasured: false,
    multiMeasured: false,
    workersReported: 0,
  };

  const tStart = performance.now();
  let rate = 0;

  // ── Single-core ────────────────────────────────────────────────
  try {
    // Two probes, not one: a cold-JIT probe under-reads by 2-3x, which would
    // wrongly downscale a fast machine's workload.
    const warm = await shaChain(1_000);
    const warmRate = 1_000 / Math.max(warm.elapsed / 1000, 1e-6);
    const calIters = Math.min(20_000, Math.max(1_000, Math.round(warmRate * 0.25)));
    const cal = await shaChain(calIters);
    rate = cal.iters / Math.max(cal.elapsed / 1000, 1e-6);

    const singleIters = Math.min(
      maxSingleCoreIterations,
      Math.max(2_000, Math.round(rate * TARGET_SINGLE_S))
    );
    const single = await shaChain(singleIters, TARGET_SINGLE_S * 3000);
    if (single.iters > 0 && single.elapsed > 0) {
      result.hashesPerSecondSingle = single.iters / (single.elapsed / 1000);
      result.singleMeasured = true;
      rate = result.hashesPerSecondSingle;
    } else {
      result.singleError = 'Single-core phase produced no timed work';
    }
  } catch (e: any) {
    result.singleError = e?.message || String(e);
  }

  // ── Multi-core (v3.6 estimator) ────────────────────────────────
  // Fixed-time window: every worker runs until the SAME absolute deadline and
  // reports its own iteration count and elapsed time. The aggregate is the sum
  // of per-worker rates.
  //
  // The previous estimator handed every worker an identical iteration count and
  // divided total hashes by wall clock. Whenever the per-worker cap bound, that
  // reduced algebraically to `threads x rate of the slowest worker` — every
  // fast core's contribution was discarded, and on a hybrid CPU the E-cores set
  // the result. It also put worker spawn time inside the measured window, which
  // penalised machines with more threads.
  try {
    const deadlineEpoch = Date.now() + MULTI_WINDOW_MS;
    const settled = await spawnWorkers(
      cores, MULTI_MAX_ITERATIONS, deadlineEpoch, WORKER_HARD_TIMEOUT_MS
    );

    const done = settled.filter(
      (s): s is PromiseFulfilledResult<WorkerOutcome> => s.status === 'fulfilled'
    );
    result.workersReported = done.length;

    // All workers must report. A partial batch measures fewer threads than the
    // machine has while the failed ones still consumed scheduler time — the
    // resulting rate would understate the hardware, which is exactly the kind
    // of wrong-but-plausible number this benchmark must not publish.
    const usable = done.filter(s => s.value.iters > 0 && s.value.elapsed > 0);
    if (usable.length === cores) {
      result.hashesPerSecondMulti = usable.reduce(
        (a, s) => a + s.value.iters / (s.value.elapsed / 1000), 0
      );
      result.multiMeasured = true;

      // Per-worker telemetry. The spread between the fastest and slowest worker
      // is the direct measurement of core heterogeneity — it is what tells a
      // reader whether a low score came from slow cores or from one stalled
      // thread. Previously this data was collected and thrown away.
      const el = usable.map(s => s.value.elapsed).sort((a, b) => a - b);
      result.workerElapsedMs = {
        min: Math.round(el[0]),
        median: Math.round(el[Math.floor(el.length / 2)]),
        max: Math.round(el[el.length - 1]),
      };
    } else {
      const firstErr = settled.find(s => s.status === 'rejected') as PromiseRejectedResult | undefined;
      result.multiError = usable.length === 0
        ? `No worker reported (${firstErr?.reason?.message || 'unknown cause'})`
        : `Only ${usable.length}/${cores} workers reported (${firstErr?.reason?.message || 'unknown cause'})`;
    }
  } catch (e: any) {
    result.multiError = e?.message || String(e);
  }

  // Score normalization: log scale, anchored at 1000 hashes/sec = score 100.
  // Unmeasured phases keep a score of 0 — the measured flags carry the meaning
  // and the renderers must never print an unmeasured value.
  const score = (h: number) => Math.round(100 * Math.log10(Math.max(h, 1) / 1000) * 100) / 100;
  if (result.singleMeasured) result.singleCoreScore = score(result.hashesPerSecondSingle);
  if (result.multiMeasured)  result.multiCoreScore  = score(result.hashesPerSecondMulti);

  if (result.singleMeasured && result.multiMeasured) {
    result.speedup = result.hashesPerSecondMulti / result.hashesPerSecondSingle;
    result.efficiency = result.speedup / cores;
  }

  result.durationMs = performance.now() - tStart;
  result.error = result.singleError || result.multiError;
  return result;
}
