import {
	SUPPORTED_LOCALES,
	getLocaleSwitchPath,
	type SupportedLocalePath,
} from "../i18n/locale";
import { getSortedPosts } from "./content-utils";
import { getCanonicalPostSlugFromId } from "./post-variant-utils";
import { getPostUrlForLocale } from "./url-utils";

export type LocaleSwitchPathMap = Partial<Record<SupportedLocalePath, string>>;
type PostVariantSource =
	| string
	| {
			id: string;
			filePath?: string | null;
			data?: { lang?: string | null };
	  };

function splitPath(path: string) {
	const hashIndex = path.indexOf("#");
	const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
	const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
	const queryIndex = withoutHash.indexOf("?");
	const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
	const pathname =
		queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
	return { pathname: pathname || "/", query, hash };
}

function appendSuffix(pathname: string, currentPath: string) {
	const { query, hash } = splitPath(currentPath);
	return `${pathname}${query}${hash}`;
}

function localeHomePath(localePath: SupportedLocalePath, currentPath: string) {
	return appendSuffix(getLocaleSwitchPath("/", localePath), currentPath);
}

export interface LocaleRouteMaps {
	localeSwitchPaths: LocaleSwitchPathMap;
	alternateLocalePaths: LocaleSwitchPathMap;
}

export async function getLocaleRouteMaps(
	currentPath: string,
	post?: PostVariantSource | null,
): Promise<LocaleRouteMaps> {
	const { pathname } = splitPath(currentPath);
	const fallbackPaths = Object.fromEntries(
		SUPPORTED_LOCALES.map((locale) => [
			locale.path,
			getLocaleSwitchPath(currentPath, locale.path),
		]),
	) as LocaleSwitchPathMap;
	const alternateLocalePaths = Object.fromEntries(
		SUPPORTED_LOCALES.map((locale) => [
			locale.path,
			getLocaleSwitchPath(pathname, locale.path),
		]),
	) as LocaleSwitchPathMap;

	if (!post) {
		return {
			localeSwitchPaths: fallbackPaths,
			alternateLocalePaths,
		};
	}

	const canonicalSlug =
		typeof post === "string"
			? getCanonicalPostSlugFromId(post)
			: getCanonicalPostSlugFromId(post);
	const localizedPostEntries = await Promise.all(
		SUPPORTED_LOCALES.map(async (locale) => ({
			locale,
			posts: await getSortedPosts(locale.lang),
		})),
	);

	for (const { locale, posts } of localizedPostEntries) {
		const localizedPost = posts.find(
			(post) => getCanonicalPostSlugFromId(post) === canonicalSlug,
		);
		if (localizedPost) {
			const exactPath = getPostUrlForLocale(localizedPost, locale.path);
			fallbackPaths[locale.path] = appendSuffix(exactPath, currentPath);
			alternateLocalePaths[locale.path] = exactPath;
		} else {
			fallbackPaths[locale.path] = localeHomePath(locale.path, currentPath);
			delete alternateLocalePaths[locale.path];
		}
	}

	return {
		localeSwitchPaths: fallbackPaths,
		alternateLocalePaths,
	};
}

export async function getLocaleSwitchPaths(
	currentPath: string,
	post?: PostVariantSource | null,
): Promise<LocaleSwitchPathMap> {
	return (await getLocaleRouteMaps(currentPath, post)).localeSwitchPaths;
}
