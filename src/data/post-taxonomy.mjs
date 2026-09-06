// Content-owned registry. When content sync is enabled, maintain the copy in
// mizuki-content/data/post-taxonomy.mjs; it is shared by Notion sync and the site.
/** @typedef {{labels: Record<string, string>, aliases?: string[]}} TaxonomyTerm */
/** @typedef {"categories" | "tags"} TaxonomyKind */
/** @param {string} zh @param {string} en @param {string} ja @param {string[]} aliases */
const term = (zh, en, ja, aliases = []) => ({
	labels: { zh_CN: zh, en, ja },
	aliases,
});

/** @type {Record<TaxonomyKind, Record<string, TaxonomyTerm>>} */
export const postTaxonomy = {
	categories: {
		study: term("研习", "Study", "学び"),
		troubleshooting: term("踩坑", "Troubleshooting", "試行錯誤"),
		exploration: term("开荒", "Exploration", "開拓"),
		reflection: term("深思", "Reflection", "思索"),
		notes: term("整理", "Notes", "整理"),
		perspectives: term("碰撞", "Perspectives", "触発"),
	},
	tags: {
		thinking: term("思考", "Thinking", "思考"),
		"computer-science": term("计算机基础", "Computer Science", "計算機科学", [
			"cs-base",
		]),
		web3: term("Web3", "Web3", "Web3"),
		infrastructure: term("基础设施", "Infrastructure", "インフラ", ["INFRA"]),
		life: term("生活", "Life", "暮らし"),
		wallet: term("钱包", "Wallets", "ウォレット"),
		networking: term("网络", "Networking", "ネットワーク", ["network"]),
		linux: term("Linux", "Linux", "Linux"),
		docker: term("Docker", "Docker", "Docker"),
		deployment: term("部署", "Deployment", "デプロイ", ["deploy"]),
		"web-scraping": term("爬虫", "Web Scraping", "Webスクレイピング", [
			"spider",
		]),
		markets: term("市场", "Markets", "市場", ["market"]),
		recommendations: term("推荐", "Recommendations", "おすすめ", [
			"recomand",
			"recommend",
		]),
		"visual-novels": term("视觉小说", "Visual Novels", "ビジュアルノベル", [
			"gal",
			"galgame",
		]),
		shell: term("Shell", "Shell", "シェル", ["bash"]),
		typescript: term("TypeScript", "TypeScript", "TypeScript", ["ts"]),
		"github-actions": term(
			"GitHub Actions",
			"GitHub Actions",
			"GitHub Actions",
			["github-action"],
		),
		projects: term("项目", "Projects", "プロジェクト", ["PROJECT"]),
		theory: term("理论", "Theory", "理論"),
		pyspider: term("PySpider", "PySpider", "PySpider"),
		trading: term("交易", "Trading", "トレード", ["trade"]),
		school: term("校园", "Campus", "キャンパス"),
		environment: term("环境配置", "Environment Setup", "環境構築", ["环境"]),
		python: term("Python", "Python", "Python"),
		transactions: term("链上交易", "Transactions", "トランザクション", [
			"transaction",
		]),
		ai: term("人工智能", "AI", "人工知能"),
		blog: term("博客", "Blogging", "ブログ"),
		llm: term("大语言模型", "Large Language Models", "大規模言語モデル"),
		notion: term("Notion", "Notion", "Notion"),
		angular: term("Angular", "Angular", "Angular"),
		documentation: term("文档", "Documentation", "ドキュメント", ["doc"]),
		svn: term("SVN", "SVN", "SVN"),
		csapp: term("深入理解计算机系统", "CS:APP", "CS:APP", ["caapp"]),
		"operating-systems": term(
			"操作系统",
			"Operating Systems",
			"オペレーティングシステム",
			["os"],
		),
		c: term("C", "C", "C"),
		nodejs: term("Node.js", "Node.js", "Node.js"),
		aws: term("AWS", "AWS", "AWS"),
		interviews: term("面试", "Interviews", "面接", ["meeting"]),
		algorithms: term("算法", "Algorithms", "アルゴリズム", ["algorithm"]),
		vscode: term("VS Code", "VS Code", "VS Code"),
		plugins: term("插件", "Plugins", "プラグイン", ["plugin"]),
		self: term("自我", "Self", "自己"),
		"mental-health": term("心理健康", "Mental Health", "メンタルヘルス", [
			"mental",
		]),
		"self-discovery": term("自我探索", "Self-discovery", "自己探求", [
			"discover",
		]),
		psychology: term("心理学", "Psychology", "心理学", ["psycho"]),
		pandas: term("pandas", "pandas", "pandas"),
		"data-processing": term("数据处理", "Data Processing", "データ処理"),
	},
};

const normalizeAlias = (value) =>
	String(value ?? "")
		.normalize("NFKC")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase();

/**
 * Validate keys, translations and alias ownership before accepting any input.
 * @param {Record<TaxonomyKind, Record<string, TaxonomyTerm>>} registry
 * @returns {(kind: TaxonomyKind, value?: string | null, options?: {strict?: boolean}) => string}
 */
export function createTaxonomyResolver(registry) {
	const indexes = {};
	for (const kind of ["categories", "tags"]) {
		const index = new Map();
		for (const [key, entry] of Object.entries(registry[kind])) {
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
				throw new Error(`Invalid ${kind} key: ${key}`);
			}
			for (const locale of ["zh_CN", "en", "ja"]) {
				if (
					typeof entry.labels?.[locale] !== "string" ||
					!entry.labels[locale].trim()
				) {
					throw new Error(`Missing ${locale} label for ${kind}.${key}`);
				}
			}
			for (const alias of [
				key,
				...Object.values(entry.labels),
				...(entry.aliases || []),
			]) {
				const normalized = normalizeAlias(alias);
				if (!normalized) throw new Error(`Empty alias for ${kind}.${key}`);
				const owner = index.get(normalized);
				if (owner && owner !== key) {
					throw new Error(
						`Ambiguous ${kind} alias "${alias}": ${owner} / ${key}`,
					);
				}
				index.set(normalized, key);
			}
		}
		indexes[kind] = index;
	}
	return (kind, value, { strict = false } = {}) => {
		const normalized = normalizeAlias(value);
		if (!normalized) return "";
		const key = indexes[kind].get(normalized);
		if (key) return key;
		if (strict) {
			throw new Error(
				`Unknown ${kind} value "${value}". Add its key, zh_CN/en/ja labels and aliases to data/post-taxonomy.mjs.`,
			);
		}
		// Standalone theme/example content may have its own, unregistered terms.
		return String(value).trim();
	};
}

export const resolveTaxonomyKey = createTaxonomyResolver(postTaxonomy);

/**
 * @param {{category?: string | null, tags?: string[]}} meta
 * @param {{strict?: boolean}} options
 * @returns {{category: string, tags: string[]}}
 */
export function normalizePostTaxonomy(
	{ category = "", tags = [] },
	options = {},
) {
	return {
		category: resolveTaxonomyKey("categories", category, options),
		tags: [
			...new Set(
				tags
					.map((tag) => resolveTaxonomyKey("tags", tag, options))
					.filter(Boolean),
			),
		],
	};
}

/** @param {TaxonomyKind} kind @param {string | null | undefined} value @param {string} language */
export function getTaxonomyLabel(kind, value, language = "zh_CN") {
	const key = resolveTaxonomyKey(kind, value);
	const entry = Object.hasOwn(postTaxonomy[kind], key)
		? postTaxonomy[kind][key]
		: null;
	if (!entry) return key;
	const locale = normalizeAlias(language).replace(/-/g, "_");
	const labelKey = /^(en)(_|$)/.test(locale)
		? "en"
		: /^(ja|jp)(_|$)/.test(locale)
			? "ja"
			: "zh_CN";
	return entry.labels[labelKey];
}
