/// <reference types="mdast" />
import { h } from "hastscript";

export function XCardComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0) {
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("x" directive must be leaf type "::x{url="https://x.com/user/status/123"}")',
		]);
	}

	const url = normalizeXUrl(pick(properties, ["url"]));
	if (!url) {
		return h("div", { class: "hidden" }, [
			'Invalid X URL. ("url" attribute must be an x.com or twitter.com URL)',
		]);
	}

	const kind = normalizeKind(pick(properties, ["kind"]), url);
	const title = kind === "article" ? pick(properties, ["title"]) : "";
	const text =
		pick(properties, ["text", "content", "description", "desc"]) ||
		getReadableXText(url);
	const image = sanitizeAssetUrl(pick(properties, ["image"]));
	const author = cleanAuthor(pick(properties, ["author"]));
	const handle =
		cleanHandle(pick(properties, ["handle"])) || extractXHandle(url);
	const fetchStatus = pick(properties, ["fetchStatus", "fetch-status"]);
	const className = [
		"card-x",
		"no-styling",
		`x-${kind}`,
		image ? "has-image" : "no-image",
		fetchStatus === "error" ? "fetch-error" : "",
	]
		.filter(Boolean)
		.join(" ");

	return h(
		"a",
		{
			class: className,
			href: url,
			rel: "nofollow noopener noreferrer",
			target: "_blank",
		},
		[
			h(
				"div",
				{ class: "xc-body" },
				[
					h(
						"div",
						{ class: "xc-meta" },
						[
							h("span", { class: "xc-logo", "aria-hidden": "true" }, "X"),
							h("span", { class: "xc-author" }, formatAuthor(author)),
							handle ? h("span", { class: "xc-handle" }, `@${handle}`) : null,
							h(
								"span",
								{ class: "xc-kind" },
								kind === "article" ? "Article" : "Post",
							),
						].filter(Boolean),
					),
					title ? h("div", { class: "xc-title" }, title) : null,
					text ? h("div", { class: "xc-text" }, text) : null,
					h("div", { class: "xc-url" }, formatDisplayUrl(url)),
				].filter(Boolean),
			),
			image ? createXCardImage(image) : null,
		].filter(Boolean),
	);
}

function createXCardImage(image) {
	return h("div", { class: "xc-media" }, [
		h("img", {
			alt: "",
			class: "xc-image",
			decoding: "async",
			loading: "lazy",
			src: image,
		}),
	]);
}

function pick(properties, keys) {
	for (const key of keys) {
		const value = properties?.[key];
		if (value !== undefined && value !== null && String(value).trim() !== "") {
			return String(value).trim();
		}
	}

	return "";
}

function normalizeXUrl(value) {
	if (!value) {
		return "";
	}

	for (const candidate of [value, `https://${value}`]) {
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

function normalizeKind(value, url) {
	const kind = value.toLowerCase();
	if (kind === "article" || kind === "post") {
		return kind;
	}

	try {
		const pathname = new URL(url).pathname;
		return /\/(?:i\/)?article(?:s)?\//i.test(pathname) ||
			/\/articles?\//i.test(pathname)
			? "article"
			: "post";
	} catch {
		return "post";
	}
}

function sanitizeAssetUrl(value) {
	if (!value) {
		return "";
	}

	const trimmedValue = value.trim();

	if (
		trimmedValue.startsWith("/") ||
		trimmedValue.startsWith("./") ||
		trimmedValue.startsWith("../") ||
		trimmedValue.startsWith("data:image/")
	) {
		return trimmedValue;
	}

	try {
		const url = new URL(trimmedValue);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return "";
		}

		const pathname = url.pathname.toLowerCase();
		return pathname.includes("/profile_images/") ? "" : url.href;
	} catch {
		return "";
	}
}

function formatAuthor(author) {
	return author || "X";
}

function cleanAuthor(value) {
	return value.replace(/^@/, "").trim();
}

function cleanHandle(value) {
	return value.replace(/^@/, "").trim();
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

		return id ? `X ${normalizeKind("", value)} ${id}` : "";
	} catch {
		return "";
	}
}

function formatDisplayUrl(value) {
	try {
		const url = new URL(value);
		return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
	} catch {
		return value;
	}
}
