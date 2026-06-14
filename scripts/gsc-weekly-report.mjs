import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const SEARCH_CONSOLE_SCOPE =
	"https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const API_BASE = "https://www.googleapis.com/webmasters/v3";
const DEFAULT_REPORT_DIR = path.join(rootDir, "output/gsc");
const DEFAULT_TOKEN_FILE = path.join(DEFAULT_REPORT_DIR, "token.json");
const DEFAULT_CLIENT_FILE = path.join(DEFAULT_REPORT_DIR, "oauth-client.json");
const DEFAULT_CALLBACK_PATH = "/oauth2callback";

loadEnv();
await loadEnvFile(path.join(rootDir, ".env.local"));

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		printHelp();
		return;
	}

	const config = await getConfig(args);

	if (args.auth) {
		await authenticate(config);
		return;
	}

	const token = await getAccessToken(config);
	const currentPeriod = getCurrentPeriod(config);
	const previousPeriod = getPreviousPeriod(currentPeriod);

	console.log(
		`Fetching GSC data for ${config.siteUrl} (${currentPeriod.startDate}..${currentPeriod.endDate})`,
	);

	const data = await fetchReportData(token, config.siteUrl, {
		current: currentPeriod,
		previous: previousPeriod,
		rowLimit: config.rowLimit,
	});

	const weekLabel = getIsoWeekLabel(currentPeriod.endDate);
	const rawPath = path.join(config.reportDir, "raw", `${weekLabel}.json`);
	const reportPath = path.join(config.reportDir, `${weekLabel}.md`);
	const latestPath = path.join(config.reportDir, "latest.md");
	const generatedAt = new Date().toISOString();

	const report = buildMarkdownReport({
		data,
		config,
		currentPeriod,
		previousPeriod,
		weekLabel,
		generatedAt,
		rawPath,
	});

	await fs.mkdir(path.dirname(rawPath), { recursive: true });
	await fs.writeFile(
		rawPath,
		`${JSON.stringify(
			{
				generatedAt,
				siteUrl: config.siteUrl,
				currentPeriod,
				previousPeriod,
				rowLimit: config.rowLimit,
				data,
			},
			null,
			2,
		)}\n`,
	);
	await fs.writeFile(reportPath, report);
	await fs.writeFile(latestPath, report);

	console.log(`Wrote report: ${path.relative(rootDir, reportPath)}`);
	console.log(`Wrote latest: ${path.relative(rootDir, latestPath)}`);
	console.log(`Wrote raw data: ${path.relative(rootDir, rawPath)}`);
}

async function loadEnvFile(filePath) {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (!match) continue;
			const key = match[1].trim();
			if (process.env[key] !== undefined) continue;
			process.env[key] = match[2].trim().replace(/^["']|["']$/g, "");
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}

function parseArgs(argv) {
	const args = {};

	for (let i = 0; i < argv.length; i++) {
		const item = argv[i];
		if (!item.startsWith("--")) {
			throw new Error(`Unexpected argument: ${item}`);
		}

		const [rawKey, inlineValue] = item.slice(2).split("=", 2);
		const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

		if (inlineValue !== undefined) {
			args[key] = inlineValue;
			continue;
		}

		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
			continue;
		}

		args[key] = next;
		i++;
	}

	return args;
}

async function getConfig(args) {
	const reportDir = resolveFromRoot(
		args.reportDir || process.env.GSC_REPORT_DIR || DEFAULT_REPORT_DIR,
	);
	const configSiteUrl =
		args.site ||
		process.env.GSC_SITE_URL ||
		(await readSiteUrlFromSiteConfig()) ||
		"https://dreaife.tokyo/";

	return {
		siteUrl: configSiteUrl,
		displaySiteUrl:
			process.env.GSC_DISPLAY_SITE_URL ||
			(await readSiteUrlFromSiteConfig()) ||
			configSiteUrl,
		reportDir,
		tokenFile: resolveFromRoot(
			args.tokenFile || process.env.GSC_TOKEN_FILE || DEFAULT_TOKEN_FILE,
		),
		clientFile: resolveFromRoot(
			args.clientFile ||
				process.env.GSC_OAUTH_CLIENT_FILE ||
				DEFAULT_CLIENT_FILE,
		),
		clientId: args.clientId || process.env.GSC_CLIENT_ID || "",
		clientSecret: args.clientSecret || process.env.GSC_CLIENT_SECRET || "",
		redirectUri: args.redirectUri || process.env.GSC_REDIRECT_URI || "",
		authPort: toInteger(args.authPort || process.env.GSC_AUTH_PORT, 53682),
		days: toInteger(args.days || process.env.GSC_DAYS, 7),
		lagDays: toInteger(args.lagDays || process.env.GSC_LAG_DAYS, 3),
		endDate: args.endDate || process.env.GSC_END_DATE || "",
		rowLimit: toInteger(args.rowLimit || process.env.GSC_ROW_LIMIT, 1000),
		minImpressions: toInteger(
			args.minImpressions || process.env.GSC_MIN_IMPRESSIONS,
			20,
		),
		lowCtr: toFloat(args.lowCtr || process.env.GSC_LOW_CTR, 0.03),
	};
}

function resolveFromRoot(value) {
	if (path.isAbsolute(value)) return value;
	return path.join(rootDir, value);
}

function toInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFloat(value, fallback) {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function readSiteUrlFromSiteConfig() {
	const configPath = path.join(rootDir, "src/config/siteConfig.ts");
	try {
		const content = await fs.readFile(configPath, "utf-8");
		const match = content.match(/siteURL:\s*["']([^"']+)["']/);
		return match?.[1] || "";
	} catch {
		return "";
	}
}

function getCurrentPeriod(config) {
	const endDate = config.endDate || formatDate(addDays(new Date(), -config.lagDays));
	const startDate = addDaysYmd(endDate, -(config.days - 1));
	return { startDate, endDate };
}

function getPreviousPeriod(period) {
	const endDate = addDaysYmd(period.startDate, -1);
	const startDate = addDaysYmd(endDate, -dateDiffDays(period.startDate, period.endDate));
	return { startDate, endDate };
}

function addDays(date, days) {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function addDaysYmd(ymd, days) {
	return formatDate(addDays(parseYmd(ymd), days));
}

function dateDiffDays(startDate, endDate) {
	const start = parseYmd(startDate);
	const end = parseYmd(endDate);
	return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function parseYmd(value) {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) {
		throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
	}
	return new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
	);
}

function formatDate(date) {
	return date.toISOString().slice(0, 10);
}

function getIsoWeekLabel(ymd) {
	const date = parseYmd(ymd);
	const day = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
	return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function authenticate(config) {
	const client = await readOAuthClient(config);
	await runAuthFlow(config, client);
	console.log(`Saved token: ${path.relative(rootDir, config.tokenFile)}`);
}

async function getAccessToken(config) {
	if (process.env.GSC_ACCESS_TOKEN) return process.env.GSC_ACCESS_TOKEN;

	const token = await readJsonIfExists(config.tokenFile);
	if (token?.access_token && token.expiry_date > Date.now() + 60000) {
		return token.access_token;
	}

	if (token?.refresh_token) {
		const client = await readOAuthClient(config);
		const refreshed = await refreshToken(client, token.refresh_token);
		await saveToken(config.tokenFile, { ...token, ...refreshed });
		return refreshed.access_token;
	}

	throw new Error(
		[
			"No GSC token found.",
			`Run: pnpm gsc:auth`,
			`Default OAuth client file: ${path.relative(rootDir, config.clientFile)}`,
			"Or set GSC_ACCESS_TOKEN for one-off runs.",
		].join("\n"),
	);
}

async function readOAuthClient(config) {
	if (config.clientId && config.clientSecret) {
		return {
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			redirectUris: [],
		};
	}

	const raw = await readJsonIfExists(config.clientFile);
	const client = raw?.installed || raw?.web || raw;
	if (!client?.client_id || !client?.client_secret) {
		throw new Error(
			[
				"Missing Google OAuth client credentials.",
				`Place an installed-app OAuth JSON file at ${path.relative(
					rootDir,
					config.clientFile,
				)}`,
				"or set GSC_CLIENT_ID and GSC_CLIENT_SECRET.",
			].join("\n"),
		);
	}

	return {
		clientId: client.client_id,
		clientSecret: client.client_secret,
		redirectUris: client.redirect_uris || [],
	};
}

async function runAuthFlow(config, client) {
	const redirectUri = pickRedirectUri(config, client);
	const redirect = new URL(redirectUri);
	const codePromise = waitForOAuthCode(redirect, config.authPort);
	const authUrl = new URL(AUTH_ENDPOINT);
	authUrl.searchParams.set("client_id", client.clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", SEARCH_CONSOLE_SCOPE);
	authUrl.searchParams.set("access_type", "offline");
	authUrl.searchParams.set("prompt", "consent");

	console.log("Open this URL in your browser and approve read-only GSC access:");
	console.log(authUrl.toString());

	const code = await codePromise;
	const token = await exchangeAuthCode(client, redirectUri, code);
	await saveToken(config.tokenFile, token);
}

function pickRedirectUri(config, client) {
	if (config.redirectUri) return config.redirectUri;

	const preferred = client.redirectUris.find((uri) => {
		try {
			const parsed = new URL(uri);
			return (
				["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.port
			);
		} catch {
			return false;
		}
	});

	if (preferred) return preferred;
	return `http://127.0.0.1:${config.authPort}${DEFAULT_CALLBACK_PATH}`;
}

async function waitForOAuthCode(redirect, fallbackPort) {
	const port = Number(redirect.port || fallbackPort);
	const callbackPath = redirect.pathname || DEFAULT_CALLBACK_PATH;
	const host = ["localhost", "127.0.0.1"].includes(redirect.hostname)
		? "127.0.0.1"
		: redirect.hostname;

	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const url = new URL(req.url, `http://${req.headers.host}`);
				if (url.pathname !== callbackPath) {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				const error = url.searchParams.get("error");
				if (error) {
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end(`Authorization failed: ${error}`);
					server.close();
					reject(new Error(`Authorization failed: ${error}`));
					return;
				}

				const code = url.searchParams.get("code");
				if (!code) {
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end("Missing authorization code");
					return;
				}

				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("Authorization complete. You can close this tab.");
				server.close();
				resolve(code);
			} catch (error) {
				server.close();
				reject(error);
			}
		});

		server.on("error", reject);
		server.listen(port, host);
	});
}

async function exchangeAuthCode(client, redirectUri, code) {
	return requestToken({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		code,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
	});
}

async function refreshToken(client, refreshTokenValue) {
	return requestToken({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		refresh_token: refreshTokenValue,
		grant_type: "refresh_token",
	});
}

async function requestToken(params) {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});

	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(
			`OAuth token request failed (${response.status}): ${JSON.stringify(body)}`,
		);
	}

	return {
		...body,
		expiry_date: Date.now() + Number(body.expires_in || 3600) * 1000,
	};
}

async function saveToken(filePath, token) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(token, null, 2)}\n`, {
		mode: 0o600,
	});
}

async function readJsonIfExists(filePath) {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf-8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function fetchReportData(token, siteUrl, options) {
	const current = options.current;
	const previous = options.previous;
	const rowLimit = options.rowLimit;

	const data = {
		current: {},
		previous: {},
		optionalErrors: {},
	};

	data.current.total = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		rowLimit: 1,
		type: "web",
		dataState: "final",
	});
	data.previous.total = await querySearchAnalytics(token, siteUrl, {
		startDate: previous.startDate,
		endDate: previous.endDate,
		rowLimit: 1,
		type: "web",
		dataState: "final",
	});
	data.current.daily = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["date"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.current.pages = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["page"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.previous.pages = await querySearchAnalytics(token, siteUrl, {
		startDate: previous.startDate,
		endDate: previous.endDate,
		dimensions: ["page"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.current.queries = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["query"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.previous.queries = await querySearchAnalytics(token, siteUrl, {
		startDate: previous.startDate,
		endDate: previous.endDate,
		dimensions: ["query"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.current.pageQueries = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["page", "query"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.current.devices = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["device"],
		rowLimit,
		type: "web",
		dataState: "final",
	});
	data.current.countries = await querySearchAnalytics(token, siteUrl, {
		startDate: current.startDate,
		endDate: current.endDate,
		dimensions: ["country"],
		rowLimit,
		type: "web",
		dataState: "final",
	});

	try {
		data.current.searchAppearance = await querySearchAnalytics(token, siteUrl, {
			startDate: current.startDate,
			endDate: current.endDate,
			dimensions: ["searchAppearance"],
			rowLimit,
			type: "web",
			dataState: "final",
		});
	} catch (error) {
		data.optionalErrors.searchAppearance = error.message;
		data.current.searchAppearance = { rows: [] };
	}

	return data;
}

async function querySearchAnalytics(token, siteUrl, body) {
	const encodedSiteUrl = encodeURIComponent(siteUrl);
	const response = await fetch(
		`${API_BASE}/sites/${encodedSiteUrl}/searchAnalytics/query`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Search Analytics query failed (${response.status}): ${text}`,
		);
	}

	return response.json();
}

function buildMarkdownReport(context) {
	const { data, config, currentPeriod, previousPeriod, weekLabel, generatedAt } =
		context;
	const currentTotal = firstMetrics(data.current.total);
	const previousTotal = firstMetrics(data.previous.total);
	const pageComparison = compareResponses(data.current.pages, data.previous.pages);
	const queryComparison = compareResponses(
		data.current.queries,
		data.previous.queries,
	);
	const currentPages = rowsWithKeys(data.current.pages);
	const currentQueries = rowsWithKeys(data.current.queries);
	const currentPageQueries = rowsWithKeys(data.current.pageQueries);

	const lines = [];
	lines.push(`# GSC Weekly Report - ${weekLabel}`);
	lines.push("");
	lines.push(`- Property: \`${config.siteUrl}\``);
	lines.push(
		`- Current period: \`${currentPeriod.startDate}\` to \`${currentPeriod.endDate}\``,
	);
	lines.push(
		`- Previous period: \`${previousPeriod.startDate}\` to \`${previousPeriod.endDate}\``,
	);
	lines.push(`- Generated: \`${generatedAt}\``);
	lines.push(
		`- Raw data: \`${path.relative(rootDir, context.rawPath)}\``,
	);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(
		markdownTable(
			["Metric", "Current", "Previous", "Delta"],
			[
				[
					"Clicks",
					formatNumber(currentTotal.clicks),
					formatNumber(previousTotal.clicks),
					formatSignedNumber(currentTotal.clicks - previousTotal.clicks),
				],
				[
					"Impressions",
					formatNumber(currentTotal.impressions),
					formatNumber(previousTotal.impressions),
					formatSignedNumber(
						currentTotal.impressions - previousTotal.impressions,
					),
				],
				[
					"CTR",
					formatPercent(currentTotal.ctr),
					formatPercent(previousTotal.ctr),
					formatSignedPercent(currentTotal.ctr - previousTotal.ctr),
				],
				[
					"Avg position",
					formatPosition(currentTotal.position),
					formatPosition(previousTotal.position),
					formatSignedPosition(
						currentTotal.position - previousTotal.position,
					),
				],
			],
		),
	);
	lines.push("");
	lines.push("## Daily Trend");
	lines.push("");
	lines.push(
		markdownTable(
			["Date", "Clicks", "Impressions", "CTR", "Avg position"],
			rowsWithKeys(data.current.daily).map((row) => [
				row.keys[0],
				formatNumber(row.clicks),
				formatNumber(row.impressions),
				formatPercent(row.ctr),
				formatPosition(row.position),
			]),
		),
	);
	lines.push("");
	lines.push("## Page Movement");
	lines.push("");
	lines.push("### Top Page Gains");
	lines.push("");
	lines.push(
		movementTable(
			pageComparison
				.filter((row) => row.deltaClicks > 0 || row.deltaImpressions > 0)
				.sort(byLargestGain)
				.slice(0, 10),
			config,
			"page",
		),
	);
	lines.push("");
	lines.push("### Top Page Losses");
	lines.push("");
	lines.push(
		movementTable(
			pageComparison
				.filter((row) => row.deltaClicks < 0 || row.deltaImpressions < 0)
				.sort(byLargestLoss)
				.slice(0, 10),
			config,
			"page",
		),
	);
	lines.push("");
	lines.push("## Query Movement");
	lines.push("");
	lines.push("### Top Query Gains");
	lines.push("");
	lines.push(
		movementTable(
			queryComparison
				.filter((row) => row.deltaClicks > 0 || row.deltaImpressions > 0)
				.sort(byLargestGain)
				.slice(0, 10),
			config,
			"query",
		),
	);
	lines.push("");
	lines.push("### Top Query Losses");
	lines.push("");
	lines.push(
		movementTable(
			queryComparison
				.filter((row) => row.deltaClicks < 0 || row.deltaImpressions < 0)
				.sort(byLargestLoss)
				.slice(0, 10),
			config,
			"query",
		),
	);
	lines.push("");
	lines.push("## Opportunities");
	lines.push("");
	lines.push(
		`Minimum impressions: \`${config.minImpressions}\`, low CTR threshold: \`${formatPercent(
			config.lowCtr,
		)}\`.`,
	);
	lines.push("");
	lines.push("### High Impression, Low CTR Pages");
	lines.push("");
	lines.push(
		pageOpportunityTable(
			currentPages
				.filter(
					(row) =>
						row.impressions >= config.minImpressions &&
						row.ctr <= config.lowCtr,
				)
				.sort((a, b) => b.impressions - a.impressions)
				.slice(0, 15),
			config,
		),
	);
	lines.push("");
	lines.push("### Ranking 8-20 Pages");
	lines.push("");
	lines.push(
		pageOpportunityTable(
			currentPages
				.filter(
					(row) =>
						row.impressions >= config.minImpressions &&
						row.position >= 8 &&
						row.position <= 20,
				)
				.sort((a, b) => b.impressions - a.impressions)
				.slice(0, 15),
			config,
		),
	);
	lines.push("");
	lines.push("### High Impression, Low CTR Queries");
	lines.push("");
	lines.push(
		queryOpportunityTable(
			currentQueries
				.filter(
					(row) =>
						row.impressions >= config.minImpressions &&
						row.ctr <= config.lowCtr,
				)
				.sort((a, b) => b.impressions - a.impressions)
				.slice(0, 15),
		),
	);
	lines.push("");
	lines.push("### Ranking 8-20 Queries");
	lines.push("");
	lines.push(
		queryOpportunityTable(
			currentQueries
				.filter(
					(row) =>
						row.impressions >= config.minImpressions &&
						row.position >= 8 &&
						row.position <= 20,
				)
				.sort((a, b) => b.impressions - a.impressions)
				.slice(0, 15),
		),
	);
	lines.push("");
	lines.push("### Page + Query Targets");
	lines.push("");
	lines.push(
		pageQueryOpportunityTable(
			currentPageQueries
				.filter(
					(row) =>
						row.impressions >= config.minImpressions &&
						row.position >= 8 &&
						row.position <= 20,
				)
				.sort((a, b) => b.impressions - a.impressions)
				.slice(0, 15),
			config,
		),
	);
	lines.push("");
	lines.push("## Audience Split");
	lines.push("");
	lines.push("### Device");
	lines.push("");
	lines.push(dimensionTable(data.current.devices));
	lines.push("");
	lines.push("### Country");
	lines.push("");
	lines.push(dimensionTable(data.current.countries));
	lines.push("");
	lines.push("### Search Appearance");
	lines.push("");
	lines.push(dimensionTable(data.current.searchAppearance));
	if (data.optionalErrors.searchAppearance) {
		lines.push("");
		lines.push(
			`Search appearance query warning: \`${data.optionalErrors.searchAppearance}\``,
		);
	}
	lines.push("");
	lines.push("## Codex Follow-Up Checklist");
	lines.push("");
	lines.push(
		"- For page losses, inspect title, description, canonical URL, structured data, and recent content changes.",
	);
	lines.push(
		"- For high-impression low-CTR queries, rewrite the visible title/description angle before touching article body.",
	);
	lines.push(
		"- For ranking 8-20 targets, add missing sections, examples, internal links, or fresher context.",
	);
	lines.push(
		"- For suspicious page drops, use GSC URL Inspection manually or with a small targeted script; do not inspect the whole site by default.",
	);
	lines.push("");

	return `${lines.join("\n")}\n`;
}

function firstMetrics(response) {
	const row = response.rows?.[0] || {};
	return {
		clicks: Number(row.clicks || 0),
		impressions: Number(row.impressions || 0),
		ctr: Number(row.ctr || 0),
		position: Number(row.position || 0),
	};
}

function rowsWithKeys(response) {
	return (response.rows || []).map((row) => ({
		keys: row.keys || [],
		clicks: Number(row.clicks || 0),
		impressions: Number(row.impressions || 0),
		ctr: Number(row.ctr || 0),
		position: Number(row.position || 0),
	}));
}

function compareResponses(currentResponse, previousResponse) {
	const current = rowsByKey(currentResponse);
	const previous = rowsByKey(previousResponse);
	const keys = new Set([...current.keys(), ...previous.keys()]);
	const rows = [];

	for (const key of keys) {
		const currentRow = current.get(key) || emptyComparisonRow(key);
		const previousRow = previous.get(key) || emptyComparisonRow(key);
		rows.push({
			key,
			current: currentRow,
			previous: previousRow,
			deltaClicks: currentRow.clicks - previousRow.clicks,
			deltaImpressions: currentRow.impressions - previousRow.impressions,
			deltaCtr: currentRow.ctr - previousRow.ctr,
			deltaPosition: currentRow.position - previousRow.position,
		});
	}

	return rows;
}

function rowsByKey(response) {
	const rows = rowsWithKeys(response);
	const map = new Map();
	for (const row of rows) {
		map.set(row.keys.join("\t"), row);
	}
	return map;
}

function emptyComparisonRow(key) {
	return {
		keys: key.split("\t"),
		clicks: 0,
		impressions: 0,
		ctr: 0,
		position: 0,
	};
}

function byLargestGain(a, b) {
	return (
		b.deltaClicks - a.deltaClicks ||
		b.deltaImpressions - a.deltaImpressions ||
		a.deltaPosition - b.deltaPosition
	);
}

function byLargestLoss(a, b) {
	return (
		a.deltaClicks - b.deltaClicks ||
		a.deltaImpressions - b.deltaImpressions ||
		b.deltaPosition - a.deltaPosition
	);
}

function movementTable(rows, config, keyType) {
	return markdownTable(
		[
			keyType === "page" ? "Page" : "Query",
			"Clicks",
			"Delta",
			"Impressions",
			"Delta",
			"CTR",
			"Position",
		],
		rows.map((row) => [
			keyType === "page" ? formatPage(row.key, config) : row.key,
			formatNumber(row.current.clicks),
			formatSignedNumber(row.deltaClicks),
			formatNumber(row.current.impressions),
			formatSignedNumber(row.deltaImpressions),
			formatPercent(row.current.ctr),
			formatPosition(row.current.position),
		]),
	);
}

function queryOpportunityTable(rows) {
	return markdownTable(
		["Query", "Clicks", "Impressions", "CTR", "Position"],
		rows.map((row) => [
			row.keys[0],
			formatNumber(row.clicks),
			formatNumber(row.impressions),
			formatPercent(row.ctr),
			formatPosition(row.position),
		]),
	);
}

function pageOpportunityTable(rows, config) {
	return markdownTable(
		["Page", "Clicks", "Impressions", "CTR", "Position"],
		rows.map((row) => [
			formatPage(row.keys[0], config),
			formatNumber(row.clicks),
			formatNumber(row.impressions),
			formatPercent(row.ctr),
			formatPosition(row.position),
		]),
	);
}

function pageQueryOpportunityTable(rows, config) {
	return markdownTable(
		["Page", "Query", "Clicks", "Impressions", "CTR", "Position"],
		rows.map((row) => [
			formatPage(row.keys[0], config),
			row.keys[1],
			formatNumber(row.clicks),
			formatNumber(row.impressions),
			formatPercent(row.ctr),
			formatPosition(row.position),
		]),
	);
}

function dimensionTable(response) {
	return markdownTable(
		["Dimension", "Clicks", "Impressions", "CTR", "Position"],
		rowsWithKeys(response).map((row) => [
			row.keys[0] || "(none)",
			formatNumber(row.clicks),
			formatNumber(row.impressions),
			formatPercent(row.ctr),
			formatPosition(row.position),
		]),
	);
}

function markdownTable(headers, rows) {
	if (!rows.length) return "_No matching rows._";

	const escapeCell = (value) =>
		String(value ?? "")
			.replace(/\|/g, "\\|")
			.replace(/\n/g, " ");

	return [
		`| ${headers.map(escapeCell).join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
	].join("\n");
}

function formatPage(value, config) {
	if (!value) return "";

	try {
		const page = new URL(value);
		const displayBase = new URL(config.displaySiteUrl);
		if (page.origin === displayBase.origin) {
			return `${page.pathname}${page.search}${page.hash}` || "/";
		}
		return value;
	} catch {
		return value;
	}
}

function formatNumber(value) {
	return Math.round(Number(value || 0)).toLocaleString("en-US");
}

function formatSignedNumber(value) {
	const rounded = Math.round(Number(value || 0));
	return `${rounded >= 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`;
}

function formatPercent(value) {
	return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatSignedPercent(value) {
	const percent = Number(value || 0) * 100;
	return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}pp`;
}

function formatPosition(value) {
	const number = Number(value || 0);
	return number ? number.toFixed(1) : "-";
}

function formatSignedPosition(value) {
	const number = Number(value || 0);
	if (!number) return "0.0";
	return `${number >= 0 ? "+" : ""}${number.toFixed(1)}`;
}

function printHelp() {
	console.log(`Usage:
  pnpm gsc:auth
  pnpm gsc:weekly
  node scripts/gsc-weekly-report.mjs [options]

Options:
  --auth                    Run the local OAuth flow and save a refresh token.
  --site <siteUrl>          GSC property, e.g. https://dreaife.tokyo/ or sc-domain:dreaife.tokyo.
  --end-date <YYYY-MM-DD>   Last GSC date to include. Defaults to today minus lag days.
  --days <n>                Number of days in the report period. Default: 7.
  --lag-days <n>            Days to skip from today to avoid incomplete data. Default: 3.
  --report-dir <path>       Output directory. Default: output/gsc.
  --token-file <path>       OAuth token cache. Default: output/gsc/token.json.
  --client-file <path>      OAuth client JSON. Default: output/gsc/oauth-client.json.
  --row-limit <n>           Rows per GSC query. Default: 1000.
  --min-impressions <n>     Opportunity table impression threshold. Default: 20.
  --low-ctr <n>             Low CTR threshold as decimal. Default: 0.03.

Local setup:
  1. Create an OAuth client for a desktop or local app with Search Console API enabled.
  2. Save its JSON to output/gsc/oauth-client.json, or set GSC_OAUTH_CLIENT_FILE.
  3. Run pnpm gsc:auth once.
  4. Run pnpm gsc:weekly whenever Codex needs a fresh local report.

Suggested weekly local schedule:
  # Saturday 08:00, using the script default 3-day GSC data lag.
  0 8 * * 6 cd ${rootDir} && pnpm gsc:weekly
`);
}

await main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
