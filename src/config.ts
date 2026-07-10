// 9bench — Site Configuration
// Verification + Analytics IDs (set after registering with each service)

// ─── Google Search Console ─────────────────────────────────────────
// Get from: https://search.google.com/search-console
// → Add Property → URL prefix → https://9bench.com → HTML tag method
// Paste the content="..." value below
export const GSC_META_VERIFICATION = '';

// ─── Bing Webmaster Tools (optional, but free 1-min setup) ────────
// Get from: https://www.bing.com/webmasters
export const BING_META_VERIFICATION = '462CF586AFC168C3EA971B9476EA008C';

// ─── Yandex Webmaster (optional, useful for AI/Yandex AI training) ─
// Get from: https://webmaster.yandex.com
export const YANDEX_META_VERIFICATION = 'fd56f469b0ccc4ee';

// ─── Analytics: Cloudflare Web Analytics (cookieless) ─────────────
// Replaced GA4 (2026-04-29) — GDPR/TTDSG § 25 requires opt-in consent
// for GA4, and we don't want a cookie banner. Cloudflare Web Analytics
// is cookieless, no consent banner needed.
// Get token from: Cloudflare dashboard → Web Analytics → Add a site
// Then update the data-cf-beacon token in BaseLayout.astro
export const CLOUDFLARE_ANALYTICS_TOKEN = ''; // ← paste from CF dashboard

// ─── IndexNow API key (instant Bing/Yandex crawl trigger) ──────────
// Generate any 16-char hex string and put it as /KEY.txt in public/
// Then submit URLs via api.indexnow.org
export const INDEXNOW_KEY = 'b4d7e8f2a1c3e5d9';
