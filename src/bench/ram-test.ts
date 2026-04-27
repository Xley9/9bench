// 9bench — RAM Benchmark
// Memory bandwidth via TypedArray copy + read patterns.
// Output: GB/s sequential read + write throughput
//
// Methodology: allocate large TypedArrays, perform sequential copies,
// measure bytes/sec. Real RAM bandwidth depends on CPU↔RAM bus, cache hierarchy,
// and channel count. We measure the WORKING-SET-SIZE that exceeds L3 cache
// to force actual main-memory access (typically 64MB working set).

export interface RAMResult {
  workingSetMB: number;
  copyBandwidthGBs: number;
  readBandwidthGBs: number;
  writeBandwidthGBs: number;
  randomAccessLatencyNs: number;
  durationMs: number;
  score: number;
  error?: string;
}

export async function runRAMBench(workingSetMB = 256): Promise<RAMResult> {
  const result: RAMResult = {
    workingSetMB,
    copyBandwidthGBs: 0,
    readBandwidthGBs: 0,
    writeBandwidthGBs: 0,
    randomAccessLatencyNs: 0,
    durationMs: 0,
    score: 0
  };

  try {
    const bytes = workingSetMB * 1024 * 1024;
    const elements = bytes / 4; // Float32

    // Allocate two arrays that each exceed L3 cache (typical 8-32MB)
    const src = new Float32Array(elements);
    const dst = new Float32Array(elements);

    // Initialize source with predictable pattern
    for (let i = 0; i < elements; i++) src[i] = i * 1.000001;

    const startTotal = performance.now();

    // Test 1: Sequential COPY bandwidth
    const copyIterations = 5;
    const copyStart = performance.now();
    for (let it = 0; it < copyIterations; it++) {
      dst.set(src); // memcpy-like, vectorizable by JIT
    }
    const copyElapsed = performance.now() - copyStart;
    const copyBytes = bytes * 2 * copyIterations; // read + write
    result.copyBandwidthGBs = (copyBytes / (copyElapsed / 1000)) / 1e9;

    // Test 2: Sequential READ bandwidth (sum)
    const readIterations = 5;
    let sum = 0;
    const readStart = performance.now();
    for (let it = 0; it < readIterations; it++) {
      let s = 0;
      for (let i = 0; i < elements; i += 4) {
        s += src[i] + src[i + 1] + src[i + 2] + src[i + 3];
      }
      sum += s;
    }
    const readElapsed = performance.now() - readStart;
    const readBytes = bytes * readIterations;
    result.readBandwidthGBs = (readBytes / (readElapsed / 1000)) / 1e9;
    if (sum === 0) console.warn('Read benchmark sum was 0 — possible JIT optimization');

    // Test 3: Sequential WRITE bandwidth
    const writeIterations = 5;
    const writeStart = performance.now();
    for (let it = 0; it < writeIterations; it++) {
      const v = it * 0.5;
      for (let i = 0; i < elements; i += 4) {
        dst[i] = v;
        dst[i + 1] = v;
        dst[i + 2] = v;
        dst[i + 3] = v;
      }
    }
    const writeElapsed = performance.now() - writeStart;
    const writeBytes = bytes * writeIterations;
    result.writeBandwidthGBs = (writeBytes / (writeElapsed / 1000)) / 1e9;

    // Test 4: Random-access latency (defeats cache prefetching)
    const indexCount = 1_000_000;
    const indices = new Uint32Array(indexCount);
    // Pseudo-random walk through working set
    let prev = 0;
    for (let i = 0; i < indexCount; i++) {
      prev = (prev * 1664525 + 1013904223) & 0xffffffff;
      indices[i] = (prev >>> 0) % elements;
    }
    let acc = 0;
    const latStart = performance.now();
    for (let i = 0; i < indexCount; i++) {
      acc += src[indices[i]];
    }
    const latElapsed = performance.now() - latStart;
    if (acc === 0) console.warn('Latency benchmark sum was 0');
    result.randomAccessLatencyNs = (latElapsed * 1e6) / indexCount;

    result.durationMs = performance.now() - startTotal;

    // 9bench RAM Score: composite of read + write bandwidth
    // Modern DDR5 desktop: ~50 GB/s read = score 1000
    // Mobile LPDDR5: ~25 GB/s = score 500
    // Old DDR3: ~10 GB/s = score 200
    const avgBandwidth = (result.readBandwidthGBs + result.writeBandwidthGBs) / 2;
    result.score = Math.round(avgBandwidth * 20);

    return result;
  } catch (e: any) {
    result.error = e?.message || String(e);
    return result;
  }
}
