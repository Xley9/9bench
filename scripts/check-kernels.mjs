// Kernel integrity guard — runs as part of `npm run build`.
//
// Policy: the committed kernels.wasm IS the benchmark. If a rebuild (e.g.
// after an assemblyscript upgrade) produces different bytes, the numbers it
// measures may shift, which would silently rebase every stored score. So a
// byte difference FAILS the build. Changing the kernel is allowed — but only
// as a deliberate act: run build-kernels.mjs, bump WL_REVISION, commit, and
// document it in the changelog. Never as a side effect of npm install.
//
// Additionally re-runs the independent cross-checks (node:crypto + JS
// reference) against the COMMITTED binary, so a corrupted checkout cannot
// build either.

import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, crossCheck } from './build-kernels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED = join(ROOT, 'src/bench/kernels/kernels.wasm');

const committed = readFileSync(COMMITTED);

const tmp = mkdtempSync(join(tmpdir(), '9bench-kernels-'));
try {
  const rebuilt = compile(join(tmp, 'kernels.wasm'));
  if (!committed.equals(rebuilt)) {
    console.error(
      '\n[check-kernels] FAIL: rebuilding the kernels produces different bytes '
      + `(committed ${committed.length}, rebuilt ${rebuilt.length}).\n`
      + 'A toolchain change is trying to alter the benchmark. If intentional:\n'
      + '  1. node scripts/build-kernels.mjs   (after bumping WL_REVISION)\n'
      + '  2. commit kernels.wasm + kernels-inline.ts\n'
      + '  3. document the revision in the methodology changelog\n'
    );
    process.exit(1);
  }
  await crossCheck(committed);
  console.log('[check-kernels] ok — committed wasm matches rebuild and passes independent cross-checks');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
