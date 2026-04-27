// Generate PNG icons from SVG sources
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

const svg512 = readFileSync(join(PUBLIC, 'icon-512.svg'));

// Generate PNG sizes
const sizes = [16, 32, 48, 96, 144, 180, 192, 256, 384, 512];

for (const size of sizes) {
  const out = join(PUBLIC, `icon-${size}.png`);
  await sharp(svg512)
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`✓ icon-${size}.png`);
}

// Apple touch icon (180x180)
await sharp(svg512)
  .resize(180, 180)
  .png()
  .toFile(join(PUBLIC, 'apple-touch-icon.png'));
console.log('✓ apple-touch-icon.png');

// Favicon ICO equivalent (32x32)
await sharp(svg512)
  .resize(32, 32)
  .png()
  .toFile(join(PUBLIC, 'favicon-32.png'));
console.log('✓ favicon-32.png');

// OG fallback default
await sharp(svg512)
  .resize(512, 512)
  .png()
  .toFile(join(PUBLIC, 'og.png'));
console.log('✓ og.png (fallback)');

console.log('\nAll icons generated.');
