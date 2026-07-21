import fs from "node:fs";
import path from "node:path";

import type { Artwork, ArtworkManifestEntry } from "../types/gallery";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
	".avif",
	".gif",
	".jpeg",
	".jpg",
	".png",
	".webp",
]);
const SKIPPED_DIRECTORIES = new Set(["thumbs", "thumbnails", "_thumbs"]);
const DATE_PREFIX_PATTERN = /(?:^|\/)(\d{4})[-_](\d{2})[-_](\d{2})(?:[-_]|$)/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ArtworkManifest {
	artworks?: ArtworkManifestEntry[];
}

export interface ScanArtworksOptions {
	directory?: string;
	publicBase?: string;
}

function normalizeRelativePath(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
	if (
		!normalized ||
		path.posix.isAbsolute(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`Invalid artwork path: ${value}`);
	}
	return normalized;
}

function toPublicUrl(relativePath: string, publicBase: string): string {
	const encodedPath = normalizeRelativePath(relativePath)
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${publicBase.replace(/\/$/, "")}/${encodedPath}`;
}

function isValidDate(value?: string): value is string {
	const match = value?.match(ISO_DATE_PATTERN);
	if (!value || !match) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function inferDateFromPath(relativePath: string): string | undefined {
	const match = relativePath.match(DATE_PREFIX_PATTERN);
	if (!match) {
		return undefined;
	}
	const date = `${match[1]}-${match[2]}-${match[3]}`;
	return isValidDate(date) ? date : undefined;
}

function inferTitle(relativePath: string): string {
	const parsed = path.posix.parse(relativePath);
	const withoutDate = parsed.name.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]?/, "");
	const title = withoutDate.replace(/[-_]+/g, " ").trim();
	return title || parsed.name;
}

function collectImageFiles(directory: string, root = directory): string[] {
	if (!fs.existsSync(directory)) {
		return [];
	}

	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const absolutePath = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) {
				throw new Error(
					`Symbolic links are not allowed in the artwork directory: ${absolutePath}`,
				);
			}
			if (entry.isDirectory()) {
				if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
					return [];
				}
				return collectImageFiles(absolutePath, root);
			}
			if (!entry.isFile()) {
				return [];
			}
			if (
				!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
			) {
				return [];
			}
			return [path.relative(root, absolutePath).replaceAll("\\", "/")];
		})
		.sort((a, b) => a.localeCompare(b));
}

function assertRegularFileWithinDirectory(
	directory: string,
	relativePath: string,
	label: string,
): string {
	const absolutePath = path.join(directory, relativePath);
	if (!fs.existsSync(absolutePath)) {
		throw new Error(`${label} does not exist: ${relativePath}`);
	}
	const fileStat = fs.lstatSync(absolutePath);
	if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
		throw new Error(`${label} must be a regular file: ${relativePath}`);
	}
	const realDirectory = fs.realpathSync(directory);
	const realFile = fs.realpathSync(absolutePath);
	if (!realFile.startsWith(`${realDirectory}${path.sep}`)) {
		throw new Error(
			`${label} resolves outside the artwork directory: ${relativePath}`,
		);
	}
	return absolutePath;
}

function readManifest(directory: string): Map<string, ArtworkManifestEntry> {
	const manifestPath = path.join(directory, "gallery.json");
	if (!fs.existsSync(manifestPath)) {
		return new Map();
	}

	let parsed: ArtworkManifest | ArtworkManifestEntry[];
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Unable to parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const entries = Array.isArray(parsed) ? parsed : parsed.artworks;
	if (!Array.isArray(entries)) {
		throw new Error(`${manifestPath} must contain an "artworks" array.`);
	}

	const metadata = new Map<string, ArtworkManifestEntry>();
	for (const entry of entries) {
		if (!entry || typeof entry.file !== "string") {
			throw new Error(`Every artwork in ${manifestPath} must have a file.`);
		}
		const file = normalizeRelativePath(entry.file);
		if (metadata.has(file)) {
			throw new Error(`Duplicate artwork metadata for ${file}.`);
		}
		if (entry.publishedAt && !isValidDate(entry.publishedAt)) {
			throw new Error(
				`Invalid publishedAt value for ${file}: ${entry.publishedAt}`,
			);
		}
		metadata.set(file, { ...entry, file });
	}
	return metadata;
}

/**
 * 扫描 public/images/artworks。gallery.json 元数据优先；没有元数据时，
 * 会从 YYYY-MM-DD 文件名前缀推断日期。为保证跨 Git/CI 环境顺序稳定，
 * 未提供显式日期的作品会让构建失败。
 */
export function scanArtworks(options: ScanArtworksOptions = {}): Artwork[] {
	const directory =
		options.directory ?? path.join(process.cwd(), "public/images/artworks");
	const publicBase = options.publicBase ?? "/images/artworks";
	const metadata = readManifest(directory);
	const imageFiles = collectImageFiles(directory);
	const imageFileSet = new Set(imageFiles);

	for (const file of metadata.keys()) {
		if (!imageFileSet.has(file)) {
			throw new Error(`Artwork metadata references a missing image: ${file}`);
		}
	}

	return imageFiles
		.flatMap((file): Artwork[] => {
			const entry = metadata.get(file);
			if (entry?.hidden) {
				return [];
			}

			assertRegularFileWithinDirectory(directory, file, "Artwork image");
			const inferredTitle = inferTitle(file);
			const publishedAt = entry?.publishedAt ?? inferDateFromPath(file);
			if (!publishedAt) {
				throw new Error(
					`Artwork ${file} needs a YYYY-MM-DD filename prefix or publishedAt metadata.`,
				);
			}
			let thumbnail: string | undefined;
			if (entry?.thumbnail) {
				const thumbnailPath = normalizeRelativePath(entry.thumbnail);
				if (
					!SUPPORTED_IMAGE_EXTENSIONS.has(
						path.extname(thumbnailPath).toLowerCase(),
					)
				) {
					throw new Error(
						`Artwork thumbnail has an unsupported format: ${thumbnailPath}`,
					);
				}
				assertRegularFileWithinDirectory(
					directory,
					thumbnailPath,
					"Artwork thumbnail",
				);
				thumbnail = toPublicUrl(thumbnailPath, publicBase);
			}

			return [
				{
					id: file,
					title: entry?.title?.trim() || inferredTitle,
					alt: entry?.alt?.trim() || entry?.title?.trim() || inferredTitle,
					publishedAt,
					description: entry?.description?.trim() || undefined,
					src: toPublicUrl(file, publicBase),
					thumbnail,
					width: entry?.width,
					height: entry?.height,
				},
			];
		})
		.sort(
			(a, b) =>
				Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
				b.id.localeCompare(a.id),
		);
}
