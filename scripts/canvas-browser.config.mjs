import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './browser-tests', testMatch: 'canvas.spec.mjs',
  outputDir: '../.artifacts/canvas-browser-results', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:18571', browserName:'chromium', locale:'zh-CN', viewport: {width:1280,height:900}, screenshot:'only-on-failure' },
  webServer: { command:'npx vite --config scripts/canvas-fixture/vite.config.mjs', cwd:fileURLToPath(new URL('..', import.meta.url)), url:'http://127.0.0.1:18571', reuseExistingServer:false }
});
