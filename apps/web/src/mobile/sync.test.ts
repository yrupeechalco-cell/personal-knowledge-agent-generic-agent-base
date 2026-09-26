// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyState, mergeSnapshot, newDocument, readMobileState, saveMobileDocument, updateMobileState } from './libraryStore';
import { syncMobile } from './sync';
beforeEach(async () => { await updateMobileState(state => Object.assign(state, emptyState(), { token: 'a'.repeat(64) })); });
afterEach(() => vi.unstubAllGlobals());
it('retains a new local edit made while an upload is awaiting acknowledgment', async () => {
  const original = { ...newDocument('电脑.md', '初始'), id: 'remote', revision: '1', metadataVersion: 1 };
  await mergeSnapshot({ version: 2, roots: [], documents: [original] }, 'A');
  const first = (await readMobileState()).documents[0];
  await saveMobileDocument({ ...first.doc, text: '第一次修改' }, first.editId);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('snapshot')) return Response.json({ serverId: 'A', snapshot: { version: 2, roots: [], documents: [original] } });
    const during = (await readMobileState()).documents[0];
    await saveMobileDocument({ ...during.doc, text: '等待网络时第二次修改' }, during.editId);
    return Response.json({ document: { ...original, text: '第一次修改', revision: '2', metadataVersion: 2 } });
  }));
  await syncMobile();
  const final = (await readMobileState()).documents[0];
  expect(final.doc.text).toBe('等待网络时第二次修改'); expect(final.pending).toBe(true); expect(final.base?.revision).toBe('2');
});
it('persists pending writes across network failure and records conflict without overwriting', async () => {
  const doc = newDocument('本机.md', '不丢失'); await saveMobileDocument(doc);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(syncMobile()).rejects.toThrow('offline');
  expect((await readMobileState()).documents[0].pending).toBe(true);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('snapshot')
    ? Response.json({ serverId: 'A', snapshot: { version: 2, roots: [], documents: [] } })
    : Response.json({ document: { ...doc, text: '另一版本', revision: '2' } }, { status: 409 })));
  await syncMobile();
  const saved = (await readMobileState()).documents[0]; expect(saved.doc.text).toBe('不丢失'); expect(saved.conflict?.text).toBe('另一版本');
});
