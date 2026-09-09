import type { APIRoute } from "astro";

const robotsTxt = `
User-agent: *
Disallow: /api/
Disallow: /cn/api/
Disallow: /en/api/
Disallow: /jp/api/
Disallow: /cdn-cgi/
# Archive filters use URL fragments. Stop crawling legacy query variants.
Disallow: /*?tag=
Disallow: /*&tag=
Disallow: /*?category=
Disallow: /*&category=
Disallow: /*?uncategorized=
Disallow: /*&uncategorized=
# Keep legacy /cn/ redirects crawlable so crawlers can learn the canonical URLs.
Allow: /

Sitemap: ${new URL("sitemap-index.xml", import.meta.env.SITE).href}
`.trim();

export const GET: APIRoute = () => {
	return new Response(robotsTxt, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
