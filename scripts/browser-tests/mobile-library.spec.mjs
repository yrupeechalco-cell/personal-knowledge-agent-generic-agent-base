import { test, expect } from '@playwright/test';

async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const main = await page.locator('.ml-main').boundingBox();
  expect(main.width).toBeGreaterThanOrEqual(page.viewportSize().width - 2);
  await expect(page.locator('.ml-header')).toBeInViewport();
  await expect(page.locator('.ml-nav')).toBeInViewport();
}

test('phone creates, persists, searches, classifies and edits while disconnected', async ({ page, context }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?mobile=1');
  await expect(page.getByRole('heading', { name: '我的资料' })).toBeVisible();
  await fits(page);
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await page.getByLabel('资料标题').fill('阅读笔记.md');
  await page.getByLabel('资料正文').fill('每天阅读二十分钟，然后用自己的话复述。');
  await page.getByLabel('资料分类').fill('学习/阅读');
  await page.getByLabel('资料标签').fill('复述，记忆');
  await page.getByLabel('资料摘要').fill('用主动复述巩固阅读成果。');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.ml-document')).toContainText('阅读笔记.md');
  await page.reload();
  await expect(page.locator('.ml-document')).toContainText('用主动复述巩固阅读成果。');
  await page.getByLabel('搜索知识库').fill('二十分钟');
  await expect(page.locator('.ml-document')).toHaveCount(1);
  await page.getByLabel('搜索知识库').fill('不存在');
  await expect(page.locator('.ml-document')).toHaveCount(0);
  await page.getByLabel('搜索知识库').fill('');
  await page.getByRole('navigation').getByRole('button', { name: '分类', exact: true }).click();
  await page.getByRole('button', { name: '学习/阅读 1' }).click();
  await expect(page.locator('.ml-document')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('phone-library.png') });
  await context.setOffline(true);
  await page.locator('.ml-document').click();
  await page.getByLabel('资料正文').fill('断网时补充的想法，也必须保留。');
  await page.screenshot({ path: info.outputPath('phone-editor.png') });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.ml-document')).toContainText('阅读笔记.md');
  await context.setOffline(false); await page.reload();
  await page.locator('.ml-document').click();
  await expect(page.getByLabel('资料正文')).toHaveValue('断网时补充的想法，也必须保留。');
  await page.getByRole('button', { name: '返回资料' }).click();
  await page.setViewportSize({ width: 320, height: 568 }); await fits(page);
  expect(errors).toEqual([]);
});

test('paired phone synchronizes both ways and keeps concurrent versions', async ({ page }, info) => {
  let remote = { id: 'root\nnote.md', rootId: 'root', path: 'note.md', text: '电脑最初的正文', revision: '1', metadataVersion: 1,
    size: 20, updatedAt: Date.now(), issue: null, status: 'reviewed', summary: '', category: '', categories: [], tags: [], tips: [] };
  let offline = false; const pushed = [];
  await page.route('**/api/mobile/**', async route => {
    if (offline) return route.abort('failed');
    expect(route.request().headers().authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    if (route.request().url().endsWith('snapshot')) return route.fulfill({ json: { serverId: 'computer-test', snapshot: { version: 2, roots: [{ id: 'root', path: '测试文件夹', paused: false, lastScan: null, issue: null }], documents: [remote] } } });
    const body = route.request().postDataJSON();
    if (body.base && (body.base.revision !== remote.revision || body.base.metadataVersion !== remote.metadataVersion)) return route.fulfill({ status: 409, json: { document: remote } });
    pushed.push(body.doc);
    if (body.base) remote = { ...body.doc, revision: `${Number(remote.revision) + 1}`, metadataVersion: remote.metadataVersion + 1 };
    return route.fulfill({ json: { document: body.base ? remote : { ...body.doc, id: 'copy', revision: '1', metadataVersion: 1 } } });
  });
  await page.goto(`/?mobile=1#pair=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: '已配对电脑' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '资料', exact: true }).click();
  await page.locator('.ml-document').click();
  await page.getByLabel('资料正文').fill('手机在线保存的修改');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => remote.text).toBe('手机在线保存的修改');
  await expect(page.locator('.ml-document small')).toHaveText('已保存');
  offline = true;
  await page.locator('.ml-document').click();
  await page.getByLabel('资料正文').fill('手机断线后的修改');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.ml-document small')).toHaveText('待同步');
  remote = { ...remote, text: '电脑与此同时的修改', revision: '3', metadataVersion: 3 };
  offline = false;
  await page.getByRole('navigation').getByRole('button', { name: /同步/ }).click();
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await expect(page.locator('.ml-conflict')).toBeVisible();
  await page.getByText('对比两个版本', { exact: true }).click();
  await expect(page.locator('.ml-conflict')).toContainText('手机断线后的修改');
  await expect(page.locator('.ml-conflict')).toContainText('电脑与此同时的修改');
  await page.screenshot({ path: info.outputPath('phone-conflict.png') });
  await page.getByRole('button', { name: '保留手机副本并同步' }).click();
  await expect.poll(() => pushed.length).toBe(2);
  expect(remote.text).toBe('电脑与此同时的修改');
  await page.getByRole('navigation').getByRole('button', { name: '资料', exact: true }).click();
  await expect(page.locator('.ml-document')).toHaveCount(2);
  await fits(page);
});

test('phone imports a persistent copy and exports a backup without pairing secrets', async ({ page }) => {
  await page.goto('/?mobile=1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await (await chooser).setFiles({ name: '导入.txt', mimeType: 'text/plain', buffer: Buffer.from('导入文件原文') });
  await expect(page.locator('.ml-document')).toContainText('导入文件原文');
  await page.reload(); await expect(page.locator('.ml-document')).toContainText('导入文件原文');
  await page.getByRole('navigation').getByRole('button', { name: /同步/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const result = await download;
  const stream = await result.createReadStream(); let data = ''; for await (const chunk of stream) data += chunk;
  const backup = JSON.parse(data); expect(backup.token).toBe(''); expect(backup.documents[0].doc.text).toBe('导入文件原文');
});
