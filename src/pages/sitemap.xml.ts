import type { APIRoute } from 'astro';

const SITE = 'https://9bench.com';

export const GET: APIRoute = () => {
  // Use real last-modified dates per URL (not dynamic today) so Google
  // trusts lastmod signals. Update these when content actually changes.
  const urls = [
    { loc: `${SITE}/`, lastmod: '2026-07-29', priority: '1.0', changefreq: 'weekly' },
    { loc: `${SITE}/top/`, lastmod: '2026-07-29', priority: '0.9', changefreq: 'daily' },
    { loc: `${SITE}/compare/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/methodology/`, lastmod: '2026-07-29', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/faq/`, lastmod: '2026-07-29', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/about/`, lastmod: '2026-07-29', priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE}/privacy/`, lastmod: '2026-03-15', priority: '0.5', changefreq: 'yearly' },
    { loc: `${SITE}/articles/`, lastmod: '2026-07-30', priority: '0.95', changefreq: 'weekly' },
    // Articles
    { loc: `${SITE}/articles/can-my-pc-run-pewdiepie-odysseus-2026/`, lastmod: '2026-07-30', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/articles/userbenchmark-alternatives-2026/`, lastmod: '2026-04-27', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/articles/how-to-test-cpu-gpu-ram-online-no-download/`, lastmod: '2026-04-27', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/articles/geekbench-vs-cinebench-vs-9bench/`, lastmod: '2026-04-27', priority: '0.9', changefreq: 'monthly' },
    { loc: `${SITE}/articles/what-is-gflops-gpu-performance-explained/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/how-many-cpu-cores-do-you-need-2026/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/why-browser-benchmarks-score-lower-than-native/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/complete-guide-online-hardware-benchmarking-2026/`, lastmod: '2026-04-27', priority: '0.95', changefreq: 'monthly' },
    { loc: `${SITE}/articles/best-gpu-for-local-llm-2026/`, lastmod: '2026-04-29', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/userbenchmark-banned-honest-alternatives-2026/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/test-pc-stable-diffusion-xl-15-seconds/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/apple-m3-max-vs-rtx-4090-local-ai/`, lastmod: '2026-04-27', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/how-much-vram-do-you-need-for-local-llm-2026/`, lastmod: '2026-04-29', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/run-local-llm-on-8gb-vram-2026-reality-check/`, lastmod: '2026-04-29', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/best-laptop-for-local-ai-2026/`, lastmod: '2026-04-29', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/browser-vs-native-llm-performance/`, lastmod: '2026-04-29', priority: '0.85', changefreq: 'monthly' },
    { loc: `${SITE}/articles/can-my-pc-run-it-15-second-test-2026/`, lastmod: '2026-07-30', priority: '0.85', changefreq: 'monthly' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
