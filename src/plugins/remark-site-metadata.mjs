import { parse } from "node-html-parser";
import { visit } from "unist-util-visit";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const siteMetadataCache = new Map();

export function remarkSiteMetadata(options = {}) {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const shouldWarn = options.warn ?? true;

	return async (tree) => {
		const siteNodes = [];

		visit(tree, (node) => {
			if (
				(node.type === "leafDirective" ||
					node.type === "containerDirective" ||
					node.type === "textDirective") &&
				node.name === "site"
			) {
				siteNodes.push(node);
			}
		});

		await Promise.all(
			siteNodes.map(async (node) => {
				node.attributes = node.attributes || {};

				const normalizedUrl = normalizeSiteUrl(node.attributes.url);
				if (!normalizedUrl) {
					node.attributes["fetch-status"] = "invalid-url";
					return;
				}

				node.attributes.url = normalizedUrl;

				const metadata = await getCachedSiteMetadata(normalizedUrl, {
					timeoutMs,
					maxBytes,
				});

				applyMetadata(node.attributes, metadata);

				if (shouldWarn && metadata.status === "error") {
					console.warn(
						`[site-card] Failed to fetch metadata for ${normalizedUrl}: ${metadata.error}`,
					);
				}
			}),
		);
	};
}

function applyMetadata(attributes, metadata) {
	attributes["fetch-status"] = metadata.status;

	if (!hasAttribute(attributes, "title") && metadata.title) {
		attributes.title = metadata.title;
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

	if (!hasAttribute(attributes, "icon") && metadata.icon) {
		attributes.icon = metadata.icon;
	}

	if (!hasAttribute(attributes, "site-name") && metadata.siteName) {
		attributes["site-name"] = metadata.siteName;
	}

	if (!hasAttribute(attributes, "canonical") && metadata.canonical) {
		attributes.canonical = metadata.canonical;
	}
}

function hasAttribute(attributes, key) {
	const value = attributes[key];
	return value !== undefined && value !== null && String(value).trim() !== "";
}

function getCachedSiteMetadata(url, options) {
	if (!siteMetadataCache.has(url)) {
		siteMetadataCache.set(
			url,
			fetchSiteMetadata(url, options).catch((error) => ({
				status: "error",
				error: error?.message || String(error),
			})),
		);
	}

	return siteMetadataCache.get(url);
}

async function fetchSiteMetadata(url, { timeoutMs, maxBytes }) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			headers: {
				accept: "text/html,application/xhtml+xml",
				"user-agent":
					"MizukiSiteCard/1.0 (+https://github.com/LyraVoid/Mizuki)",
			},
			redirect: "follow",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const html = await readLimitedText(response, maxBytes);
		return {
			status: "ok",
			...extractSiteMetadata(html, response.url || url),
		};
	} catch (error) {
		if (error?.name === "AbortError") {
			return { status: "error", error: `timeout after ${timeoutMs}ms` };
		}

		return { status: "error", error: error?.message || String(error) };
	} finally {
		clearTimeout(timeout);
	}
}

async function readLimitedText(response, maxBytes) {
	if (!response.body?.getReader) {
		return (await response.text()).slice(0, maxBytes);
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

		if (value.byteLength > remainingBytes) {
			await reader.cancel();
			break;
		}
	}

	return text + decoder.decode();
}

function extractSiteMetadata(html, baseUrl) {
	const root = parse(html);
	const title =
		getMetaContent(root, [
			'meta[property="og:title"]',
			'meta[name="twitter:title"]',
		]) || cleanText(root.querySelector("title")?.textContent);
	const description = getMetaContent(root, [
		'meta[property="og:description"]',
		'meta[name="twitter:description"]',
		'meta[name="description"]',
	]);
	const image = resolveHttpUrl(
		getMetaContent(root, [
			'meta[property="og:image"]',
			'meta[property="og:image:url"]',
			'meta[name="twitter:image"]',
			'meta[name="twitter:image:src"]',
		]),
		baseUrl,
	);
	const icon = resolveHttpUrl(
		getLinkHref(root, [
			'link[rel="apple-touch-icon"]',
			'link[rel="icon"]',
			'link[rel="shortcut icon"]',
		]),
		baseUrl,
	);
	const canonical = resolveHttpUrl(
		getMetaContent(root, ['meta[property="og:url"]']) ||
			getLinkHref(root, ['link[rel="canonical"]']),
		baseUrl,
	);

	return {
		canonical,
		description,
		icon,
		image,
		siteName:
			getMetaContent(root, ['meta[property="og:site_name"]']) ||
			getHostnameLabel(baseUrl),
		title,
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

function normalizeSiteUrl(value) {
	const rawValue = cleanText(value);
	if (!rawValue) {
		return "";
	}

	for (const candidate of [rawValue, `https://${rawValue}`]) {
		try {
			const url = new URL(candidate);
			if (url.protocol === "http:" || url.protocol === "https:") {
				return url.href;
			}
		} catch {
			// Try the next candidate.
		}
	}

	return "";
}

function getHostnameLabel(value) {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function cleanText(value) {
	return value ? String(value).replace(/\s+/g, " ").trim() : "";
}
