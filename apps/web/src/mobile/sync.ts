import type { LibraryDocument, LibrarySnapshot } from '@knowledge-agent/workspace';
import { cacheAttachment, mergeSnapshot, readAttachment, readMobileState, updateMobileState, type LocalDocument } from './libraryStore';
import { MAX_MEDIA_BYTES, mediaType, validateMedia } from './media';

let running: Promise<void> | undefined;
async function request(path: string, token: string, body?: unknown, attachment?: Blob) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), attachment ? 120000 : 15000);
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
  running = performSync().finally(() => { running = undefined; });
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
    if (needsUpload && !data.capabilities?.media) throw new Error('电脑 App 版本尚不支持附件同步，请更新到 0.3.4 或更新版本。附件已保存在手机。');
    const attachment = needsUpload && sent.attachment ? await readAttachment(sent.attachment.key) : undefined;
    if (needsUpload && !attachment) throw new Error('附件原文件未保存在本机，无法同步。请重新导入。');
    const { status, data: result } = await request(needsUpload ? 'media-change' : 'change', token, { operationId: sent.editId,
      base: sent.base ? { revision: sent.base.revision, metadataVersion: sent.base.metadataVersion ?? 0 } : null, doc: sent.doc }, attachment);
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
export async function loadMedia(entry: LocalDocument): Promise<Blob> {
  if (entry.attachment?.revision === entry.doc.revision) {
    const blob = await readAttachment(entry.attachment.key);
    if (blob) return blob;
  }
  const state = await readMobileState();
  if (!entry.base || !state.token) throw new Error('附件尚未下载。请连接已配对的电脑后重试。');
  if (entry.doc.size > MAX_MEDIA_BYTES) throw new Error('此附件超过 50 MB，请在电脑上打开。');
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch('/api/mobile/attachment', { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.doc.id, revision: entry.doc.revision }), signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '附件下载失败，请检查电脑同步服务版本及连接。');
    }
    const declared = Number(response.headers.get('Content-Length'));
    if (!Number.isFinite(declared) || declared !== entry.doc.size || declared > MAX_MEDIA_BYTES) throw new Error('附件大小已变化或响应无效，请重新同步。');
    const blob = await response.blob();
    if (blob.size !== entry.doc.size) throw new Error('附件下载不完整，请重试。');
    const format = await validateMedia(blob, entry.doc.path);
    return cacheAttachment(entry.doc.id, entry.doc.revision, blob.slice(0, blob.size, format.mime));
  } finally { window.clearTimeout(timer); }
}
