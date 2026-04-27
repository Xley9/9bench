// Cloudflare Pages Middleware — rewrite og:image + twitter:image on /r/<id>
// pages so social platforms unfurl with the personalized score card.

interface Env {}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next } = context;
  const url = new URL(request.url);

  // Only rewrite for /r/<id>/ result pages
  const match = url.pathname.match(/^\/r\/([a-f0-9]{8})\/?$/);
  if (!match) return next();

  const id = match[1];
  const acceptHeader = request.headers.get('accept') || '';
  if (!acceptHeader.includes('text/html')) return next();

  const response = await next();
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;

  const ogImageUrl = `${url.origin}/og?id=${id}`;
  const personalTitle = `9bench score · ${id} · The honest browser benchmark`;
  const personalDesc = `Browser-based hardware benchmark result. Test your own at 9bench.com — no download, no account, 15 seconds.`;

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:title"]', {
      element(el) { el.setAttribute('content', personalTitle); }
    })
    .on('meta[property="og:description"]', {
      element(el) { el.setAttribute('content', personalDesc); }
    })
    .on('meta[property="og:image"]', {
      element(el) { el.setAttribute('content', ogImageUrl); }
    })
    .on('meta[property="og:url"]', {
      element(el) { el.setAttribute('content', `${url.origin}/r/${id}/`); }
    })
    .on('meta[name="twitter:title"]', {
      element(el) { el.setAttribute('content', personalTitle); }
    })
    .on('meta[name="twitter:description"]', {
      element(el) { el.setAttribute('content', personalDesc); }
    })
    .on('meta[name="twitter:image"]', {
      element(el) { el.setAttribute('content', ogImageUrl); }
    });

  const transformed = rewriter.transform(response);
  return new Response(transformed.body, transformed);
};
