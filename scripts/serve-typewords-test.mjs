import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.resolve(import.meta.dirname, '..');
const bundle = path.join(root, 'apps/desktop/src-tauri/resources/typewords');
const child = spawn(path.join(bundle, 'runtime/node.exe'), [path.join(bundle, '.output/server/index.mjs')], {
  cwd: bundle, windowsHide: true, stdio: 'inherit',
  env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, PATH: '', NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: '18567' }
});
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body style="margin:0"><iframe title="TypeWords 英语学习" src="http://127.0.0.1:18567/words" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" allow="autoplay; fullscreen" style="width:100vw;height:100vh;border:0"></iframe></body></html>');
});
child.on('exit', (code) => { server.close(); process.exitCode = code ?? 1; });
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:18567/words');
    if (response.ok) { server.listen(18568, '127.0.0.1'); break; }
  } catch { /* wait for our isolated child */ }
  if (attempt === 99) { child.kill(); throw new Error('TypeWords did not start'); }
  await delay(200);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); server.close(); });
