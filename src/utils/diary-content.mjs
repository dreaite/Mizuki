/**
 * Diary entries are rendered as escaped plain text, not Markdown. Notion's
 * Markdown API represents Shift+Enter with an HTML-looking <br> marker, so
 * convert only that marker before the text reaches the renderer.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDiaryContent(value) {
	return String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/<br\s*\/?>/gi, "\n");
}
