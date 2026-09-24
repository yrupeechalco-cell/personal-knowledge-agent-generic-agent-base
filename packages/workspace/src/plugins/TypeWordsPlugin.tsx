import { useEffect, useState } from "react";
import { TYPEWORDS_PLUGIN, checkTypeWords, isTypeWordsEnabled, type TypeWordsAdapter } from "./typewords";

export function TypeWordsPlugin({ adapter }: { adapter?: TypeWordsAdapter }) {
  const [enabled, setEnabled] = useState(isTypeWordsEnabled);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"checking" | "ready" | "offline">("checking");
  const [preferenceError, setPreferenceError] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    setStatus("checking");
    setStartupError("");
    const timeout = adapter ? undefined : window.setTimeout(() => controller.abort(), 5000);
    (adapter ? adapter.ensureStarted() : checkTypeWords(controller.signal))
      .then(() => { if (!disposed) setStatus("ready"); })
      .catch((error) => { if (!disposed) { setStatus("offline"); setStartupError(String(error)); } })
      .finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [enabled, attempt, adapter]);

  async function selectDirectory() {
    if (!adapter) return;
    setSelecting(true);
    try {
      if (await adapter.selectDirectory()) setAttempt((value) => value + 1);
    } catch (error) { setStartupError(String(error)); setStatus("offline"); }
    finally { setSelecting(false); }
  }

  async function useBundled() {
    if (!adapter?.useBundled) return;
    setSelecting(true);
    try {
      await adapter.useBundled();
      setAttempt((value) => value + 1);
    } catch (error) { setStartupError(String(error)); setStatus("offline"); }
    finally { setSelecting(false); }
  }

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
        {enabled && <button type="button" disabled={selecting || status === "checking"} onClick={() => setAttempt((value) => value + 1)}>重新连接</button>}
        {adapter?.useBundled && <button type="button" disabled={selecting || (enabled && status === "checking")} onClick={() => void useBundled()}>使用内置版本</button>}
        {adapter && <button type="button" disabled={selecting || (enabled && status === "checking")} onClick={() => void selectDirectory()} title="可选：使用自己构建的 TypeWords">自定义目录</button>}
        <a href={TYPEWORDS_PLUGIN.entryUrl} target="_blank" rel="noopener noreferrer">独立打开</a>
        <button type="button" onClick={toggleEnabled}>{enabled ? "停用插件" : "启用插件"}</button>
      </div>
    </header>
    {preferenceError && <p role="status">本次设置已生效，但未能保存到下次启动。</p>}
    {!enabled ? <div className="typewords-plugin-empty"><h2>英语学习插件已停用</h2><p>启用后即可练习单词和文章。停用不会删除学习记录。</p></div>
      : status === "checking" ? <div className="typewords-plugin-empty" role="status">{adapter ? "正在启动并连接本机 TypeWords…" : "正在连接本机 TypeWords…"}</div>
      : status === "offline" ? <div className="typewords-plugin-empty" role="status"><h2>尚未连接 TypeWords</h2>{adapter ? <><p>{startupError}</p><p>正式安装版已包含英语学习程序和运行环境，无需另外下载。可点击“使用内置版本”恢复，再试“重新连接”；学习记录会保留。</p></> : <><p>请运行“启动知识库与英语学习.cmd”，或先运行 TypeWords 文件夹里的“启动 TypeWords.cmd”。</p><p>启动后点击“重新连接”。若浏览器限制内嵌页面，可使用“独立打开”。</p></>}<code>{TYPEWORDS_PLUGIN.entryUrl}</code></div>
      : <iframe key={attempt} src={TYPEWORDS_PLUGIN.entryUrl} title="TypeWords 英语学习" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals" allow="autoplay; fullscreen" referrerPolicy="no-referrer" onError={() => { setStatus("offline"); setStartupError("英语学习页面加载失败，请重新连接或使用内置版本。"); }} />}
  </section>;
}
