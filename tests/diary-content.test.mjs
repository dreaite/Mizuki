import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDiaryContent } from "../src/utils/diary-content.mjs";

test("normalizes Notion line-break markers into plain-text newlines", () => {
	assert.equal(
		normalizeDiaryContent("第一行<br>第二行<BR />第三行\r\n第四行"),
		"第一行\n第二行\n第三行\n第四行",
	);
});

test("does not interpret unrelated HTML", () => {
	assert.equal(
		normalizeDiaryContent("<strong>plain text</strong><bracket>"),
		"<strong>plain text</strong><bracket>",
	);
});
