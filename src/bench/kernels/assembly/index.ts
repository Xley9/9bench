// 9bench v4.0 candidate CPU kernels (AssemblyScript → WASM, scalar only).
//
// Design constraints (see /methodology#v4-gate):
// - Identical machine-code semantics on every device: no SIMD, no crypto
//   hardware, no engine-specific paths. WASM cannot emit SHA-NI/ARMv8-SHA2,
//   which turns "can't use the accelerator" into the comparability guarantee —
//   the old crypto.subtle workload had a ~4x hardware cliff between CPUs with
//   and without SHA extensions that had nothing to do with CPU quality.
// - Self-verifying: callers compare kernel output against expected tables
//   computed at BUILD TIME by independent implementations (node:crypto for
//   SHA-256, a plain-JS reference for Mandelbrot). A miscompiled or broken
//   kernel cannot produce a benchmark number.
// - Deterministic: no randomness, no time, no floating-point ambiguity
//   (WASM f64 ops are IEEE-754 exact; iteration counts are integers).
//
// Memory layout (linear memory, no GC objects at runtime):
//   [0   .. 32)   SHA-256 chain state (8 big-endian u32 words)
//   [64  .. 320)  W message schedule scratch (64 u32)

// ── SHA-256 round constants ─────────────────────────────────────────
const K: StaticArray<u32> = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Where the caller writes the 32-byte seed and reads the 32-byte result. */
export function statePtr(): i32 {
  return 0;
}

const W_PTR: i32 = 64;

/**
 * One full SHA-256 of the 32-byte state, written back to the state.
 *
 * A 32-byte message always pads to exactly one 64-byte block:
 *   W[0..7]  = message (8 BE words)
 *   W[8]     = 0x80000000
 *   W[9..14] = 0
 *   W[15]    = 256 (message length in bits)
 * so each chain step is exactly one compression. node:crypto computes the
 * identical function, which is what makes the build-time cross-check an
 * independent verification rather than the kernel checking itself.
 */
function sha256OfState(): void {
  // Message words from state (state is stored big-endian).
  for (let i = 0; i < 8; i++) {
    store<u32>(W_PTR + (i << 2), bswap<u32>(load<u32>(i << 2)));
  }
  store<u32>(W_PTR + (8 << 2), 0x80000000);
  for (let i = 9; i < 15; i++) {
    store<u32>(W_PTR + (i << 2), 0);
  }
  store<u32>(W_PTR + (15 << 2), 256);

  // Message schedule.
  for (let i = 16; i < 64; i++) {
    const w15 = load<u32>(W_PTR + ((i - 15) << 2));
    const w2  = load<u32>(W_PTR + ((i - 2) << 2));
    const s0  = rotr<u32>(w15, 7) ^ rotr<u32>(w15, 18) ^ (w15 >>> 3);
    const s1  = rotr<u32>(w2, 17) ^ rotr<u32>(w2, 19) ^ (w2 >>> 10);
    store<u32>(
      W_PTR + (i << 2),
      load<u32>(W_PTR + ((i - 16) << 2)) + s0 + load<u32>(W_PTR + ((i - 7) << 2)) + s1
    );
  }

  // Compression from the fixed SHA-256 IV (each step is a full hash, not a
  // running compression — that is what node:crypto verifies against).
  let a: u32 = 0x6a09e667, b: u32 = 0xbb67ae85, c: u32 = 0x3c6ef372, d: u32 = 0xa54ff53a;
  let e: u32 = 0x510e527f, f: u32 = 0x9b05688c, g: u32 = 0x1f83d9ab, h: u32 = 0x5be0cd19;

  for (let i = 0; i < 64; i++) {
    const S1 = rotr<u32>(e, 6) ^ rotr<u32>(e, 11) ^ rotr<u32>(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = h + S1 + ch + unchecked(K[i]) + load<u32>(W_PTR + (i << 2));
    const S0 = rotr<u32>(a, 2) ^ rotr<u32>(a, 13) ^ rotr<u32>(a, 22);
    const mj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = S0 + mj;
    h = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }

  // Digest = IV + working vars, stored big-endian back into the state.
  store<u32>(0,  bswap<u32>(a + 0x6a09e667));
  store<u32>(4,  bswap<u32>(b + 0xbb67ae85));
  store<u32>(8,  bswap<u32>(c + 0x3c6ef372));
  store<u32>(12, bswap<u32>(d + 0xa54ff53a));
  store<u32>(16, bswap<u32>(e + 0x510e527f));
  store<u32>(20, bswap<u32>(f + 0x9b05688c));
  store<u32>(24, bswap<u32>(g + 0x1f83d9ab));
  store<u32>(28, bswap<u32>(h + 0x5be0cd19));
}

/**
 * INT kernel work unit: `steps` chained SHA-256 hashes of the 32-byte state.
 * Caller seeds the state, calls int_unit(8192), compares the state against
 * the expected table.
 */
export function int_unit(steps: i32): void {
  for (let s = 0; s < steps; s++) {
    sha256OfState();
  }
}

// ── FP64 kernel: Mandelbrot escape iteration ────────────────────────
// Fixed viewport [-2.0, 0.5] x [-1.25, 1.25] rendered as a virtual 512x512
// image, split into an 8x8 grid of 64x64-pixel tiles. Tile indices 0..63
// cycle through the whole set, mixing interior tiles (expensive, hit the
// 256-iteration cap) and exterior tiles (cheap, escape early).
//
// The u32 checksum is the sum of iteration counts — which doubles as the
// exact amount of work done, so the caller derives pixel-iterations/second
// from the expected table without trusting the kernel's own timing.

/** One 64x64 tile; returns the iteration-count checksum. */
export function fp_tile(tileIdx: i32): u32 {
  const tx = tileIdx & 7;
  const ty = tileIdx >> 3;
  const dx = 2.5 / 512.0;
  const dy = 2.5 / 512.0;
  let checksum: u32 = 0;

  for (let py = 0; py < 64; py++) {
    const cy = -1.25 + ((<f64>(ty * 64 + py)) + 0.5) * dy;
    for (let px = 0; px < 64; px++) {
      const cx = -2.0 + ((<f64>(tx * 64 + px)) + 0.5) * dx;
      let zx = 0.0, zy = 0.0;
      let iter: u32 = 0;
      while (iter < 256) {
        const zx2 = zx * zx;
        const zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) break;
        zy = 2.0 * zx * zy + cy;
        zx = zx2 - zy2 + cx;
        iter++;
      }
      checksum += iter;
    }
  }
  return checksum;
}
