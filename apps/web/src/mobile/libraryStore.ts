import type { LibraryDocument, LibrarySnapshot } from '@knowledge-agent/workspace';

export interface LocalDocument {
  doc: LibraryDocument;
  localId?: string;
  base: LibraryDocument | null;
  pending: boolean;
  editId: string;
  conflict?: LibraryDocument | null;
}
export interface MobileState {
  version: 1;
  documents: LocalDocument[];
  roots: LibrarySnapshot['roots'];
  token: string;
  serverId: string;
  lastSync: number | null;
}
export const emptyState = (): MobileState => ({ version: 1, documents: [], roots: [], token: '', serverId: '', lastSync: null });
let database: Promise<IDBDatabase> | undefined;
export function openMobileDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('knowledge-agent-mobile', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onerror = () => { database = undefined; reject(new Error('无法打开本机知识库，请退出无痕浏览并允许网站保存数据。')); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
  });
  return database;
}

// Read/modify/write happens in a single IndexedDB transaction, including across tabs.
// UI state is never acknowledged as saved until the transaction commits.
export async function updateMobileState(change: (state: MobileState) => void): Promise<MobileState> {
  const db = await openMobileDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('library', 'readwrite');
    const store = transaction.objectStore('library');
    const request = store.get('state');
    let state: MobileState;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        state = request.result ?? emptyState();
        if (state.version !== 1) throw new Error('本机资料版本不兼容，请先导出备份。');
        change(state);
        store.put(state, 'state');
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { window.dispatchEvent(new Event('mobile-library-changed')); resolve(state); };
    transaction.onabort = transaction.onerror = () => reject(failure ?? new Error('保存失败：本机空间不足或数据库不可用。请复制当前正文备份后重试。'));
  });
}
export async function readMobileState(): Promise<MobileState> {
  const db = await openMobileDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('library', 'readonly').objectStore('library').get('state');
    request.onsuccess = () => resolve(request.result ?? emptyState());
    request.onerror = () => reject(request.error);
  });
}
export function newDocument(name = '未命名笔记.md', text = ''): LibraryDocument {
  return { id: `mobile:${crypto.randomUUID()}`, rootId: 'mobile', path: name,
    revision: '', size: new TextEncoder().encode(text).length, updatedAt: Date.now(), text,
    issue: null, status: 'pending', summary: '', category: '', categories: [], tags: [], tips: [], metadataVersion: 0 };
}
export async function saveMobileDocument(doc: LibraryDocument, expectedEditId?: string) {
  if (new TextEncoder().encode(doc.text).length > 1024 * 1024 || doc.text.includes('\0')) throw new Error('正文最多 1 MB，且不能包含二进制内容。');
  if (doc.summary.length > 6000 || doc.tags.length > 20 || doc.tags.some(tag => tag.length > 60)) throw new Error('摘要或标签超过限制。');
  return updateMobileState(state => {
    const existing = state.documents.find(item => item.doc.id === doc.id || item.localId === doc.id);
    if (existing && expectedEditId !== existing.editId) throw new Error('这篇资料已在另一个页面或同步中更新。你的输入仍在，请复制后返回重新打开。');
    const savedDoc = existing?.base && existing.doc.id !== doc.id
      ? { ...doc, id: existing.doc.id, rootId: existing.doc.rootId, path: existing.doc.path, revision: existing.doc.revision } : doc;
    const entry: LocalDocument = { ...existing, localId: existing?.localId ?? doc.id, doc: { ...savedDoc, updatedAt: Date.now() }, base: existing?.base ?? null,
      pending: true, editId: crypto.randomUUID() };
    if (existing) state.documents[state.documents.indexOf(existing)] = entry;
    else {
      if (state.documents.length >= 1500) throw new Error('最多保存 1500 份资料。');
      state.documents.unshift(entry);
    }
  });
}
export function sameVersion(a: LibraryDocument | null | undefined, b: LibraryDocument | null | undefined) {
  return Boolean(a && b && a.revision === b.revision && (a.metadataVersion ?? 0) === (b.metadataVersion ?? 0));
}
export async function mergeSnapshot(snapshot: LibrarySnapshot, serverId: string) {
  return updateMobileState(state => {
    if (state.serverId && state.serverId !== serverId) throw new Error('这是另一台电脑的知识库，已停止同步以免混合资料。请先导出本机备份。');
    state.serverId = serverId;
    state.roots = snapshot.roots;
    const incoming = new Map(snapshot.documents.map(doc => [doc.id, doc]));
    for (const entry of state.documents) {
      if (!entry.base) continue;
      const remote = incoming.get(entry.doc.id);
      incoming.delete(entry.doc.id);
      if (entry.pending) {
        // Keep local changes intact. The server also checks versions before writing.
        // Leave conflict detection to the write endpoint, which can recognize a
        // previously committed operation whose response was lost on the network.
      } else if (remote) {
        if (!sameVersion(entry.doc, remote)) entry.editId = crypto.randomUUID();
        entry.doc = remote; entry.base = remote; delete entry.conflict;
      } else {
        // Never erase an offline copy because a folder was removed/unavailable remotely.
        entry.conflict = null;
      }
    }
    for (const doc of incoming.values()) state.documents.push({ doc, base: doc, pending: false, editId: crypto.randomUUID() });
  });
}
export async function resolveConflict(id: string, choice: 'remote' | 'both') {
  return updateMobileState(state => {
    const entry = state.documents.find(item => item.doc.id === id);
    if (!entry || entry.conflict === undefined) return;
    if (choice === 'both') {
      const copy = newDocument(`${entry.doc.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')}（手机保留版）.md`, entry.doc.text);
      state.documents.unshift({ doc: { ...entry.doc, ...copy, summary: entry.doc.summary, tags: entry.doc.tags, categories: entry.doc.categories, category: entry.doc.category, tips: entry.doc.tips }, base: null, pending: true, editId: crypto.randomUUID() });
    }
    if (entry.conflict) {
      entry.doc = entry.conflict; entry.base = entry.conflict; entry.pending = false; entry.editId = crypto.randomUUID(); delete entry.conflict;
    } else {
      if (choice !== 'both') throw new Error('电脑已移除这份资料，请选择保留手机副本。');
      state.documents = state.documents.filter(item => item !== entry);
    }
  });
}
