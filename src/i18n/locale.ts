import { siteConfig } from "../config/siteConfig";

export const SUPPORTED_LOCALES = [
	{
		path: "cn",
		lang: "zh_CN",
		htmlLang: "zh-CN",
		label: "简体中文",
		shortLabel: "CN",
	},
	{
		path: "en",
		lang: "en",
		htmlLang: "en",
		label: "English",
		shortLabel: "EN",
	},
	{
		path: "jp",
		lang: "ja",
		htmlLang: "ja",
		label: "日本語",
		shortLabel: "JP",
	},
] as const;

export type SupportedLocalePath = (typeof SUPPORTED_LOCALES)[number]["path"];
export type SupportedLocaleLang = (typeof SUPPORTED_LOCALES)[number]["lang"];

export interface RouteLocaleContext {
	localePath: SupportedLocalePath;
	lang: SupportedLocaleLang;
	htmlLang: string;
	hasLocalePrefix: boolean;
}

let currentRouteLocaleContext: RouteLocaleContext | undefined;

export function normalizeLanguageCode(raw?: string | null): string {
	if (!raw) {
		return "";
	}

	const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
	const aliasMap: Record<string, string> = {
		cn: "zh_cn",
		zh: "zh_cn",
		zh_hans: "zh_cn",
		zh_sg: "zh_cn",
		tw: "zh_tw",
		zh_hant: "zh_tw",
		zh_hk: "zh_tw",
		zh_mo: "zh_tw",
		jp: "ja",
		ja_jp: "ja",
		en_us: "en",
		en_gb: "en",
		en_au: "en",
	};

	return aliasMap[normalized] || normalized;
}

function toSupportedLang(raw?: string | null): SupportedLocaleLang {
	const normalized = normalizeLanguageCode(raw);
	if (normalized === "en") {
		return "en";
	}
	if (normalized === "ja") {
		return "ja";
	}
	return "zh_CN";
}

export function getLocaleInfoByPath(path?: string | null) {
	return SUPPORTED_LOCALES.find((locale) => locale.path === path);
}

export function getLocaleInfoByLang(lang?: string | null) {
	const supportedLang = toSupportedLang(lang);
	return (
		SUPPORTED_LOCALES.find((locale) => locale.lang === supportedLang) ||
		SUPPORTED_LOCALES[0]
	);
}

export function getDefaultLocaleInfo() {
	if (siteConfig.i18n?.defaultLocale) {
		return (
			getLocaleInfoByPath(siteConfig.i18n.defaultLocale) ||
			getLocaleInfoByLang(siteConfig.lang)
		);
	}
	return getLocaleInfoByLang(siteConfig.lang);
}

export function isSupportedLocalePath(
	value?: string | null,
): value is SupportedLocalePath {
	return SUPPORTED_LOCALES.some((locale) => locale.path === value);
}

function stripBase(pathname: string): string {
	const base = import.meta.env.BASE_URL || "/";
	if (base === "/" || !pathname.startsWith(base)) {
		return pathname;
	}
	const stripped = pathname.slice(base.length - 1);
	return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

export function stripLocalePrefix(pathname: string) {
	const normalized = stripBase(pathname || "/");
	const segments = normalized.split("/").filter(Boolean);
	const first = segments[0];

	if (isSupportedLocalePath(first)) {
		let withoutLocale = `/${segments.slice(1).join("/")}`;
		if (
			withoutLocale !== "/" &&
			withoutLocale !== "" &&
			normalized.endsWith("/") &&
			!withoutLocale.endsWith("/")
		) {
			withoutLocale += "/";
		}
		return {
			localePath: first,
			hasLocalePrefix: true,
			pathWithoutLocale:
				withoutLocale === "/" || withoutLocale === "" ? "/" : withoutLocale,
		};
	}

	return {
		localePath: getDefaultLocaleInfo().path,
		hasLocalePrefix: false,
		pathWithoutLocale: normalized || "/",
	};
}

export function getRouteLocaleContextFromPath(
	pathname: string,
): RouteLocaleContext {
	const route = stripLocalePrefix(pathname);
	const localeInfo =
		getLocaleInfoByPath(route.localePath) || getDefaultLocaleInfo();
	return {
		localePath: localeInfo.path,
		lang: localeInfo.lang,
		htmlLang: localeInfo.htmlLang,
		hasLocalePrefix: route.hasLocalePrefix,
	};
}

export function setCurrentLocaleContext(
	localePathOrLang?: string | null,
	hasLocalePrefix?: boolean,
): RouteLocaleContext {
	const localeInfo =
		getLocaleInfoByPath(localePathOrLang) ||
		getLocaleInfoByLang(localePathOrLang);
	const explicitLocale = !!localePathOrLang;
	currentRouteLocaleContext = {
		localePath: localeInfo.path,
		lang: localeInfo.lang,
		htmlLang: localeInfo.htmlLang,
		hasLocalePrefix:
			hasLocalePrefix ??
			(explicitLocale &&
			currentRouteLocaleContext?.localePath === localeInfo.path
				? currentRouteLocaleContext.hasLocalePrefix
				: false),
	};
	return currentRouteLocaleContext;
}

export function setCurrentLocaleContextFromPath(
	pathname: string,
): RouteLocaleContext {
	currentRouteLocaleContext = getRouteLocaleContextFromPath(pathname);
	return currentRouteLocaleContext;
}

export function getCurrentLocaleContext(): RouteLocaleContext {
	if (typeof document !== "undefined") {
		return getRouteLocaleContextFromPath(window.location.pathname);
	}
	return (
		currentRouteLocaleContext || {
			localePath: getDefaultLocaleInfo().path,
			lang: getDefaultLocaleInfo().lang,
			htmlLang: getDefaultLocaleInfo().htmlLang,
			hasLocalePrefix: false,
		}
	);
}

export function getCurrentLocaleLang(): SupportedLocaleLang {
	return getCurrentLocaleContext().lang;
}

export function getCurrentLocalePath(): SupportedLocalePath {
	return getCurrentLocaleContext().localePath;
}

export function getExplicitLocaleStaticPaths() {
	return SUPPORTED_LOCALES.map((locale) => ({
		params: { locale: locale.path },
		props: { localePath: locale.path },
	}));
}

export function getRouteLocaleStaticContexts() {
	const defaultLocale = getDefaultLocaleInfo();
	return [
		{
			localePath: defaultLocale.path,
			lang: defaultLocale.lang,
			htmlLang: defaultLocale.htmlLang,
			hasLocalePrefix: false,
			routePrefix: "",
		},
		...SUPPORTED_LOCALES.map((locale) => ({
			localePath: locale.path,
			lang: locale.lang,
			htmlLang: locale.htmlLang,
			hasLocalePrefix: true,
			routePrefix: locale.path,
		})),
	];
}

function splitPath(path: string) {
	const hashIndex = path.indexOf("#");
	const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
	const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
	const queryIndex = withoutHash.indexOf("?");
	const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
	const pathname =
		queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
	return { pathname, query, hash };
}

function normalizePathname(pathname: string): string {
	if (!pathname) {
		return "/";
	}
	return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function withLocalePrefix(
	path: string,
	localePath = getCurrentLocalePath(),
	usePrefix = getCurrentLocaleContext().hasLocalePrefix,
): string {
	if (
		!path ||
		path.startsWith("#") ||
		/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path)
	) {
		return path;
	}

	const { pathname, query, hash } = splitPath(path);
	const route = stripLocalePrefix(normalizePathname(pathname));
	const localizedPathname = usePrefix
		? `/${localePath}${route.pathWithoutLocale === "/" ? "/" : route.pathWithoutLocale}`
		: route.pathWithoutLocale;

	return `${localizedPathname}${query}${hash}`;
}

export function getLocaleSwitchPath(
	currentPath: string,
	targetLocalePath: SupportedLocalePath,
): string {
	const { pathname, query, hash } = splitPath(currentPath);
	const route = stripLocalePrefix(pathname || "/");
	const targetPrefix =
		targetLocalePath === getDefaultLocaleInfo().path
			? ""
			: `/${targetLocalePath}`;
	const targetPath =
		route.pathWithoutLocale === "/"
			? `${targetPrefix}/`
			: `${targetPrefix}${route.pathWithoutLocale}`;
	return `${targetPath}${query}${hash}`;
}

export function isLocalizedHomePath(pathname: string): boolean {
	const route = stripLocalePrefix(pathname || "/");
	return route.pathWithoutLocale === "/";
}
