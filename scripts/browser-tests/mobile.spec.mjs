import { test, expect } from '@playwright/test';

const notes = [
  { name: '阅读计划.md', mimeType: 'text/markdown', buffer: Buffer.from('---\ntags: [学习, 阅读]\n---\n# 阅读计划\n\n每天阅读二十分钟，然后用自己的话复述。\n\n[[旅行清单]]\n\n' + '这是用于检验手机长文滚动的段落。\n\n'.repeat(30)) },
  { name: '旅行清单.txt', mimeType: 'text/plain', buffer: Buffer.from('# 旅行清单\n\n出发前带上充电器。') }
];

async function importNotes(page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择文档预览' }).click();
  await (await chooser).setFiles(notes);
  await expect(page.getByRole('button', { name: '收起文件列表' })).toBeVisible();
}

async function assertFits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const nav = await page.getByRole('navigation', { name: '手机导航' }).boundingBox();
  expect(nav.x).toBeGreaterThanOrEqual(0);
  expect(nav.width).toBeGreaterThanOrEqual(page.viewportSize().width - 1);
  const workspace = await page.locator('main.workspace').boundingBox();
  expect(workspace.width).toBeGreaterThanOrEqual(page.viewportSize().width - 1);
  await expect(page.locator('.mobile-header')).toBeInViewport();
  expect(nav.y + nav.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
}

test('phone imports, reads, searches and filters without changing original files', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '连接你的知识库' })).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath('phone-start.png') });
  await importNotes(page);
  await page.locator('.file-tree').getByTitle('阅读计划.md').click();
  await expect(page.getByRole('button', { name: '收起文件列表' })).toBeHidden();
  await expect(page.locator('.markdown-preview')).toContainText('每天阅读二十分钟');
  await expect(page.locator('.markdown-input')).toHaveCount(0);
  await expect(page.locator('.status-line')).toContainText('不会上传或修改原文件');
  await page.screenshot({ path: info.outputPath('phone-reading.png') });
  expect(await page.locator('.note-editor').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);

  const nav = page.getByRole('navigation', { name: '手机导航' });
  await nav.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '全库搜索' }).fill('充电器');
  await page.getByRole('option').filter({ hasText: '旅行清单' }).click();
  await expect(page.locator('.markdown-preview')).toContainText('出发前带上充电器');
  await nav.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '#学习 1', exact: true }).click();
  await expect(page.locator('.file-tree').getByTitle('旅行清单.md')).toHaveCount(0);
  await expect(page.locator('.file-tree').getByTitle('阅读计划.md')).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath('phone-files.png') });

  // A failed/cancelled replacement must leave the imported vault intact.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入文件', exact: true }).click();
  await (await chooser).setFiles([]);
  await page.getByRole('button', { name: '收起文件列表' }).click();
  await expect(page.locator('.markdown-preview')).toContainText('充电器');
  await assertFits(page);
  await nav.getByRole('button', { name: '图谱' }).click();
  await expect(page.locator('.tag-knowledge-scene canvas')).toBeVisible();
  await page.screenshot({ path: info.outputPath('phone-graph.png') });
  expect(errors).toEqual([]);
});

test('phone panels, settings, small screen and desktop resize stay usable', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '手机导航' });
  await nav.getByRole('button', { name: '助手' }).click();
  await expect(page.locator('.agent-console')).toBeVisible();
  const panel = await page.locator('.agent-console').boundingBox();
  expect(panel.width).toBeLessThanOrEqual(page.viewportSize().width);
  await nav.getByRole('button', { name: '图谱' }).click();
  await expect(page.locator('.agent-console')).toBeHidden();
  await nav.getByRole('button', { name: '更多' }).click();
  await page.getByRole('textbox', { name: '命令面板' }).fill('设置');
  await page.getByRole('option').filter({ hasText: '打开应用设置' }).first().click();
  await expect(page.locator('.app-settings-dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('phone-settings.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 568 });
  await assertFits(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toHaveCount(0);
  await expect(page.locator('.app-chrome')).toBeVisible();
  await expect(page.locator('.vault-ribbon')).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop.png') });
  expect(errors).toEqual([]);
});
