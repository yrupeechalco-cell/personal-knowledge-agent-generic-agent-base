import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import "./local-cli.css";

interface Status { enabled: boolean; ready: boolean; appVersion: string; cliPath: string; capabilityCount: number; running: number; error?: string }
export function LocalCliPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const show = () => { setOpen(true); setError(""); void invoke<Status>("local_cli_status").then(setStatus).catch(e => setError(String(e))); };
    window.addEventListener("open-local-cli", show);
    return () => window.removeEventListener("open-local-cli", show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (!open) return null;
  const command = status?.cliPath ? `& '${status.cliPath.replaceAll("'", "''")}' capabilities` : "";
  return <div className="local-cli-overlay"><section className="local-cli-panel" role="dialog" aria-modal="true" aria-labelledby="local-cli-title">
    <header><h2 id="local-cli-title">Codex CLI 连接</h2><button aria-label="关闭 Codex CLI 设置" onClick={() => setOpen(false)}>×</button></header>
    <p>开启后，本机 Codex 可以读取资料、修改分类与标签、编辑笔记和画布、切换功能、启动英语学习。</p>
    <div className="local-cli-state"><strong>{status?.enabled ? "已开启" : "未开启"}</strong><span>{status?.enabled ? (status.ready ? `软件已就绪 · ${status.capabilityCount} 个命令` : "等待软件就绪") : "原有 Agent 可照常使用"}</span></div>
    <p>连接只在这台电脑和当前 Windows 账户内使用。只有指定的文件夹会被操作；关闭通道会取消排队任务，已开始的保存会完成。</p>
    <button className="local-cli-toggle" disabled={busy || !status} onClick={async () => {
      setBusy(true); setError("");
      try { setStatus(await invoke<Status>("local_cli_configure", { enabled: !status?.enabled })); }
      catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}>{busy ? "正在设置…" : status?.enabled ? "关闭 CLI 通道" : "允许 Codex 操作软件"}</button>
    {command && <><h3>提供给 Codex 的入口</h3><pre>{command}</pre><button onClick={() => { void navigator.clipboard.writeText(command).catch(e => setError(`复制失败：${String(e)}`)); }}>复制命令</button></>}
    <p className="local-cli-footnote">TypeWords 目前开放启动、停止和进入页面；插件内部的词典与学习记录尚未提供 CLI。笔记修改有撤销备份，资料标注仍保存在 App 索引中。</p>
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
  </section></div>;
}
