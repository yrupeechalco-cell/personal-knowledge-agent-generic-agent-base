import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const bundle = path.join(root, 'apps/desktop/src-tauri/resources/typewords');
const manifest = JSON.parse(await readFile(path.join(bundle, 'bundle-manifest.json'), 'utf8').catch(() => {
  throw new Error('TypeWords resources missing. Run npm run typewords:prepare before building a Windows installer.');
}));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (manifest.version !== version) throw new Error('TypeWords resources belong to a different app version; rebuild them.');
if (manifest.sourceManifestSha256 !== sha256(await readFile(path.join(root, 'docs/TYPEWORDS_SOURCE_MANIFEST.json')))) throw new Error('TypeWords source provenance differs.');
const required = new Set(['.output/server/index.mjs', 'runtime/node.exe', 'runtime/LICENSE', 'LICENSE', 'SOURCE.md', 'package.json']);
let assets = 0;
for (const entry of manifest.files) {
  if (entry.path.includes('\\') || entry.path.startsWith('/') || entry.path.split('/').includes('..')) throw new Error('Invalid bundle path');
  const bytes = await readFile(path.join(bundle, entry.path));
  if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Incomplete TypeWords resource: ${entry.path}`);
  required.delete(entry.path);
  if (entry.path.startsWith('.output/public/_nuxt/') && entry.path.endsWith('.js')) assets++;
}
if (required.size || !assets) throw new Error('TypeWords bundle is missing runtime, notices, or browser assets.');
console.log(`Verified ${manifest.files.length} bundled TypeWords resources and ${assets} browser scripts.`);
