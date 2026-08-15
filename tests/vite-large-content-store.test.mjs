import assert from "node:assert/strict";
import test from "node:test";

import { largeContentStorePlugin } from "../src/plugins/vite-large-content-store.mjs";

test("loads Astro's content store from disk regardless of virtual module size", () => {
	const plugin = largeContentStorePlugin();
	const messages = [];
	plugin.configResolved({ root: "/tmp/mizuki-test-root" });

	const result = plugin.transform.call(
		{ info: (message) => messages.push(message) },
		"export default [];",
		"\0astro:data-layer-content",
	);

	assert.match(result.code, /readFileSync/);
	assert.match(
		result.code,
		/\/tmp\/mizuki-test-root\/node_modules\/\.astro\/data-store\.json/,
	);
	assert.match(result.code, /export default JSON\.parse\(serializedContent\)/);
	assert.equal(messages.length, 1);
	assert.match(messages[0], /Loading the Astro content store from disk/);
});

test("ignores unrelated virtual modules", () => {
	const plugin = largeContentStorePlugin();
	assert.equal(
		plugin.transform.call({ info() {} }, "export default [];", "\0other"),
		null,
	);
});
