import path from "node:path";

const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 5000;
const remotePosterImageCache = new Map<string, Promise<string>>();

export async function processPosterImage(
	imagePath: string | undefined,
	filePath: string | undefined,
): Promise<string> {
	if (!imagePath) {
		return "";
	}

	const isLocal = !(
		imagePath.startsWith("/") ||
		imagePath.startsWith("http") ||
		imagePath.startsWith("https") ||
		imagePath.startsWith("data:")
	);

	if (isLocal && filePath) {
		const basePath = filePath.replace(/\/[^/]+$/, "").replace(/\\/g, "/");
		const files = import.meta.glob<ImageMetadata>(
			"../../**/*.{jpg,jpeg,png,gif,webp,avif,svg}",
			{
				import: "default",
			},
		);
		const normalizedPath = path
			.normalize(path.join("../../", basePath, imagePath))
			.replace(/\\/g, "/");
		const file = files[`./${normalizedPath}`] || files[normalizedPath];
		if (file) {
			const img = await file();
			return img.src;
		}
	}

	if (imagePath.startsWith("http")) {
		return processRemotePosterImage(imagePath);
	}

	return imagePath;
}

export function shouldFetchRemotePosterImages(): boolean {
	const envValue = process.env.SHARE_POSTER_FETCH_REMOTE_IMAGES;
	if (envValue !== undefined) {
		return ["1", "true", "yes", "on"].includes(envValue.toLowerCase());
	}

	return process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true";
}

export function processRemotePosterImage(imageUrl: string): Promise<string> {
	if (!shouldFetchRemotePosterImages()) {
		return Promise.resolve(imageUrl);
	}

	const cachedImage = remotePosterImageCache.get(imageUrl);
	if (cachedImage) {
		return cachedImage;
	}

	const imagePromise = fetchRemotePosterImage(imageUrl);
	remotePosterImageCache.set(imageUrl, imagePromise);
	return imagePromise;
}

async function fetchRemotePosterImage(imageUrl: string): Promise<string> {
	const timeoutMs = getRemoteImageTimeoutMs();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	timeout.unref?.();

	try {
		const response = await fetch(imageUrl, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const base64 = Buffer.from(arrayBuffer).toString("base64");
		const contentType = response.headers.get("content-type") || "image/jpeg";
		return `data:${contentType};base64,${base64}`;
	} catch (error) {
		if (process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true") {
			console.warn(
				`[share-poster] Failed to fetch cover image for poster: ${imageUrl} (${formatError(error)})`,
			);
		}
		return imageUrl;
	} finally {
		clearTimeout(timeout);
	}
}

function getRemoteImageTimeoutMs(): number {
	const rawValue = Number(process.env.SHARE_POSTER_IMAGE_TIMEOUT_MS);
	return Number.isFinite(rawValue) && rawValue > 0
		? rawValue
		: DEFAULT_REMOTE_IMAGE_TIMEOUT_MS;
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
