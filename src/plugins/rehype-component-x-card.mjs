/// <reference types="mdast" />
import { h } from "hastscript";
import {
	extractXHandle,
	extractXProfileHandle,
	getReadableXText,
	getXResourceKind,
	normalizeXAuthor,
	normalizeXResourceUrl,
} from "./x-card-utils.mjs";

export function XCardComponent(properties, children) {
	const fetchStatus = pick(properties, ["fetchStatus", "fetch-status"]);
	if (fetchStatus === "invalid-directive") {
		return createInvalidDirectiveMessage();
	}

	if (Array.isArray(children) && children.length !== 0) {
		return createInvalidDirectiveMessage();
	}

	const url = normalizeXResourceUrl(pick(properties, ["url"]));
	if (!url) {
		return h("div", { class: "hidden" }, [
			'Invalid X URL. ("url" must point to an X post or article)',
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
	const date = cleanDate(pick(properties, ["date"]));
	if (fetchStatus === "error") {
		return createFallbackLink(url);
	}
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
			image ? createXCardImage(image) : null,
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
							h("span", { class: "xc-kind" }, formatKind(kind, date)),
						].filter(Boolean),
					),
					title ? h("div", { class: "xc-title" }, title) : null,
					text ? h("div", { class: "xc-text" }, text) : null,
					h("div", { class: "xc-url" }, formatDisplayUrl(url)),
				].filter(Boolean),
			),
		].filter(Boolean),
	);
}

function createInvalidDirectiveMessage() {
	return h("div", { class: "hidden" }, [
		'Invalid directive. ("x" directive must be leaf type "::x{url="https://x.com/user/status/123"}")',
	]);
}

function createFallbackLink(url) {
	return h(
		"a",
		{
			href: url,
			rel: "nofollow noopener noreferrer",
			target: "_blank",
		},
		formatDisplayUrl(url),
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

function normalizeKind(value, url) {
	const kind = value.toLowerCase();
	if (kind === "article" || kind === "post") {
		return kind;
	}

	return getXResourceKind(url);
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
	return normalizeXAuthor(value);
}

function cleanHandle(value) {
	return extractXProfileHandle(value);
}

function cleanDate(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function formatKind(kind, date) {
	const label = kind === "article" ? "Article" : "Post";
	return date ? `${label} · ${date}` : label;
}

function formatDisplayUrl(value) {
	try {
		const url = new URL(value);
		return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
	} catch {
		return value;
	}
}
