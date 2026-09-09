import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import sharp from "sharp";

export const PREVIEW_PATH = "/_image-previews/";
export const previewDirectory = path.resolve(
	"node_modules/.cache/mizuki-previews",
);
const pending = new Map();

async function download(src) {
	const response = await fetch(src, { signal: AbortSignal.timeout(15000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

/** Server-only: create a separate JPEG; the caller keeps the original link. */
export async function getImagePreview(src, { basePath = "/" } = {}) {
	if (!src || /^(?:data:|blob:)/i.test(src)) return { src };
	const remote = /^https?:\/\//i.test(src) || src.startsWith("//");
	let source = src;
	let version = src;
	try {
		if (remote) {
			source = new URL(src, "https://localhost").href;
		} else {
			const pathname = decodeURIComponent(src.split(/[?#]/)[0]);
			const directory = path.resolve(
				process.cwd(),
				src.startsWith("/") ? "public" : "src",
			);
			source = path.resolve(
				directory,
				...(src.startsWith("/") ? [] : [basePath.replace(/^\/+/, "")]),
				pathname.replace(/^\/+/, ""),
			);
			if (!source.startsWith(`${directory}${path.sep}`))
				throw new Error("Image path escapes its root");
			const info = await stat(source);
			version = `${info.mtimeMs}:${info.size}`;
		}
		// SVGs stay vectors; HEIC keeps the existing browser conversion flow.
		if (/\.(?:svg|heic|heif)(?:[?#]|$)/i.test(source)) return { src };
		const key = `${source}:${version}`;
		if (!pending.has(key)) {
			pending.set(
				key,
				(async () => {
					const input = remote
						? await download(source)
						: await readFile(source);
					const hash = createHash("sha256")
						.update("jpeg-preview-v1-800-70")
						.update(input)
						.digest("hex")
						.slice(0, 24);
					const filename = `${hash}.jpg`;
					const output = path.join(previewDirectory, filename);
					let metadata;
					try {
						metadata = await sharp(output).metadata();
					} catch {
						const result = await sharp(input, { page: 0, pages: 1 })
							.rotate()
							.resize({
								width: 800,
								height: 800,
								fit: "inside",
								withoutEnlargement: true,
							})
							.flatten({ background: "#ffffff" })
							.jpeg({ quality: 70, progressive: true })
							.toBuffer({ resolveWithObject: true });
						await mkdir(previewDirectory, { recursive: true });
						await writeFile(output, result.data);
						metadata = result.info;
					}
					return {
						src: `${PREVIEW_PATH}${filename}`,
						width: metadata.width,
						height: metadata.height,
					};
				})().catch((error) => {
					// A failed external host must not break the site build.
					console.warn(
						`[image-preview] Using original image: ${error.message}`,
					);
					return { src };
				}),
			);
		}
		return await pending.get(key);
	} catch (error) {
		console.warn(`[image-preview] Using original image: ${error.message}`);
		return { src };
	}
}

export function imagePreviews() {
	let base = "/";
	return {
		name: "mizuki-image-previews",
		hooks: {
			"astro:config:done": ({ config }) => {
				base = config.base;
			},
			"astro:server:setup": ({ server }) => {
				server.middlewares.use(
					`${base.replace(/\/$/, "")}${PREVIEW_PATH}`,
					async (req, res, next) => {
						const filename = req.url?.split("?")[0].replace(/^\//, "");
						if (!/^[a-f0-9]{24}\.jpg$/.test(filename ?? "")) return next();
						try {
							const data = await readFile(
								path.join(previewDirectory, filename),
							);
							res.setHeader("Content-Type", "image/jpeg");
							res.setHeader(
								"Cache-Control",
								"public, max-age=31536000, immutable",
							);
							res.end(data);
						} catch {
							next();
						}
					},
				);
			},
			// Previews are created while pages render, after Astro copies public/.
			"astro:build:done": async ({ dir }) => {
				const output = fileURLToPath(dir);
				const used = new Set();
				for (const file of await glob("**/*.html", {
					cwd: output,
					absolute: true,
				})) {
					const html = await readFile(file, "utf8");
					for (const match of html.matchAll(
						/\/_image-previews\/([a-f0-9]{24}\.jpg)/g,
					))
						used.add(match[1]);
				}
				// Never publish cached images belonging to removed or hidden content.
				if (used.size) {
					const destination = path.join(output, PREVIEW_PATH.slice(1));
					await mkdir(destination, { recursive: true });
					for (const filename of used)
						await copyFile(
							path.join(previewDirectory, filename),
							path.join(destination, filename),
						);
				}
			},
		},
	};
}
