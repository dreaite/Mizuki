// 参考 HEIC → WebCodecs → Canvas 的思路：https://github.com/WordPress/gutenberg/pull/76731

// Match encoded Notion/R2 filenames as well as ordinary local paths.
export function isHeicImage(source: string): boolean {
	try {
		const url = new URL(source, "https://local.invalid");
		return (
			["http:", "https:"].includes(url.protocol) &&
			/\.(heic|heif)$/i.test(decodeURIComponent(url.pathname))
		);
	} catch {
		return false;
	}
}

export const HEIC_PLACEHOLDER =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='120' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' fill='%23888' fill-opacity='.12'/%3E%3Ctext x='80' y='65' text-anchor='middle' font-family='sans-serif' font-size='15' fill='%23888'%3EHEIC%3C/text%3E%3C/svg%3E";

/** 将 HEIC 转成预览 JPEG；解码在 Worker 中完成。 */
export function createHeicPreview(
	source: string,
	signal?: AbortSignal,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("cancelled"));
			return;
		}
		const script = URL.createObjectURL(
			new Blob([`(${heicWorker.toString()})()`], { type: "text/javascript" }),
		);
		const worker = new Worker(script);
		const finish = () => {
			worker.terminate();
			URL.revokeObjectURL(script);
			signal?.removeEventListener("abort", abort);
		};
		const abort = () => {
			finish();
			reject(new Error("cancelled"));
		};
		signal?.addEventListener("abort", abort, { once: true });
		worker.onerror = () => {
			finish();
			reject(new Error("decode"));
		};
		worker.onmessage = (
			event: MessageEvent<{ blob?: Blob; error?: string }>,
		) => {
			finish();
			if (event.data.blob) resolve(event.data.blob);
			else reject(new Error(event.data.error || "decode"));
		};
		worker.postMessage(new URL(source, location.href).href);
	});
}

export function initHeicImages(root: HTMLElement): () => void {
	const cache = new Map<string, Promise<string>>();
	const loading = new WeakMap<HTMLImageElement, Promise<void>>();
	const observed = new WeakSet<HTMLImageElement>();
	const urls = new Set<string>();
	const controller = new AbortController();
	let disposed = false;
	let opening = false;
	const lang = document.documentElement.lang;
	const labels = lang.startsWith("zh")
		? ["正在加载图片…", "此图片暂时无法预览", "打开原图"]
		: lang.startsWith("ja")
			? [
					"画像を読み込み中…",
					"この画像をプレビューできません",
					"元の画像を開く",
				]
			: ["Loading image…", "Image preview unavailable", "Open original"];

	function convert(source: string): Promise<string> {
		let result = cache.get(source);
		if (!result) {
			result = createHeicPreview(source, controller.signal).then((blob) => {
				const url = URL.createObjectURL(blob);
				urls.add(url);
				return url;
			});
			cache.set(source, result);
		}
		return result;
	}

	function load(img: HTMLImageElement): Promise<void> {
		const existing = loading.get(img);
		if (existing) return existing;
		const result = (async () => {
			observer.unobserve(img);
			const anchor = img.closest("a");
			const source = img.dataset.heicSrc;
			if (!anchor || !source) return;
			img.dataset.heicState = "loading";
			anchor.setAttribute("aria-busy", "true");
			anchor.title = labels[0];
			try {
				const url = await convert(source);
				if (disposed || !img.isConnected) return;
				img.src = url;
				anchor.dataset.src = url;
				img.dataset.heicState = "ready";
				anchor.removeAttribute("title");
			} catch {
				if (disposed || !img.isConnected) return;
				img.dataset.heicState = "failed";
				img.alt = anchor.title = labels[1];
				anchor.dataset.src = HEIC_PLACEHOLDER;
				const link = document.createElement("a");
				link.href = source;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = labels[2];
				anchor.dataset.caption = `${labels[1]} · ${link.outerHTML}`;
			} finally {
				anchor.removeAttribute("aria-busy");
				anchor.dataset.type = "image";
				anchor.dataset.thumbSrc = img.src;
			}
		})();
		loading.set(img, result);
		return result;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries)
				if (entry.isIntersecting) void load(entry.target as HTMLImageElement);
		},
		{ rootMargin: "100px" },
	);
	const discover = () => {
		for (const img of root.querySelectorAll<HTMLImageElement>(
			"img[data-heic-src]",
		)) {
			if (observed.has(img)) continue;
			observed.add(img);
			observer.observe(img);
		}
	};
	// Memos can replace diary cards after the page has loaded.
	const changes = new MutationObserver(discover);
	changes.observe(root, { childList: true, subtree: true });
	discover();

	const onClick = (event: MouseEvent) => {
		const anchor = (event.target as Element).closest<HTMLAnchorElement>(
			"a[data-fancybox]",
		);
		if (
			!anchor ||
			!root.contains(anchor) ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.button !== 0
		)
			return;
		const group = [
			...root.querySelectorAll<HTMLImageElement>("img[data-heic-src]"),
		].filter(
			(img) => img.closest("a")?.dataset.fancybox === anchor.dataset.fancybox,
		);
		if (
			group.every((img) =>
				["ready", "failed"].includes(img.dataset.heicState || ""),
			)
		)
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (opening) return;
		opening = true;
		void Promise.all(group.map(load))
			.then(() => {
				if (!disposed && anchor.isConnected) anchor.click();
			})
			.finally(() => {
				opening = false;
			});
	};
	document.addEventListener("click", onClick, true);
	return () => {
		disposed = true;
		observer.disconnect();
		changes.disconnect();
		document.removeEventListener("click", onClick, true);
		controller.abort();
		for (const url of urls) URL.revokeObjectURL(url);
		cache.clear();
	};
}

// 单文件内启动后台解码，所有解析依赖都封装在这个函数中。
function heicWorker() {
	class Reader {
		position = 0;
		constructor(readonly data: Uint8Array) {}
		number(length: number): number {
			if (this.position + length > this.data.length)
				throw new Error("Invalid HEIC data");
			let value = 0;
			for (let i = 0; i < length; i++)
				value = value * 256 + this.data[this.position++];
			if (!Number.isSafeInteger(value)) throw new Error("Invalid HEIC offset");
			return value;
		}
		text(length: number): string {
			return String.fromCharCode(
				...Array.from({ length }, () => this.number(1)),
			);
		}
		fullBox(): number {
			const version = this.number(1);
			this.number(3);
			return version;
		}
	}

	type Box = { name: string; data: Uint8Array };

	function boxes(data: Uint8Array): Box[] {
		const result: Box[] = [];
		const reader = new Reader(data);
		while (reader.position < data.length) {
			const start = reader.position;
			let length = reader.number(4);
			const name = reader.text(4);
			if (length === 1) length = reader.number(8);
			if (length === 0) length = data.length - start;
			const end = start + length;
			if (end < reader.position || end > data.length)
				throw new Error("Invalid HEIC box");
			result.push({ name, data: data.subarray(reader.position, end) });
			reader.position = end;
		}
		return result;
	}

	function required(list: Box[], name: string): Uint8Array {
		const box = list.find((item) => item.name === name);
		if (!box) throw new Error(`Missing HEIC ${name}`);
		return box.data;
	}

	function codecString(config: Uint8Array): string {
		const reader = new Reader(config);
		reader.number(1);
		const profile = reader.number(1);
		const compatibility = Number.parseInt(
			reader
				.number(4)
				.toString(2)
				.padStart(32, "0")
				.split("")
				.reverse()
				.join(""),
			2,
		);
		const constraints = Array.from({ length: 6 }, () => reader.number(1));
		while (constraints.at(-1) === 0) constraints.pop();
		return [
			"hvc1",
			`${["", "A", "B", "C"][profile >> 6]}${profile & 31}`,
			compatibility.toString(16),
			`${profile & 32 ? "H" : "L"}${reader.number(1)}`,
			...constraints.map((value) => value.toString(16)),
		].join(".");
	}

	function parseHeic(buffer: ArrayBuffer) {
		const file = new Uint8Array(buffer);
		const metadata = boxes(required(boxes(file), "meta").subarray(4));
		const primaryReader = new Reader(required(metadata, "pitm"));
		const primary = primaryReader.number(primaryReader.fullBox() === 0 ? 2 : 4);
		const itemData = new Map<number, Uint8Array[]>();
		const locations = new Reader(required(metadata, "iloc"));
		const version = locations.fullBox();
		const extentSizes = locations.number(1);
		const baseSizes = locations.number(1);
		const count = locations.number(version < 2 ? 2 : 4);
		for (let i = 0; i < count; i++) {
			const id = locations.number(version < 2 ? 2 : 4);
			const method = version ? locations.number(2) & 15 : 0;
			if (locations.number(2) !== 0 || method > 1)
				throw new Error("Unsupported HEIC item location");
			const base = locations.number(baseSizes >> 4);
			const parts: Uint8Array[] = [];
			const source = method === 1 ? required(metadata, "idat") : file;
			const extents = locations.number(2);
			for (let j = 0; j < extents; j++) {
				if (version) locations.number(baseSizes & 15);
				const offset = base + locations.number(extentSizes >> 4);
				const length = locations.number(extentSizes & 15);
				if (offset + length > source.length)
					throw new Error("Invalid HEIC image data");
				parts.push(source.subarray(offset, offset + length));
			}
			itemData.set(id, parts);
		}
		const readItem = (id: number): Uint8Array => {
			const parts = itemData.get(id);
			if (!parts?.length) throw new Error("Missing HEIC image data");
			if (parts.length === 1) return parts[0];
			const joined = new Uint8Array(
				parts.reduce((size, part) => size + part.length, 0),
			);
			let offset = 0;
			for (const part of parts) {
				joined.set(part, offset);
				offset += part.length;
			}
			return joined;
		};

		const propertyBoxes = boxes(required(metadata, "iprp"));
		const properties = boxes(required(propertyBoxes, "ipco"));
		const associations = new Map<number, Box[]>();
		const associationReader = new Reader(required(propertyBoxes, "ipma"));
		const header = associationReader.number(4);
		const entries = associationReader.number(4);
		for (let i = 0; i < entries; i++) {
			const id = associationReader.number(header >>> 24 ? 4 : 2);
			const items: Box[] = [];
			const propertyCount = associationReader.number(1);
			for (let j = 0; j < propertyCount; j++) {
				const index =
					associationReader.number(header & 1 ? 2 : 1) &
					(header & 1 ? 32767 : 127);
				if (index) items.push(properties[index - 1]);
			}
			associations.set(id, items);
		}
		const primaryProperties = associations.get(primary) || [];
		const rotation =
			((primaryProperties.find((item) => item.name === "irot")?.data[0] || 0) &
				3) *
			90;
		let type = "hvc1";
		const info = metadata.find((item) => item.name === "iinf");
		if (info) {
			const reader = new Reader(info.data);
			reader.number(reader.fullBox() === 0 ? 2 : 4);
			for (const item of boxes(info.data.subarray(reader.position))) {
				if (item.name !== "infe") continue;
				const entry = new Reader(item.data);
				const itemVersion = entry.fullBox();
				if (itemVersion < 2) continue;
				const id = entry.number(itemVersion === 2 ? 2 : 4);
				entry.number(2);
				if (id === primary) type = entry.text(4);
			}
		}

		let ids = [primary];
		let columns = 1;
		let outputWidth = 0;
		let outputHeight = 0;
		if (type === "grid") {
			const grid = new Reader(readItem(primary));
			grid.number(1);
			const dimensionBytes = grid.number(1) & 1 ? 4 : 2;
			const rows = grid.number(1) + 1;
			columns = grid.number(1) + 1;
			outputWidth = grid.number(dimensionBytes);
			outputHeight = grid.number(dimensionBytes);
			const references = new Reader(required(metadata, "iref"));
			const idBytes = references.fullBox() === 0 ? 2 : 4;
			ids = [];
			for (const relation of boxes(
				references.data.subarray(references.position),
			)) {
				if (relation.name !== "dimg") continue;
				const reader = new Reader(relation.data);
				if (reader.number(idBytes) !== primary) continue;
				const linkedCount = reader.number(2);
				ids = Array.from({ length: linkedCount }, () =>
					reader.number(idBytes),
				).slice(0, rows * columns);
			}
			if (ids.length !== rows * columns) throw new Error("Missing HEIC tiles");
		} else if (type !== "hvc1") throw new Error("Unsupported HEIC image type");

		const tileProperties = associations.get(ids[0]) || [];
		const size = new Reader(required(tileProperties, "ispe"));
		size.fullBox();
		const tileWidth = size.number(4);
		const tileHeight = size.number(4);
		const description = required(tileProperties, "hvcC");
		return {
			codecString: codecString(description),
			description,
			tileWidth,
			tileHeight,
			outputWidth: outputWidth || tileWidth,
			outputHeight: outputHeight || tileHeight,
			rotation,
			tiles: ids.map((id, index) => ({
				data: readItem(id),
				x: (index % columns) * tileWidth,
				y: Math.floor(index / columns) * tileHeight,
			})),
		};
	}
	async function decodeFrame(
		config: VideoDecoderConfig,
		data: Uint8Array,
	): Promise<VideoFrame> {
		let frame: VideoFrame | undefined;
		let failure: DOMException | undefined;
		const decoder = new VideoDecoder({
			output(value) {
				frame?.close();
				frame = value;
			},
			error(error) {
				failure = error;
			},
		});
		try {
			decoder.configure(config);
			decoder.decode(
				new EncodedVideoChunk({
					type: "key",
					timestamp: 0,
					data: data as Uint8Array<ArrayBuffer>,
				}),
			);
			await decoder.flush();
			if (!frame) throw failure || new Error("decode");
			return frame;
		} catch (error) {
			frame?.close();
			throw error;
		} finally {
			if (decoder.state !== "closed") decoder.close();
		}
	}

	async function decode(url: string): Promise<Blob> {
		const response = await fetch(url);
		if (!response.ok) throw new Error("fetch");
		const blob = await response.blob();
		const image = parseHeic(await blob.arrayBuffer());
		// A resized preview is enough for the diary and avoids a full-size canvas.
		const scale = Math.min(
			1,
			2560 / Math.max(image.outputWidth, image.outputHeight),
		);
		const width = Math.max(1, Math.round(image.outputWidth * scale));
		const height = Math.max(1, Math.round(image.outputHeight * scale));
		const rotated = image.rotation === 90 || image.rotation === 270;
		const canvas = new OffscreenCanvas(
			rotated ? height : width,
			rotated ? width : height,
		);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("canvas");
		try {
			const bitmap = await createImageBitmap(blob, {
				resizeWidth: canvas.width,
				resizeHeight: canvas.height,
			}).catch(() => null);
			if (bitmap) {
				try {
					context.drawImage(bitmap, 0, 0);
				} finally {
					bitmap.close();
				}
			} else {
				const config: VideoDecoderConfig = {
					codec: image.codecString,
					description: image.description as Uint8Array<ArrayBuffer>,
					codedWidth: image.tileWidth,
					codedHeight: image.tileHeight,
				};
				if (!(await VideoDecoder.isConfigSupported(config)).supported)
					throw new Error("unsupported");
				context.translate(canvas.width / 2, canvas.height / 2);
				context.rotate((-image.rotation * Math.PI) / 180);
				context.translate(-width / 2, -height / 2);
				context.scale(scale, scale);
				for (const tile of image.tiles) {
					const frame = await decodeFrame(config, tile.data);
					try {
						context.drawImage(
							frame,
							tile.x,
							tile.y,
							image.tileWidth,
							image.tileHeight,
						);
					} finally {
						frame.close();
					}
				}
			}
			return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
		} finally {
			canvas.width = canvas.height = 1;
		}
	}

	self.onmessage = async (event: MessageEvent<string>) => {
		try {
			self.postMessage({ blob: await decode(event.data) });
		} catch (error) {
			self.postMessage({
				error: error instanceof Error ? error.message : "decode",
			});
		}
	};
}
