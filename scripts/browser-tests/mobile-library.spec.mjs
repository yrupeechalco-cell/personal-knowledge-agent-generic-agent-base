import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const blockHttp = route => route.abort('internetdisconnected');
async function disconnectMedia(page, disconnected) {
  // WebKit on Windows setOffline also breaks entirely in-memory Blob URLs and
  // Blob.arrayBuffer (verified with a standalone image). Cut all real HTTP(S)
  // traffic here, preserving local binary reads to exercise device-offline use.
  if (disconnected) await page.route(/^https?:\/\//, blockHttp);
  else await page.unroute(/^https?:\/\//, blockHttp);
}
async function importFiles(page, files) {
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '允许并选择文件', exact: true }).click();
  await (await chooser).setFiles(files);
}

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

test('phone requests file access before importing and exports a backup without pairing secrets', async ({ page }, info) => {
  await page.goto('/?mobile=1');
  let chooserCount = 0;
  page.on('filechooser', () => { chooserCount++; });
  const access = page.getByRole('dialog', { name: '允许读取你选择的文件？' });
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(access).toBeVisible();
  expect(chooserCount).toBe(0);
  await expect(access).toContainText('配对后参与自动同步');
  await page.screenshot({ path: info.outputPath('phone-file-access.png') });
  await page.getByRole('button', { name: '暂不允许', exact: true }).click();
  await expect(access).toHaveCount(0);
  await expect(page.locator('.ml-document')).toHaveCount(0);
  expect(chooserCount).toBe(0);
  // Refusing file access must not block the rest of the app.
  await page.getByRole('button', { name: '新建笔记', exact: true }).click();
  await expect(page.getByLabel('资料正文')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '返回资料' }).click();
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(access).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '允许并选择文件', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '允许并选择文件', exact: true })).toBeInViewport();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '允许并选择文件', exact: true }).click();
  await (await chooser).setFiles({ name: '导入.txt', mimeType: 'text/plain', buffer: Buffer.from('导入文件原文') });
  expect(chooserCount).toBe(1);
  await expect(access).toHaveCount(0);
  await expect(page.locator('.ml-document')).toContainText('导入文件原文');
  await page.reload(); await expect(page.locator('.ml-document')).toContainText('导入文件原文');
  await page.getByRole('navigation').getByRole('button', { name: /同步/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出资料目录备份' }).click();
  const result = await download;
  const stream = await result.createReadStream(); let data = ''; for await (const chunk of stream) data += chunk;
  const backup = JSON.parse(data); expect(backup.token).toBe(''); expect(backup.documents[0].doc.text).toBe('导入文件原文');
});

test('cancelling the system file selection imports nothing and does not grant future access', async ({ page }) => {
  await page.goto('/?mobile=1');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '允许并选择文件', exact: true }).click();
  await chooser;
  // Browser automation has no OS Cancel button; deliver the input's native cancel event.
  await page.locator('input[type=file]').dispatchEvent('cancel');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.locator('.ml-document')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '允许读取你选择的文件？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('media persists, plays or explains codec limits, classifies and exports original bytes', async ({ page, browserName }, info) => {
  // Standalone <audio>/<video> with these same bytes also fail in Windows WebKit.
  // Assert the product's fallback there; Chromium must actually decode and play.
  const limitedCodecs = browserName === 'webkit' && process.platform === 'win32';
  await page.goto('/?mobile=1');
  await importFiles(page, [fixture('sample.png'), fixture('sample.wav'), fixture('sample.mp4')]);
  await expect(page.locator('.ml-document')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.ml-document')).toHaveCount(3);
  await disconnectMedia(page, true);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await expect(page.locator('.ml-document')).toHaveCount(1);
  await page.locator('.ml-document').click();
  await expect.poll(() => page.locator('.ml-image img').evaluate(img => img.naturalWidth)).toBe(128);
  await page.getByRole('button', { name: '放大图片' }).click();
  await expect(page.getByRole('button', { name: '缩小图片' })).toBeVisible();
  await page.getByLabel('资料分类').fill('素材/图片');
  await page.getByLabel('资料标签').fill('紫色，参考');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.ml-document')).toContainText('素材/图片');
  await page.getByRole('button', { name: '音频', exact: true }).click(); await page.locator('.ml-document').click();
  if (limitedCodecs) await expect(page.getByRole('status')).toContainText('当前设备无法预览此文件的编码');
  else {
    await expect.poll(() => page.locator('audio').evaluate(el => el.readyState)).toBeGreaterThan(0);
    await page.locator('audio').evaluate(el => el.play());
    await expect.poll(() => page.locator('audio').evaluate(el => el.currentTime)).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: '返回资料' }).click();
  await page.getByRole('button', { name: '视频', exact: true }).click(); await page.locator('.ml-document').click();
  if (limitedCodecs) await expect(page.getByRole('status')).toContainText('当前设备无法预览此文件的编码');
  else {
    await expect.poll(() => page.locator('video').evaluate(el => el.videoWidth)).toBe(128);
    await page.locator('video').evaluate(el => el.play());
    await expect.poll(() => page.locator('video').evaluate(el => el.currentTime)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: info.outputPath('phone-video.png') });
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: '导出原文件' }).click();
  const stream = await (await download).createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(await readFile(fixture('sample.mp4')));
  await disconnectMedia(page, false);
});

test('media bytes synchronize both ways and downloads survive disconnect', async ({ page }) => {
  const png = await readFile(fixture('sample.png')); let remote; const uploads = [];
  await page.route('**/api/mobile/**', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    if (route.request().url().endsWith('snapshot')) return route.fulfill({ json: { serverId: 'media-computer', capabilities: { media: true }, snapshot: { version: 2, roots: [], documents: remote ? [remote] : [] } } });
    if (route.request().url().endsWith('media-change')) {
      const bytes = route.request().postDataBuffer(); const length = bytes.readUInt32BE(0);
      const change = JSON.parse(bytes.subarray(4, 4 + length)); uploads.push(bytes.subarray(4 + length));
      remote = { ...change.doc, id: 'remote-media', revision: '1', metadataVersion: 1 };
      return route.fulfill({ json: { document: remote } });
    }
    if (route.request().url().endsWith('attachment')) return route.fulfill({ body: png, headers: { 'Content-Type': 'image/png', 'Content-Length': `${png.length}` } });
    throw new Error('Unexpected endpoint');
  });
  await page.goto(`/?mobile=1#pair=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: '已配对电脑' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '资料', exact: true }).click();
  await importFiles(page, [fixture('sample.png')]);
  await expect.poll(() => uploads.length).toBe(1); expect(uploads[0]).toEqual(png);
  await expect(page.locator('.ml-document small')).toHaveText('已保存');
  // Simulate another computer-created file, so the phone has metadata but no binary.
  remote = { ...remote, id: 'computer-photo', path: '电脑图片.png' };
  await page.getByRole('navigation').getByRole('button', { name: /同步/ }).click();
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '资料', exact: true }).click();
  await page.locator('.ml-document').filter({ hasText: '电脑图片.png' }).click();
  await expect.poll(() => page.locator('.ml-image img').evaluate(img => img.naturalWidth)).toBe(128);
  await page.getByRole('button', { name: '返回资料' }).click();
  await disconnectMedia(page, true);
  await page.locator('.ml-document').filter({ hasText: '电脑图片.png' }).click();
  await expect.poll(() => page.locator('.ml-image img').evaluate(img => img.naturalWidth)).toBe(128);
});

test('invalid mixed imports remain atomic and do not leave partial media', async ({ page }) => {
  await page.goto('/?mobile=1');
  await importFiles(page, [{ name: 'valid.png', mimeType: 'image/png', buffer: await readFile(fixture('sample.png')) }, { name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') }]);
  await expect(page.getByRole('alert')).toContainText('内容与文件格式不符');
  await expect(page.locator('.ml-document')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.ml-document')).toHaveCount(0);
});
