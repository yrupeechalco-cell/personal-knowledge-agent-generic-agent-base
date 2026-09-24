import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'docs/TYPEWORDS_SOURCE_MANIFEST.json'), 'utf8'));
for (const file of manifest.files) {
  const destination = path.join(root, '.artifacts/typewords-build/source', file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, 'third_party/typewords', file.path), destination);
}
// Desktop integration patch, applied only to the isolated build copy. The source
// snapshot appends another '/' to LIBS_URL, producing /libs//Shepherd... (Nitro 404).
const envFile = path.join(root, '.artifacts/typewords-build/source/app/core/config/env.ts');
const envSource = await readFile(envFile, 'utf8');
const original = "LIBS_URL: '/libs/',";
if (!envSource.includes(original)) throw new Error('Review the TypeWords local library URL patch for this source snapshot.');
await writeFile(envFile, envSource.replace(original, "LIBS_URL: '/libs',"));
