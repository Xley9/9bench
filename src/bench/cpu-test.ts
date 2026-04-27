// 9bench — CPU Benchmark
// Single-Core: SHA-256 hash chain (cryptographic, CPU-bound, deterministic)
// Multi-Core: parallel work via Web Workers + same workload
// Output: hashes/sec normalized to a "9bench CPU score"
//
// Why SHA-256: deterministic, CPU-bound, parallelizable, real-world relevant
// (used in TLS, blockchain, file integrity), and platform-independent.

export interface CPUResult {
  singleCoreScore: number;
  multiCoreScore: number;
  cores: number;
  durationMs: number;
  hashesPerSecondSingle: number;
  hashesPerSecondMulti: number;
  speedup: number;
  efficiency: number;
  error?: string;
}

// Inline worker source — runs the same SHA-256 chain
const WORKER_SOURCE = `
async function sha256(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(hash);
}
async function chain(iterations) {
  let buf = new Uint8Array(64);
  for (let i = 0; i < 64; i++) buf[i] = i;
  for (let i = 0; i < iterations; i++) {
    buf = await sha256(buf);
  }
  return buf;
}
self.onmessage = async (e) => {
  const t0 = performance.now();
  const result = await chain(e.data.iterations);
  const elapsed = performance.now() - t0;
  self.postMessage({ elapsed, hash: result.slice(0, 4) });
};
`;

async function shaChain(iterations: number): Promise<{ elapsed: number }> {
  let buf = new Uint8Array(64);
  for (let i = 0; i < 64; i++) buf[i] = i;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const hash = await crypto.subtle.digest('SHA-256', buf);
    buf = new Uint8Array(hash);
  }
  return { elapsed: performance.now() - t0 };
}

function spawnWorker(iterations: number): Promise<{ elapsed: number }> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    const timeout = setTimeout(() => {
      w.terminate();
      reject(new Error('Worker timeout'));
    }, 60_000);
    w.onmessage = (e) => {
      clearTimeout(timeout);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve({ elapsed: e.data.elapsed });
    };
    w.onerror = (e) => {
      clearTimeout(timeout);
      w.terminate();
      reject(e);
    };
    w.postMessage({ iterations });
  });
}

export async function runCPUBench(
  singleCoreIterations = 100_000,
  multiCoreIterationsPerWorker = 100_000
): Promise<CPUResult> {
  const cores = navigator.hardwareConcurrency || 4;
  const result: CPUResult = {
    singleCoreScore: 0,
    multiCoreScore: 0,
    cores,
    durationMs: 0,
    hashesPerSecondSingle: 0,
    hashesPerSecondMulti: 0,
    speedup: 0,
    efficiency: 0
  };

  try {
    // Single-core warm-up
    await shaChain(1000);

    // Single-core timed
    const single = await shaChain(singleCoreIterations);
    result.hashesPerSecondSingle = singleCoreIterations / (single.elapsed / 1000);

    // Multi-core: spawn N workers, each doing same iteration count
    const startMulti = performance.now();
    const promises: Promise<{ elapsed: number }>[] = [];
    for (let i = 0; i < cores; i++) {
      promises.push(spawnWorker(multiCoreIterationsPerWorker));
    }
    const multiResults = await Promise.all(promises);
    const multiElapsed = performance.now() - startMulti;
    const totalHashes = multiCoreIterationsPerWorker * cores;
    result.hashesPerSecondMulti = totalHashes / (multiElapsed / 1000);

    // Score normalization: log scale, anchored at 1000 hashes/sec = score 100
    // Modern CPUs do 1M+ SHA-256/sec single-core, so score ~600
    const score = (h: number) => Math.round(100 * Math.log10(Math.max(h, 1) / 1000) * 100) / 100;
    result.singleCoreScore = score(result.hashesPerSecondSingle);
    result.multiCoreScore = score(result.hashesPerSecondMulti);

    result.speedup = result.hashesPerSecondMulti / result.hashesPerSecondSingle;
    result.efficiency = result.speedup / cores;
    result.durationMs = single.elapsed + multiElapsed;

    return result;
  } catch (e: any) {
    result.error = e?.message || String(e);
    return result;
  }
}
