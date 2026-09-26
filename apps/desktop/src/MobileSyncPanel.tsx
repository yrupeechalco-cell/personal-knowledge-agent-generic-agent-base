import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import './mobile-sync.css';

export function MobileSyncPanel() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('open-mobile-sync', show);
    return () => window.removeEventListener('open-mobile-sync', show);
  }, []);
  if (!open) return null;
  return <div className="mobile-sync-overlay" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="mobile-sync-title" className="mobile-sync-panel">
    <header><h2 id="mobile-sync-title">设备与卡片同步</h2><button onClick={() => setOpen(false)} aria-label="关闭手机同步设置">×</button></header>
    <p>这一版先在电脑端试用知识卡片。请从左侧「文件知识库」进入「知识卡片」，整理标注、选择共享范围并预览可共享内容。</p>
    <p>同账户的手机卡片同步将在下一步接入。设为「可共享」表示允许卡片进入导出范围，目前尚未上传到任何账户。</p>
    <p>旧版正文和附件自动同步已暂停。电脑原件和手机已保存的资料仍在各自设备。</p>
    <button disabled={busy} onClick={async () => { setBusy(true); try { await invoke('mobile_sync_disable'); setMessage('旧设备配对已撤销。'); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }}>撤销旧设备配对</button>
    {message && <p role="status">{message}</p>}
  </section></div>;
}
