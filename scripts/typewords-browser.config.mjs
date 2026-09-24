import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: 'typewords.spec.mjs',
  outputDir: '../.artifacts/typewords-browser-results',
  timeout: 60000,
  workers: 1,
  use: { browserName: 'chromium', locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/serve-typewords-test.mjs', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:18568', reuseExistingServer: false, timeout: 30000 }
});
