// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyState, mergeSnapshot, newDocument, readMobileState, resolveConflict, saveMobileDocument, updateMobileState } from './libraryStore';

beforeEach(async () => { await updateMobileState(state => Object.assign(state, emptyState())); });
describe('durable mobile library', () => {
  it('persists new notes and classifications and rejects stale edits from another tab', async () => {
    const doc = newDocument('测试.md', '持久保存的正文');
    await saveMobileDocument({ ...doc, categories: ['工作/项目'], tags: ['关键词'] });
    const first = (await readMobileState()).documents[0];
    expect(first.doc.text).toBe('持久保存的正文');
    await saveMobileDocument({ ...first.doc, text: '另一个页面的修改' }, first.editId);
    await expect(saveMobileDocument({ ...first.doc, text: '旧页面的修改' }, first.editId)).rejects.toThrow('另一个页面');
    expect((await readMobileState()).documents[0].doc.text).toBe('另一个页面的修改');
  });
  it('pulls remote changes without losing an unsynchronized local edit or removed source', async () => {
    const doc = { ...newDocument('电脑.md', '原文'), revision: '1', metadataVersion: 1 };
    await mergeSnapshot({ version: 2, roots: [], documents: [doc] }, 'computer-A');
    const entry = (await readMobileState()).documents[0];
    await saveMobileDocument({ ...doc, text: '手机断线编辑' }, entry.editId);
    await mergeSnapshot({ version: 2, roots: [], documents: [{ ...doc, text: '电脑新版本', revision: '2' }] }, 'computer-A');
    expect((await readMobileState()).documents[0].doc.text).toBe('手机断线编辑');
    await mergeSnapshot({ version: 2, roots: [], documents: [] }, 'computer-A');
    expect((await readMobileState()).documents).toHaveLength(1);
  });
  it('keeps both conflict versions and refuses to mix unrelated computers', async () => {
    const doc = { ...newDocument('电脑.md', '原文'), revision: '1' };
    await mergeSnapshot({ version: 2, roots: [], documents: [doc] }, 'A');
    await updateMobileState(state => { state.documents[0].doc.text = '手机内容'; state.documents[0].conflict = { ...doc, text: '电脑内容', revision: '2' }; });
    await resolveConflict(doc.id, 'both');
    const state = await readMobileState();
    expect(state.documents.map(item => item.doc.text).sort()).toEqual(['手机内容', '电脑内容'].sort());
    expect(state.documents.find(item => item.doc.text === '手机内容')?.pending).toBe(true);
    await expect(mergeSnapshot({ version: 2, roots: [], documents: [] }, 'B')).rejects.toThrow('另一台电脑');
    expect((await readMobileState()).documents).toHaveLength(2);
  });
});
