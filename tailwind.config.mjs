/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // 9bench brand — different from Toololis indigo to differentiate
        brand: {
          DEFAULT: '#10B981', // emerald — "trust, accuracy, score"
          dark: '#065F46',
          light: '#D1FAE5'
        },
        truth: {
          DEFAULT: '#4F46E5', // indigo — Truth Series shared identity
          dark: '#312E81'
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
