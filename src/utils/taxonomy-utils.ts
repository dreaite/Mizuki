import { getTaxonomyLabel } from "../data/post-taxonomy.mjs";
import I18nKey from "../i18n/i18nKey";
import { getCurrentLocaleLang } from "../i18n/locale";
import { i18nFor } from "../i18n/translation";

export {
	normalizePostTaxonomy,
	resolveTaxonomyKey,
} from "../data/post-taxonomy.mjs";

export function getCategoryLabel(
	value?: string | null,
	language: string = getCurrentLocaleLang(),
): string {
	return (
		getTaxonomyLabel("categories", value, language) ||
		i18nFor(language, I18nKey.uncategorized)
	);
}

export function getTagLabel(
	value: string,
	language: string = getCurrentLocaleLang(),
): string {
	return getTaxonomyLabel("tags", value, language);
}
