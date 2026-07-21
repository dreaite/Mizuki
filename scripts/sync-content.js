import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./load-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

loadEnv();
console.log("Loaded .env configuration file\n");

function parseBoolean(value, fallback = false) {
	if (value == null || value === "") return fallback;
	const normalized = String(value).trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return fallback;
}

function resolveFromRoot(value) {
	return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function pathEntryExists(value) {
	try {
		fs.lstatSync(value);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

function redactRepoUrl(value) {
	if (!value) return "";

	try {
		const url = new URL(value);
		if (url.username || url.password) {
			url.username = "***";
			url.password = "";
		}
		return url.toString();
	} catch {
		return value.replace(/(https?:\/\/)([^/@]+)@/i, "$1***@");
	}
}

function runGit(args, options = {}) {
	execFileSync("git", args, {
		stdio: "inherit",
		...options,
	});
}

function fail(message) {
	console.error(`\nContent synchronization failed: ${message}`);
	process.exit(1);
}

function countMarkdownFiles(dir) {
	if (!fs.existsSync(dir)) return 0;
	let count = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			count += countMarkdownFiles(entryPath);
		} else if (/\.(md|mdx|markdown)$/i.test(entry.name)) {
			count += 1;
		}
	}
	return count;
}

function clearAstroContentCache() {
	const astroCacheDir = path.join(rootDir, "node_modules", ".astro");
	if (fs.existsSync(astroCacheDir)) {
		fs.rmSync(astroCacheDir, { recursive: true, force: true });
		console.log("Cleared Astro content cache: node_modules/.astro");
	}
}

// 从环境变量读取配置
const ENABLE_CONTENT_SYNC = parseBoolean(
	process.env.ENABLE_CONTENT_SYNC,
	false,
);
const CONTENT_REPO_URL = process.env.CONTENT_REPO_URL || "";
const CONTENT_DIR = resolveFromRoot(process.env.CONTENT_DIR || "content");
const BACKUP_DIR = path.join(rootDir, ".content-sync-backup");

console.log("Starting content synchronization...\n");

// 检查是否启用内容分离
if (!ENABLE_CONTENT_SYNC) {
	console.log(
		"Content separation is disabled (ENABLE_CONTENT_SYNC is not true)",
	);
	console.log("Local repository content will be used.");
	console.log("To enable content separation, set:");
	console.log("     ENABLE_CONTENT_SYNC=true");
	console.log("     CONTENT_REPO_URL=<your-repo-url>\n");
	process.exit(0);
}

if (!CONTENT_REPO_URL) {
	fail(
		"ENABLE_CONTENT_SYNC=true but CONTENT_REPO_URL is not set. Configure the content repository URL in your build environment.",
	);
}

// 检查内容目录是否存在
if (!fs.existsSync(CONTENT_DIR)) {
	console.log(`Content directory does not exist: ${CONTENT_DIR}`);
	console.log("Using independent repository mode");

	try {
		console.log(
			`Cloning content repository: ${redactRepoUrl(CONTENT_REPO_URL)}`,
		);
		runGit(["clone", "--depth", "1", CONTENT_REPO_URL, CONTENT_DIR], {
			cwd: rootDir,
		});
		console.log("Content repository cloned successfully");
	} catch (error) {
		fail(`clone failed: ${error.message}`);
	}
} else {
	console.log(`Content directory already exists: ${CONTENT_DIR}`);

	if (fs.existsSync(path.join(CONTENT_DIR, ".git"))) {
		try {
			console.log("Pulling latest content...");
			runGit(["pull", "--ff-only"], {
				cwd: CONTENT_DIR,
			});
			console.log("Content updated successfully");
		} catch (error) {
			fail(`git pull failed: ${error.message}`);
		}
	} else {
		console.log(
			"Content directory is not a git repository; using it as-is.",
		);
	}
}

const requiredPostsDir = path.join(CONTENT_DIR, "posts");
if (!fs.existsSync(requiredPostsDir)) {
	fail(`required source directory is missing: ${requiredPostsDir}`);
}

const postCount = countMarkdownFiles(requiredPostsDir);
if (postCount === 0) {
	fail(`no Markdown posts found in ${requiredPostsDir}`);
}

// 创建符号链接或复制内容
console.log("\nSetting up content links...");

function restoreLegacyDirectoryMapping(dest) {
	const destPath = path.join(rootDir, dest);
	if (
		!pathEntryExists(destPath) ||
		!fs.lstatSync(destPath).isSymbolicLink()
	) {
		return;
	}

	const backupPath = path.join(BACKUP_DIR, dest);
	console.log(`Restoring local directory before merged sync: ${dest}`);
	fs.unlinkSync(destPath);
	fs.mkdirSync(path.dirname(destPath), { recursive: true });

	if (pathEntryExists(backupPath)) {
		fs.renameSync(backupPath, destPath);
	} else {
		fs.mkdirSync(destPath, { recursive: true });
	}
}

// Older builds replaced public/images as a whole. Restore its local backup,
// then map each remote top-level entry separately so code-owned directories
// such as public/images/artworks and public/images/demos remain available.
restoreLegacyDirectoryMapping("public/images");

const remoteImagesDir = path.join(CONTENT_DIR, "images");
const imageMappings = fs.existsSync(remoteImagesDir)
	? fs.readdirSync(remoteImagesDir, { withFileTypes: true }).map((entry) => ({
			src: path.posix.join("images", entry.name),
			dest: path.posix.join("public/images", entry.name),
		}))
	: [];

const contentMappings = [
	{ src: "posts", dest: "src/content/posts" },
	{ src: "spec", dest: "src/content/spec" },
	{ src: "data", dest: "src/data" },
	...imageMappings,
];

for (const mapping of contentMappings) {
	const srcPath = path.join(CONTENT_DIR, mapping.src);
	const destPath = path.join(rootDir, mapping.dest);
	const legacyBackupPath = `${destPath}.backup`;

	if (!fs.existsSync(srcPath)) {
		console.log(`Skipping non-existent source: ${mapping.src}`);
		continue;
	}

	if (pathEntryExists(legacyBackupPath)) {
		console.log(`Removing legacy in-place backup: ${mapping.dest}.backup`);
		fs.rmSync(legacyBackupPath, { recursive: true, force: true });
	}

	// 如果目标已存在且不是符号链接,备份它
	if (
		pathEntryExists(destPath) &&
		!fs.lstatSync(destPath).isSymbolicLink()
	) {
		const backupPath = path.join(BACKUP_DIR, mapping.dest);
		console.log(
			`Backing up existing content: ${mapping.dest} -> ${path.relative(
				rootDir,
				backupPath,
			)}`,
		);
		if (pathEntryExists(backupPath)) {
			fs.rmSync(backupPath, { recursive: true, force: true });
		}
		fs.mkdirSync(path.dirname(backupPath), { recursive: true });
		fs.renameSync(destPath, backupPath);
	}

	fs.mkdirSync(path.dirname(destPath), { recursive: true });

	// 删除现有的符号链接
	if (pathEntryExists(destPath)) {
		fs.unlinkSync(destPath);
	}

	// 创建符号链接 (Windows 需要管理员权限,否则复制文件)
	try {
		const relPath = path.relative(path.dirname(destPath), srcPath);
		fs.symlinkSync(relPath, destPath, "junction");
		console.log(`Created symbolic link: ${mapping.dest} -> ${mapping.src}`);
	} catch (error) {
		console.log(`Copying content: ${mapping.src} -> ${mapping.dest}`);
		copyRecursive(srcPath, destPath);
	}
}

clearAstroContentCache();

console.log(`\nContent synchronization completed (${postCount} post files)\n`);

// 递归复制函数
function copyRecursive(src, dest) {
	if (fs.statSync(src).isDirectory()) {
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(dest, { recursive: true });
		}
		const files = fs.readdirSync(src);
		for (const file of files) {
			copyRecursive(path.join(src, file), path.join(dest, file));
		}
	} else {
		fs.copyFileSync(src, dest);
	}
}
