import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://9bench.com',
  output: 'static',
  compressHTML: true,
  integrations: [
    tailwind({ applyBaseStyles: false })
  ],
  build: {
    inlineStylesheets: 'auto'
  }
});
