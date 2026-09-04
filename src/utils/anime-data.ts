import fs from "node:fs";
import path from "node:path";

import localAnimeList from "../data/anime";
import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";

export interface RawAnimeItem {
	title?: string;
	cover?: string;
	link?: string;
	status?: string;
	rating?: number | string;
	progress?: number | string;
	totalEpisodes?: number | string;
	description?: string;
	year?: string;
	studio?: string;
	genre?: string[];
}

export interface AnimeItem {
	title: string;
	cover: string;
	link: string;
	status: string;
	// 个人评分；0 表示未评分，卡片不会显示评分徽标。
	rating: number;
	progress: number;
	totalEpisodes: number;
	description: string;
	year: string;
	studio: string;
	genre: string[];
}

export type AnimeStatus =
	| "watching"
	| "completed"
	| "planned"
	| "onhold"
	| "dropped";

export type AnimeStatusLabels = Partial<Record<AnimeStatus, string>>;

const localErogeModuleMap = import.meta.glob("../data/eroge.ts", {
	eager: true,
}) as Record<string, { default?: AnimeItem[] }>;
const localErogeList = Array.isArray(
	localErogeModuleMap["../data/eroge.ts"]?.default,
)
	? localErogeModuleMap["../data/eroge.ts"].default
	: [];

export type AnimeSourceConfig =
	| { type: "local"; data: AnimeItem[] }
	| {
			type: "json";
			filename: string;
			fetchOnDev?: boolean;
			emptyDescription?: string;
	  };

export function loadAnimeData(filename: string): AnimeItem[] {
	const dataPath = path.join(process.cwd(), `src/data/${filename}`);

	if (!fs.existsSync(dataPath)) {
		console.warn(`[Anime] Data file not found: ${dataPath}`);
		return [];
	}

	try {
		const fileContent = fs.readFileSync(dataPath, "utf-8");
		const rawData = JSON.parse(fileContent) as RawAnimeItem[];

		return rawData.map((item) => ({
			title: item.title || "Unknown",
			cover: item.cover || "",
			link: item.link || "",
			status: item.status || "planned",
			rating: Number(item.rating) || 0,
			progress: Number(item.progress) || 0,
			totalEpisodes: Number(item.totalEpisodes) || 12,
			description: item.description || "",
			year: item.year || "",
			studio: item.studio || "",
			genre: Array.isArray(item.genre) ? item.genre : [],
		}));
	} catch (error) {
		console.error(`[Anime] Failed to parse ${filename}:`, error);
		return [];
	}
}

export function getAnimeSourceConfigs(): Record<string, AnimeSourceConfig> {
	return {
		local: {
			type: "local",
			data: localAnimeList,
		},
		bilibili: {
			type: "json",
			filename: "bilibili-data.json",
			fetchOnDev: undefined,
			emptyDescription: i18n(I18nKey.animeEmptyBilibili),
		},
		bangumi: {
			type: "json",
			filename: "bangumi-data.json",
			fetchOnDev: undefined,
			emptyDescription: i18n(I18nKey.animeEmptyBangumi),
		},
	};
}

export function getErogeSourceConfigs(): Record<string, AnimeSourceConfig> {
	return {
		local: {
			type: "local",
			data: localErogeList,
		},
		bangumi: {
			type: "json",
			filename: "eroge-bangumi-data.json",
			fetchOnDev: undefined,
			emptyDescription: "请检查 Bangumi 配置、权限 Token 或网络连接",
		},
	};
}

export function getAnimeList(
	mode: string,
	sourceConfigs: Record<string, AnimeSourceConfig>,
): { animeList: AnimeItem[]; currentConfig: AnimeSourceConfig | undefined } {
	let animeList: AnimeItem[] = [];
	const currentConfig = sourceConfigs[mode];

	if (currentConfig) {
		if (currentConfig.type === "local") {
			animeList = currentConfig.data;
		} else if (currentConfig.type === "json") {
			const isDev = import.meta.env.DEV;
			const shouldFetchOnDev = currentConfig.fetchOnDev ?? false;
			const skipLoad = isDev && !shouldFetchOnDev;

			if (skipLoad) {
				console.log(`[Dev] Skipping ${mode} data load (fetchOnDev is off).`);
				animeList = [];
			} else {
				animeList = loadAnimeData(currentConfig.filename);
			}
		}
	} else {
		console.warn(`[Anime] Unknown or unconfigured mode: ${mode}`);
	}

	return { animeList, currentConfig };
}

export function getStatusMap(
	labels: AnimeStatusLabels = {},
): Record<string, { text: string; class: string; icon: string }> {
	return {
		watching: {
			text: labels.watching ?? i18n(I18nKey.animeStatusWatching),
			class:
				"bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
			icon: "▶",
		},
		completed: {
			text: labels.completed ?? i18n(I18nKey.animeStatusCompleted),
			class: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
			icon: "✓",
		},
		planned: {
			text: labels.planned ?? i18n(I18nKey.animeStatusPlanned),
			class:
				"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
			icon: "❤",
		},
		onhold: {
			text: labels.onhold ?? i18n(I18nKey.animeStatusOnHold),
			class:
				"bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
			icon: "⏸",
		},
		dropped: {
			text: labels.dropped ?? i18n(I18nKey.animeStatusDropped),
			class: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
			icon: "✗",
		},
	};
}
