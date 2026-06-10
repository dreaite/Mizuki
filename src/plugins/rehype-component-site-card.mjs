/// <reference types="mdast" />
import { h } from "hastscript";

export function SiteCardComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0) {
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("site" directive must be leaf type "::site{url="https://example.com"}")',
		]);
	}

	const url = normalizeHttpUrl(pick(properties, ["url"]));
	if (!url) {
		return h("div", { class: "hidden" }, [
			'Invalid site URL. ("url" attribute must be an http(s) URL)',
		]);
	}

	const host = getHostnameLabel(url);
	const title = pick(properties, ["title"]) || host || url;
	const description = pick(properties, ["description", "desc"]);
	const siteName = pick(properties, ["siteName", "site-name"]) || host;
	const image = sanitizeAssetUrl(pick(properties, ["image"]));
	const icon = sanitizeAssetUrl(pick(properties, ["icon"]));
	const fetchStatus = pick(properties, ["fetchStatus", "fetch-status"]);
	const className = [
		"card-site",
		"no-styling",
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
			image
				? h("div", { class: "sc-media" }, [
						h("img", {
							alt: "",
							class: "sc-image",
							decoding: "async",
							loading: "lazy",
							src: image,
						}),
					])
				: h("div", { class: "sc-media sc-placeholder" }, [
						h("span", domainInitials(host)),
					]),
			h(
				"div",
				{ class: "sc-body" },
				[
					h("div", { class: "sc-meta" }, [
						icon
							? h("img", {
									alt: "",
									class: "sc-icon",
									decoding: "async",
									loading: "lazy",
									src: icon,
								})
							: h("span", { class: "sc-icon-fallback" }),
						h("span", { class: "sc-site-name" }, siteName),
					]),
					h("div", { class: "sc-title" }, title),
					description
						? h("div", { class: "sc-description" }, description)
						: null,
					h("div", { class: "sc-url" }, formatDisplayUrl(url)),
				].filter(Boolean),
			),
		],
	);
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

function normalizeHttpUrl(value) {
	if (!value) {
		return "";
	}

	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: "";
	} catch {
		return "";
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
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: "";
	} catch {
		return "";
	}
}

function getHostnameLabel(value) {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
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

function domainInitials(hostname) {
	const parts = hostname
		.replace(/^www\./, "")
		.split(".")
		.filter(Boolean);
	const label = parts[0] || hostname || "site";
	return label.slice(0, 2).toUpperCase();
}
