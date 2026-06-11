export function resolveFriendImageUrl(imgurl = "", siteurl = "") {
	const normalizedImage = imgurl.trim();

	if (normalizedImage && !isTemporaryNotionAssetUrl(normalizedImage)) {
		return normalizedImage;
	}

	return getSiteFaviconUrl(siteurl);
}

export function isTemporaryNotionAssetUrl(value = "") {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();

		return (
			host === "secure.notion-static.com" ||
			host.includes("prod-files-secure") ||
			(host.endsWith(".amazonaws.com") &&
				(url.searchParams.has("X-Amz-Expires") ||
					url.searchParams.has("X-Amz-Signature"))) ||
			(host.endsWith("notion.so") && url.pathname.startsWith("/image/"))
		);
	} catch {
		return false;
	}
}

function getSiteFaviconUrl(siteurl) {
	try {
		const site = new URL(siteurl);
		return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(site.origin)}&sz=128`;
	} catch {
		return "/favicon/favicon.ico";
	}
}
