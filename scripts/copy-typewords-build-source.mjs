import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'docs/TYPEWORDS_SOURCE_MANIFEST.json'), 'utf8'));
for (const file of manifest.files) {
  const destination = path.join(root, '.artifacts/typewords-build/source', file.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, 'third_party/typewords', file.path), destination);
}
