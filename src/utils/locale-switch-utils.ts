import {
	SUPPORTED_LOCALES,
	getLocaleSwitchPath,
	type SupportedLocalePath,
} from "../i18n/locale";
import { getSortedPosts } from "./content-utils";
import { getCanonicalPostSlugFromId } from "./post-variant-utils";

export type LocaleSwitchPathMap = Partial<Record<SupportedLocalePath, string>>;

function splitPath(path: string) {
	const hashIndex = path.indexOf("#");
	const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
	const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
	const queryIndex = withoutHash.indexOf("?");
	const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
	return { query, hash };
}

function appendSuffix(pathname: string, currentPath: string) {
	const { query, hash } = splitPath(currentPath);
	return `${pathname}${query}${hash}`;
}

function localeHomePath(localePath: SupportedLocalePath, currentPath: string) {
	return appendSuffix(`/${localePath}/`, currentPath);
}

function localePostPath(
	localePath: SupportedLocalePath,
	canonicalSlug: string,
	currentPath: string,
) {
	const cleanSlug = canonicalSlug.replace(/^\/+/, "").replace(/\/+$/, "");
	return appendSuffix(`/${localePath}/posts/${cleanSlug}/`, currentPath);
}

export async function getLocaleSwitchPaths(
	currentPath: string,
	postSlug?: string | null,
): Promise<LocaleSwitchPathMap> {
	const fallbackPaths = Object.fromEntries(
		SUPPORTED_LOCALES.map((locale) => [
			locale.path,
			getLocaleSwitchPath(currentPath, locale.path),
		]),
	) as LocaleSwitchPathMap;

	if (!postSlug) {
		return fallbackPaths;
	}

	const canonicalSlug = getCanonicalPostSlugFromId(postSlug);
	const localizedPostEntries = await Promise.all(
		SUPPORTED_LOCALES.map(async (locale) => ({
			locale,
			posts: await getSortedPosts(locale.lang),
		})),
	);

	for (const { locale, posts } of localizedPostEntries) {
		const hasLocalizedPost = posts.some(
			(post) => getCanonicalPostSlugFromId(post) === canonicalSlug,
		);
		fallbackPaths[locale.path] = hasLocalizedPost
			? localePostPath(locale.path, canonicalSlug, currentPath)
			: localeHomePath(locale.path, currentPath);
	}

	return fallbackPaths;
}
