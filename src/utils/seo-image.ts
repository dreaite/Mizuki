import type { SiteConfig } from "../types/config";

function firstImage(src: string | string[] | undefined): string {
	if (typeof src === "string") {
		return src;
	}
	return src?.[0] || "";
}

export function getDefaultBannerImage(siteConfig: SiteConfig): string {
	const src = siteConfig.banner.src;
	if (typeof src === "string" || Array.isArray(src)) {
		return firstImage(src);
	}
	if (src && typeof src === "object") {
		return firstImage(src.desktop) || firstImage(src.mobile);
	}
	return "";
}

export function getAbsoluteImageUrl(
	imageUrl: string | undefined,
	site: string | URL | undefined,
): string | undefined {
	if (!imageUrl || imageUrl.startsWith("data:") || !site) {
		return undefined;
	}
	return imageUrl.startsWith("http")
		? imageUrl
		: new URL(imageUrl, site).toString();
}

export function getStructuredDataImageUrl(
	primaryImageUrl: string | undefined,
	site: string | URL | undefined,
	siteConfig: SiteConfig,
): string | undefined {
	return getAbsoluteImageUrl(
		primaryImageUrl || getDefaultBannerImage(siteConfig),
		site,
	);
}
