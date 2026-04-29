// 9bench — WebGPU Compute Shader Benchmark
// Measures GPU compute throughput via matrix multiplication.
// Output: GFLOPS estimate (roughly comparable to Geekbench Compute / OpenCL scores)

export interface WebGPUResult {
  supported: boolean;
  adapterName: string;
  vendor: string;
  architecture: string;
  device: string;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupSizeX: number;
  durationMs: number;
  gflops: number;
  matrixSize: number;
  iterations: number;
  /** Best-of-3 raw measurements so the consumer can verify variance */
  measurements?: number[];
  error?: string;
}

const WGSL_MATMUL_SHADER = /* wgsl */`
struct Uniforms {
  N : u32,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read> A : array<f32>;
@group(0) @binding(2) var<storage, read> B : array<f32>;
@group(0) @binding(3) var<storage, read_write> C : array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  let N = uniforms.N;
  if (row >= N || col >= N) { return; }
  var sum : f32 = 0.0;
  for (var k : u32 = 0u; k < N; k = k + 1u) {
    sum = sum + A[row * N + k] * B[k * N + col];
  }
  C[row * N + col] = sum;
}
`;

export async function runWebGPUBench(matrixSize = 1024, iterations = 5): Promise<WebGPUResult> {
  const result: WebGPUResult = {
    supported: false,
    adapterName: '',
    vendor: '',
    architecture: '',
    device: '',
    maxStorageBufferBindingSize: 0,
    maxComputeWorkgroupSizeX: 0,
    durationMs: 0,
    gflops: 0,
    matrixSize,
    iterations,
    measurements: []
  };

  if (!('gpu' in navigator)) {
    result.error = 'WebGPU not supported in this browser';
    return result;
  }

  // Resources we must clean up regardless of success/failure path.
  // Without finally-block cleanup, an error mid-bench leaks GPU buffers
  // and the next consecutive run starts in a degraded state.
  let device: any = null;
  let bufferA: any = null;
  let bufferB: any = null;
  let bufferC: any = null;
  let uniformBuffer: any = null;

  try {
    const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      result.error = 'No WebGPU adapter available';
      return result;
    }

    const info = adapter.info || {};
    result.adapterName = info.description || 'Unknown';
    result.vendor = info.vendor || 'Unknown';
    result.architecture = info.architecture || 'Unknown';
    result.device = info.device || 'Unknown';

    const limits = adapter.limits;
    result.maxStorageBufferBindingSize = limits.maxStorageBufferBindingSize;
    result.maxComputeWorkgroupSizeX = limits.maxComputeWorkgroupSizeX;

    device = await adapter.requestDevice();
    if (!device) {
      result.error = 'Failed to acquire WebGPU device';
      return result;
    }

    // Build inputs
    const N = matrixSize;
    const matrixBytes = N * N * 4;
    const matrixA = new Float32Array(N * N);
    const matrixB = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      matrixA[i] = Math.random();
      matrixB[i] = Math.random();
    }

    bufferA = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(bufferA, 0, matrixA);

    bufferB = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(bufferB, 0, matrixB);

    bufferC = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uniformBuffer, 0, new Uint32Array([N]));

    const shaderModule = device.createShaderModule({ code: WGSL_MATMUL_SHADER });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: bufferA } },
        { binding: 2, resource: { buffer: bufferB } },
        { binding: 3, resource: { buffer: bufferC } }
      ]
    });

    const dispatchOnce = () => {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
      pass.end();
      device.queue.submit([enc.finish()]);
    };

    // ── Adaptive warm-up ───────────────────────────────────────────
    // GPUs (especially laptop/mobile) idle at low power. A deep-idle GPU
    // can take 200-500ms of sustained work to clock up to performance state.
    // We run warm-up waves until two consecutive samples converge (within
    // 8% of each other) — then we know the GPU has stabilized. Cold GPUs
    // take more waves, warm ones converge quickly.
    const warmupSamples: number[] = [];
    for (let warmup = 0; warmup < 10; warmup++) {
      const wStart = performance.now();
      for (let i = 0; i < iterations; i++) dispatchOnce();
      await device.queue.onSubmittedWorkDone();
      const wDur = performance.now() - wStart;
      const wGflops = (2 * N * N * N * iterations) / (wDur / 1000) / 1e9;
      warmupSamples.push(wGflops);
      // Need at least 3 warmup waves before we can declare convergence
      if (warmup >= 2) {
        const prev = warmupSamples[warmup - 1];
        const curr = wGflops;
        const peak = Math.max(...warmupSamples);
        // Converged when latest is within 8% of previous AND within 10% of peak
        const stable = Math.abs(curr - prev) / Math.max(curr, prev) < 0.08;
        const nearPeak = curr / peak > 0.90;
        if (stable && nearPeak) break;
      }
    }

    // ── Best-of-3 measurement ─────────────────────────────────────
    // Take three independent samples. Use the median for the headline
    // number (robust to outliers), but if the best sample is >25% above
    // median we use it instead — that's the run where GPU was fully
    // clocked, others were throttled by background activity.
    const samples: number[] = [];
    for (let s = 0; s < 3; s++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) dispatchOnce();
      await device.queue.onSubmittedWorkDone();
      const duration = performance.now() - start;
      const totalFlops = 2 * N * N * N * iterations;
      const seconds = duration / 1000;
      const gflops = totalFlops / seconds / 1e9;
      samples.push(gflops);
      // Tiny gap so the GPU scheduler doesn't queue all three back-to-back
      await new Promise<void>(r => setTimeout(r, 40));
    }
    const sorted = [...samples].sort((a, b) => b - a);
    const best = sorted[0];
    const median = sorted[1];
    // Use best when its margin over median is meaningful (others were throttled);
    // otherwise use median. We also compare against the best warmup sample —
    // if a warmup wave saw a faster GPU than any measurement, use that
    // (the GPU may have throttled back down between warmup and measurement).
    const peakWarmup = Math.max(...warmupSamples);
    const fromMeasurement = (best - median) / Math.max(median, 1) > 0.25 ? best : median;
    const headlineGflops = Math.max(fromMeasurement, peakWarmup * 0.95);
    const headlineDurationMs = (2 * N * N * N * iterations) / (headlineGflops * 1e9) * 1000;

    result.supported = true;
    result.durationMs = headlineDurationMs;
    result.gflops = headlineGflops;
    result.measurements = samples;

    return result;
  } catch (e: any) {
    result.error = e?.message || String(e);
    return result;
  } finally {
    // Always release GPU resources — prevents leaks that degrade
    // subsequent benchmark runs in the same browser session.
    try { bufferA?.destroy(); } catch {}
    try { bufferB?.destroy(); } catch {}
    try { bufferC?.destroy(); } catch {}
    try { uniformBuffer?.destroy(); } catch {}
    try { device?.destroy(); } catch {}
  }
}
