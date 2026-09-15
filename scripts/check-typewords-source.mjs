import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "docs/TYPEWORDS_SOURCE_MANIFEST.json"), "utf8"));
const sourceRoot = path.join(root, "third_party/typewords");
const expected = new Set();
for (const entry of manifest.files) {
  if (entry.path.includes("\\") || entry.path.startsWith("/") || entry.path.split("/").includes("..")) throw new Error("Invalid source path");
  if (expected.has(entry.path)) throw new Error(`Duplicate source path: ${entry.path}`);
  expected.add(entry.path);
  const bytes = await readFile(path.join(sourceRoot, entry.path));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Source differs from imported snapshot: ${entry.path}`);
}
const ignored = new Set(["node_modules", ".nuxt", ".output", ".nitro", ".cache", ".data", "dist", "dist-ssr", "logs"]);
async function checkDirectory(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".env") || entry.name.endsWith(".log") || entry.name.endsWith(".tsbuildinfo")) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await checkDirectory(path.join(directory, entry.name), relative + "/");
    else if (!expected.has(relative)) throw new Error(`Unrecorded source file: ${relative}`);
  }
}
await checkDirectory(sourceRoot);
console.log(`Verified ${expected.size} TypeWords source files against the documented snapshot.`);
