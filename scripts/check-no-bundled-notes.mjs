import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--all";
const scanRoots = [
  path.join(root, "apps", "web", "src"),
  path.join(root, "apps", "desktop", "src"),
  path.join(root, "packages")
];
if (mode === "--all" || mode === "--web") scanRoots.push(path.join(root, "apps", "web", "dist"));
if (mode === "--all" || mode === "--desktop") scanRoots.push(path.join(root, "apps", "desktop", "dist"));
if (!["--all", "--web", "--desktop", "--source"].includes(mode)) {
  throw new Error(`Unknown content-check mode: ${mode}`);
}
const bannedMarkers = [
  "demoVaultFiles",
  "个人知识库 Agent 演示库",
  "拓扑结构-洞与边界",
  "生态网络-关键节点",
  "行星气候-能量平衡"
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const findings = [];

for (const scanRoot of scanRoots) {
  await scanDirectory(scanRoot);
}

if (findings.length > 0) {
  console.error("Bundled note markers were found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("No bundled demonstration notes were found in product sources or build output.");

async function scanDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(entryPath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const content = await readFile(entryPath, "utf8");
    for (const marker of bannedMarkers) {
      if (content.includes(marker)) findings.push(`${path.relative(root, entryPath)} contains ${marker}`);
    }
  }
}
