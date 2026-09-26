import type { LibraryDocument, LibrarySnapshot } from '@knowledge-agent/workspace';
import { mergeSnapshot, readMobileState, updateMobileState, type LocalDocument } from './libraryStore';

let running: Promise<void> | undefined;
async function request(path: string, token: string, body?: unknown) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/mobile/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store' });
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
    const { status, data: result } = await request('change', token, { operationId: sent.editId,
      base: sent.base ? { revision: sent.base.revision, metadataVersion: sent.base.metadataVersion ?? 0 } : null, doc: sent.doc });
    await updateMobileState(next => {
      const local = next.documents.find(entry => entry.doc.id === sent.doc.id);
      if (!local) return;
      if (status === 409) { local.conflict = result.document ?? null; return; }
      const remote = result.document as LibraryDocument;
      if (!remote?.id) throw new Error('同步响应不完整，待同步修改已保留。');
      next.documents = next.documents.filter(entry => entry === local || entry.doc.id !== remote.id);
      // An edit made while the network was waiting must survive the response.
      local.base = remote;
      if (local.editId === sent.editId) { local.doc = remote; local.pending = false; }
      else { local.doc.id = remote.id; local.doc.rootId = remote.rootId; local.doc.path = remote.path; local.doc.revision = remote.revision; }
      delete local.conflict;
    });
  }
  await updateMobileState(next => { next.lastSync = Date.now(); });
}
