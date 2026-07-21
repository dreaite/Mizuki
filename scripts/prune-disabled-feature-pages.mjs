import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE_CONFIG_PATH = path.join(ROOT, "src/config/siteConfig.ts");
const LOCALE_CONFIG_PATH = path.join(ROOT, "src/i18n/locale.ts");
const FEATURE_PAGE_SLUGS = {
	anime: "anime",
	eroge: "eroge",
	diary: "diary",
	friends: "friends",
	projects: "projects",
	skills: "skills",
	timeline: "timeline",
	albums: "albums",
	gallery: "gallery",
	devices: "devices",
	aiTools: "ai-tools",
};

function parseArgs() {
	const outIndex = process.argv.indexOf("--out");
	return {
		outputDir:
			outIndex >= 0
				? path.resolve(process.argv[outIndex + 1])
				: path.join(ROOT, "dist"),
	};
}

function readDisabledFeaturePages() {
	const source = readFileSync(SITE_CONFIG_PATH, "utf8");
	const featureBlock = source.match(/featurePages\s*:\s*{([\s\S]*?)\n\s*},/);
	if (!featureBlock?.[1]) {
		throw new Error("Unable to parse featurePages from siteConfig.ts");
	}

	return Object.entries(FEATURE_PAGE_SLUGS)
		.filter(([key]) => {
			const match = featureBlock[1].match(
				new RegExp(`\\b${key}\\s*:\\s*(true|false)`),
			);
			return match?.[1] === "false";
		})
		.map(([, slug]) => slug);
}

function readLocalePaths() {
	const source = readFileSync(LOCALE_CONFIG_PATH, "utf8");
	return [
		...new Set(
			Array.from(source.matchAll(/\bpath\s*:\s*["']([^"']+)["']/g)).map(
				(match) => match[1],
			),
		),
	];
}

function pruneFeaturePage(outputDir, localePaths, slug) {
	const candidates = [
		path.join(outputDir, slug),
		...localePaths.map((localePath) => path.join(outputDir, localePath, slug)),
	];
	let removed = 0;

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		rmSync(candidate, { recursive: true, force: true });
		removed++;
	}

	return removed;
}

const { outputDir } = parseArgs();
const disabledFeaturePages = readDisabledFeaturePages();
const localePaths = readLocalePaths();
const removedCount = disabledFeaturePages.reduce(
	(total, slug) => total + pruneFeaturePage(outputDir, localePaths, slug),
	0,
);

console.log(
	`Pruned ${removedCount} disabled feature-page directories (${disabledFeaturePages.join(", ") || "none"}) from ${path.relative(ROOT, outputDir) || "."}`,
);
