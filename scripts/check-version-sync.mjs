import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const rootPackage = await json("package.json");
const desktopPackage = await json("apps/desktop/package.json");
const tauriConfig = await json("apps/desktop/src-tauri/tauri.conf.json");
const cargoToml = await readFile(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  root: rootPackage.version,
  desktop: desktopPackage.version,
  tauri: tauriConfig.version,
  cargo: cargoVersion
};
const expected = versions.root;
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);

if (mismatches.length) {
  console.error("Desktop release versions are out of sync:", versions);
  process.exit(1);
}

console.log(`Desktop release version ${expected} is synchronized.`);
