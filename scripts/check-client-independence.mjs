import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
if (config.build.frontendDist !== '../dist') throw Error('Release must embed the desktop frontend.');
const resources = config.bundle.resources;
if (!resources['resources/cli/'] || !resources['resources/typewords/']) throw Error('CLI and TypeWords must ship inside the installer.');
for (const [source, target] of Object.entries(resources)) {
  if (path.isAbsolute(source) || path.isAbsolute(target) || source.includes('..') || target.includes('..')) throw Error('Resources must use package-relative paths.');
}
const findings = [];
const extensions = new Set(['.ts', '.tsx', '.js', '.css', '.html', '.mjs']);
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (extensions.has(path.extname(file)) && !/\.test\./.test(file)) {
      const text = await readFile(file, 'utf8');
      if (/[A-Z]:[/\\]+Users[/\\]+pc[/\\]/i.test(text) || /192\.168\.0\.103/.test(text)) findings.push(path.relative(root, file));
      if (file.includes(`${path.sep}dist${path.sep}`) && /https?:\/\/(?:127\.0\.0\.1|localhost):(?:5173|5174|5176|5188)\b/.test(text)) findings.push(`${path.relative(root, file)}: development URL`);
    }
  }
}
for (const relative of ['packages', 'apps/desktop/src', 'apps/desktop/dist']) await walk(path.join(root, relative));
if (findings.length) throw Error(`Developer-machine dependency found:\n${findings.join('\n')}`);
console.log('Desktop frontend is embedded; resource paths are relative; no known developer paths or dev-server URLs in the shipped desktop frontend.');
