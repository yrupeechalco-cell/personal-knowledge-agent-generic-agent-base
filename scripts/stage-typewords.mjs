import { appendFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'third_party/typewords');
const output = path.join(root, '.artifacts/typewords-build/source/.output');
const packageStore = path.join(root, '.artifacts/typewords-build/source/node_modules/.pnpm');
const destination = path.join(root, 'apps/desktop/src-tauri/resources/typewords');
const runtime = path.resolve(process.argv[2]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const node = await readFile(path.join(runtime, 'node.exe'));
if (sha256(node) !== '63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088') throw new Error('Unexpected Node executable');
await readFile(path.join(output, 'server/index.mjs'));
// This fixed build-output directory is inside the repository, never a user-selected path.
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'runtime'), { recursive: true });
await cp(output, path.join(destination, '.output'), { recursive: true, dereference: true });
await cp(path.join(source, 'package.json'), path.join(destination, 'package.json'));
await cp(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'));
await cp(path.join(runtime, 'LICENSE'), path.join(destination, 'runtime/LICENSE'));
await writeFile(path.join(destination, 'runtime/node.exe'), node);
// Nitro traces executable dependencies but drops many license files. Preserve the
// original notices separately, including libraries compiled into browser chunks.
const notices = [];
async function collectNotice(directory) {
  let metadata;
  try { metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); }
  catch { return; }
  if (!metadata.name || !metadata.version) return;
  const id = `${metadata.name.replaceAll('/', '__')}@${metadata.version}`;
  if (notices.some((entry) => entry.id === id)) return;
  const licenses = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /^(license|licence|copying|notice)(\.|$)/i.test(entry.name));
  for (const license of licenses) {
    const target = path.join(destination, 'THIRD_PARTY_LICENSES', id, license.name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(directory, license.name), target);
  }
  notices.push({ id, name: metadata.name, version: metadata.version, license: metadata.license, repository: metadata.repository, notices: licenses.map((file) => file.name) });
}
for (const folder of await readdir(packageStore, { withFileTypes: true })) {
  if (!folder.isDirectory() || folder.name === 'node_modules') continue;
  const modules = path.join(packageStore, folder.name, 'node_modules');
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(path.join(modules, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) await collectNotice(path.join(modules, entry.name, scoped.name));
      }
    } else await collectNotice(path.join(modules, entry.name));
  }
}
await mkdir(path.join(destination, 'THIRD_PARTY_LICENSES'), { recursive: true });
await writeFile(path.join(destination, 'THIRD_PARTY_LICENSES/index.json'), JSON.stringify(notices, null, 2) + '\n');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const tagUrl = `https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/tree/app-v${version}`;
await writeFile(path.join(destination, 'SOURCE.md'), `# TypeWords\n\nBy zyronon and TypeWords contributors. Upstream: https://github.com/zyronon/TypeWords\n\nBuilt from the user-provided TypeWords-3.0.7 source snapshot (not a verified upstream tag).\nCorresponding source: ${tagUrl}/third_party/typewords\nSource archive: https://github.com/yrupeechalco-cell/personal-knowledge-agent-generic-agent-base/archive/refs/tags/app-v${version}.zip\nBuild instructions: ${tagUrl}/docs/TYPEWORDS_PLUGIN.md\nBuild scripts and pnpm lockfile are included in that source archive.\nGPL-3.0 license: LICENSE. Dependency license notices are retained in the production output.\n\nBundled Node.js 24.14.0: https://nodejs.org/dist/v24.14.0/\nNode.js and bundled library license notices: runtime/LICENSE.\nThis integration does not include or synchronize personal learning records.\n`);
await appendFile(path.join(destination, 'SOURCE.md'), '\n## Desktop integration modifications (2026-09-24)\n\nThe isolated build copy changes app/core/config/env.ts to remove the duplicate slash in local library URLs, and app/core/hooks/sound.ts to handle rejected audio play promises while keeping the existing speech-synthesis fallback. These are Knowledge Agent integration changes, not upstream changes. Both patches are reproduced by scripts/copy-typewords-build-source.mjs in the corresponding source archive. The original snapshot remains unchanged. Additional original dependency notices are in THIRD_PARTY_LICENSES/.\n');
const files = [];
async function record(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await record(path.join(directory, entry.name), relative + '/');
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, entry.name));
      files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    } else throw new Error(`Non-portable resource: ${relative}`);
  }
}
await record(destination);
const sourceManifest = await readFile(path.join(root, 'docs/TYPEWORDS_SOURCE_MANIFEST.json'));
await writeFile(path.join(destination, 'bundle-manifest.json'), JSON.stringify({ version, node: '24.14.0', pnpm: '11.24.0', sourceManifestSha256: sha256(sourceManifest), files }, null, 2) + '\n');
console.log(`Staged TypeWords and Node: ${files.length} files, ${(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024).toFixed(1)} MiB.`);
