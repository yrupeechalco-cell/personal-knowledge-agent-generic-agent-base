import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import './mobile-sync.css';

interface SyncStatus { enabled: boolean; running: boolean; urls: string[]; inbox: string; error?: string }
export function MobileSyncPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const show = () => { setOpen(true); void operate('mobile_sync_status'); };
    window.addEventListener('open-mobile-sync', show);
    const unlisten = isTauri() ? listen('mobile-library-changed', () => window.dispatchEvent(new Event('knowledge-library-changed'))) : Promise.resolve(() => {});
    return () => { window.removeEventListener('open-mobile-sync', show); void unlisten.then(stop => stop()); };
  }, []);
  async function operate(command: string) {
    setBusy(true); setError('');
    try { setStatus(await invoke<SyncStatus>(command)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  const url = status?.urls.find(value => !value.includes('127.0.0.1'));
  return <div className="mobile-sync-overlay" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="mobile-sync-title" className="mobile-sync-panel"><header><h2 id="mobile-sync-title">手机同步</h2><button onClick={() => setOpen(false)} aria-label="关闭手机同步设置">×</button></header><p>电脑与手机各自保存资料，在同一 Wi-Fi 下自动交换修改。</p>{(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    {status?.running ? <><p>已开启 · 分享「文件知识库」中已选择的资料目录。手机的正文编辑会写回原文件，分类整理保存在 App 索引中。</p>{url ? <div className="mobile-sync-qr"><QRCodeSVG value={url} size={220} marginSize={3}/><strong>用 iPhone 相机扫描后，在 Safari 打开</strong><small>二维码包含本次设备授权，请勿转发给他人。</small></div> : <p>没有找到局域网地址，请连接 Wi-Fi 或有线网络后重新打开本窗口。</p>}<label>连接地址<input readOnly value={url ?? status.urls[0] ?? ''} onFocus={e => e.target.select()}/></label><p>手机新笔记保存到：<br/><code>{status.inbox}</code></p><button disabled={busy} onClick={() => void operate('mobile_sync_choose_inbox')}>更换新笔记保存文件夹</button><p>电脑 App 和手机页面保持打开时，每 15 秒同步。两端都修改的内容会保留两个版本供选择。</p><p>仅在你信任的局域网使用；当前连接使用 HTTP，不提供互联网中继或传输加密。</p><button disabled={busy} onClick={() => void operate('mobile_sync_disable')}>关闭同步并撤销当前配对</button></> : <><p>首次开启时选择一个文件夹，用于保存手机新建的笔记。电脑原有的文件位置不会改变。</p><button disabled={busy} onClick={() => void operate('mobile_sync_enable')}>{busy ? '正在开启…' : '选择保存文件夹并开启同步'}</button></>}
  </section></div>;
}
