import { readFile, writeFile } from "node:fs/promises";

const [manifestPath, installerUrl] = process.argv.slice(2);

if (!manifestPath || !installerUrl) {
  console.error(
    "Usage: node scripts/normalize-release-manifest.mjs <latest.json> <installer-url>",
  );
  process.exit(1);
}

const source = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(source);

if (!manifest.version || !manifest.platforms) {
  throw new Error("Updater manifest is missing version or platforms.");
}

for (const platform of Object.values(manifest.platforms)) {
  if (!platform || typeof platform !== "object" || !platform.signature) {
    throw new Error("Updater manifest contains a platform without a signature.");
  }
  platform.url = installerUrl;
}

const normalized = `${JSON.stringify(manifest, null, 2)}\n`;
JSON.parse(normalized);
await writeFile(manifestPath, normalized, "utf8");

console.log(
  `Validated updater manifest ${manifest.version} for ${Object.keys(manifest.platforms).length} platform entries.`,
);
