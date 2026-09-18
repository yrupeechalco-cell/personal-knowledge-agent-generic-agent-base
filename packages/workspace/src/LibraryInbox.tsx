import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, RefreshCw, Search, FileText, FolderSearch, Sparkles } from "lucide-react";
import type { ModelRequest } from "@knowledge-agent/agent";
import { librarySummaryRequest, parseLibrarySuggestion, searchLibrary, type LibraryAdapter, type LibraryDocument, type LibraryFilter, type LibraryReview, type LibrarySnapshot } from "./libraryModel";

interface Props { adapter?: LibraryAdapter; runModel?: (request: ModelRequest) => Promise<string>; model: string; modelReady: boolean; visible: boolean }
const EMPTY: LibrarySnapshot = { version: 1, roots: [], documents: [] };
const STATUS = { pending: "待整理", reviewed: "已整理", ignored: "已忽略" };

export function LibraryInbox({ adapter, runModel, model, modelReady, visible }: Props) {
  const [data, setData] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("pending");
  const [selected, setSelected] = useState("");
  const [detailDirty, setDetailDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [autoScan, setAutoScan] = useState(true);
  // Persisted pause belongs to each root. This switch only controls the current App session.
  const operate = useCallback(async (operation: () => Promise<LibrarySnapshot>, message = "") => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { const next = await operation(); if (alive.current) { setData(next); if (message) setNotice(message); } }
    catch (reason) { if (alive.current) setError(String(reason)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (adapter) void operate(adapter.load);
    return () => { alive.current = false; };
  }, [adapter, operate]);
  useEffect(() => {
    if (!adapter || !autoScan) return;
    // Keep running when the inbox tab is hidden. Native extraction runs off the UI thread.
    const interval = window.setInterval(() => { void operate(adapter.scan); }, 30000);
    return () => window.clearInterval(interval);
  }, [adapter, autoScan, operate]);
  const results = useMemo(() => searchLibrary(data.documents, query, filter), [data.documents, query, filter]);
  const document = data.documents.find((item) => item.id === selected);
  return <section className="library-host" hidden={!visible} aria-label="资料收件箱">
    <div className="library-heading">
      <div><h2><FolderSearch size={21} />资料收件箱</h2><p>让电脑里的资料可以查找、回顾和整理</p></div>
      <div className="library-actions">
        <button disabled={!adapter || busy} onClick={() => adapter && void operate(adapter.scan, "扫描完成，请查看目录状态和文件提示。")}><RefreshCw size={15} />{busy ? "处理中…" : "立即扫描"}</button>
        <button className="library-primary" disabled={!adapter || busy} onClick={() => adapter && void operate(adapter.addFolder)}><FolderPlus size={15} />添加监测文件夹</button>
      </div>
    </div>
    {!adapter ? <div className="library-empty"><FolderSearch size={32} /><h3>请在正式安装的 App 中添加资料</h3><p>电脑文件监测需要桌面 App。这里可以预览界面；浏览器中不会扫描你的电脑。</p></div> : <>
      <div className="library-settings"><label><input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />本次运行自动扫描（每 30 秒）</label><span>共 {data.documents.length} 份资料 · {data.documents.filter((d) => d.status === "pending").length} 份待整理</span></div>
      {error && <p className="library-error" role="alert">{error}<button disabled={busy} onClick={() => void operate(adapter.load)}>重试读取</button></p>}
      {notice && <p className="library-notice" role="status">{notice}</p>}
      <details className="library-roots" open={data.roots.length === 0 ? true : undefined}>
        <summary>监测文件夹（{data.roots.length}）{data.roots.some((r) => r.issue) ? " · 有目录需要检查" : ""}</summary>
        {data.roots.length === 0 && <p>添加一个存放日常资料的文件夹。只会读取你选择的目录；文件仍保留在原来的位置。</p>}
        {data.roots.map((root) => <div className="library-root" key={root.id}>
          <div><strong title={root.path}>{root.path}</strong><small>{root.paused ? "已暂停" : root.lastScan ? `上次扫描 ${new Date(root.lastScan).toLocaleString()}` : "等待扫描"}</small>{root.issue && <small className="library-error">{root.issue}</small>}</div>
          <button disabled={busy} onClick={() => void operate(() => adapter.updateRoot(root.id, root.paused ? "resume" : "pause"))}>{root.paused ? "恢复" : "暂停"}</button>
          <button disabled={busy} onClick={() => setRemoveId(root.id)}>移除</button>
          {removeId === root.id && <div className="library-remove"><span>移除此目录的索引和整理卡片，原文件保留。</span><button disabled={busy} onClick={() => { setRemoveId(""); void operate(() => adapter.updateRoot(root.id, "remove")); }}>确认移除索引</button><button onClick={() => setRemoveId("")}>取消</button></div>}
        </div>)}
      </details>
      <div className="library-search"><Search size={17} /><input aria-label="搜索资料正文" placeholder="搜索文件名、正文、摘要或标签…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="library-filters" role="group" aria-label="资料状态">{([["pending", "待整理"], ["reviewed", "已整理"], ["all", "全部"], ["issues", "读取提示"], ["ignored", "已忽略"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}{value === "issues" ? ` ${data.documents.filter((d) => d.issue).length}` : ""}</button>)}<span>{results.length} 个结果</span></div>
      <div className="library-columns">
        <div className="library-list" aria-label="资料列表">
          {results.length === 0 && <div className="library-empty"><FileText size={26} /><h3>{data.roots.length === 0 ? "从一个资料文件夹开始" : query ? "没有找到匹配资料" : "这里暂时没有资料"}</h3><p>{query ? "试试正文中的关键词，或切换到「全部」。" : "添加文件或保存修改后，点击「立即扫描」即可检查结果。"}</p></div>}
          {results.map((doc) => <button className={`library-item${selected === doc.id ? " selected" : ""}`} key={doc.id} onClick={() => { if (doc.id === selected) return; if (detailDirty) setPendingSelection(doc.id); else setSelected(doc.id); }}><strong><FileText size={15} />{doc.path.split("/").pop()}</strong><small title={doc.path}>{doc.path}</small><p>{doc.issue || doc.summary || doc.text.slice(0, 100) || "文件正文为空"}</p><span>{STATUS[doc.status]} · {(doc.size / 1024).toFixed(1)} KB{doc.issue ? " · 未收录正文" : ""}</span></button>)}
        </div>
        <div className="library-detail">{pendingSelection && <div className="library-remove" role="alert"><span>当前资料有未保存的整理内容。</span><button onClick={() => { setSelected(pendingSelection); setPendingSelection(""); setDetailDirty(false); }}>放弃修改并切换</button><button onClick={() => setPendingSelection("")}>继续编辑</button></div>}{document ? <DocumentDetail key={`${document.id}:${document.revision}:${document.issue ?? ""}`} doc={document} rootPath={data.roots.find((r) => r.id === document.rootId)?.path ?? ""} adapter={adapter} busy={busy} model={model} modelReady={modelReady} runModel={runModel} onDirty={setDetailDirty} onSave={(review) => operate(() => adapter.saveReview(review), "整理结果已保存到本机索引，原文件未改动。")}/> : <div className="library-empty"><FileText size={30} /><h3>选择一份资料</h3><p>查看正文，编辑摘要、分类和标签。确认后可导出为知识库里的 Markdown 卡片。</p></div>}</div>
      </div>
    </>}
    <details className="library-help"><summary>收录范围与使用说明</summary><p>支持 UTF-8 编码的 Markdown、TXT、CSV、TSV、JSON、YAML、XML、HTML，以及 DOCX 的正文。文本/Word 解压正文上限 1 MB，Word 文件上限 20 MB；PDF、图片、旧版 Word、Excel 等暂只收录文件名并提示。正文索引总量 16 MB，最多 1500 个文件、10 个不重叠目录。</p><p>自动扫描仅在 App 运行时进行；退出后停止，下次打开会继续。跳过隐藏目录、系统链接、缓存/构建目录，以及名称含密码、secret、token 等的路径。资料卡片存在本机索引中；移除目录会移除这些卡片，可先导出保存。</p><p>本地扫描和搜索不会调用 AI。点击「AI 生成建议」才会将选中文件名与正文前 12000 字符发送给当前模型，结果需要你检查并保存。源文件更新后会清空旧建议并回到待整理。</p></details>
  </section>;
}

function DocumentDetail({ doc, rootPath, adapter, busy, model, modelReady, runModel, onSave, onDirty }: { doc: LibraryDocument; rootPath: string; adapter: LibraryAdapter; busy: boolean; model: string; modelReady: boolean; runModel?: Props["runModel"]; onSave: (review: LibraryReview) => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const [summary, setSummary] = useState(doc.summary);
  const [category, setCategory] = useState(doc.category);
  const [tags, setTags] = useState(doc.tags.join("、"));
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = summary !== doc.summary || category !== doc.category || tags !== doc.tags.join("、");
  useEffect(() => { onDirty(dirty || generating); return () => onDirty(false); }, [dirty, generating, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = (status: LibraryReview["status"]) => onSave({ id: doc.id, revision: doc.revision, status, summary, category, tags: tags.split(/[、,，\n]/).map((tag) => tag.trim()).filter(Boolean) });
  async function generate() {
    if (!runModel || !modelReady || generating) return;
    setGenerating(true); setMessage("");
    try {
      const suggestion = parseLibrarySuggestion(await runModel(librarySummaryRequest(doc, model)));
      if (mounted.current) { setSummary(suggestion.summary); setCategory(suggestion.category); setTags(suggestion.tags.join("、")); setMessage("建议已生成，请检查内容后点击「保存整理」。"); }
    } catch (error) { if (mounted.current) setMessage(`生成失败：${String(error)}`); }
    finally { if (mounted.current) setGenerating(false); }
  }
  return <article>
    <h3>{doc.path.split("/").pop()}</h3><p className="library-path">{rootPath} / {doc.path}</p>
    <p className="library-meta">{STATUS[doc.status]} · 索引更新于 {new Date(doc.updatedAt).toLocaleString()}</p>
    {doc.issue && <p className="library-error">{doc.issue}</p>}
    <details className="library-content"><summary>查看已收录正文（{doc.text.length} 字符）</summary><pre>{doc.text || "没有可预览的正文"}</pre></details>
    <div className="library-ai"><button disabled={!modelReady || !runModel || !doc.text.trim() || generating || busy || Boolean(doc.issue)} onClick={() => void generate()}><Sparkles size={15} />{generating ? "正在生成…" : "AI 生成建议"}</button><small>{modelReady ? `当前模型：${model}。点击会发送文件名与最多 12000 字符正文。` : "请先在设置中连接模型；也可以手动填写下方内容。"}</small></div>
    {message && <p className="library-notice" role="status">{message}</p>}
    <label>摘要<textarea aria-label="资料摘要" maxLength={6000} disabled={generating} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="记录这份资料的要点…" /></label>
    <label>分类<input aria-label="资料分类" maxLength={100} disabled={generating} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例如：英语学习" /></label>
    <label>标签<input aria-label="资料标签" disabled={generating} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号或顿号分隔" /></label>
    <div className="library-actions"><button className="library-primary" disabled={busy || generating} onClick={() => void save("reviewed")}>保存整理</button><button disabled={busy || generating} onClick={() => void save(doc.status === "ignored" ? "pending" : "ignored")}>{doc.status === "ignored" ? "放回待整理" : "忽略此资料"}</button><button disabled={busy || generating || dirty || !doc.summary.trim()} title={dirty ? "请先保存整理" : "导出已保存的整理卡片"} onClick={async () => { try { const path = await adapter.exportCard(doc.id, doc.revision); if (mounted.current) setMessage(path ? `已导出：${path}` : "已取消导出。"); } catch (error) { if (mounted.current) setMessage(String(error)); } }}>导出卡片</button></div>
    {dirty && <small className="library-unsaved">有未保存的整理内容；请保存后再切换资料。后台发现源文件更新时，旧建议会失效。</small>}
  </article>;
}
