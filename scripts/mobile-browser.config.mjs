import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './browser-tests',
  testMatch: 'mobile-library.spec.mjs',
  outputDir: '../.artifacts/mobile-browser-results',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:18569', locale: 'zh-CN', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'phone-chromium', use: { ...devices['Pixel 5'], browserName: 'chromium' } }
  ],
  webServer: {
    command: 'node scripts/mobile-preview.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { MOBILE_PREVIEW_PORT: '18569' },
    url: 'http://127.0.0.1:18569',
    reuseExistingServer: false,
    timeout: 30000
  }
});
