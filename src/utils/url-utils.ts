import type { CollectionEntry } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import {
	getCurrentLocaleContext,
	getCurrentLocalePath,
	getDefaultLocaleInfo,
	type SupportedLocalePath,
	withLocalePrefix,
} from "@i18n/locale";
import { i18n } from "@i18n/translation";

import { permalinkConfig } from "../config";
import { generatePermalinkSlug } from "./permalink-utils";
import { getCanonicalPostSlugFromId } from "./post-variant-utils";

/**
 * 移除文件扩展名（.md, .mdx, .markdown）
 * 用于将 Astro v5 Content Layer API 的 id 转换为 URL 友好的 slug
 */
export function removeFileExtension(id: string): string {
	return id.replace(/\.(md|mdx|markdown)$/i, "");
}

export function pathsEqual(path1: string, path2: string) {
	const normalizedPath1 = path1.replace(/^\/|\/$/g, "").toLowerCase();
	const normalizedPath2 = path2.replace(/^\/|\/$/g, "").toLowerCase();
	return normalizedPath1 === normalizedPath2;
}

function joinUrl(...parts: string[]): string {
	const joined = parts.join("/");
	return joined.replace(/\/+/g, "/");
}

export function getPostUrlBySlug(slug: string): string {
	// 移除文件扩展名（如 .md, .mdx 等）
	const slugWithoutExt = removeFileExtension(slug);
	return localizedUrl(`/posts/${getCanonicalPostSlugFromId(slugWithoutExt)}/`);
}

export function getPostUrlByAlias(alias: string): string {
	// 移除开头的斜杠并确保固定链接在 /posts/ 路径下
	const cleanAlias = alias.replace(/^\/+/, "");
	return localizedUrl(`/posts/${cleanAlias}/`);
}

type PostUrlSource = {
	id: string;
	filePath?: string | null;
	data: { alias?: string; permalink?: string; lang?: string | null };
};

function getPostPath(post: PostUrlSource): string {
	if (post.data.permalink) {
		const slug = post.data.permalink.replace(/^\/+/, "").replace(/\/+$/, "");
		return `/${slug}/`;
	}

	if (permalinkConfig.enable) {
		const slug = generatePermalinkSlug(post as CollectionEntry<"posts">);
		return `/${slug}/`;
	}

	if (post.data.alias) {
		const cleanAlias = post.data.alias.replace(/^\/+/, "");
		return `/posts/${cleanAlias}/`;
	}

	return `/posts/${getCanonicalPostSlugFromId(post)}/`;
}

export function getPostUrlForLocale(
	post: PostUrlSource,
	localePath: SupportedLocalePath,
): string {
	const usePrefix = localePath !== getDefaultLocaleInfo().path;
	return url(withLocalePrefix(getPostPath(post), localePath, usePrefix));
}

export function getPostUrl(post: CollectionEntry<"posts">): string;
export function getPostUrl(post: PostUrlSource): string;
// biome-ignore lint/suspicious/noExplicitAny: overload union
export function getPostUrl(post: any): string {
	return localizedUrl(getPostPath(post));
}

export function getTagUrl(tag: string): string {
	if (!tag) {
		return localizedUrl("/archive/");
	}
	return localizedUrl(`/archive/?tag=${encodeURIComponent(tag.trim())}`);
}

export function getCategoryUrl(category: string | null): string {
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() === i18n(I18nKey.uncategorized).toLowerCase()
	) {
		return localizedUrl("/archive/?uncategorized=true");
	}
	return localizedUrl(
		`/archive/?category=${encodeURIComponent(category.trim())}`,
	);
}

export function getDir(path: string): string {
	// 移除文件扩展名
	const pathWithoutExt = removeFileExtension(path);
	const lastSlashIndex = pathWithoutExt.lastIndexOf("/");
	if (lastSlashIndex < 0) {
		return "/";
	}
	return pathWithoutExt.substring(0, lastSlashIndex + 1);
}

export function getFileDirFromPath(filePath: string): string {
	return filePath.replace(/^src\//, "").replace(/\/[^/]+$/, "");
}

export function url(path: string) {
	return joinUrl("", import.meta.env.BASE_URL, path);
}

export function localizedUrl(path: string) {
	const context = getCurrentLocaleContext();
	return url(
		withLocalePrefix(path, getCurrentLocalePath(), context.hasLocalePrefix),
	);
}

/**
 * 生成当前语言的规范 URL：默认语言不带前缀，其余语言保留前缀。
 * 仅用于没有默认语言镜像路由的页面，避免从 /cn/* 页面链接到重复地址。
 */
export function canonicalLocalizedUrl(path: string) {
	const localePath = getCurrentLocalePath();
	return url(
		withLocalePrefix(
			path,
			localePath,
			localePath !== getDefaultLocaleInfo().path,
		),
	);
}
