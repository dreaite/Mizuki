const X_HOSTNAMES = new Set(["x.com", "twitter.com", "mobile.twitter.com"]);
const X_HANDLE_PATTERN = /^[a-zA-Z0-9_]{1,15}$/;
const X_ID_PATTERN = /^\d{1,20}$/;

export function parseXResourceUrl(value) {
	const url = parseXUrl(value);
	if (!url) {
		return null;
	}

	const segments = url.pathname.split("/").filter(Boolean);
	const statusResource = parseStatusResource(segments);
	if (statusResource) {
		return createResource(statusResource);
	}

	const articleResource = parseArticleResource(segments);
	if (articleResource) {
		return createResource(articleResource);
	}

	return null;
}

export function normalizeXResourceUrl(value) {
	return parseXResourceUrl(value)?.url || "";
}

export function getXResourceKind(value) {
	return parseXResourceUrl(value)?.kind || "post";
}

export function extractXHandle(value) {
	return parseXResourceUrl(value)?.handle || "";
}

export function getReadableXText(value) {
	const resource = parseXResourceUrl(value);
	if (!resource) {
		return "";
	}

	return `X ${resource.kind === "article" ? "article" : "post"} ${resource.id}`;
}

export function extractXProfileHandle(value) {
	const cleaned = cleanText(value).replace(/^@/, "");
	if (X_HANDLE_PATTERN.test(cleaned)) {
		return cleaned;
	}

	const url = parseXUrl(cleaned);
	if (!url) {
		return "";
	}

	const segments = url.pathname.split("/").filter(Boolean);
	return segments.length === 1 && X_HANDLE_PATTERN.test(segments[0])
		? segments[0]
		: "";
}

export function normalizeXAuthor(value) {
	const cleaned = cleanText(value);
	if (!cleaned) {
		return "";
	}

	const handle = extractXProfileHandle(cleaned);
	if (handle) {
		return handle;
	}

	if (/^[a-z][a-z\d+.-]*:\/\//i.test(cleaned)) {
		return "";
	}

	return cleaned.replace(/^@/, "");
}

function parseStatusResource(segments) {
	let handle = "";
	let id = "";
	let suffixStart = 0;

	if (
		segments[0]?.toLowerCase() === "i" &&
		segments[1]?.toLowerCase() === "web" &&
		segments[2]?.toLowerCase() === "status"
	) {
		id = segments[3];
		suffixStart = 4;
	} else if (
		segments[0]?.toLowerCase() === "i" &&
		segments[1]?.toLowerCase() === "status"
	) {
		id = segments[2];
		suffixStart = 3;
	} else if (
		X_HANDLE_PATTERN.test(segments[0] || "") &&
		["status", "statuses"].includes(segments[1]?.toLowerCase())
	) {
		handle = segments[0];
		id = segments[2];
		suffixStart = 3;
	} else {
		return null;
	}

	if (
		!X_ID_PATTERN.test(id || "") ||
		!hasValidMediaSuffix(segments.slice(suffixStart))
	) {
		return null;
	}

	return { handle, id, kind: "post" };
}

function parseArticleResource(segments) {
	let handle = "";
	let id = "";

	if (
		segments[0]?.toLowerCase() === "i" &&
		["article", "articles"].includes(segments[1]?.toLowerCase()) &&
		segments.length === 3
	) {
		id = segments[2];
	} else if (
		X_HANDLE_PATTERN.test(segments[0] || "") &&
		["article", "articles"].includes(segments[1]?.toLowerCase()) &&
		segments.length === 3
	) {
		handle = segments[0];
		id = segments[2];
	} else {
		return null;
	}

	return X_ID_PATTERN.test(id || "") ? { handle, id, kind: "article" } : null;
}

function hasValidMediaSuffix(segments) {
	if (segments.length === 0) {
		return true;
	}

	return (
		segments.length === 2 &&
		["photo", "video"].includes(segments[0]?.toLowerCase()) &&
		/^\d+$/.test(segments[1] || "")
	);
}

function createResource({ handle, id, kind }) {
	const pathname =
		kind === "article"
			? handle
				? `/${handle}/article/${id}`
				: `/i/article/${id}`
			: handle
				? `/${handle}/status/${id}`
				: `/i/status/${id}`;

	return {
		handle,
		id,
		kind,
		url: `https://x.com${pathname}`,
	};
}

function parseXUrl(value) {
	const rawValue = cleanText(value);
	if (!rawValue) {
		return null;
	}

	const candidates = rawValue.startsWith("//")
		? [`https:${rawValue}`]
		: [rawValue, `https://${rawValue}`];

	for (const candidate of candidates) {
		try {
			const url = new URL(candidate);
			const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
			if (
				(url.protocol === "http:" || url.protocol === "https:") &&
				X_HOSTNAMES.has(hostname) &&
				!url.username &&
				!url.password &&
				!url.port
			) {
				return url;
			}
		} catch {
			// Try the next candidate.
		}
	}

	return null;
}

function cleanText(value) {
	return value ? String(value).replace(/\s+/g, " ").trim() : "";
}
