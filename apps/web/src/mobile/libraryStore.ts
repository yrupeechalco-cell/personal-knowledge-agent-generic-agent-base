import type { LibraryDocument, LibrarySnapshot } from '@knowledge-agent/workspace';
import { checkMediaStorage, MEDIA_CHUNK_BYTES, mediaType, validateMedia } from './media';
import { readImportedVault } from '../importedVault';

export interface LocalDocument {
  doc: LibraryDocument;
  localId?: string;
  base: LibraryDocument | null;
  pending: boolean;
  editId: string;
  conflict?: LibraryDocument | null;
  attachment?: { key: string; revision: string };
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
    const request = indexedDB.open('knowledge-agent-mobile', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('library')) request.result.createObjectStore('library');
      if (!request.result.objectStoreNames.contains('attachments')) request.result.createObjectStore('attachments');
    };
    request.onerror = () => { database = undefined; reject(new Error('无法打开本机知识库，请退出无痕浏览并允许网站保存数据。')); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; cleanupAbandonedAttachments(request.result); resolve(request.result); };
  });
  return database;
}

function cleanupAbandonedAttachments(db: IDBDatabase) {
  const tx = db.transaction(['library', 'attachments'], 'readwrite');
  const state = tx.objectStore('library').get('state');
  state.onsuccess = () => {
    if (state.result && state.result.version !== 1) return;
    const used = new Set((state.result as MobileState | undefined)?.documents.flatMap(item => item.attachment ? [item.attachment.key] : []) ?? []);
    const cursor = tx.objectStore('attachments').openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (item.value.stagedAt < Date.now() - 86400000 && !used.has(String(item.key))) deleteAttachmentInTransaction(tx, String(item.key));
      item.continue();
    };
  };
}

// Read/modify/write happens in a single IndexedDB transaction, including across tabs.
// UI state is never acknowledged as saved until the transaction commits.
export async function updateMobileState(change: (state: MobileState) => void, attachments: { key: string; blob: Blob }[] = []): Promise<MobileState> {
  // WebKit may fail to persist file-backed Blob objects. Store portable binary
  // buffers, preparing them before starting the atomic IndexedDB transaction.
  const binaries = await Promise.all(attachments.map(async ({ key, blob }) => ({ key, value: { bytes: await blob.arrayBuffer(), mime: blob.type } })));
  const db = await openMobileDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['library', 'attachments'], 'readwrite');
    const store = transaction.objectStore('library');
    const request = store.get('state');
    let state: MobileState;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        state = request.result ?? emptyState();
        if (state.version !== 1) throw new Error('本机资料版本不兼容，请先导出备份。');
        const previousKeys = new Set(state.documents.flatMap(entry => entry.attachment ? [entry.attachment.key] : []));
        change(state);
        const retainedKeys = new Set(state.documents.flatMap(entry => entry.attachment ? [entry.attachment.key] : []));
        for (const key of previousKeys) if (!retainedKeys.has(key)) deleteAttachmentInTransaction(transaction, key);
        for (const binary of binaries) transaction.objectStore('attachments').put(binary.value, binary.key);
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
async function attachmentValue(key: string): Promise<{ bytes: ArrayBuffer; mime: string; chunks?: number; size?: number } | Blob | undefined> {
  const db = await openMobileDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('attachments').objectStore('attachments').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function deleteAttachmentInTransaction(tx: IDBTransaction, key: string) {
  const store = tx.objectStore('attachments'); const request = store.get(key);
  request.onsuccess = () => { for (let part = 0; part < (request.result?.chunks ?? 0); part++) store.delete(`${key}:${part}`); store.delete(key); };
}
export async function readAttachmentRange(key: string, offset = 0, length = MEDIA_CHUNK_BYTES): Promise<Blob | undefined> {
  const value = await attachmentValue(key);
  if (!value) return;
  if (value instanceof Blob) return value.slice(offset, offset + length, value.type);
  if (!value.chunks) return new Blob([value.bytes], { type: value.mime }).slice(offset, offset + length, value.mime);
  const parts: BlobPart[] = [];
  const end = Math.min(value.size!, offset + length);
  for (let part = Math.floor(offset / MEDIA_CHUNK_BYTES); part * MEDIA_CHUNK_BYTES < end; part++) {
    const chunk = await attachmentValue(`${key}:${part}`);
    if (!chunk || chunk instanceof Blob) throw new Error('附件分块不完整，请重新导入或下载。');
    const begin = Math.max(offset - part * MEDIA_CHUNK_BYTES, 0);
    const limit = Math.min(end - part * MEDIA_CHUNK_BYTES, chunk.bytes.byteLength);
    parts.push(new Blob([chunk.bytes], { type: value.mime }).slice(begin, limit));
  }
  return new Blob(parts, { type: value.mime });
}
export async function readAttachment(key: string): Promise<Blob | undefined> {
  const value = await attachmentValue(key);
  if (!value) return;
  if (value instanceof Blob) return value;
  return readAttachmentRange(key, 0, value.size ?? value.bytes.byteLength);
}
async function putAttachmentValue(key: string, value: unknown) {
  const db = await openMobileDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('attachments', 'readwrite'); tx.objectStore('attachments').put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('附件保存失败，可能是手机空间不足。原文件仍保留，请腾出空间后重试。'));
  });
}
export async function stageAttachment(name: string, size: number, mime: string, readPart: (offset: number) => Promise<Blob>, onProgress?: (message: string) => void) {
  const key = crypto.randomUUID(); const chunks = Math.ceil(size / MEDIA_CHUNK_BYTES);
  // The manifest is recorded first, so interrupted staging can be identified and removed.
  await putAttachmentValue(key, { chunks, size, mime, stagedAt: Date.now() });
  try {
    for (let offset = 0; offset < size; offset += MEDIA_CHUNK_BYTES) {
      const part = await readPart(offset);
      if (part.size !== Math.min(MEDIA_CHUNK_BYTES, size - offset)) throw new Error('附件分块大小不符，传输已停止。');
      await putAttachmentValue(`${key}:${offset / MEDIA_CHUNK_BYTES}`, { bytes: await part.arrayBuffer(), mime });
      onProgress?.(`${name} · ${Math.round(Math.min(size, offset + part.size) / size * 100)}%`);
    }
    return key;
  } catch (e) { await discardAttachment(key); if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new Error('浏览器存储空间不足，未导入。原文件仍保留，请释放空间后重试。'); throw e; }
}
export async function discardAttachment(key: string) {
  const db = await openMobileDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('attachments', 'readwrite'); deleteAttachmentInTransaction(tx, key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); });
}
export async function attachStagedFile(id: string, revision: string, key: string) {
  try {
    await updateMobileState(state => {
      const entry = state.documents.find(item => item.doc.id === id);
      if (!entry || entry.doc.revision !== revision) throw new Error('附件已更新，请重新打开。');
      entry.attachment = { key, revision };
    });
  } catch (e) { await discardAttachment(key); throw e; }
}
export async function importMobileFiles(files: File[], onProgress?: (message: string) => void) {
  if (!files.length) return;
  await checkMediaStorage(files.reduce((sum, file) => sum + file.size, 0));
  const entries: LocalDocument[] = []; const staged: string[] = [];
  try {
  for (const file of files) {
    if (/[\\/]/.test(file.name)) throw new Error('文件名不能包含路径分隔符。');
    const media = mediaType(file.name);
    if (media) {
      await validateMedia(file, file.name);
      const doc = { ...newDocument(file.name), size: file.size };
      const key = await stageAttachment(file.name, file.size, media.mime, async offset => file.slice(offset, offset + MEDIA_CHUNK_BYTES, media.mime), onProgress);
      staged.push(key);
      entries.push({ doc, attachment: { key, revision: '' }, localId: doc.id, base: null, pending: true, editId: crypto.randomUUID() });
    } else {
      const vault = await readImportedVault([file]);
      for (const note of vault?.files ?? []) {
        if (new TextEncoder().encode(note.content).length > 1024 * 1024) throw new Error(`${file.name}：文字正文最多 1 MB。`);
        const doc = newDocument(note.path, note.content);
        entries.push({ doc, localId: doc.id, base: null, pending: true, editId: crypto.randomUUID() });
      }
    }
  }
  // Publish the entire batch only after all binary chunks are durable.
  await updateMobileState(state => {
    if (state.documents.length + entries.length > 1500) throw new Error('最多保存 1500 份资料。');
    state.documents.unshift(...entries);
  });
  } catch (e) { for (const key of staged) await discardAttachment(key); throw e; }
}
export async function cacheAttachment(id: string, revision: string, blob: Blob) {
  const key = crypto.randomUUID();
  await updateMobileState(state => {
    const entry = state.documents.find(item => item.doc.id === id);
    if (!entry || entry.doc.revision !== revision) throw new Error('附件已更新，请重新打开。');
    entry.attachment = { key, revision };
  }, [{ key, blob }]);
  return blob;
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
    if (existing && mediaType(existing.doc.path) && (savedDoc.path !== existing.doc.path || savedDoc.text !== existing.doc.text)) throw new Error('附件原文件不可在正文编辑器中修改。');
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
      const media = mediaType(entry.doc.path);
      if (media && (!entry.attachment || entry.attachment.revision !== entry.doc.revision)) throw new Error('此附件原版尚未保存在手机，无法创建手机副本。请先导出分类信息或使用电脑版本。');
      const ext = media ? entry.doc.path.split('.').pop() : 'md';
      const copy = newDocument(`${entry.doc.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')}（手机保留版）.${ext}`, entry.doc.text);
      state.documents.unshift({ doc: { ...entry.doc, ...copy, size: media ? entry.doc.size : copy.size, summary: entry.doc.summary, tags: entry.doc.tags, categories: entry.doc.categories, category: entry.doc.category, tips: entry.doc.tips }, attachment: media ? { key: entry.attachment!.key, revision: '' } : undefined, base: null, pending: true, editId: crypto.randomUUID() });
    }
    if (entry.conflict) {
      entry.doc = entry.conflict; entry.base = entry.conflict; entry.pending = false; entry.editId = crypto.randomUUID(); delete entry.conflict;
    } else {
      if (choice !== 'both') throw new Error('电脑已移除这份资料，请选择保留手机副本。');
      state.documents = state.documents.filter(item => item !== entry);
    }
  });
}
