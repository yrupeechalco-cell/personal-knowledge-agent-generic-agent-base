import { test, expect } from '@playwright/test';

test('library entry, cross-file excerpts and pagination work without a network or model', async ({ page, context }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '检索与引用', exact: true }).click();
  await expect(page.getByRole('heading', { name: '带着问题找资料' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'AI 整理任务' })).toHaveCount(0);
  await context.setOffline(true);
  await page.getByLabel('检索主题', { exact: true }).fill('求职');
  await page.getByRole('button', { name: '查找相关资料' }).click();
  await expect(page.getByText('“求职” · 6 组候选')).toBeVisible();
  await page.screenshot({ path: info.outputPath('retrieval-first-screen.png') });
  await expect(page.getByText('1 份相同索引正文已合并。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '补读上下文' }).first().click();
  await expect(page.getByText('上下文 · 索引', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '继续查看下一批', exact: false }).click();
  await expect(page.getByText('已显示 5 组正文节选 · 1 组仅文件信息 · 还有 0 组待查看')).toBeVisible();
  await expect(page.getByText('PDF 正文暂未收录')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '收起上下文' }).click();
  await page.screenshot({ path: info.outputPath('retrieval-light.png'), fullPage: true });
  await page.locator('.theme-light').evaluate(el => el.className = 'theme-dark');
  await page.setViewportSize({ width: 1024, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('retrieval-dark.png'), fullPage: true });
  expect(errors).toEqual([]);
});
