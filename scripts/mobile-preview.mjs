import { createServer } from 'vite';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.MOBILE_PREVIEW_PORT || 5176);
const server = await createServer({
  configFile: path.join(repo, 'apps/web/vite.config.ts'),
  root: path.join(repo, 'apps/web'),
  server: {
    host: '0.0.0.0', port, strictPort: true,
    proxy: { '/api/mobile': { target: 'http://127.0.0.1:5177', changeOrigin: true, headers: { Origin: 'http://127.0.0.1:5177' } } },
    // Only the app source is served. Never expose ignored notes, tooling, or keys.
    fs: {
      strict: true,
      allow: [repo],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.artifacts/**', '**/.private/**',
        '**/.codex/**', '**/.agents/**', '**/vaults/**', '**/private-vaults/**', '**/third_party/**',
        '**/apps/desktop/src-tauri/**', '**/PROJECT_MEMORY.md', '**/DEVELOPMENT_LOG.md', '**/secrets.json']
    }
  }
});
await server.listen();
console.log(`\nKnowledge app mobile preview (keep this process running):\nhttp://127.0.0.1:${port}`);
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.')) {
      console.log(`${name}: http://${address.address}:${port}`);
    }
  }
}
console.log('Connect the phone to the same router/Wi-Fi. UI changes refresh automatically.\n');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
