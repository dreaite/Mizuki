import { normalizeLanguageCode } from "../i18n/locale";

type LocalizedFields<T> = Partial<Record<string, Partial<T>>>;

export type LocalizableDataItem<T> = T & {
	lang?: string;
	translations?: LocalizedFields<T>;
};

function hasRequiredFields<T extends object>(
	item: T,
	requiredFields: readonly (keyof T)[],
): boolean {
	return requiredFields.every((field) => {
		const value = item[field];
		if (typeof value === "string") {
			return value.trim().length > 0;
		}
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		return value != null;
	});
}

function getExactTranslation<T extends object>(
	translations: LocalizedFields<T> | undefined,
	targetLanguage: string,
): Partial<T> | undefined {
	if (!translations) {
		return undefined;
	}

	const normalizedTarget = normalizeLanguageCode(targetLanguage);
	return Object.entries(translations).find(
		([language]) => normalizeLanguageCode(language) === normalizedTarget,
	)?.[1];
}

export function localizeDataItems<T extends object>(
	items: readonly LocalizableDataItem<T>[],
	targetLanguage: string,
	requiredFields: readonly (keyof T)[],
	localizedFields: readonly (keyof T)[] = requiredFields,
): T[] {
	const normalizedTarget = normalizeLanguageCode(targetLanguage);

	return items.flatMap((item) => {
		if (!item.lang) {
			return hasRequiredFields(item, requiredFields) ? [item] : [];
		}

		if (normalizeLanguageCode(item.lang) === normalizedTarget) {
			return hasRequiredFields(item, requiredFields) ? [item] : [];
		}

		const translation = getExactTranslation(
			item.translations,
			normalizedTarget,
		);
		if (!translation) {
			return [];
		}
		if (!hasRequiredFields(translation as T, requiredFields)) {
			return [];
		}

		const localizedBase = { ...item } as Partial<T> &
			Pick<LocalizableDataItem<T>, "lang" | "translations">;
		for (const field of new Set([...requiredFields, ...localizedFields])) {
			delete localizedBase[field];
		}
		const localizedItem = { ...localizedBase, ...translation } as T;
		return hasRequiredFields(localizedItem, requiredFields)
			? [localizedItem]
			: [];
	});
}
