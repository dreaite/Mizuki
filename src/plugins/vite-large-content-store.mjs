import path from "node:path";

const ASTRO_DATA_STORE_MODULE_ID = "\0astro:data-layer-content";

/**
 * Avoid serializing Astro's content store into one JavaScript module.
 *
 * Astro's build-time content plugin expands data-store.json with dataToEsm().
 * Vite's es-module-lexer WebAssembly parser can exceed its linear-memory limit
 * before static generation starts, and the unsafe module size depends on the
 * generated content shape. Always using runtime JSON.parse() during production
 * builds avoids a brittle size threshold while keeping the data on disk.
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
			if (id !== ASTRO_DATA_STORE_MODULE_ID) {
				return null;
			}

			const dataStorePath = path.join(
				rootDir,
				"node_modules",
				".astro",
				"data-store.json",
			);
			this.info(
				`Loading the Astro content store from disk (${(code.length / 1024 / 1024).toFixed(1)} MiB virtual module).`,
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
