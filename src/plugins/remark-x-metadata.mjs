import { parse } from "node-html-parser";
import { visit } from "unist-util-visit";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const xMetadataCache = new Map();
const warnedXMetadataFailures = new Set();

export function remarkXMetadata(options = {}) {
	const timeoutMs = getTimeoutMs(options.timeoutMs);
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const shouldWarn = options.warn ?? true;
	const shouldFetch = getFetchEnabled(options);

	return async (tree) => {
		const xNodes = [];

		visit(tree, (node) => {
			if (
				(node.type === "leafDirective" ||
					node.type === "containerDirective" ||
					node.type === "textDirective") &&
				node.name === "x"
			) {
				xNodes.push(node);
			}
		});

		await Promise.all(
			xNodes.map(async (node) => {
				node.attributes = node.attributes || {};

				const normalizedUrl = normalizeXUrl(node.attributes.url);
				if (!normalizedUrl) {
					node.attributes["fetch-status"] = "invalid-url";
					return;
				}

				node.attributes.url = normalizedUrl;
				const fallbackMetadata = createFallbackXMetadata(normalizedUrl);

				if (!shouldFetch) {
					applyMetadata(node.attributes, {
						...fallbackMetadata,
						status: "skipped",
					});
					return;
				}

				const metadata = await getCachedXMetadata(normalizedUrl, {
					timeoutMs,
					maxBytes,
				});

				applyMetadata(
					node.attributes,
					mergeXMetadata(fallbackMetadata, metadata),
				);

				if (shouldWarn && metadata.status === "error") {
					warnXMetadataFailure(normalizedUrl, metadata.error);
				}
			}),
		);
	};
}

function applyMetadata(attributes, metadata) {
	attributes["fetch-status"] = metadata.status;

	if (!hasAttribute(attributes, "kind") && metadata.kind) {
		attributes.kind = metadata.kind;
	}

	if (!hasAttribute(attributes, "title") && metadata.title) {
		attributes.title = metadata.title;
	}

	if (
		!hasAttribute(attributes, "text") &&
		!hasAttribute(attributes, "content") &&
		metadata.text
	) {
		attributes.text = metadata.text;
	}

	if (
		!hasAttribute(attributes, "description") &&
		!hasAttribute(attributes, "desc") &&
		metadata.description
	) {
		attributes.description = metadata.description;
	}

	if (!hasAttribute(attributes, "image") && metadata.image) {
		attributes.image = metadata.image;
	}

	if (!hasAttribute(attributes, "author") && metadata.author) {
		attributes.author = metadata.author;
	}

	if (!hasAttribute(attributes, "handle") && metadata.handle) {
		attributes.handle = metadata.handle;
	}

	if (!hasAttribute(attributes, "canonical") && metadata.canonical) {
		attributes.canonical = metadata.canonical;
	}
}

function hasAttribute(attributes, key) {
	const value = attributes[key];
	return value !== undefined && value !== null && String(value).trim() !== "";
}

function getCachedXMetadata(url, options) {
	if (!xMetadataCache.has(url)) {
		xMetadataCache.set(
			url,
			fetchXMetadata(url, options).catch((error) => ({
				status: "error",
				error: error?.message || String(error),
			})),
		);
	}

	return xMetadataCache.get(url);
}

async function fetchXMetadata(url, { timeoutMs, maxBytes }) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	timeout.unref?.();

	try {
		const response = await fetch(url, {
			headers: {
				accept: "text/html,application/xhtml+xml",
				"user-agent": "MizukiXCard/1.0 (+https://github.com/LyraVoid/Mizuki)",
			},
			redirect: "follow",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const html = await readLimitedText(response, maxBytes);
		return {
			...extractXMetadata(html, response.url || url),
			status: "ok",
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return { status: "error", error: `timeout after ${timeoutMs}ms` };
		}

		return { status: "error", error: formatError(error) };
	} finally {
		clearTimeout(timeout);
	}
}

async function readLimitedText(response, maxBytes) {
	if (!response.body?.getReader) {
		return trimMetadataHtml((await response.text()).slice(0, maxBytes));
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let text = "";

	while (receivedBytes < maxBytes) {
		const { done, value } = await reader.read();

		if (done) {
			break;
		}

		const remainingBytes = maxBytes - receivedBytes;
		const chunk =
			value.byteLength > remainingBytes
				? value.slice(0, remainingBytes)
				: value;

		receivedBytes += chunk.byteLength;
		text += decoder.decode(chunk, { stream: true });

		const metadataHtml = trimMetadataHtml(text);
		if (metadataHtml.length !== text.length) {
			await reader.cancel();
			return metadataHtml;
		}

		if (value.byteLength > remainingBytes) {
			await reader.cancel();
			break;
		}
	}

	return trimMetadataHtml(text + decoder.decode());
}

function trimMetadataHtml(html) {
	const headEnd = html.toLowerCase().indexOf("</head>");
	return headEnd === -1 ? html : html.slice(0, headEnd + "</head>".length);
}

function extractXMetadata(html, baseUrl) {
	const root = parse(html);
	const fallbackMetadata = createFallbackXMetadata(baseUrl);
	const canonical = normalizeXUrl(
		getMetaContent(root, ['meta[property="og:url"]']) ||
			getLinkHref(root, ['link[rel="canonical"]']) ||
			baseUrl,
	);
	const url = canonical || normalizeXUrl(baseUrl) || baseUrl;
	const kind = getXKind(url);
	const title = cleanXTitle(
		getMetaContent(root, [
			'meta[property="og:title"]',
			'meta[name="twitter:title"]',
		]) || cleanText(root.querySelector("title")?.textContent),
	);
	const description = cleanXText(
		getMetaContent(root, [
			'meta[property="og:description"]',
			'meta[name="twitter:description"]',
			'meta[name="description"]',
		]),
	);
	const image = resolveHttpUrl(
		getMetaContent(root, [
			'meta[property="og:image"]',
			'meta[property="og:image:url"]',
			'meta[property="og:image:secure_url"]',
			'meta[name="twitter:image"]',
			'meta[name="twitter:image:src"]',
		]),
		baseUrl,
	);
	const authorFromTitle = extractAuthorFromTitle(title);
	const handle = extractXHandle(url);
	const author =
		cleanText(
			getMetaContent(root, [
				'meta[name="author"]',
				'meta[property="article:author"]',
				'meta[name="twitter:creator"]',
			]),
		).replace(/^@/, "") ||
		authorFromTitle.author ||
		handle;
	const text =
		kind === "post"
			? cleanXText(description || authorFromTitle.text || title)
			: cleanXText(description);

	return {
		canonical: url,
		description,
		handle: handle || fallbackMetadata.handle,
		author: author || fallbackMetadata.author,
		image: shouldUseXImage(image, {
			kind,
			cardType: getMetaContent(root, ['meta[name="twitter:card"]']),
		})
			? image
			: "",
		kind,
		text: text || fallbackMetadata.text,
		title: kind === "article" ? title : "",
	};
}

function mergeXMetadata(fallbackMetadata, metadata) {
	return {
		...fallbackMetadata,
		...metadata,
		author: metadata.author || fallbackMetadata.author,
		canonical: metadata.canonical || fallbackMetadata.canonical,
		handle: metadata.handle || fallbackMetadata.handle,
		image: metadata.image || "",
		kind: metadata.kind || fallbackMetadata.kind,
		text: metadata.text || fallbackMetadata.text,
		title: metadata.title || fallbackMetadata.title,
	};
}

function getMetaContent(root, selectors) {
	for (const selector of selectors) {
		const value = cleanText(
			root.querySelector(selector)?.getAttribute("content"),
		);
		if (value) {
			return value;
		}
	}

	return "";
}

function getLinkHref(root, selectors) {
	for (const selector of selectors) {
		const value = cleanText(root.querySelector(selector)?.getAttribute("href"));
		if (value) {
			return value;
		}
	}

	return "";
}

function resolveHttpUrl(value, baseUrl) {
	if (!value) {
		return "";
	}

	try {
		const url = new URL(value, baseUrl);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: "";
	} catch {
		return "";
	}
}

function normalizeXUrl(value) {
	const rawValue = cleanText(value);
	if (!rawValue) {
		return "";
	}

	for (const candidate of [rawValue, `https://${rawValue}`]) {
		try {
			const url = new URL(candidate);
			if (
				(url.protocol === "http:" || url.protocol === "https:") &&
				isXHostname(url.hostname)
			) {
				url.protocol = "https:";
				url.hostname = "x.com";
				return url.href;
			}
		} catch {
			// Try the next candidate.
		}
	}

	return "";
}

function isXHostname(hostname) {
	const normalized = hostname.toLowerCase().replace(/^www\./, "");
	return (
		normalized === "x.com" ||
		normalized === "twitter.com" ||
		normalized === "mobile.twitter.com"
	);
}

function createFallbackXMetadata(url) {
	const normalizedUrl = normalizeXUrl(url) || url;
	const kind = getXKind(normalizedUrl);
	const handle = extractXHandle(normalizedUrl);

	return {
		status: "fallback",
		canonical: normalizedUrl,
		kind,
		handle,
		author: handle,
		title: kind === "article" ? "X Article" : "",
		text: getReadableXText(normalizedUrl),
	};
}

function getXKind(value) {
	try {
		const pathname = new URL(value).pathname;
		return /\/(?:i\/)?article(?:s)?\//i.test(pathname) ||
			/\/articles?\//i.test(pathname)
			? "article"
			: "post";
	} catch {
		return "post";
	}
}

function extractXHandle(value) {
	try {
		const segments = new URL(value).pathname.split("/").filter(Boolean);
		const handle = segments[0];
		if (
			!handle ||
			handle === "i" ||
			handle === "intent" ||
			handle === "share"
		) {
			return "";
		}

		return handle;
	} catch {
		return "";
	}
}

function cleanXTitle(value) {
	return cleanText(value).replace(/\s*\/\s*X\s*$/, "");
}

function cleanXText(value) {
	return cleanText(value)
		.replace(/^["“]|["”]$/g, "")
		.replace(/\s+pic\.twitter\.com\/\S+$/i, "")
		.replace(/\s+https?:\/\/t\.co\/\S+$/i, "")
		.trim();
}

function extractAuthorFromTitle(title) {
	const match = cleanText(title).match(
		/^(.+?)\s+(?:on|在)\s+X:\s*[“"](.+)[”"]$/i,
	);
	if (!match) {
		return { author: "", text: "" };
	}

	return {
		author: cleanText(match[1]),
		text: cleanXText(match[2]),
	};
}

function shouldUseXImage(image, { kind, cardType }) {
	if (!image) {
		return false;
	}

	try {
		const url = new URL(image);
		const pathname = url.pathname.toLowerCase();
		if (pathname.includes("/profile_images/")) {
			return false;
		}

		if (kind === "article") {
			return true;
		}

		const normalizedCardType = cleanText(cardType).toLowerCase();
		if (
			normalizedCardType.includes("large_image") ||
			normalizedCardType.includes("player")
		) {
			return true;
		}

		return (
			url.hostname === "pbs.twimg.com" &&
			(pathname.includes("/media/") ||
				pathname.includes("/tweet_video_thumb/") ||
				pathname.includes("/amplify_video_thumb/"))
		);
	} catch {
		return false;
	}
}

function getReadableXText(value) {
	try {
		const url = new URL(value);
		const segments = url.pathname.split("/").filter(Boolean);
		const id = segments.find((segment, index) => {
			const previous = segments[index - 1];
			return (
				/^\d+$/.test(segment) &&
				["status", "statuses", "article"].includes(previous)
			);
		});

		return id
			? `X ${getXKind(value) === "article" ? "article" : "post"} ${id}`
			: "";
	} catch {
		return "";
	}
}

function getFetchEnabled(options) {
	if (options.fetch !== undefined) {
		return Boolean(options.fetch);
	}

	for (const key of ["X_CARD_FETCH_METADATA", "SITE_CARD_FETCH_METADATA"]) {
		const envValue = process.env[key];
		if (envValue !== undefined) {
			return ["1", "true", "yes", "on"].includes(envValue.toLowerCase());
		}
	}

	return process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true";
}

function getTimeoutMs(optionValue) {
	const rawValue =
		optionValue ??
		process.env.X_CARD_FETCH_TIMEOUT_MS ??
		process.env.SITE_CARD_FETCH_TIMEOUT_MS;
	const timeoutMs = Number.parseInt(rawValue, 10);

	return Number.isFinite(timeoutMs) && timeoutMs > 0
		? timeoutMs
		: DEFAULT_TIMEOUT_MS;
}

function warnXMetadataFailure(url, error) {
	if (warnedXMetadataFailures.has(url)) {
		return;
	}

	warnedXMetadataFailures.add(url);
	console.warn(`[x-card] Failed to fetch metadata for ${url}: ${error}`);
}

function formatError(error) {
	const messages = [
		error?.message,
		error?.cause?.message,
		error?.code,
		error?.cause?.code,
	]
		.filter(Boolean)
		.map(String);

	return [...new Set(messages)].join("; ") || String(error);
}

function cleanText(value) {
	return value ? String(value).replace(/\s+/g, " ").trim() : "";
}
