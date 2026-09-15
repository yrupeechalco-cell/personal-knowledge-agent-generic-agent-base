import { useEffect, useState } from "react";
import { TYPEWORDS_PLUGIN, checkTypeWords } from "./typewords";

export function TypeWordsPlugin() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(TYPEWORDS_PLUGIN.storageKey) !== "false"; } catch { return true; }
  });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"checking" | "ready" | "offline">("checking");
  const [preferenceError, setPreferenceError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    setStatus("checking");
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    checkTypeWords(controller.signal)
      .then(() => { if (!disposed) setStatus("ready"); })
      .catch(() => { if (!disposed) setStatus("offline"); })
      .finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [enabled, attempt]);

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(TYPEWORDS_PLUGIN.storageKey, String(next)); setPreferenceError(false); }
    catch { setPreferenceError(true); }
  }

  return <section className="typewords-plugin" aria-label="TypeWords 英语学习插件">
    <header className="typewords-plugin-toolbar">
      <div><strong>英语学习</strong><small>TypeWords · 本地插件</small></div>
      <div className="typewords-plugin-actions">
        {enabled && <button type="button" onClick={() => setAttempt((value) => value + 1)}>重新连接</button>}
        <a href={TYPEWORDS_PLUGIN.entryUrl} target="_blank" rel="noopener noreferrer">独立打开</a>
        <button type="button" onClick={toggleEnabled}>{enabled ? "停用插件" : "启用插件"}</button>
      </div>
    </header>
    {preferenceError && <p role="status">本次设置已生效，但未能保存到下次启动。</p>}
    {!enabled ? <div className="typewords-plugin-empty"><h2>英语学习插件已停用</h2><p>启用后即可练习单词和文章。停用不会删除学习记录。</p></div>
      : status === "checking" ? <div className="typewords-plugin-empty" role="status">正在连接本机 TypeWords…</div>
      : status === "offline" ? <div className="typewords-plugin-empty" role="status"><h2>尚未连接 TypeWords</h2><p>请运行“启动知识库与英语学习.cmd”，或先运行 TypeWords 文件夹里的“启动 TypeWords.cmd”。</p><p>启动后点击“重新连接”。若浏览器限制内嵌页面，可使用“独立打开”。</p><code>{TYPEWORDS_PLUGIN.entryUrl}</code></div>
      : <iframe key={attempt} src={TYPEWORDS_PLUGIN.entryUrl} title="TypeWords 英语学习" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" allow="autoplay; fullscreen" referrerPolicy="no-referrer" />}
  </section>;
}
