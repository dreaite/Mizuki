import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import svelte, { vitePreprocess } from "@astrojs/svelte";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { oddmisc } from "oddmisc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components";
import rehypeExternalLinks from "rehype-external-links";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { siteConfig } from "./src/config/index.ts";
import { buildIconInclude } from "./src/plugins/astro-icon-include.mjs";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import { AdmonitionComponent } from "./src/plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { ImageGridComponent } from "./src/plugins/rehype-component-image-grid.mjs";
import { SiteCardComponent } from "./src/plugins/rehype-component-site-card.mjs";
import { XCardComponent } from "./src/plugins/rehype-component-x-card.mjs";
import { rehypeImageWidth } from "./src/plugins/rehype-image-width.mjs";
import { rehypeMermaid } from "./src/plugins/rehype-mermaid.mjs";
import { rehypeWrapTable } from "./src/plugins/rehype-wrap-table.mjs";
import { remarkContent } from "./src/plugins/remark-content.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkEscapeNumericColons } from "./src/plugins/remark-escape-numeric-colons.mjs";
import { remarkFixGithubAdmonitions } from "./src/plugins/remark-fix-github-admonitions.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.js";
import { remarkSiteMetadata } from "./src/plugins/remark-site-metadata.mjs";
import { remarkXMetadata } from "./src/plugins/remark-x-metadata.mjs";
import { largeContentStorePlugin } from "./src/plugins/vite-large-content-store.mjs";

const sitemapLocaleAliases = {
	cn: "zh-CN",
	en: "en",
	jp: "ja",
};
const defaultSitemapLocale = siteConfig.i18n?.defaultLocale || "cn";
const buildOutputDir = path.join(process.cwd(), "dist");
const sitemapLocalePaths = new Set(Object.keys(sitemapLocaleAliases));
const featurePageSlugs = {
	aiTools: "ai-tools",
};
const disabledFeaturePages = new Set(
	Object.entries(siteConfig.featurePages)
		.filter(([, enabled]) => enabled === false)
		.map(([key]) => featurePageSlugs[key] || key),
);

function stripSitemapLocale(pathname) {
	const segments = pathname.split("/").filter(Boolean);
	if (segments[0] && sitemapLocalePaths.has(segments[0])) {
		return `/${segments.slice(1).join("/")}${pathname.endsWith("/") ? "/" : ""}`;
	}
	return pathname;
}

function isDisabledFeaturePath(pathname) {
	const routePathname = stripSitemapLocale(pathname);
	const firstSegment = routePathname.split("/").filter(Boolean)[0];
	return !!firstSegment && disabledFeaturePages.has(firstSegment);
}

function hasBuiltIndexPage(pathname) {
	const normalizedPathname = decodeURIComponent(pathname)
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	return existsSync(
		path.join(buildOutputDir, normalizedPathname, "index.html"),
	);
}

function getBuiltCanonicalPathname(pathname) {
	const normalizedPathname = decodeURIComponent(pathname)
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	const indexPath = path.join(buildOutputDir, normalizedPathname, "index.html");
	if (!existsSync(indexPath)) return null;

	const html = readFileSync(indexPath, "utf8");
	const canonicalTag = html.match(
		/<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
	)?.[0];
	const canonicalHref = canonicalTag?.match(/\bhref=["']([^"']+)["']/i)?.[1];
	if (!canonicalHref) return null;

	return new URL(canonicalHref, siteConfig.siteURL).pathname;
}

function shouldIncludeInSitemap(page) {
	const pathname = new URL(page).pathname;
	const routePathname = stripSitemapLocale(pathname);

	if (routePathname.startsWith("/api/") || isDisabledFeaturePath(pathname)) {
		return false;
	}

	if (
		defaultSitemapLocale &&
		pathname !== `/${defaultSitemapLocale}/` &&
		pathname.startsWith(`/${defaultSitemapLocale}/`)
	) {
		return false;
	}

	const canonicalPathname = getBuiltCanonicalPathname(pathname);
	if (canonicalPathname && canonicalPathname !== pathname) {
		return false;
	}

	if (pathname.startsWith("/posts/")) {
		const permalinkPathname = pathname.replace(/^\/posts\//, "/");
		if (hasBuiltIndexPage(permalinkPathname)) {
			return false;
		}
	}

	return pathname !== `/${defaultSitemapLocale}/`;
}

// https://astro.build/config
export default defineConfig({
	fonts: [
		{
			name: "JetBrains Mono",
			cssVariable: "--font-jetbrains-mono",
			provider: fontProviders.fontsource(),
			styles: ["normal", "italic"],
		},
		{
			name: "ZenMaruGothic-Medium",
			cssVariable: "--font-body",
			provider: fontProviders.local(),
			options: {
				variants: [
					{
						src: ["./src/assets/fonts/ZenMaruGothic-Medium.ttf"],
						weight: "500",
						style: "normal",
					},
				],
			},
			// These variables are composed into --font-sans below. Keep their
			// fallback lists empty; otherwise a system fallback after this Latin
			// font prevents the following CJK font from ever being considered.
			fallbacks: [],
			optimizedFallbacks: false,
		},
		{
			name: "Loli",
			cssVariable: "--font-cjk",
			provider: fontProviders.local(),
			options: {
				variants: [
					{
						src: ["./src/assets/fonts/loli.ttf"],
						weight: "400",
						style: "normal",
					},
				],
			},
			// The final system fallback belongs to --font-sans, not this partial
			// CJK font stack.
			fallbacks: [],
			optimizedFallbacks: false,
		},
	],

	site: siteConfig.siteURL,
	base: "/",
	trailingSlash: "always",
	compressHTML: true,

	output: "static",

	image: {
		layout: "constrained",
	},

	server: {
		port: 3000,
	},

	integrations: [
		oddmisc({
			umami: {
				shareUrl: false,
			},
		}),
		swup({
			theme: false,
			animationClass: "transition-swup-",
			containers: ["main"],
			smoothScrolling: false, // 禁用平滑滚动以提升性能，避免与锚点导航冲突
			cache: true,
			preload: false, // 禁用预加载以提升性能
			accessibility: true,
			updateHead: process.env.NODE_ENV === "production",
			updateBodyClass: false,
			globalInstance: true,
			// 滚动相关配置优化
			resolveUrl: (url) => url,
			animateHistoryBrowsing: false,
			skipPopStateHandling: (event) => {
				// 跳过锚点链接的处理，让浏览器原生处理
				return event.state?.url?.includes("#");
			},
		}),
		icon({
			include: buildIconInclude(),
		}),
		expressiveCode({
			themes: ["github-light", "github-dark"],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				pluginLanguageBadge(),
				pluginCustomCopyButton(),
			],
			defaultProps: {
				wrap: true,
				overridesByLang: {
					shellsession: { showLineNumbers: false },
					bash: { frame: "code" },
					shell: { frame: "code" },
					sh: { frame: "code" },
					zsh: { frame: "code" },
				},
			},
			styleOverrides: {
				codeBackground: "var(--codeblock-bg)",
				borderRadius: "0.75rem",
				borderColor: "none",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"var(--font-jetbrains-mono), SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {
					editorBackground: "var(--codeblock-bg)",
					terminalBackground: "var(--codeblock-bg)",
					terminalTitlebarBackground: "var(--codeblock-bg)",
					editorTabBarBackground: "var(--codeblock-bg)",
					editorActiveTabBackground: "none",
					editorActiveTabIndicatorBottomColor: "var(--primary)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--codeblock-bg)",
					terminalTitlebarBorderBottomColor: "none",
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
			},
			frames: {
				showCopyToClipboardButton: false,
			},
		}),
		svelte({
			preprocess: vitePreprocess(),
		}),
		sitemap({
			filter: shouldIncludeInSitemap,
			i18n: {
				defaultLocale: defaultSitemapLocale,
				locales: sitemapLocaleAliases,
			},
		}),
		mdx(),
	],
	markdown: {
		processor: unified({
			remarkPlugins: [
				remarkMath,
				remarkContent,
				remarkFixGithubAdmonitions,
				remarkDirective,
				remarkEscapeNumericColons,
				[
					remarkSiteMetadata,
					{
						siteUrl: siteConfig.siteURL,
						defaultLocale: siteConfig.i18n?.defaultLocale,
						locales: siteConfig.i18n?.locales,
					},
				],
				remarkXMetadata,
				remarkSectionize,
				parseDirectiveNode,
				remarkMermaid,
			],
			rehypePlugins: [
				rehypeKatex,
				[
					rehypeExternalLinks,
					{
						target: "_blank",
						rel: ["nofollow", "noopener", "noreferrer"],
					},
				],
				rehypeSlug,
				rehypeWrapTable,
				rehypeMermaid,
				[
					rehypeComponents,
					{
						components: {
							github: GithubCardComponent,
							grid: ImageGridComponent,
							site: SiteCardComponent,
							x: XCardComponent,
							note: (x, y) => AdmonitionComponent(x, y, "note"),
							tip: (x, y) => AdmonitionComponent(x, y, "tip"),
							important: (x, y) => AdmonitionComponent(x, y, "important"),
							caution: (x, y) => AdmonitionComponent(x, y, "caution"),
							warning: (x, y) => AdmonitionComponent(x, y, "warning"),
						},
					},
				],
				[
					rehypeAutolinkHeadings,
					{
						behavior: "append",
						properties: {
							className: ["anchor"],
						},
						content: {
							type: "element",
							tagName: "span",
							properties: {
								className: ["anchor-icon"],
								"data-pagefind-ignore": true,
							},
							children: [{ type: "text", value: "#" }],
						},
					},
				],
				rehypeImageWidth,
			],
		}),
	},
	vite: {
		plugins: [largeContentStorePlugin(), tailwindcss()],
		// 开发环境预打包优化：将常用依赖提前编译，避免首次页面加载时 on-demand 编译导致 8s+ 的等待
		optimizeDeps: {
			include: [
				"@iconify/svelte",
				"svelte",
				"svelte/transition",
				"svelte/easing",
				"overlayscrollbars",
				"@fancyapps/ui",
				"marked",
				"sanitize-html",
				"qrcode",
			],
		},
		// 预热常用入口文件，让 Vite 在服务器启动后立即开始转换，而不是等到浏览器请求
		server: {
			warmup: {
				clientFiles: [
					"src/layouts/Layout.astro",
					"src/pages/index.astro",
					"src/components/widgets/music-player/MusicPlayer.svelte",
					"src/components/organisms/navigation/Search.svelte",
					"src/components/control/ThemeSwitch.svelte",
					"src/components/features/settings/DisplaySettings.svelte",
					"src/scripts/swup-manager.ts",
				],
			},
		},
		build: {
			// 静态资源处理优化，防止小图片转 base64 导致 HTML 体积过大
			assetsInlineLimit: 4096,
			// CSS 代码分割
			cssCodeSplit: true,
			cssMinify: "esbuild",
			// 内联小型 CSS 文件以减少网络请求
			inlineStylesheets: "auto",
			// 生产环境移除 console 和 debugger
			minify: "esbuild",
			rollupOptions: {
				onwarn(warning, warn) {
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					warn(warning);
				},
			},
		},
		// 生产环境移除 console.log 和 debugger
		esbuildOptions: {
			drop:
				process.env.NODE_ENV === "production" ? ["console", "debugger"] : [],
		},
	},
});
