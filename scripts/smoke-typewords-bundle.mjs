import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'apps/desktop/src-tauri/resources/typewords');
const scratch = path.join(root, '.artifacts');
await mkdir(scratch, { recursive: true });
const temporary = await mkdtemp(path.join(scratch, 'typewords 新电脑 '));
const bundle = path.join(temporary, '英语 学习');
await cp(source, bundle, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(bundle, 'bundle-manifest.json'), 'utf8'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const url = `http://127.0.0.1:${port}`;
// Deliberately do not inherit PATH, Node options, a TypeWords directory setting, or build-machine environment.
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: temporary, TMP: temporary,
  USERPROFILE: temporary, APPDATA: temporary, LOCALAPPDATA: temporary, PATH: '',
  NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port) };
const child = spawn(path.join(bundle, 'runtime/node.exe'), [path.join(bundle, '.output/server/index.mjs')], { cwd: bundle, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { output += data; });
let spawnError;
child.on('error', (error) => { spawnError = error; });
try {
  let html;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`TypeWords exited: ${output}`);
    try {
      const response = await fetch(`${url}/words`, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 200);
      html = await response.text();
      break;
    } catch { await delay(200); }
  }
  assert.match(html ?? '', /Type\s?Words/i, `TypeWords page did not start: ${output}`);
  const scripts = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert(scripts.some((asset) => asset.endsWith('.js')), 'Page must include browser scripts');
  for (const asset of scripts) {
    const response = await fetch(new URL(asset, url));
    assert.equal(response.status, 200, `Missing entry asset ${asset}`);
    assert(!response.headers.get('content-type')?.includes('text/html'), `HTML returned for ${asset}`);
  }
  // Verify every public asset byte for byte, including lazy-loaded routes, fonts, dictionaries and sounds.
  const assets = manifest.files.filter((file) => file.path.startsWith('.output/public/'));
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < assets.length) {
      const asset = assets[cursor++];
      const relative = asset.path.slice('.output/public/'.length).split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${url}/${relative}`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, `Missing public asset ${relative}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(bundle, asset.path)), `Asset changed in transit: ${relative}`);
    }
  }));
  const words = await (await fetch(`${url}/dicts/en/word/CET4_T.json`)).json();
  assert(Array.isArray(words) && words.length > 2500, 'Bundled word dictionary unavailable');
  console.log(`Portable TypeWords passed: ${assets.length} assets, ${words.length} words; empty PATH, fresh profile, Chinese path with spaces.`);
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
