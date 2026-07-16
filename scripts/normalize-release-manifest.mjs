import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function normalizeReleaseManifest(manifest, installerUrl) {
  if (!manifest?.version || !manifest?.platforms) {
    throw new Error("Updater manifest is missing version or platforms.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(installerUrl);
  } catch {
    throw new Error("Installer URL is invalid.");
  }
  if (parsedUrl.protocol !== "https:" || /\s/.test(installerUrl) || !parsedUrl.pathname.endsWith("-setup.exe")) {
    throw new Error("Installer URL must be one HTTPS setup executable URL without whitespace.");
  }

  for (const platform of Object.values(manifest.platforms)) {
    if (!platform || typeof platform !== "object" || !platform.signature) {
      throw new Error("Updater manifest contains a platform without a signature.");
    }
    platform.url = installerUrl;
  }

  return manifest;
}

async function main() {
  const [manifestPath, installerUrl] = process.argv.slice(2);

  if (!manifestPath || !installerUrl) {
    throw new Error("Usage: node scripts/normalize-release-manifest.mjs <latest.json> <installer-url>");
  }

  const source = await readFile(manifestPath, "utf8");
  const manifest = normalizeReleaseManifest(JSON.parse(source), installerUrl);
  const normalized = `${JSON.stringify(manifest, null, 2)}\n`;
  JSON.parse(normalized);
  await writeFile(manifestPath, normalized, "utf8");

  console.log(
    `Validated updater manifest ${manifest.version} for ${Object.keys(manifest.platforms).length} platform entries.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
