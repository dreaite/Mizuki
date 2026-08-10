import { parse } from "node-html-parser";
import { visit } from "unist-util-visit";
import {
	extractXHandle,
	extractXProfileHandle,
	getReadableXText,
	normalizeXAuthor,
	normalizeXResourceUrl,
	parseXResourceUrl,
} from "./x-card-utils.mjs";

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_HTML_MAX_BYTES = 1024 * 1024;
const DEFAULT_OEMBED_MAX_BYTES = 256 * 1024;
const MAX_X_REDIRECTS = 2;
const MAX_CONCURRENT_X_CARDS = 2;
const MAX_CACHE_ENTRIES = 256;
const SUCCESS_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 30 * 1000;
const X_CARD_USER_AGENT =
	"MizukiXCard/1.1 (+https://github.com/LyraVoid/Mizuki)";
const xMetadataCache = new Map();
const warnedXMetadataFailures = new Set();
const cardFetchQueue = [];
let activeCardFetches = 0;

export function remarkXMetadata(options = {}) {
	const timeoutMs = getTimeoutMs(options.timeoutMs);
	const htmlMaxBytes = options.maxBytes ?? DEFAULT_HTML_MAX_BYTES;
	const oEmbedMaxBytes = options.oEmbedMaxBytes ?? DEFAULT_OEMBED_MAX_BYTES;
	const shouldWarn = options.warn ?? true;
	const shouldFetch = getFetchEnabled(options);
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	return async (tree) => {
		const xNodes = [];

		visit(tree, (node) => {
			if (
				(node.type === "leafDirective" ||
					node.type === "containerDirective" ||
					node.type === "textDirective") &&
				node.name === "x"
			) {
				node.attributes = node.attributes || {};
				if (node.type !== "leafDirective") {
					node.attributes["fetch-status"] = "invalid-directive";
					return;
				}

				xNodes.push(node);
			}
		});

		await Promise.all(
			xNodes.map(async (node) => {
				const normalizedUrl = normalizeXResourceUrl(node.attributes.url);
				if (!normalizedUrl) {
					node.attributes["fetch-status"] = "invalid-url";
					return;
				}

				node.attributes.url = normalizedUrl;
				const fallbackMetadata = createFallbackXMetadata(normalizedUrl);

				if (!shouldFetch) {
					applyMetadata(
						node.attributes,
						prepareMetadataForNode(
							{ ...fallbackMetadata, status: "skipped" },
							node.attributes,
						),
					);
					return;
				}

				const remoteMetadata = await getCachedXMetadata(normalizedUrl, {
					fetchImpl,
					htmlMaxBytes,
					oEmbedMaxBytes,
					timeoutMs,
				});
				const metadata = prepareMetadataForNode(
					mergeXMetadata(fallbackMetadata, remoteMetadata),
					node.attributes,
				);
				const canonicalUrl = normalizeXResourceUrl(metadata.canonical);
				if (canonicalUrl) {
					node.attributes.url = canonicalUrl;
				}

				applyMetadata(node.attributes, metadata);

				if (shouldWarn && metadata.status === "error") {
					warnXMetadataFailure(normalizedUrl, remoteMetadata.error);
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
		!hasAnyAttribute(attributes, ["text", "content", "description", "desc"])
	) {
		if (metadata.text) {
			attributes.text = metadata.text;
		} else if (metadata.description) {
			attributes.description = metadata.description;
		}
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

	if (!hasAttribute(attributes, "date") && metadata.date) {
		attributes.date = metadata.date;
	}

	if (!hasAttribute(attributes, "canonical") && metadata.canonical) {
		attributes.canonical = metadata.canonical;
	}
}

function hasAnyAttribute(attributes, keys) {
	return keys.some((key) => hasAttribute(attributes, key));
}

function hasAttribute(attributes, key) {
	const value = attributes[key];
	return value !== undefined && value !== null && String(value).trim() !== "";
}

function getCachedXMetadata(url, options) {
	const now = Date.now();
	const cached = xMetadataCache.get(url);
	if (cached && cached.expiresAt > now) {
		return cached.promise;
	}

	if (cached) {
		xMetadataCache.delete(url);
	}

	const entry = {
		expiresAt: Number.POSITIVE_INFINITY,
		promise: null,
	};
	entry.promise = withXCardSlot(() => fetchXMetadata(url, options)).catch(
		(error) => ({
			status: "error",
			error: formatError(error),
		}),
	);
	xMetadataCache.set(url, entry);
	pruneMetadataCache();

	void entry.promise.then((metadata) => {
		entry.expiresAt =
			Date.now() +
			(metadata.cacheTtlMs ??
				(metadata.status === "ok"
					? SUCCESS_CACHE_TTL_MS
					: FAILURE_CACHE_TTL_MS));
	});

	return entry.promise;
}

function pruneMetadataCache() {
	while (xMetadataCache.size > MAX_CACHE_ENTRIES) {
		const oldestKey = xMetadataCache.keys().next().value;
		xMetadataCache.delete(oldestKey);
	}
}

async function fetchXMetadata(
	url,
	{ fetchImpl, htmlMaxBytes, oEmbedMaxBytes, timeoutMs },
) {
	if (typeof fetchImpl !== "function") {
		return { status: "error", error: "fetch is not available" };
	}

	const resource = parseXResourceUrl(url);
	if (!resource) {
		return { status: "error", error: "invalid X resource URL" };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	timeout.unref?.();

	try {
		const pagePromise = settleMetadataSource(
			fetchXPageMetadata(resource, {
				fetchImpl,
				maxBytes: htmlMaxBytes,
				signal: controller.signal,
			}),
		);
		const oEmbedPromise =
			resource.kind === "post"
				? settleMetadataSource(
						fetchXOEmbedMetadata(resource, {
							fetchImpl,
							maxBytes: oEmbedMaxBytes,
							signal: controller.signal,
						}),
					)
				: Promise.resolve({ status: "skipped" });
		const [pageMetadata, oEmbedMetadata] = await Promise.all([
			pagePromise,
			oEmbedPromise,
		]);

		return combineRemoteMetadata(resource, pageMetadata, oEmbedMetadata);
	} catch (error) {
		return {
			status: "error",
			error:
				error?.name === "AbortError"
					? `timeout after ${timeoutMs}ms`
					: formatError(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function settleMetadataSource(promise) {
	try {
		return await promise;
	} catch (error) {
		return {
			status: "error",
			error:
				error?.name === "AbortError" ? "request timed out" : formatError(error),
		};
	}
}

async function fetchXOEmbedMetadata(resource, { fetchImpl, maxBytes, signal }) {
	const endpoint = new URL("https://publish.x.com/oembed");
	endpoint.searchParams.set("url", resource.url);
	endpoint.searchParams.set("omit_script", "true");
	endpoint.searchParams.set("hide_thread", "true");
	endpoint.searchParams.set("dnt", "true");
	endpoint.searchParams.set("lang", "en");

	const response = await fetchImpl(endpoint, {
		headers: {
			accept: "application/json",
			"user-agent": X_CARD_USER_AGENT,
		},
		redirect: "manual",
		signal,
	});

	if (isRedirectResponse(response)) {
		throw new Error("oEmbed redirected unexpectedly");
	}
	if (!response.ok) {
		throw new Error(`oEmbed HTTP ${response.status}`);
	}
	assertContentType(response, "application/json", "oEmbed");

	const payload = JSON.parse(await readLimitedText(response, maxBytes));
	const canonicalResource = parseXResourceUrl(payload.url);
	if (!canonicalResource || canonicalResource.id !== resource.id) {
		throw new Error("oEmbed returned a different X resource");
	}

	const root = parse(String(payload.html || ""));
	const blockquote =
		root.querySelector("blockquote.twitter-tweet") ||
		root.querySelector("blockquote");
	const text = cleanXText(extractElementText(blockquote?.querySelector("p")));
	const author = normalizeXAuthor(payload.author_name);
	const handle = extractXProfileHandle(payload.author_url);
	const date = extractOEmbedDate(blockquote, resource.id);

	if (!text && !author) {
		throw new Error("oEmbed response did not contain post metadata");
	}

	return {
		status: "ok",
		author,
		canonical: canonicalResource.url,
		date,
		handle,
		text,
	};
}

async function fetchXPageMetadata(resource, { fetchImpl, maxBytes, signal }) {
	let currentResource = resource;

	for (
		let redirectCount = 0;
		redirectCount <= MAX_X_REDIRECTS;
		redirectCount++
	) {
		const response = await fetchImpl(currentResource.url, {
			headers: {
				accept: "text/html,application/xhtml+xml",
				"user-agent": X_CARD_USER_AGENT,
			},
			redirect: "manual",
			signal,
		});

		if (isRedirectResponse(response)) {
			if (redirectCount === MAX_X_REDIRECTS) {
				throw new Error("too many X redirects");
			}

			const location = response.headers.get("location");
			const redirectedResource = parseXResourceUrl(
				location ? new URL(location, currentResource.url).href : "",
			);
			if (!redirectedResource || redirectedResource.id !== resource.id) {
				throw new Error("X redirected outside the requested resource");
			}

			currentResource = redirectedResource;
			continue;
		}

		if (!response.ok) {
			throw new Error(`X HTTP ${response.status}`);
		}
		assertContentType(response, "text/html", "X page");

		const metadata = extractXPageMetadata(
			await readLimitedText(response, maxBytes),
			currentResource,
		);
		if (!hasUsefulPageMetadata(metadata)) {
			throw new Error("X page did not expose usable metadata");
		}

		return { ...metadata, status: "ok" };
	}

	throw new Error("X metadata request failed");
}

function combineRemoteMetadata(resource, pageMetadata, oEmbedMetadata) {
	const page = pageMetadata.status === "ok" ? pageMetadata : {};
	const oEmbed = oEmbedMetadata.status === "ok" ? oEmbedMetadata : {};
	const oEmbedText = isUrlOnlyText(oEmbed.text) ? "" : oEmbed.text;
	const text = oEmbedText || page.text || oEmbed.text || "";
	const title =
		resource.kind === "article" ? page.title || page.description : "";
	const metadata = {
		status: "ok",
		author: oEmbed.author || page.author || "",
		canonical: oEmbed.canonical || page.canonical || resource.url,
		date: oEmbed.date || "",
		description: page.description || "",
		handle: oEmbed.handle || page.handle || resource.handle,
		image: page.image || "",
		kind: resource.kind,
		text,
		title,
		titleCandidate: page.description || page.title || "",
	};

	if (hasUsefulRemoteMetadata(metadata)) {
		const hasAllExpectedSources =
			pageMetadata.status === "ok" &&
			(resource.kind === "article" || oEmbedMetadata.status === "ok");
		return {
			...metadata,
			cacheTtlMs: hasAllExpectedSources
				? SUCCESS_CACHE_TTL_MS
				: FAILURE_CACHE_TTL_MS,
		};
	}

	const errors = [pageMetadata.error, oEmbedMetadata.error].filter(Boolean);
	return {
		status: "error",
		error: errors.join("; ") || "X metadata was unavailable",
	};
}

function prepareMetadataForNode(metadata, attributes) {
	const hasManualMetadata = hasAnyAttribute(attributes, [
		"title",
		"text",
		"content",
		"description",
		"desc",
		"image",
	]);
	const status =
		metadata.status === "error" && hasManualMetadata
			? "manual"
			: metadata.status;
	const requestedKind = cleanText(attributes.kind).toLowerCase();
	const kind = ["article", "post"].includes(requestedKind)
		? requestedKind
		: metadata.kind;
	if (kind !== "article") {
		return { ...metadata, kind, status, title: "" };
	}

	const title = metadata.title || metadata.titleCandidate || "X Article";
	const kindAwareText = cleanText(metadata.text).replace(
		/^X post (\d+)$/,
		"X article $1",
	);
	const text =
		isUrlOnlyText(kindAwareText) ||
		cleanText(kindAwareText) === cleanText(title)
			? ""
			: kindAwareText;
	const description =
		cleanText(metadata.description) === cleanText(title)
			? ""
			: metadata.description;

	return { ...metadata, description, kind, status, text, title };
}

function mergeXMetadata(fallbackMetadata, metadata) {
	return {
		...fallbackMetadata,
		...metadata,
		author: metadata.author || fallbackMetadata.author,
		canonical: metadata.canonical || fallbackMetadata.canonical,
		date: metadata.date || "",
		description: metadata.description || "",
		handle: metadata.handle || fallbackMetadata.handle,
		image: metadata.image || "",
		kind: metadata.kind || fallbackMetadata.kind,
		text: metadata.text || fallbackMetadata.text,
		title: metadata.title || fallbackMetadata.title,
		titleCandidate: metadata.titleCandidate || "",
	};
}

function extractXPageMetadata(html, resource) {
	const root = parse(html);
	const canonicalValue =
		getMetaContent(root, ['meta[property="og:url"]']) ||
		getLinkHref(root, ['link[rel="canonical"]']);
	const canonicalResource = parseXResourceUrl(canonicalValue);
	if (!canonicalResource || canonicalResource.id !== resource.id) {
		throw new Error("X page returned a different resource");
	}
	const canonical = canonicalResource.url;
	const rawTitle =
		getMetaContent(root, [
			'meta[property="og:title"]',
			'meta[name="twitter:title"]',
		]) || cleanText(root.querySelector("title")?.textContent);
	if (isGenericXTitle(rawTitle)) {
		return {
			canonical,
			kind: resource.kind,
		};
	}
	const titleInfo = extractAuthorFromTitle(rawTitle);
	const description = cleanXText(
		getMetaContent(root, [
			'meta[property="og:description"]',
			'meta[name="twitter:description"]',
			'meta[name="description"]',
		]),
	);
	const cardType = getMetaContent(root, ['meta[name="twitter:card"]']);
	const image = resolveTrustedXImage(
		getMetaContent(root, [
			'meta[property="og:image"]',
			'meta[property="og:image:url"]',
			'meta[property="og:image:secure_url"]',
			'meta[name="twitter:image"]',
			'meta[name="twitter:image:src"]',
		]),
		resource.url,
		cardType,
	);
	const metaAuthor = normalizeXAuthor(
		getMetaContent(root, ['meta[name="author"]']),
	);
	const creator = normalizeXAuthor(
		getMetaContent(root, ['meta[name="twitter:creator"]']),
	);
	const articleAuthor = normalizeXAuthor(
		getMetaContent(root, ['meta[property="article:author"]']),
	);
	const handle =
		titleInfo.handle || extractXHandle(canonical) || resource.handle;
	const author =
		titleInfo.author || metaAuthor || creator || articleAuthor || handle;
	const text = cleanXText(description || titleInfo.text);
	const title =
		resource.kind === "article" && !isGenericXTitle(rawTitle)
			? cleanXTitle(rawTitle)
			: "";

	return {
		author,
		canonical,
		description,
		handle,
		image,
		kind: resource.kind,
		text,
		title,
	};
}

function extractAuthorFromTitle(value) {
	const title = cleanXTitle(value);
	const currentMatch = title.match(
		/^(.+?)\s+\(@([a-zA-Z0-9_]{1,15})\)\s+(?:on|在)\s+X(?:\s*:\s*[“"](.+)[”"])?$/i,
	);
	if (currentMatch) {
		return {
			author: cleanText(currentMatch[1]),
			handle: cleanText(currentMatch[2]),
			text: cleanXText(currentMatch[3]),
		};
	}

	const legacyMatch = title.match(/^(.+?)\s+(?:on|在)\s+X:\s*[“"](.+)[”"]$/i);
	return legacyMatch
		? {
				author: cleanText(legacyMatch[1]),
				handle: "",
				text: cleanXText(legacyMatch[2]),
			}
		: { author: "", handle: "", text: "" };
}

function extractOEmbedDate(blockquote, resourceId) {
	if (!blockquote) {
		return "";
	}

	for (const link of blockquote.querySelectorAll("a").reverse()) {
		const linkedResource = parseXResourceUrl(link.getAttribute("href"));
		if (linkedResource?.id === resourceId) {
			return normalizeDate(link.textContent);
		}
	}

	return "";
}

function extractElementText(element) {
	if (!element) {
		return "";
	}

	const html = element.innerHTML.replace(/<br\s*\/?>/gi, "\n");
	return parse(`<div>${html}</div>`).textContent;
}

function normalizeDate(value) {
	const cleaned = cleanText(value);
	const timestamp = Date.parse(`${cleaned} 00:00:00 UTC`);
	return Number.isNaN(timestamp)
		? ""
		: new Date(timestamp).toISOString().slice(0, 10);
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

function resolveTrustedXImage(value, baseUrl, cardType) {
	if (!value) {
		return "";
	}

	try {
		const url = new URL(value, baseUrl);
		const pathname = url.pathname.toLowerCase();
		const normalizedCardType = cleanText(cardType).toLowerCase();
		const trustedPath =
			pathname.includes("/media/") ||
			pathname.includes("/tweet_video_thumb/") ||
			pathname.includes("/amplify_video_thumb/") ||
			pathname.includes("/card_img/");
		const supportedCard =
			normalizedCardType.includes("large_image") ||
			normalizedCardType.includes("player") ||
			pathname.includes("/media/");

		return url.protocol === "https:" &&
			url.hostname === "pbs.twimg.com" &&
			trustedPath &&
			supportedCard
			? url.href
			: "";
	} catch {
		return "";
	}
}

function hasUsefulPageMetadata(metadata) {
	return Boolean(
		metadata.text || metadata.title || metadata.description || metadata.image,
	);
}

function hasUsefulRemoteMetadata(metadata) {
	return Boolean(
		metadata.text || metadata.title || metadata.description || metadata.image,
	);
}

function isGenericXTitle(value) {
	const title = cleanXTitle(value).toLowerCase();
	return (
		!title ||
		title === "x" ||
		title === "x on x" ||
		title === "x. it’s what’s happening" ||
		title === "x. it's what's happening"
	);
}

function isUrlOnlyText(value) {
	return /^https?:\/\/\S+$/i.test(cleanText(value));
}

function isRedirectResponse(response) {
	return response.status >= 300 && response.status < 400;
}

function assertContentType(response, expectedType, label) {
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.toLowerCase().includes(expectedType)) {
		throw new Error(`${label} returned unexpected content type`);
	}
}

async function readLimitedText(response, maxBytes) {
	const limit = getByteLimit(maxBytes);
	const contentLength = Number.parseInt(
		response.headers.get("content-length") || "",
		10,
	);
	if (Number.isFinite(contentLength) && contentLength > limit) {
		throw new Error(`response exceeded ${limit} bytes`);
	}

	if (!response.body?.getReader) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > limit) {
			throw new Error(`response exceeded ${limit} bytes`);
		}
		return new TextDecoder().decode(buffer);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let text = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		receivedBytes += value.byteLength;
		if (receivedBytes > limit) {
			await reader.cancel();
			throw new Error(`response exceeded ${limit} bytes`);
		}
		text += decoder.decode(value, { stream: true });
	}

	return text + decoder.decode();
}

function getByteLimit(value) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_HTML_MAX_BYTES;
}

async function withXCardSlot(task) {
	await acquireXCardSlot();
	try {
		return await task();
	} finally {
		releaseXCardSlot();
	}
}

function acquireXCardSlot() {
	if (activeCardFetches < MAX_CONCURRENT_X_CARDS) {
		activeCardFetches += 1;
		return Promise.resolve();
	}

	return new Promise((resolve) => cardFetchQueue.push(resolve));
}

function releaseXCardSlot() {
	const next = cardFetchQueue.shift();
	if (next) {
		next();
		return;
	}

	activeCardFetches -= 1;
}

function createFallbackXMetadata(url) {
	const resource = parseXResourceUrl(url);
	const normalizedUrl = resource?.url || url;
	const kind = resource?.kind || "post";
	const handle = resource?.handle || "";

	return {
		status: "fallback",
		author: handle,
		canonical: normalizedUrl,
		handle,
		kind,
		text: getReadableXText(normalizedUrl),
		title: kind === "article" ? "X Article" : "",
	};
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
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}

	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs));
}

function warnXMetadataFailure(url, error) {
	if (warnedXMetadataFailures.has(url)) {
		return;
	}

	warnedXMetadataFailures.add(url);
	console.warn(`[x-card] Failed to fetch metadata for ${url}: ${error}`);
}

function cleanXTitle(value) {
	return cleanText(value).replace(/\s*\/\s*X\s*$/, "");
}

function cleanXText(value) {
	return cleanText(value)
		.replace(/^["“]|["”]$/g, "")
		.replace(/(?:\s+|^)pic\.twitter\.com\/\S+$/i, "")
		.replace(/(?:\s+|^)https?:\/\/(?:t\.co|x\.com)\/\S+$/i, "")
		.trim();
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
