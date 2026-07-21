import path from "node:path";

const ASTRO_DATA_STORE_MODULE_ID = "\0astro:data-layer-content";
const LARGE_MODULE_THRESHOLD = 5 * 1024 * 1024;

/**
 * Avoid serializing a large Astro content store into one JavaScript module.
 *
 * Astro's build-time content plugin expands data-store.json with dataToEsm().
 * Once the generated module is large enough, Vite's es-module-lexer WebAssembly
 * parser can exceed its linear-memory limit before static generation starts.
 * Development mode already uses runtime JSON.parse() for large stores; this
 * plugin gives production builds the same shape while keeping the data on disk.
 */
export function largeContentStorePlugin() {
	let rootDir = process.cwd();

	return {
		name: "mizuki:large-content-store",
		enforce: "pre",
		apply: "build",
		configResolved(config) {
			rootDir = config.root;
		},
		transform(code, id) {
			if (
				id !== ASTRO_DATA_STORE_MODULE_ID ||
				code.length <= LARGE_MODULE_THRESHOLD
			) {
				return null;
			}

			const dataStorePath = path.join(
				rootDir,
				"node_modules",
				".astro",
				"data-store.json",
			);
			this.info(
				`Loading the large Astro content store from disk (${(code.length / 1024 / 1024).toFixed(1)} MiB virtual module).`,
			);

			return {
				code: [
					'import { readFileSync } from "node:fs";',
					`const serializedContent = readFileSync(${JSON.stringify(dataStorePath)}, "utf8");`,
					"export default JSON.parse(serializedContent);",
				].join("\n"),
				map: { mappings: "" },
			};
		},
	};
}
