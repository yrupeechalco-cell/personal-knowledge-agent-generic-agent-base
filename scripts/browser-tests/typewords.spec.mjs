import { test, expect } from '@playwright/test';

test('new learning profile renders in the plugin iframe and opens the bundled dictionary', async ({ page, context }, testInfo) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  // Only dismiss the onboarding tour; no dictionary or learning state is seeded.
  await context.addInitScript(() => localStorage.setItem('tour-guide', '1'));
  // All required learning UI/resources must work without an external service.
  await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:18568');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText('今日任务', { exact: true })).toBeVisible();
  await expect(frame.getByText('请选择一本词典开始学习', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('typewords-home.png'), fullPage: true });
  await frame.getByText('选择词典', { exact: true }).click();
  await frame.getByText('CET-4', { exact: true }).click();
  await expect(frame.getByText('cancel', { exact: true }).first()).toBeVisible();
  await expect(frame.locator('#study')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('typewords-dictionary.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});
