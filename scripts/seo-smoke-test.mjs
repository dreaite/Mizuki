import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "node-html-parser";

const ROOT = process.cwd();
const EXPECTED_ORIGIN =
	process.env.SEO_SMOKE_ORIGIN || "https://dreaife.tokyo";
const BEGIN_REDIRECTS = "# BEGIN generated SEO redirects";
const END_REDIRECTS = "# END generated SEO redirects";
const REQUIRED_ABOUT_ALTERNATES = new Map([
	["zh-CN", "/about/"],
	["en", "/en/about/"],
	["ja", "/jp/about/"],
	["x-default", "/about/"],
]);
const REQUIRED_SITEMAP_ABOUT_ALTERNATES = new Map(
	[...REQUIRED_ABOUT_ALTERNATES].filter(([language]) => language !== "x-default"),
);

function parseArgs() {
	const distIndex = process.argv.indexOf("--dist");
	if (distIndex >= 0 && !process.argv[distIndex + 1]) {
		throw new Error("--dist requires a directory");
	}

	return {
		distDir: path.resolve(
			ROOT,
			distIndex >= 0 ? process.argv[distIndex + 1] : "dist",
		),
	};
}

const { distDir: DIST_DIR } = parseArgs();
const failures = [];
let assertionCount = 0;

function verify(condition, message) {
	assertionCount += 1;
	if (!condition) {
		failures.push(message);
	}
	return condition;
}

function readArtifact(relativePath) {
	const filePath = path.join(DIST_DIR, relativePath);
	if (!verify(existsSync(filePath), `Missing build artifact: ${relativePath}`)) {
		return "";
	}
	return readFileSync(filePath, "utf8");
}

function decodeXmlText(value) {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function extractLocs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
		decodeXmlText(match[1].trim()),
	);
}

function hasWellFormedXmlTags(xml) {
	const withoutDeclarations = xml
		.replace(/<\?[\s\S]*?\?>/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
	const tagPattern =
		/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)(?:\s+[^<>]*?)?\s*(\/?)>/g;
	const stack = [];
	let rootCount = 0;
	let documentRoot = "";

	const remaining = withoutDeclarations.replace(
		tagPattern,
		(_tag, closing, name, selfClosing) => {
			if (closing) {
				if (selfClosing || stack.pop() !== name) {
					rootCount = Number.POSITIVE_INFINITY;
				}
			} else if (!selfClosing) {
				if (stack.length === 0) {
					rootCount += 1;
					documentRoot ||= name;
				}
				stack.push(name);
			} else if (stack.length === 0) {
				rootCount += 1;
				documentRoot ||= name;
			}
			return "";
		},
	);

	return {
		documentRoot,
		valid:
			rootCount === 1 &&
			stack.length === 0 &&
			!remaining.includes("<") &&
			!remaining.includes(">"),
	};
}

function parseXmlAttributes(tag) {
	const attributes = new Map();
	for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) {
		attributes.set(match[1], decodeXmlText(match[2]));
	}
	return attributes;
}

function verifySitemapXml(xml, rootName, label) {
	verify(
		xml.startsWith('<?xml version="1.0"'),
		`${label} must start with an XML declaration`,
	);
	const structure = hasWellFormedXmlTags(xml);
	verify(structure.valid, `${label} must be well-formed XML`);
	verify(
		structure.documentRoot === rootName,
		`${label} document root must be ${rootName}`,
	);

	const rootTag = xml.match(new RegExp(`<${rootName}\\b[^>]*>`))?.[0];
	verify(!!rootTag, `${label} must contain a ${rootName} root`);
	if (rootTag) {
		const attributes = parseXmlAttributes(rootTag);
		verify(
			attributes.get("xmlns") ===
				"http://www.sitemaps.org/schemas/sitemap/0.9",
			`${label} must use the sitemap XML namespace`,
		);
		if (xml.includes("<xhtml:link")) {
			verify(
				attributes.get("xmlns:xhtml") ===
					"http://www.w3.org/1999/xhtml",
				`${label} must declare the xhtml namespace for hreflang links`,
			);
		}
	}
}

function extractSitemapEntries(xml) {
	const entries = [];
	for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
		const body = match[1];
		const loc = body.match(/<loc>([^<]+)<\/loc>/)?.[1];
		if (!loc) {
			continue;
		}

		const alternates = new Map();
		for (const link of body.matchAll(/<xhtml:link\b[^>]*\/?>/g)) {
			const attributes = parseXmlAttributes(link[0]);
			if (
				attributes.get("rel") === "alternate" &&
				attributes.has("hreflang") &&
				attributes.has("href")
			) {
				alternates.set(
					attributes.get("hreflang"),
					attributes.get("href"),
				);
			}
		}

		entries.push({
			href: decodeXmlText(loc.trim()),
			alternates,
		});
	}
	return entries;
}

function toAbsoluteUrl(value, base, context) {
	try {
		return new URL(value, base);
	} catch {
		verify(false, `${context} is not a valid URL: ${value}`);
		return null;
	}
}

function elementsByAttribute(root, tagName, attribute, expectedValue) {
	return root.querySelectorAll(tagName).filter((element) => {
		const value = element.getAttribute(attribute);
		return value?.toLowerCase() === expectedValue.toLowerCase();
	});
}

function linkElements(root, rel) {
	return root.querySelectorAll("link").filter((element) =>
		(element.getAttribute("rel") || "")
			.toLowerCase()
			.split(/\s+/)
			.includes(rel.toLowerCase()),
	);
}

function metaContents(root, attribute, expectedValue) {
	return elementsByAttribute(
		root,
		"meta",
		attribute,
		expectedValue,
	).map((element) => element.getAttribute("content") || "");
}

function canonicalHrefs(root) {
	return linkElements(root, "canonical").map(
		(element) => element.getAttribute("href") || "",
	);
}

function hreflangMap(root, context) {
	const alternates = new Map();
	for (const element of linkElements(root, "alternate")) {
		const language = element.getAttribute("hreflang");
		if (!language) {
			continue;
		}
		const href = element.getAttribute("href") || "";
		verify(
			!alternates.has(language),
			`${context} has duplicate hreflang=${language}`,
		);
		alternates.set(language, href);
	}
	return alternates;
}

function hreflangCount(root) {
	return linkElements(root, "alternate").filter((element) =>
		element.hasAttribute("hreflang"),
	).length;
}

function robotsMetaContents(root) {
	return metaContents(root, "name", "robots");
}

function containsDirective(contents, directive) {
	return contents.some((content) =>
		content
			.toLowerCase()
			.split(",")
			.map((part) => part.trim().split(/\s+/, 1)[0])
			.includes(directive),
	);
}

function urlToHtmlPath(url) {
	let pathname;
	try {
		pathname = decodeURIComponent(url.pathname);
	} catch {
		verify(false, `Sitemap URL has invalid path encoding: ${url.href}`);
		return null;
	}

	verify(
		pathname === "/" || pathname.endsWith("/"),
		`Sitemap URL must use a trailing slash: ${url.href}`,
	);
	const relativePath = pathname.replace(/^\/+|\/+$/g, "");
	const filePath = path.resolve(DIST_DIR, relativePath, "index.html");
	const allowedPrefix = `${DIST_DIR}${path.sep}`;
	if (
		!verify(
			filePath === path.join(DIST_DIR, "index.html") ||
				filePath.startsWith(allowedPrefix),
			`Sitemap URL escapes the build directory: ${url.href}`,
		)
	) {
		return null;
	}
	return filePath;
}

function readSitemapPage(url) {
	const filePath = urlToHtmlPath(url);
	if (
		!filePath ||
		!verify(
			existsSync(filePath),
			`Sitemap URL has no built HTML page: ${url.href}`,
		)
	) {
		return null;
	}

	const html = readFileSync(filePath, "utf8");
	const root = parse(html);
	const head = root.querySelector("head");
	verify(!!head, `${url.pathname} must contain a head element`);
	return {
		url,
		filePath,
		html,
		root,
		head: head || parse(""),
	};
}

function parseRedirectRules(source) {
	return source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.flatMap((line) => {
			const [from, to, status = "302"] = line.split(/\s+/);
			return from && to ? [{ from, to, status, line }] : [];
		});
}

function compileRedirectSource(source) {
	let pattern = "^";
	const captures = [];

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === "*") {
			pattern += "(.*)";
			captures.push("splat");
			continue;
		}
		if (character === ":") {
			const name = source
				.slice(index + 1)
				.match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0];
			if (name) {
				pattern += "([^/]+)";
				captures.push(name);
				index += name.length;
				continue;
			}
		}
		pattern += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	return { regex: new RegExp(`${pattern}$`), captures };
}

function matchRedirect(rule, pathname) {
	const { regex, captures } = compileRedirectSource(rule.from);
	const match = pathname.match(regex);
	if (!match) {
		return null;
	}

	const values = new Map();
	captures.forEach((name, index) => values.set(name, match[index + 1]));
	return values;
}

function isRedirectStatus(status) {
	return /^(?:301|302|303|307|308)!?$/.test(status);
}

function resolveRedirect(rules, pathname) {
	for (const rule of rules) {
		if (!isRedirectStatus(rule.status)) {
			continue;
		}
		const captures = matchRedirect(rule, pathname);
		if (!captures) {
			continue;
		}

		let destination = rule.to;
		for (const [name, value] of captures) {
			destination = destination.replaceAll(`:${name}`, value);
		}
		return { rule, destination };
	}
	return null;
}

function headerBlock(source, route) {
	const lines = source.split(/\r?\n/);
	const start = lines.findIndex((line) => line === route);
	if (start < 0) {
		return [];
	}

	const block = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line.trim()) {
			break;
		}
		if (!/^\s/.test(line)) {
			break;
		}
		block.push(line.trim());
	}
	return block;
}

function parseRobotsGroups(source) {
	const groups = [];
	let userAgents = [];
	let rules = [];

	const flush = () => {
		if (userAgents.length > 0) {
			groups.push({ userAgents, rules });
		}
		userAgents = [];
		rules = [];
	};

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) {
			continue;
		}

		const separator = line.indexOf(":");
		if (separator < 0) {
			continue;
		}
		const directive = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (directive === "user-agent") {
			if (rules.length > 0) {
				flush();
			}
			userAgents.push(value.toLowerCase());
		} else if (userAgents.length > 0) {
			rules.push({ directive, value });
		}
	}
	flush();
	return groups;
}

function verifySelfCanonical(page, label) {
	const canonicals = canonicalHrefs(page.head);
	verify(canonicals.length === 1, `${label} must have exactly one canonical`);
	if (canonicals.length === 1) {
		verify(
			canonicals[0].startsWith("https://"),
			`${label} canonical must be an absolute HTTPS URL`,
		);
		const canonical = toAbsoluteUrl(canonicals[0], page.url, `${label} canonical`);
		verify(
			canonical?.href === page.url.href,
			`${label} canonical must be self-referencing ` +
				`(expected ${page.url.href}, found ${canonical?.href || canonicals[0]})`,
		);
	}
}

function verifyAlternateMap(page, expected, label) {
	const actual = hreflangMap(page.head, label);
	verify(
		actual.size === expected.size,
		`${label} must expose exactly ${expected.size} hreflang links`,
	);

	for (const [language, pathname] of expected) {
		const expectedHref = new URL(pathname, `${EXPECTED_ORIGIN}/`).href;
		const actualHref = actual.get(language);
		verify(
			!!actualHref?.startsWith("https://"),
			`${label} hreflang=${language} must be an absolute HTTPS URL`,
		);
		const normalized = actualHref
			? toAbsoluteUrl(actualHref, page.url, `${label} hreflang=${language}`)
			: null;
		verify(
			normalized?.href === expectedHref,
			`${label} hreflang=${language} must point to ${expectedHref}`,
		);
	}
	return actual;
}

function main() {
	const sitemapIndex = readArtifact("sitemap-index.xml");
	verifySitemapXml(sitemapIndex, "sitemapindex", "sitemap-index.xml");

	const sitemapReferences = extractLocs(sitemapIndex);
	verify(
		sitemapReferences.length > 0,
		"sitemap-index.xml must reference at least one child sitemap",
	);

	const sitemapEntries = [];
	for (const reference of sitemapReferences) {
		verify(
			reference.startsWith("https://"),
			`Child sitemap location must be an absolute HTTPS URL: ${reference}`,
		);
		const sitemapUrl = toAbsoluteUrl(
			reference,
			`${EXPECTED_ORIGIN}/`,
			"Sitemap index location",
		);
		if (!sitemapUrl) {
			continue;
		}
		verify(
			sitemapUrl.origin === EXPECTED_ORIGIN,
			`Child sitemap must use ${EXPECTED_ORIGIN}: ${sitemapUrl.href}`,
		);
		verify(
			/^\/sitemap-\d+\.xml$/.test(sitemapUrl.pathname),
			`Unexpected child sitemap path: ${sitemapUrl.pathname}`,
		);

		const relativePath = sitemapUrl.pathname.replace(/^\/+/, "");
		const childSitemap = readArtifact(relativePath);
		verifySitemapXml(childSitemap, "urlset", relativePath);
		const childEntries = extractSitemapEntries(childSitemap);
		verify(
			childEntries.length === extractLocs(childSitemap).length,
			`${relativePath} must wrap every location in a complete URL entry`,
		);
		verify(
			childEntries.length > 0,
			`${relativePath} must contain at least one URL`,
		);
		sitemapEntries.push(...childEntries);
	}

	const sitemapUrls = [];
	const sitemapHrefSet = new Set();
	const sitemapEntryByHref = new Map();
	for (const entry of sitemapEntries) {
		verify(
			entry.href.startsWith("https://"),
			`Sitemap page location must be an absolute HTTPS URL: ${entry.href}`,
		);
		const url = toAbsoluteUrl(
			entry.href,
			`${EXPECTED_ORIGIN}/`,
			"Sitemap page location",
		);
		if (!url) {
			continue;
		}

		verify(
			url.origin === EXPECTED_ORIGIN,
			`Sitemap page must use ${EXPECTED_ORIGIN}: ${url.href}`,
		);
		verify(!url.search, `Sitemap page must not contain a query: ${url.href}`);
		verify(!url.hash, `Sitemap page must not contain a fragment: ${url.href}`);
		verify(
			url.pathname !== "/cn/" && !url.pathname.startsWith("/cn/"),
			`Default-locale mirror must not appear in sitemap: ${url.href}`,
		);
		verify(
			!url.pathname.startsWith("/api/") &&
				!/^\/(?:cn|en|jp)\/api\//.test(url.pathname),
			`API route must not appear in sitemap: ${url.href}`,
		);
		verify(
			!["/404/", "/404.html", "/rss.xml", "/atom.xml"].includes(url.pathname),
			`Non-index page must not appear in sitemap: ${url.href}`,
		);
		verify(
			!sitemapHrefSet.has(url.href),
			`Duplicate sitemap URL: ${url.href}`,
		);

		sitemapHrefSet.add(url.href);
		sitemapUrls.push(url);
		sitemapEntryByHref.set(url.href, entry);
	}
	verify(sitemapUrls.length > 0, "Sitemap must contain at least one page URL");

	const robots = readArtifact("robots.txt");
	const robotsLines = robots
		.split(/\r?\n/)
		.map((line) => line.replace(/#.*$/, "").trim())
		.filter(Boolean);
	for (const line of [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/",
		"Disallow: /cn/api/",
		"Disallow: /en/api/",
		"Disallow: /jp/api/",
		"Disallow: /cdn-cgi/",
		`Sitemap: ${EXPECTED_ORIGIN}/sitemap-index.xml`,
	]) {
		verify(robotsLines.includes(line), `robots.txt is missing: ${line}`);
	}
	const wildcardRobotsGroups = parseRobotsGroups(robots).filter((group) =>
		group.userAgents.includes("*"),
	);
	verify(
		wildcardRobotsGroups.length > 0,
		"robots.txt must define a wildcard user-agent group",
	);
	const blocksEntireSite = wildcardRobotsGroups.some((group) =>
		group.rules.some(
			(rule) =>
				rule.directive === "disallow" &&
				(rule.value.replace(/\s+/g, "") === "/" ||
					/^\/\*+\$?$/.test(rule.value.replace(/\s+/g, ""))),
		),
	);
	verify(!blocksEntireSite, "robots.txt must not block the entire site");

	const pages = [];
	const pageByHref = new Map();
	for (const url of sitemapUrls) {
		const page = readSitemapPage(url);
		if (!page) {
			continue;
		}
		pages.push(page);
		pageByHref.set(url.href, page);
		verifySelfCanonical(page, url.pathname);

		const robotsMeta = robotsMetaContents(page.head);
		verify(
			robotsMeta.length === 1,
			`${url.pathname} must have exactly one robots meta tag`,
		);
		verify(
			!containsDirective(robotsMeta, "noindex"),
			`Sitemap page must not be noindex: ${url.href}`,
		);

		const crawlableArchiveFilters = page.root
			.querySelectorAll("a")
			.map((anchor) => anchor.getAttribute("href") || "")
			.filter((href) =>
				/\/archive\/\?(?:tag|category|uncategorized)=/i.test(href),
			);
		verify(
			crawlableArchiveFilters.length === 0,
			`${url.pathname} emits a crawlable archive filter URL: ${crawlableArchiveFilters[0]}`,
		);
	}

	const articleCandidates = pages
		.filter((page) =>
			metaContents(page.head, "property", "og:type").some(
				(value) => value.toLowerCase() === "article",
			),
		)
		.filter(
			(page) => !/^\/(?:cn|en|jp)(?:\/|$)/.test(page.url.pathname),
		)
		.sort((left, right) => {
			const alternateDifference =
				hreflangCount(right.head) - hreflangCount(left.head);
			return (
				alternateDifference ||
				left.url.pathname.localeCompare(right.url.pathname)
			);
		});
	const representativeArticle = articleCandidates[0];
	verify(
		!!representativeArticle,
		"Sitemap must contain a default-language article",
	);
	if (representativeArticle) {
		verifySelfCanonical(
			representativeArticle,
			`Representative article ${representativeArticle.url.pathname}`,
		);
		for (const [attribute, property] of [
			["Open Graph", "og:url"],
			["Twitter", "twitter:url"],
		]) {
			const values = metaContents(
				representativeArticle.head,
				"property",
				property,
			);
			verify(
				values.length === 1,
				`Representative article must have exactly one ${attribute} URL`,
			);
			const value = values[0]
				? toAbsoluteUrl(
						values[0],
						representativeArticle.url,
						`Representative article ${attribute} URL`,
					)
				: null;
			verify(
				value?.href === representativeArticle.url.href,
				`Representative article ${attribute} URL must match its canonical`,
			);
		}

		const articleAlternates = hreflangMap(
			representativeArticle.head,
			`Representative article ${representativeArticle.url.pathname}`,
		);
		verify(
			articleAlternates.has("zh-CN") &&
				articleAlternates.has("x-default") &&
				(articleAlternates.has("en") || articleAlternates.has("ja")),
			"Representative article must expose default, x-default, and at least one translated hreflang",
		);
		verify(
			articleAlternates.get("x-default") ===
				articleAlternates.get("zh-CN"),
			"Representative article x-default must point to its zh-CN version",
		);
		if (articleAlternates.size > 0) {
			for (const [language, href] of articleAlternates) {
				const alternateUrl = toAbsoluteUrl(
					href,
					representativeArticle.url,
					`Representative article hreflang=${language}`,
				);
				if (!alternateUrl) {
					continue;
				}
				verify(
					sitemapHrefSet.has(alternateUrl.href),
					`Representative article hreflang=${language} target must be in sitemap`,
				);
				const alternatePage = pageByHref.get(alternateUrl.href);
				if (!alternatePage) {
					continue;
				}
				verifySelfCanonical(
					alternatePage,
					`Representative article hreflang=${language} target`,
				);
				const reciprocal = hreflangMap(
					alternatePage.head,
					`Representative article hreflang=${language} target`,
				);
				for (const [expectedLanguage, expectedHref] of articleAlternates) {
					verify(
						reciprocal.get(expectedLanguage) === expectedHref,
						`Representative article hreflang=${language} target must ` +
							`reciprocate hreflang=${expectedLanguage}`,
					);
				}
			}
		}
	}

	for (const [language, pathname] of REQUIRED_ABOUT_ALTERNATES) {
		if (language === "x-default") {
			continue;
		}
		const href = new URL(pathname, `${EXPECTED_ORIGIN}/`).href;
		verify(sitemapHrefSet.has(href), `${pathname} must appear in sitemap`);
		const page = pageByHref.get(href);
		if (!page) {
			continue;
		}
		verifySelfCanonical(page, `${pathname} multilingual fixture`);
		verifyAlternateMap(
			page,
			REQUIRED_ABOUT_ALTERNATES,
			`${pathname} multilingual fixture`,
		);

		const sitemapEntry = sitemapEntryByHref.get(href);
		if (!sitemapEntry) {
			continue;
		}
		verify(
			sitemapEntry.alternates.size ===
				REQUIRED_SITEMAP_ABOUT_ALTERNATES.size,
			`${pathname} sitemap entry must expose all locale alternates`,
		);
		for (const [alternateLanguage, alternatePathname] of REQUIRED_SITEMAP_ABOUT_ALTERNATES) {
			const expectedHref = new URL(
				alternatePathname,
				`${EXPECTED_ORIGIN}/`,
			).href;
			verify(
				sitemapEntry.alternates.get(alternateLanguage) === expectedHref,
				`${pathname} sitemap hreflang=${alternateLanguage} must point to ${expectedHref}`,
			);
		}
	}

	const redirects = readArtifact("_redirects");
	const allRedirectRules = parseRedirectRules(redirects);
	const beginIndex = redirects.indexOf(BEGIN_REDIRECTS);
	const endIndex = redirects.indexOf(END_REDIRECTS);
	verify(beginIndex >= 0, `_redirects is missing ${BEGIN_REDIRECTS}`);
	verify(
		endIndex > beginIndex,
		`_redirects is missing ${END_REDIRECTS}`,
	);
	const generatedRedirects =
		beginIndex >= 0 && endIndex > beginIndex
			? parseRedirectRules(
					redirects.slice(beginIndex + BEGIN_REDIRECTS.length, endIndex),
				)
			: [];
	verify(
		generatedRedirects.length > 0,
		"_redirects must contain generated SEO rules",
	);
	verify(
		generatedRedirects.every((rule) => rule.status === "301"),
		"Every generated SEO redirect must use status 301",
	);

	for (const [from, to] of [
		["/cn", "/"],
		["/cn/", "/"],
		["/cn/*", "/:splat"],
	]) {
		verify(
			generatedRedirects.some(
				(rule) =>
					rule.from === from && rule.to === to && rule.status === "301",
			),
			`Missing default-locale redirect: ${from} ${to} 301`,
		);
	}

	for (const url of sitemapUrls) {
		const conflict = allRedirectRules.find(
			(rule) =>
				isRedirectStatus(rule.status) &&
				matchRedirect(rule, url.pathname) !== null,
		);
		verify(
			!conflict,
			`Redirect shadows sitemap URL ${url.pathname}: ${conflict?.line}`,
		);
	}

	const aboutRedirect = resolveRedirect(allRedirectRules, "/cn/about/");
	verify(
		aboutRedirect?.rule.status === "301" &&
			new URL(aboutRedirect.destination, `${EXPECTED_ORIGIN}/`).pathname ===
				"/about/",
		"/cn/about/ must redirect to /about/ with status 301",
	);

	if (representativeArticle) {
		const legacyPath = `/cn${representativeArticle.url.pathname}`;
		const articleRedirect = resolveRedirect(allRedirectRules, legacyPath);
		verify(
			articleRedirect?.rule.status === "301" &&
				new URL(
					articleRedirect.destination,
					`${EXPECTED_ORIGIN}/`,
				).pathname === representativeArticle.url.pathname,
			`${legacyPath} must redirect to ${representativeArticle.url.pathname} with status 301`,
		);
	}

	const exactLegacyArticleRedirect = generatedRedirects.find((rule) => {
		if (
			!rule.from.startsWith("/posts/") &&
			!rule.from.startsWith("/cn/posts/")
		) {
			return false;
		}
		if (/[*:]/.test(rule.from) || rule.status !== "301") {
			return false;
		}
		const destination = toAbsoluteUrl(
			rule.to,
			`${EXPECTED_ORIGIN}/`,
			`Legacy redirect destination for ${rule.from}`,
		);
		return (
			destination &&
			sitemapHrefSet.has(destination.href) &&
			!sitemapHrefSet.has(new URL(rule.from, `${EXPECTED_ORIGIN}/`).href)
		);
	});
	verify(
		!!exactLegacyArticleRedirect,
		"Generated redirects must include an exact legacy article URL targeting a sitemap canonical",
	);

	const notFoundHtml = readArtifact("404.html");
	const notFoundRoot = parse(notFoundHtml);
	const notFoundHead = notFoundRoot.querySelector("head") || parse("");
	verify(
		!!notFoundRoot.querySelector("head"),
		"404 page must contain a head element",
	);
	const notFoundRobots = robotsMetaContents(notFoundHead);
	verify(
		containsDirective(notFoundRobots, "noindex"),
		"404 page must contain a noindex directive",
	);
	verify(
		containsDirective(notFoundRobots, "follow"),
		"404 page must contain a follow directive",
	);
	verify(
		canonicalHrefs(notFoundHead).length === 0,
		"404 page must not emit a canonical",
	);
	verify(
		hreflangMap(notFoundHead, "404 page").size === 0,
		"404 page must not emit hreflang links",
	);
	verify(
		metaContents(notFoundHead, "property", "og:url").length === 0,
		"404 page must not emit og:url",
	);
	verify(
		metaContents(notFoundHead, "property", "twitter:url").length === 0,
		"404 page must not emit twitter:url",
	);
	verify(
		![...sitemapHrefSet].some((href) =>
			["/404/", "/404.html"].includes(new URL(href).pathname),
		),
		"404 page must not appear in sitemap",
	);

	const headers = readArtifact("_headers");
	for (const route of ["/rss.xml", "/atom.xml"]) {
		const block = headerBlock(headers, route);
		verify(block.length > 0, `_headers is missing a ${route} block`);
		const robotsHeader = block.find((line) =>
			line.toLowerCase().startsWith("x-robots-tag:"),
		);
		const robotsHeaderDirectives = (robotsHeader || "")
			.slice((robotsHeader || "").indexOf(":") + 1)
			.toLowerCase()
			.split(/[,\s]+/)
			.filter(Boolean);
		verify(
			!!robotsHeader &&
				robotsHeaderDirectives.includes("noindex") &&
				robotsHeaderDirectives.includes("follow"),
			`${route} must use X-Robots-Tag: noindex, follow`,
		);
		verify(
			!sitemapHrefSet.has(new URL(route, `${EXPECTED_ORIGIN}/`).href),
			`${route} must not appear in sitemap`,
		);
	}

	if (failures.length > 0) {
		console.error(
			`SEO smoke test failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`,
		);
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log(
		`SEO smoke test passed (${assertionCount} assertions, ${sitemapUrls.length} sitemap URLs).`,
	);
	console.log(
		`Representative article: ${representativeArticle?.url.pathname || "none"}`,
	);
	console.log("Multilingual fixture: /about/ (zh-CN, en, ja, x-default)");
}

try {
	main();
} catch (error) {
	console.error(
		`SEO smoke test crashed: ${error instanceof Error ? error.stack : error}`,
	);
	process.exitCode = 1;
}
