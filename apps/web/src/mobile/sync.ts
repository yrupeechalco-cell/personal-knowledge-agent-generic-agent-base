import type { LibraryDocument, LibrarySnapshot } from '@knowledge-agent/workspace';
import { attachStagedFile, mergeSnapshot, readAttachment, readAttachmentRange, readMobileState, stageAttachment, updateMobileState, type LocalDocument } from './libraryStore';
import { MAX_MEDIA_BYTES, MEDIA_CHUNK_BYTES, mediaType } from './media';

let running: Promise<void> | undefined;
async function request(path: string, token: string, body?: unknown, attachment?: Blob) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), attachment || path === 'media-finish' ? 120000 : 15000);
  try {
    const metadata = new TextEncoder().encode(JSON.stringify(body));
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, metadata.length);
    const payload = attachment ? await new Blob([length, metadata, attachment]).arrayBuffer() : body ? JSON.stringify(body) : undefined;
    const response = await fetch(`/api/mobile/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': attachment ? 'application/octet-stream' : 'application/json' } : {}) },
      body: payload, signal: controller.signal, cache: 'no-store' });
    if (response.status === 401) throw new Error('配对已失效，请在电脑上重新打开「手机同步」并扫描二维码。');
    let data;
    try { data = await response.json(); } catch { throw new Error('电脑同步服务未开启。请在正式 App 中开启「手机同步」。'); }
    if (!response.ok && response.status !== 409) throw new Error(data.error || '暂时无法同步，修改已保存在本机。');
    return { status: response.status, data };
  } finally { window.clearTimeout(timeout); }
}
export async function pairMobile(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('配对信息无效，请扫描电脑上的二维码。');
  const { data } = await request('snapshot', token);
  await mergeSnapshot(data.snapshot as LibrarySnapshot, data.serverId);
  await updateMobileState(state => { state.token = token; });
  void navigator.storage?.persist?.().catch(() => false);
}
export function syncMobile() {
  if (running) return running;
  running = performSync().finally(() => { running = undefined; window.dispatchEvent(new CustomEvent('mobile-transfer-progress', { detail: '' })); });
  return running;
}
async function performSync() {
  let state = await readMobileState();
  if (!state.token) return;
  const token = state.token;
  const { data } = await request('snapshot', token);
  state = await mergeSnapshot(data.snapshot as LibrarySnapshot, data.serverId);
  for (const item of state.documents.filter(entry => entry.pending && entry.conflict === undefined)) {
    const latest = await readMobileState();
    if (latest.token !== token) return;
    const current = latest.documents.find(entry => entry.doc.id === item.doc.id);
    if (!current?.pending || current.conflict !== undefined) continue;
    const sent: LocalDocument = structuredClone(current);
    const needsUpload = !sent.base && mediaType(sent.doc.path);
    if (needsUpload && !data.capabilities?.mediaChunks) throw new Error('电脑 App 版本尚不支持附件分块同步，请更新到 0.3.4 或更新版本。附件已保存在手机。');
    if (needsUpload) {
      if (!sent.attachment) throw new Error('附件原文件未保存在本机，无法同步。请重新导入。');
      for (let offset = 0; offset < sent.doc.size;) {
        if ((await readMobileState()).token !== token) return;
        const part = await readAttachmentRange(sent.attachment.key, offset);
        if (!part?.size) throw new Error('本机附件分块缺失，请重新导入。');
        const uploaded = await request('media-chunk', token, { operationId: sent.editId, name: sent.doc.path, total: sent.doc.size, offset }, part);
        const next = uploaded.data.offset;
        if (!Number.isSafeInteger(next) || next < offset + part.size || next > sent.doc.size || next < sent.doc.size && next % MEDIA_CHUNK_BYTES !== 0) throw new Error('附件续传位置无效，请重试。');
        offset = next;
        window.dispatchEvent(new CustomEvent('mobile-transfer-progress', { detail: `${sent.doc.path} · 上传 ${Math.round(offset / sent.doc.size * 100)}%` }));
      }
    }
    const { status, data: result } = await request(needsUpload ? 'media-finish' : 'change', token, { operationId: sent.editId,
      base: sent.base ? { revision: sent.base.revision, metadataVersion: sent.base.metadataVersion ?? 0 } : null, doc: sent.doc });
    await updateMobileState(next => {
      const local = next.documents.find(entry => entry.doc.id === sent.doc.id);
      if (!local) return;
      if (status === 409) { local.conflict = result.document ?? null; return; }
      const remote = result.document as LibraryDocument;
      if (!remote?.id) throw new Error('同步响应不完整，待同步修改已保留。');
      next.documents = next.documents.filter(entry => entry === local || entry.doc.id !== remote.id);
      local.localId ??= sent.doc.id;
      if (local.attachment && local.attachment.revision === sent.doc.revision) local.attachment.revision = remote.revision;
      // An edit made while the network was waiting must survive the response.
      local.base = remote;
      if (local.editId === sent.editId) { local.doc = remote; local.pending = false; }
      else { local.doc.id = remote.id; local.doc.rootId = remote.rootId; local.doc.path = remote.path; local.doc.revision = remote.revision; }
      delete local.conflict;
    });
  }
  await updateMobileState(next => { next.lastSync = Date.now(); });
}

// Attachments from the computer are downloaded on demand and persist for offline use.
const downloads = new Map<string, { promise: Promise<Blob>; listeners: Set<(message: string) => void> }>();
export function loadMedia(entry: LocalDocument, onProgress?: (message: string) => void): Promise<Blob> {
  const id = JSON.stringify([entry.doc.id, entry.doc.revision]);
  const existing = downloads.get(id);
  if (existing) { if (onProgress) existing.listeners.add(onProgress); return existing.promise; }
  const listeners = new Set(onProgress ? [onProgress] : []);
  const promise = loadMediaOnce(entry, message => listeners.forEach(listener => listener(message)));
  downloads.set(id, { promise, listeners });
  void promise.then(() => downloads.delete(id), () => downloads.delete(id));
  return promise;
}
async function loadMediaOnce(entry: LocalDocument, onProgress?: (message: string) => void): Promise<Blob> {
  const state = await readMobileState();
  const current = state.documents.find(item => item.doc.id === entry.doc.id && item.doc.revision === entry.doc.revision) ?? entry;
  if (current.attachment?.revision === entry.doc.revision) {
    const blob = await readAttachment(current.attachment.key);
    if (blob) return blob;
  }
  if (!entry.base || !state.token) throw new Error('附件尚未下载。请连接已配对的电脑后重试。');
  if (entry.doc.size > MAX_MEDIA_BYTES) throw new Error('此附件超过 1 GB，请在电脑上打开。');
  const format = mediaType(entry.doc.path)!;
  const key = await stageAttachment(entry.doc.path, entry.doc.size, format.mime, async offset => {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 60000);
    try {
    const response = await fetch('/api/mobile/attachment', { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.doc.id, revision: entry.doc.revision, offset }), signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '附件下载失败，请检查电脑同步服务版本及连接。');
    }
    const declared = Number(response.headers.get('Content-Length'));
    const expected = Math.min(MEDIA_CHUNK_BYTES, entry.doc.size - offset);
    if (!Number.isFinite(declared) || declared !== expected) throw new Error('附件大小已变化或响应无效，请重新同步。');
    const blob = await response.blob();
    if (blob.size !== expected) throw new Error('附件下载不完整，请重试。');
    return blob;
    } finally { window.clearTimeout(timer); }
  }, onProgress);
  await attachStagedFile(entry.doc.id, entry.doc.revision, key);
  return (await readAttachment(key))!;
}
