import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { XCardComponent } from "../src/plugins/rehype-component-x-card.mjs";
import { remarkXMetadata } from "../src/plugins/remark-x-metadata.mjs";

describe("remarkXMetadata", () => {
	it("uses oEmbed for post text, author, handle, and date", async () => {
		const url = "https://x.com/alice/status/1000000000000000001";
		const { calls, fetchImpl } = createFetchRouter({
			page: htmlResponse("<html><head><title>X on X</title></head></html>"),
			oEmbed: jsonResponse(
				createOEmbedPayload({
					authorName: "Alice Example",
					authorUrl: "https://x.com/alice",
					date: "August 10, 2026",
					text: 'Hello <a href="https://x.com/hashtag/world">#world</a> pic.twitter.com/media',
					url,
				}),
			),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "ok");
		assert.equal(attributes.text, "Hello #world");
		assert.equal(attributes.author, "Alice Example");
		assert.equal(attributes.handle, "alice");
		assert.equal(attributes.date, "2026-08-10");
		assert.equal(attributes.canonical, url);
		assert.equal(calls.length, 2);
	});

	it("keeps oEmbed text and author while using OG metadata for media", async () => {
		const url = "https://x.com/alice/status/1000000000000000002";
		const image = "https://pbs.twimg.com/media/example.jpg";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					description: "OG text must not replace oEmbed text",
					image,
					title: "Wrong Page Author (@alice) on X",
					url,
				}),
			),
			oEmbed: jsonResponse(
				createOEmbedPayload({
					authorName: "Alice Example",
					authorUrl: "https://x.com/alice",
					date: "August 9, 2026",
					text: "Text from the supported oEmbed endpoint",
					url,
				}),
			),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes.text, "Text from the supported oEmbed endpoint");
		assert.equal(attributes.author, "Alice Example");
		assert.equal(attributes.image, image);
		assert.equal(attributes.date, "2026-08-09");
	});

	it("treats a generic X shell plus failed oEmbed as an error", async () => {
		const url = "https://x.com/shell/status/1000000000000000003";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(`
				<html><head>
					<title>X on X</title>
					<meta property="og:url" content="${url}">
					<meta property="og:title" content="X on X">
					<meta property="og:description" content="See what's happening in the world right now">
					<meta property="og:image" content="https://abs.twimg.com/rweb/ssr/default/v2/og/image.png">
				</head></html>
			`),
			oEmbed: htmlResponse("Not found", 404),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "error");
		assert.equal(attributes.text, "X post 1000000000000000003");
		assert.equal(attributes.image, undefined);
		assert.equal(attributes.title, undefined);
	});

	it("normalizes an article:author URL instead of rendering the URL", async () => {
		const url = "https://x.com/alice/status/1000000000000000004";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					author: "https://x.com/alice",
					description: "Metadata from the X page",
					title: "Metadata page",
					url,
				}),
			),
			oEmbed: htmlResponse("Not found", 404),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes.author, "alice");
		assert.equal(attributes.handle, "alice");
		assert.doesNotMatch(attributes.author, /:\/\//);
	});

	it("only accepts canonical post and article URL shapes", async () => {
		let fetchCount = 0;
		const fetchImpl = async () => {
			fetchCount += 1;
			throw new Error("invalid URLs must not be fetched");
		};
		const invalidUrls = [
			"https://x.com/home",
			"https://x.com/alice",
			"https://x.com/intent/post",
			"https://x.com/alice/status/not-a-number",
			"https://x.com.evil.example/alice/status/123",
			"https://x.com:444/alice/status/123",
			"https://user:password@x.com/alice/status/123",
			"https://x.com/alice/status/123/analytics",
		];

		for (const url of invalidUrls) {
			const attributes = await transform({ url }, fetchImpl);
			assert.equal(attributes["fetch-status"], "invalid-url", url);
		}

		assert.equal(fetchCount, 0);
		assert.equal(
			(
				await transform(
					{ url: "twitter.com/Alice/status/123?s=20#fragment" },
					fetchImpl,
					{ fetch: false },
				)
			).url,
			"https://x.com/Alice/status/123",
		);
		assert.equal(
			(
				await transform(
					{ url: "https://mobile.twitter.com/i/web/status/456/photo/1" },
					fetchImpl,
					{ fetch: false },
				)
			).url,
			"https://x.com/i/status/456",
		);
		assert.equal(
			(
				await transform(
					{ url: "https://x.com/i/articles/789?source=share" },
					fetchImpl,
					{ fetch: false },
				)
			).url,
			"https://x.com/i/article/789",
		);
	});

	it("preserves manual card fields while remote metadata fills no overrides", async () => {
		const url = "https://x.com/alice/status/1000000000000000005";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					description: "Remote description",
					image: "https://pbs.twimg.com/media/remote.jpg",
					title: "Remote Author (@alice) on X",
					url,
				}),
			),
			oEmbed: jsonResponse(
				createOEmbedPayload({
					authorName: "Remote Author",
					authorUrl: "https://x.com/alice",
					date: "August 8, 2026",
					text: "Remote text",
					url,
				}),
			),
		});
		const manual = {
			author: "Manual Author",
			canonical: url,
			content: "Manual content",
			date: "2026-01-02",
			desc: "Manual description",
			handle: "manual",
			image: "https://example.com/manual.jpg",
			kind: "article",
			title: "Manual title",
			url,
		};

		const attributes = await transform(manual, fetchImpl);

		for (const [key, value] of Object.entries(manual)) {
			assert.equal(attributes[key], value, key);
		}
		assert.equal(attributes["fetch-status"], "ok");
	});

	it("keeps a manually populated card rich when remote lookup fails", async () => {
		const url = "https://x.com/i/article/1000000000000000015";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse("Not found", 404),
			oEmbed: htmlResponse("Not found", 404),
		});
		const attributes = await transform(
			{
				image: "https://example.com/manual-cover.jpg",
				text: "Manual article summary",
				title: "Manual article title",
				url,
			},
			fetchImpl,
		);

		const result = XCardComponent(attributes, []);

		assert.equal(attributes["fetch-status"], "manual");
		assert.equal(result.tagName, "a");
		assert.ok(result.properties.className.includes("card-x"));
	});

	it("fetches direct article metadata without calling oEmbed", async () => {
		const url = "https://x.com/i/article/1000000000000000006";
		const image = "https://pbs.twimg.com/media/article-cover.jpg";
		const { calls, fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					author: "https://x.com/alice",
					description: "A short article description",
					image,
					title: "A careful article / X",
					url,
				}),
			),
			oEmbed: () => {
				throw new Error("article URLs must not call oEmbed");
			},
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "ok");
		assert.equal(attributes.kind, "article");
		assert.equal(attributes.title, "A careful article");
		assert.equal(attributes.text, "A short article description");
		assert.equal(attributes.image, image);
		assert.equal(calls.length, 1);
	});

	it("uses a status wrapper plus kind=article for an X Article card", async () => {
		const url = "https://x.com/alice/status/1000000000000000009";
		const image = "https://pbs.twimg.com/media/article-wrapper.jpg";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					description: "A wrapper Article title",
					image,
					title: "Alice Example (@alice) on X",
					url,
				}),
			),
			oEmbed: jsonResponse(
				createOEmbedPayload({
					authorName: "Alice Example",
					authorUrl: "https://x.com/alice",
					date: "August 7, 2026",
					text: '<a href="https://t.co/article">https://t.co/article</a>',
					url,
				}),
			),
		});

		const attributes = await transform({ kind: "article", url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "ok");
		assert.equal(attributes.title, "A wrapper Article title");
		assert.equal(attributes.text, undefined);
		assert.equal(attributes.description, undefined);
		assert.equal(attributes.image, image);
		assert.equal(attributes.author, "Alice Example");
		assert.equal(attributes.date, "2026-08-07");
	});

	it("keeps an explicit Article fallback coherent when fetching is disabled", async () => {
		const attributes = await transform(
			{
				kind: "article",
				url: "https://x.com/alice/status/1000000000000000008",
			},
			async () => {
				throw new Error("fetching is disabled");
			},
			{ fetch: false },
		);

		assert.equal(attributes["fetch-status"], "skipped");
		assert.equal(attributes.kind, "article");
		assert.equal(attributes.title, "X Article");
		assert.equal(attributes.text, "X article 1000000000000000008");
	});

	it("does not accept metadata whose canonical points to another post", async () => {
		const url = "https://x.com/alice/status/1000000000000000010";
		const { fetchImpl } = createFetchRouter({
			page: htmlResponse(
				createXPage({
					description: "Text from the wrong post",
					title: "Wrong Post (@wrong) on X",
					url: "https://x.com/wrong/status/9999999999999999999",
				}),
			),
			oEmbed: htmlResponse("Not found", 404),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "error");
		assert.equal(attributes.text, "X post 1000000000000000010");
		assert.notEqual(attributes.text, "Text from the wrong post");
	});

	it("starts timeout accounting after a queued card gets a concurrency slot", async () => {
		const urls = [
			"https://x.com/alice/status/1000000000000000011",
			"https://x.com/alice/status/1000000000000000012",
			"https://x.com/alice/status/1000000000000000013",
			"https://x.com/alice/status/1000000000000000014",
		];
		let activeRequests = 0;
		let peakRequests = 0;
		const fetchImpl = async (input, { signal } = {}) => {
			const requestUrl = new URL(String(input));
			const resourceUrl =
				requestUrl.hostname === "publish.x.com"
					? requestUrl.searchParams.get("url")
					: requestUrl.href;
			activeRequests += 1;
			peakRequests = Math.max(peakRequests, activeRequests);
			try {
				await new Promise((resolve) => setTimeout(resolve, 600));
				if (signal?.aborted) {
					const error = new Error("The operation was aborted");
					error.name = "AbortError";
					throw error;
				}
				return requestUrl.hostname === "publish.x.com"
					? jsonResponse(
							createOEmbedPayload({
								authorName: "Alice Example",
								authorUrl: "https://x.com/alice",
								date: "August 6, 2026",
								text: "Queued post text",
								url: resourceUrl,
							}),
						)
					: htmlResponse(
							createXPage({
								description: "Queued post text",
								title: "Alice Example (@alice) on X",
								url: resourceUrl,
							}),
						);
			} finally {
				activeRequests -= 1;
			}
		};

		const attributes = await transformMany(urls, fetchImpl, {
			timeoutMs: 1000,
		});

		assert.deepEqual(
			attributes.map((item) => item["fetch-status"]),
			["ok", "ok", "ok", "ok"],
		);
		assert.ok(peakRequests <= 4, `peak requests: ${peakRequests}`);
	});

	it("does not follow a direct-page redirect outside a validated X URL", async () => {
		const url = "https://x.com/alice/status/1000000000000000007";
		const { calls, fetchImpl } = createFetchRouter({
			page: new Response(null, {
				headers: { location: "https://example.com/private" },
				status: 302,
			}),
			oEmbed: htmlResponse("Not found", 404),
		});

		const attributes = await transform({ url }, fetchImpl);

		assert.equal(attributes["fetch-status"], "error");
		assert.equal(calls.length, 2);
		assert.equal(
			calls.some((call) => call.hostname === "example.com"),
			false,
		);
	});
});

describe("XCardComponent", () => {
	it("places image media before the text body for the Site Card-style preview", () => {
		const result = XCardComponent(
			{
				author: "Alice Example",
				image: "https://pbs.twimg.com/media/example.jpg",
				text: "Post text",
				url: "https://x.com/alice/status/123",
			},
			[],
		);

		assert.ok(result.properties.className.includes("has-image"));
		assert.deepEqual(result.children[0].properties.className, ["xc-media"]);
		assert.deepEqual(result.children[1].properties.className, ["xc-body"]);
	});

	it("rejects a non-resource X URL even when remark processing is bypassed", () => {
		const result = XCardComponent({ url: "https://x.com/home" }, []);

		assert.equal(result.tagName, "div");
		assert.deepEqual(result.properties.className, ["hidden"]);
	});

	it("hides an invalid non-leaf directive even when it has no children", async () => {
		let fetchCount = 0;
		const node = {
			type: "containerDirective",
			name: "x",
			attributes: { url: "https://x.com/alice/status/123" },
			children: [],
		};
		await remarkXMetadata({
			fetch: true,
			fetchImpl: async () => {
				fetchCount += 1;
				throw new Error("invalid directives must not fetch");
			},
			warn: false,
		})({ type: "root", children: [node] });

		const result = XCardComponent(node.attributes, []);

		assert.equal(fetchCount, 0);
		assert.equal(node.attributes["fetch-status"], "invalid-directive");
		assert.equal(result.tagName, "div");
		assert.deepEqual(result.properties.className, ["hidden"]);
	});

	it("renders a plain link when all remote metadata sources fail", () => {
		const result = XCardComponent(
			{
				"fetch-status": "error",
				text: "X post 123",
				url: "https://x.com/alice/status/123",
			},
			[],
		);

		assert.equal(result.tagName, "a");
		assert.equal(result.properties.href, "https://x.com/alice/status/123");
		assert.equal(result.properties.className, undefined);
		assert.equal(result.children[0].value, "x.com/alice/status/123");
	});
});

async function transform(attributes, fetchImpl, options = {}) {
	const node = {
		type: "leafDirective",
		name: "x",
		attributes: { ...attributes },
		children: [],
	};
	const tree = { type: "root", children: [node] };

	await remarkXMetadata({
		fetch: true,
		fetchImpl,
		warn: false,
		...options,
	})(tree);

	return node.attributes;
}

async function transformMany(urls, fetchImpl, options = {}) {
	const nodes = urls.map((url) => ({
		type: "leafDirective",
		name: "x",
		attributes: { url },
		children: [],
	}));
	await remarkXMetadata({
		fetch: true,
		fetchImpl,
		warn: false,
		...options,
	})({ type: "root", children: nodes });

	return nodes.map((node) => node.attributes);
}

function createFetchRouter({ page, oEmbed }) {
	const calls = [];
	return {
		calls,
		fetchImpl: async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			if (url.hostname === "publish.x.com") {
				return typeof oEmbed === "function" ? oEmbed(url) : oEmbed;
			}
			if (url.hostname === "x.com") {
				return typeof page === "function" ? page(url) : page;
			}
			throw new Error(`Unexpected request to ${url.href}`);
		},
	};
}

function createOEmbedPayload({ authorName, authorUrl, date, text, url }) {
	return {
		url,
		author_name: authorName,
		author_url: authorUrl,
		html: `<blockquote class="twitter-tweet"><p>${text}</p>&mdash; ${authorName} <a href="${url}">${date}</a></blockquote>`,
		provider_name: "X",
		type: "rich",
		version: "1.0",
	};
}

function createXPage({ author = "", description, image = "", title, url }) {
	return `
		<html><head>
			${title ? `<title>${title}</title><meta property="og:title" content="${title}">` : ""}
			<meta property="og:url" content="${url}">
			<meta property="og:description" content="${description}">
			${image ? `<meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image">` : ""}
			${author ? `<meta property="article:author" content="${author}">` : ""}
		</head></html>
	`;
}

function htmlResponse(html, status = 200) {
	return new Response(html, {
		status,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function jsonResponse(payload, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
