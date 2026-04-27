import type { APIRoute } from 'astro';

const SITE = 'https://9bench.com';

export const GET: APIRoute = () => {
  const today = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' }
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
