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
  // A fresh Windows CI browser can finish hydration just after the default 5s.
  // Keep the content assertion; allow the bundled app's cold start to complete.
  await expect(frame.getByText('今日任务', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(frame.getByText('请选择一本词典开始学习', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('typewords-home.png'), fullPage: true });
  await frame.getByText('选择词典', { exact: true }).click();
  await frame.getByText('CET-4', { exact: true }).click();
  await expect(frame.getByText('cancel', { exact: true }).first()).toBeVisible();
  await expect(frame.locator('#study')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('typewords-dictionary.png'), fullPage: true });
  await frame.locator('#study').click();
  await frame.locator('#dialog-ok').click();
  await expect.poll(() => page.frames().find((item) => item.url().includes(':18567'))?.url()).toContain('/practice-words/1');
  await expect(frame.locator('body')).toContainText('取消');
  await page.screenshot({ path: testInfo.outputPath('typewords-practice.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});

test('first launch can load the local onboarding script', async ({ page, context }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:18568');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText('点击这里选择一本词典开始学习', { exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByText('下一步（1/4）', { exact: true }).click();
  await expect(frame.getByText('CET-4', { exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
