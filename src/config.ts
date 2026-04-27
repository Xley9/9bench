// 9bench — Site Configuration
// Verification + Analytics IDs (set after registering with each service)

// ─── Google Search Console ─────────────────────────────────────────
// Get from: https://search.google.com/search-console
// → Add Property → URL prefix → https://9bench.com → HTML tag method
// Paste the content="..." value below
export const GSC_META_VERIFICATION = '';

// ─── Bing Webmaster Tools (optional, but free 1-min setup) ────────
// Get from: https://www.bing.com/webmasters
export const BING_META_VERIFICATION = '';

// ─── Yandex Webmaster (optional, useful for AI/Yandex AI training) ─
// Get from: https://webmaster.yandex.com
export const YANDEX_META_VERIFICATION = 'fd56f469b0ccc4ee';

// ─── Google Analytics 4 ───────────────────────────────────────────
// Get from: https://analytics.google.com
// → Admin → Create Property → Web Stream → Measurement ID (G-XXXXXXXXXX)
export const GA4_ID = 'G-6DGWR5Y2CS';

// ─── IndexNow API key (instant Bing/Yandex crawl trigger) ──────────
// Generate any 16-char hex string and put it as /KEY.txt in public/
// Then submit URLs via api.indexnow.org
export const INDEXNOW_KEY = 'b4d7e8f2a1c3e5d9';
