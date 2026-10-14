import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './browser-tests', testMatch: 'library-retrieval.spec.mjs',
  outputDir: '../.artifacts/retrieval-browser-results', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:18570', browserName: 'chromium', locale: 'zh-CN', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --config scripts/retrieval-fixture/vite.config.mjs', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:18570', reuseExistingServer: false },
});
