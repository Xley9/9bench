// IndexNow post-deploy submission script
// Usage: node scripts/indexnow-submit.js [url1] [url2] ...
// If no URLs provided, submits homepage + sitemap

const KEY = 'b4d7e8f2a1c3e5d9';
const HOST = '9bench.com';
const KEY_URL = `https://${HOST}/${KEY}.txt`;

const ENDPOINTS = [
  'https://api.indexnow.org/indexnow',
  'https://www.bing.com/indexnow',
  'https://yandex.com/indexnow',
];

async function submit(urls) {
  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_URL,
    urlList: urls,
  };

  console.log(`Submitting ${urls.length} URLs to IndexNow...`);

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log(`  ${endpoint}: ${res.status} ${res.statusText}`);
    } catch (err) {
      console.error(`  ${endpoint}: FAILED — ${err.message}`);
    }
  }
}

const args = process.argv.slice(2);
const urls = args.length > 0
  ? args
  : [
      `https://${HOST}/`,
      `https://${HOST}/sitemap.xml`,
      `https://${HOST}/robots.txt`,
      `https://${HOST}/llms.txt`,
    ];

submit(urls);
