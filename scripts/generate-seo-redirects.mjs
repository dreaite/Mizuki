import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "src/content/posts");
const SITE_CONFIG_PATH = path.join(ROOT, "src/config/siteConfig.ts");
const PERMALINK_CONFIG_PATH = path.join(ROOT, "src/config/permalinkConfig.ts");
const DEFAULT_OUTPUT = path.join(ROOT, "dist/_redirects");
const BEGIN_MARKER = "# BEGIN generated SEO redirects";
const END_MARKER = "# END generated SEO redirects";
const POST_EXT_RE = /\.(md|mdx|markdown)$/i;
const KNOWN_LANG_SUFFIXES = new Set([
	"en",
	"en_us",
	"en_gb",
	"en_au",
	"zh",
	"zh_cn",
	"zh_tw",
	"cn",
	"tw",
	"ja",
	"ja_jp",
	"jp",
]);

function parseArgs() {
	const outIndex = process.argv.indexOf("--out");
	return {
		outFile:
			outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT,
	};
}

function normalizeLanguageCode(raw = "") {
	const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
	const aliasMap = {
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

function parseQuotedString(source, pattern) {
	const match = source.match(pattern);
	return match?.[1]?.trim() ?? "";
}

function readSiteConfig() {
	if (!existsSync(SITE_CONFIG_PATH)) {
		return { defaultLocale: "cn", defaultLang: "zh_cn" };
	}

	const source = readFileSync(SITE_CONFIG_PATH, "utf8");
	const siteLang =
		parseQuotedString(source, /const\s+SITE_LANG\s*=\s*["']([^"']+)["']/) ||
		parseQuotedString(source, /lang\s*:\s*["']([^"']+)["']/);
	const defaultLocale = parseQuotedString(
		source,
		/defaultLocale\s*:\s*["']([^"']+)["']/,
	);

	return {
		defaultLocale: defaultLocale || "cn",
		defaultLang: normalizeLanguageCode(defaultLocale || siteLang || "zh_CN"),
	};
}

function readPermalinkConfig() {
	if (!existsSync(PERMALINK_CONFIG_PATH)) {
		return { enable: false, format: "%postname%" };
	}

	const source = readFileSync(PERMALINK_CONFIG_PATH, "utf8");
	const enableMatch = source.match(/enable\s*:\s*(true|false)/);
	const format = parseQuotedString(source, /format\s*:\s*["']([^"']+)["']/);

	return {
		enable: enableMatch?.[1] === "true",
		format: format || "%postname%",
	};
}

function walkMarkdownFiles(dir) {
	if (!existsSync(dir)) {
		return [];
	}

	const files = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = path.join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			files.push(...walkMarkdownFiles(fullPath));
		} else if (POST_EXT_RE.test(entry)) {
			files.push(fullPath);
		}
	}
	return files;
}

function extractFrontmatter(source) {
	if (!source.startsWith("---")) {
		return "";
	}

	const end = source.indexOf("\n---", 3);
	return end >= 0 ? source.slice(3, end) : "";
}

function stripInlineComment(value) {
	let quote = "";
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if ((char === '"' || char === "'") && value[i - 1] !== "\\") {
			quote = quote === char ? "" : quote || char;
		}
		if (char === "#" && !quote) {
			return value.slice(0, i).trim();
		}
	}
	return value.trim();
}

function readFrontmatterValue(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
	if (!match) {
		return "";
	}

	let value = stripInlineComment(match[1] ?? "");
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value.trim();
}

function normalizeSlug(value) {
	const slug = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
	return slug || "";
}

function normalizeAlias(value) {
	let alias = normalizeSlug(value);
	if (alias.startsWith("posts/")) {
		alias = alias.replace(/^posts\//, "");
	}
	return alias;
}

function splitPathAndBase(pathWithoutExt) {
	const lastSlashIndex = pathWithoutExt.lastIndexOf("/");
	if (lastSlashIndex < 0) {
		return { dir: "", base: pathWithoutExt };
	}
	return {
		dir: pathWithoutExt.slice(0, lastSlashIndex + 1),
		base: pathWithoutExt.slice(lastSlashIndex + 1),
	};
}

function getPostVariantInfo(relativePath, frontmatterLang) {
	const idWithoutExt = relativePath.replace(POST_EXT_RE, "").replace(/\\/g, "/");
	const { dir, base } = splitPathAndBase(idWithoutExt);
	let canonicalBase = base;
	let fileSuffixLang = "";

	const dotIndex = base.lastIndexOf(".");
	if (dotIndex > 0) {
		const maybeLang = base.slice(dotIndex + 1);
		if (KNOWN_LANG_SUFFIXES.has(normalizeLanguageCode(maybeLang))) {
			fileSuffixLang = normalizeLanguageCode(maybeLang);
			canonicalBase = base.slice(0, dotIndex);
		}
	}

	return {
		canonicalSlug: `${dir}${canonicalBase}`,
		rawPostname: base,
		variantLang: fileSuffixLang || normalizeLanguageCode(frontmatterLang),
	};
}

function isDefaultLanguagePost(variantLang, defaultLang) {
	return !variantLang || normalizeLanguageCode(variantLang) === defaultLang;
}

function parsePost(filePath, defaultLang) {
	const source = readFileSync(filePath, "utf8");
	const frontmatter = extractFrontmatter(source);
	const relativePath = path.relative(POSTS_DIR, filePath).replace(/\\/g, "/");
	const { canonicalSlug, rawPostname, variantLang } = getPostVariantInfo(
		relativePath,
		readFrontmatterValue(frontmatter, "lang"),
	);
	const draft = readFrontmatterValue(frontmatter, "draft").toLowerCase() === "true";

	if (draft || !isDefaultLanguagePost(variantLang, defaultLang)) {
		return null;
	}

	return {
		filePath,
		canonicalSlug,
		rawPostname,
		permalink: normalizeSlug(readFrontmatterValue(frontmatter, "permalink")),
		alias: normalizeAlias(readFrontmatterValue(frontmatter, "alias")),
		category: readFrontmatterValue(frontmatter, "category") || "uncategorized",
		published: new Date(readFrontmatterValue(frontmatter, "published") || 0),
	};
}

function pad2(value) {
	return String(value).padStart(2, "0");
}

function generatePermalink(post, permalinkConfig, postNumericId) {
	if (post.permalink) {
		return post.permalink;
	}

	if (!permalinkConfig.enable) {
		return "";
	}

	const published = Number.isNaN(post.published.getTime())
		? new Date(0)
		: post.published;
	return normalizeSlug(
		permalinkConfig.format
			.replace(/%year%/g, String(published.getFullYear()))
			.replace(/%monthnum%/g, pad2(published.getMonth() + 1))
			.replace(/%day%/g, pad2(published.getDate()))
			.replace(/%hour%/g, pad2(published.getHours()))
			.replace(/%minute%/g, pad2(published.getMinutes()))
			.replace(/%second%/g, pad2(published.getSeconds()))
			.replace(/%post_id%/g, String(postNumericId))
			.replace(/%postname%/g, post.canonicalSlug)
			.replace(/%raw_postname%/g, post.rawPostname)
			.replace(/%category%/g, post.category),
	);
}

function withTrailingSlash(pathname) {
	return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function addRedirect(rules, source, destination) {
	if (!source || !destination || source === destination) {
		return;
	}
	rules.set(source, `${source} ${destination} 301`);
}

function generateRules() {
	const { defaultLocale, defaultLang } = readSiteConfig();
	const permalinkConfig = readPermalinkConfig();
	const posts = walkMarkdownFiles(POSTS_DIR)
		.map((filePath) => parsePost(filePath, defaultLang))
		.filter(Boolean);
	const sortedPosts = [...posts].sort(
		(a, b) => a.published.getTime() - b.published.getTime(),
	);
	const postIds = new Map(
		sortedPosts.map((post, index) => [post.filePath, index + 1]),
	);
	const exactRules = new Map();

	for (const post of posts) {
		const permalink = generatePermalink(
			post,
			permalinkConfig,
			postIds.get(post.filePath) ?? 0,
		);
		if (!permalink) {
			continue;
		}

		const destination = withTrailingSlash(`/${permalink}`);
		const sourceSlugs = new Set([post.canonicalSlug]);
		if (post.alias) {
			sourceSlugs.add(post.alias);
		}

		for (const slug of sourceSlugs) {
			const postPath = withTrailingSlash(`/posts/${slug}`);
			addRedirect(exactRules, postPath, destination);
			addRedirect(exactRules, postPath.replace(/\/$/, ""), destination);

			if (defaultLocale) {
				const localizedPostPath = withTrailingSlash(`/${defaultLocale}${postPath}`);
				addRedirect(exactRules, localizedPostPath, destination);
				addRedirect(exactRules, localizedPostPath.replace(/\/$/, ""), destination);
			}
		}
	}

	const lines = [
		"# Generated by scripts/generate-seo-redirects.mjs.",
		"# Exact rules collapse legacy post routes before default-locale mirrors.",
		...exactRules.values(),
	];

	if (defaultLocale) {
		lines.push(
			"",
			"# Collapse default-locale mirrors to the canonical unprefixed URLs.",
			`/${defaultLocale} / 301`,
			`/${defaultLocale}/ / 301`,
			`/${defaultLocale}/* /:splat 301`,
		);
	}

	return lines;
}

function writeRedirects(outFile, generatedLines) {
	const existing = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
	const manual = existing.includes(BEGIN_MARKER)
		? existing.slice(0, existing.indexOf(BEGIN_MARKER)).trimEnd()
		: existing.trimEnd();
	const content = [
		manual,
		BEGIN_MARKER,
		...generatedLines,
		END_MARKER,
	]
		.filter(Boolean)
		.join("\n");

	mkdirSync(path.dirname(outFile), { recursive: true });
	writeFileSync(outFile, `${content}\n`);
}

const { outFile } = parseArgs();
const rules = generateRules();
writeRedirects(outFile, rules);
console.log(
	`Generated ${rules.filter((line) => line.includes(" 301")).length} SEO redirects at ${path.relative(ROOT, outFile)}`,
);
