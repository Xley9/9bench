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
    iterations
  };

  if (!('gpu' in navigator)) {
    result.error = 'WebGPU not supported in this browser';
    return result;
  }

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

    const device = await adapter.requestDevice();
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

    const bufferA = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(bufferA, 0, matrixA);

    const bufferB = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(bufferB, 0, matrixB);

    const bufferC = device.createBuffer({
      size: matrixBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const uniformBuffer = device.createBuffer({
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

    // Warm-up pass
    {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    }

    // Timed iterations
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
    const duration = performance.now() - start;

    // Each matmul = 2 * N^3 FLOPs (mul+add per element-of-row × N × N)
    const totalFlops = 2 * N * N * N * iterations;
    const seconds = duration / 1000;
    const gflops = totalFlops / seconds / 1e9;

    result.supported = true;
    result.durationMs = duration;
    result.gflops = gflops;

    // Cleanup
    bufferA.destroy();
    bufferB.destroy();
    bufferC.destroy();
    uniformBuffer.destroy();
    device.destroy();

    return result;
  } catch (e: any) {
    result.error = e?.message || String(e);
    return result;
  }
}
