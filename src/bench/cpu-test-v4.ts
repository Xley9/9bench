// 9bench v4.0 CANDIDATE CPU benchmark — shadow-mode / solo-mode only.
//
// NOT SCORED. This module runs the two build-time WASM kernels (SHA-256
// integer chain + Mandelbrot f64) that are candidates to replace the current
// crypto.subtle workload. Until the published validation gate on
// /methodology passes, nothing computed here enters any score, any pool or
// any leaderboard — the numbers are stored as telemetry (shadow_runs table)
// and printed to the console log of the person whose machine produced them.
//
// Estimator: identical to the scored v3.6 CPU test — fixed absolute deadline
// (Date.now() epoch, shared across threads), each worker reports its own
// units and elapsed, multi-core aggregate = SUM of per-worker rates. Only
// the WORKLOAD differs. Changing one variable at a time is what lets the
// validation gate attribute a pass or a failure.
//
// Self-verification: every work unit's output is compared against tables
// computed at build time by independent implementations (node:crypto / a JS
// reference). A run that computes a wrong answer reports verifyOk=false and
// its rates are zeroed — it cannot produce a benchmark number.

import {
  WL_REVISION, INT_STEPS_PER_UNIT, INT_SEED_COUNT, FP_TILE_COUNT,
  WASM_B64, INT_SEEDS_B64, INT_EXPECTED_B64, FP_EXPECTED,
} from './kernels/kernels-inline';
import { shaChain } from './cpu-test';

export interface CPUV4Config {
  /** Single-core measured window per kernel (ms). */
  singleMs: number;
  /** Multi-core measured window per kernel (ms). */
  multiWindowMs: number;
  /** Discarded warm-up per kernel per worker (ms) — lets WASM tier-up settle. */
  warmupMs: number;
  /** Run the 0.4s old-workload probe first (throttle index vs the scored phase). */
  probe: boolean;
  onLog?: (line: string) => void;
}

export interface CPUV4Result {
  wl: number;
  probeHashesSingle?: number;
  intSingle: number;
  fpSingle: number;
  intMulti: number;
  fpMulti: number;
  singleElapsedMs: number;
  multiWindowMs: number;
  workersSpawned: number;
  workersReported: number;
  intWorkerRates: number[];
  fpWorkerRates: number[];
  clockSkewMs: number;
  verifyOk: boolean;
  verifyFailKernel?: 'int' | 'fp';
  shadowElapsedMs: number;
  error?: string;
}

// Worker source. The wasm binary and both verification tables are inlined so
// the worker is fully self-contained (blob URL, no network, works under the
// existing CSP without changes).
function workerSource(): string {
  return `
self.onerror = function (m) { try { self.postMessage({ ok:false, error:String(m) }); } catch(e){} };
const WASM_B64 = '${WASM_B64}';
const INT_SEEDS_B64 = '${INT_SEEDS_B64}';
const INT_EXPECTED_B64 = '${INT_EXPECTED_B64}';
const FP_EXPECTED = ${JSON.stringify(FP_EXPECTED)};
const INT_STEPS = ${INT_STEPS_PER_UNIT};
const INT_SEEDS_N = ${INT_SEED_COUNT};
const FP_TILES_N = ${FP_TILE_COUNT};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const INT_SEEDS = b64ToBytes(INT_SEEDS_B64);
const INT_EXPECTED = b64ToBytes(INT_EXPECTED_B64);

let ex = null, mem = null, sp = 0;
async function ensureWasm() {
  if (ex) return;
  const { instance } = await WebAssembly.instantiate(b64ToBytes(WASM_B64), {});
  ex = instance.exports;
  mem = new Uint8Array(ex.memory.buffer);
  sp = ex.statePtr();
}

// One INT unit: seed -> ${INT_STEPS_PER_UNIT} chained hashes -> compare
// against the node:crypto table. Returns work done, or -1 on verify failure.
function runIntUnit(u) {
  const idx = u % INT_SEEDS_N;
  mem.set(INT_SEEDS.subarray(idx * 32, idx * 32 + 32), sp);
  ex.int_unit(INT_STEPS);
  for (let i = 0; i < 32; i++) {
    if (mem[sp + i] !== INT_EXPECTED[idx * 32 + i]) return -1;
  }
  return INT_STEPS;
}

// One FP unit: one 64x64 tile -> compare checksum against the JS-reference
// table. The expected checksum IS the exact pixel-iteration work, so rates
// derive from the table rather than kernel self-reporting.
function runFpUnit(u) {
  const idx = u % FP_TILES_N;
  const got = ex.fp_tile(idx) >>> 0;
  if (got !== FP_EXPECTED[idx]) return -1;
  return FP_EXPECTED[idx];
}

self.onmessage = async (e) => {
  try {
    const { kernel, deadlineEpoch, warmupMs } = e.data;
    await ensureWasm();
    const runUnit = kernel === 'int' ? runIntUnit : runFpUnit;

    // Warm-up: discarded, bounded by both time and the shared deadline.
    const w0 = performance.now();
    let u = 0;
    while (performance.now() - w0 < warmupMs && Date.now() < deadlineEpoch) {
      if (runUnit(u++) < 0) { self.postMessage({ ok:false, verifyFail:true, error:'verify failed (warmup)' }); return; }
    }

    // Measured window: rate = work / OWN performance.now() elapsed. A wall
    // clock step (sleep/NTP) can only move where the window ENDS, never the
    // rate — which is why sharing a Date.now() epoch across workers is safe.
    const t0 = performance.now(), d0 = Date.now();
    let work = 0, units = 0;
    while (Date.now() < deadlineEpoch) {
      const w = runUnit(u++);
      if (w < 0) { self.postMessage({ ok:false, verifyFail:true, error:'verify failed' }); return; }
      work += w;
      units++;
    }
    const elapsed = performance.now() - t0;
    // Sleep/freeze detector: perf-elapsed and wall-elapsed diverging by more
    // than a second means the machine suspended mid-window.
    const clockSkew = Math.abs(elapsed - (Date.now() - d0));
    self.postMessage({ ok:true, work, units, elapsed, clockSkew });
  } catch (err) {
    self.postMessage({ ok:false, error:String((err && err.message) || err) });
  }
};
`;
}

interface KernelReply { ok: boolean; work?: number; units?: number; elapsed?: number; clockSkew?: number; verifyFail?: boolean; error?: string }

/** A worker plus a one-command-at-a-time request/reply channel. */
class KernelWorker {
  private w: Worker;
  private pending: ((r: KernelReply) => void) | null = null;
  constructor(url: string) {
    this.w = new Worker(url);
    this.w.onmessage = (e: MessageEvent) => { const p = this.pending; this.pending = null; p?.(e.data as KernelReply); };
    this.w.onerror = (e: any) => { const p = this.pending; this.pending = null; p?.({ ok: false, error: e?.message || 'worker error' }); };
  }
  run(kernel: 'int' | 'fp', deadlineEpoch: number, warmupMs: number, hardTimeoutMs: number): Promise<KernelReply> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending) { this.pending = null; resolve({ ok: false, error: `worker did not report within ${hardTimeoutMs}ms` }); }
      }, hardTimeoutMs);
      this.pending = (r) => { clearTimeout(timer); resolve(r); };
      this.w.postMessage({ kernel, deadlineEpoch, warmupMs });
    });
  }
  terminate() { try { this.w.terminate(); } catch { /* noop */ } }
}

export async function runCPUBenchV4(cfg: CPUV4Config): Promise<CPUV4Result> {
  const log = cfg.onLog ?? (() => {});
  const t0 = performance.now();
  const cores = Math.min(Math.max(1, navigator.hardwareConcurrency || 4), 64);

  const result: CPUV4Result = {
    wl: WL_REVISION,
    intSingle: 0, fpSingle: 0, intMulti: 0, fpMulti: 0,
    singleElapsedMs: 0, multiWindowMs: cfg.multiWindowMs,
    workersSpawned: 0, workersReported: 0,
    intWorkerRates: [], fpWorkerRates: [],
    clockSkewMs: 0,
    verifyOk: true,
    shadowElapsedMs: 0,
  };

  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    result.error = 'WebAssembly or Workers unavailable';
    result.verifyOk = false;
    result.shadowElapsedMs = Math.round(performance.now() - t0);
    return result;
  }

  // ── 0. Throttle probe: re-run the OLD workload briefly ────────────
  // Dividing this by the scored hashesPerSecondSingle from minutes earlier
  // gives a per-run throttle index — measured, not guessed. Matters because
  // the shadow phase runs on a chip that just did 25-40s of benchmark work.
  if (cfg.probe) {
    try {
      const p = await shaChain(1_000_000_000, 400);
      if (p.elapsed > 0) result.probeHashesSingle = p.iters / (p.elapsed / 1000);
    } catch { /* non-fatal */ }
  }

  const blob = new Blob([workerSource()], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const workers: KernelWorker[] = [];
  const failKernel = (k: 'int' | 'fp', err?: string, verify?: boolean) => {
    if (verify) { result.verifyOk = false; result.verifyFailKernel = result.verifyFailKernel ?? k; }
    if (err && !result.error) result.error = err;
  };

  try {
    // ── 1. Single-core: ONE worker, kernels sequential ──────────────
    // A worker, not the main thread: the kernels are synchronous and would
    // freeze the page; a worker also removes event-loop jitter.
    const single = new KernelWorker(url);
    workers.push(single);
    const sStart = performance.now();
    for (const kernel of ['int', 'fp'] as const) {
      const deadline = Date.now() + cfg.warmupMs + cfg.singleMs;
      const r = await single.run(kernel, deadline, cfg.warmupMs, cfg.warmupMs + cfg.singleMs + 15_000);
      if (r.ok && r.work! > 0 && r.elapsed! > 0) {
        const rate = r.work! / (r.elapsed! / 1000);
        if (kernel === 'int') result.intSingle = rate; else result.fpSingle = rate;
        result.clockSkewMs = Math.max(result.clockSkewMs, Math.round(r.clockSkew || 0));
      } else {
        failKernel(kernel, r.error, r.verifyFail);
      }
    }
    result.singleElapsedMs = Math.round(performance.now() - sStart);
    log(`shadow → single: int ${fmtRate(result.intSingle)} steps/s · fp ${fmtRate(result.fpSingle)} px-iter/s`);

    // ── 2. Multi-core: N workers spawned once, kernels sequential ───
    const multi: KernelWorker[] = [];
    for (let i = 0; i < cores; i++) { const w = new KernelWorker(url); multi.push(w); workers.push(w); }
    result.workersSpawned = cores;

    for (const kernel of ['int', 'fp'] as const) {
      // 1s spawn/settle allowance so every worker is alive before the
      // deadline starts mattering — spawn cost stays outside the window.
      const deadline = Date.now() + 1_000 + cfg.warmupMs + cfg.multiWindowMs;
      const replies = await Promise.all(multi.map(w =>
        w.run(kernel, deadline, cfg.warmupMs, 1_000 + cfg.warmupMs + cfg.multiWindowMs + 20_000)
      ));
      const good = replies.filter(r => r.ok && r.work! > 0 && r.elapsed! > 0);
      if (good.length === cores) {
        const rates = good.map(r => r.work! / (r.elapsed! / 1000));
        const sum = rates.reduce((a, b) => a + b, 0);
        if (kernel === 'int') { result.intMulti = sum; result.intWorkerRates = rates.map(r => Math.round(r)); }
        else { result.fpMulti = sum; result.fpWorkerRates = rates.map(r => Math.round(r)); }
        result.clockSkewMs = Math.max(result.clockSkewMs, ...good.map(r => Math.round(r.clockSkew || 0)));
        result.workersReported = cores;
      } else {
        const bad = replies.find(r => !r.ok);
        result.workersReported = Math.max(result.workersReported, good.length);
        failKernel(kernel,
          `${kernel} multi: only ${good.length}/${cores} workers reported (${bad?.error || 'unknown'})`,
          replies.some(r => r.verifyFail));
        // All workers must report — a partial batch measures fewer threads
        // than the machine has. Rates stay 0 for this kernel.
      }
    }
    log(`shadow → multi (${cores} workers): int ${fmtRate(result.intMulti)} steps/s · fp ${fmtRate(result.fpMulti)} px-iter/s`);
  } catch (e: any) {
    result.error = result.error || e?.message || String(e);
  } finally {
    for (const w of workers) w.terminate();
    URL.revokeObjectURL(url);
  }

  // Verify failure ⇒ the failing kernel's numbers are not benchmark numbers.
  if (!result.verifyOk) {
    if (result.verifyFailKernel === 'int') { result.intSingle = 0; result.intMulti = 0; result.intWorkerRates = []; }
    if (result.verifyFailKernel === 'fp') { result.fpSingle = 0; result.fpMulti = 0; result.fpWorkerRates = []; }
  }

  result.shadowElapsedMs = Math.round(performance.now() - t0);
  return result;
}

function fmtRate(r: number): string {
  if (r <= 0) return '—';
  if (r >= 1e6) return (r / 1e6).toFixed(1) + 'M';
  if (r >= 1e3) return (r / 1e3).toFixed(0) + 'k';
  return String(Math.round(r));
}
