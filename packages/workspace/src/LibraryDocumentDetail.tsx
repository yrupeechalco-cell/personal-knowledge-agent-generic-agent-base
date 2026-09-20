import { useEffect, useRef, useState } from "react";
import { ExternalLink, FilePenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ModelRequest } from "@knowledge-agent/agent";
import { aiReview, analyzeLibraryDocument, canEditSource, categoriesOf, isAnalysisStale, normalizeCategories, type LibraryAdapter, type LibraryDocument, type LibraryReview, type LibrarySnapshot, type LibraryTip } from "./libraryModel";

interface Props {
  doc: LibraryDocument; rootPath: string; adapter: LibraryAdapter; busy: boolean; model: string; modelReady: boolean;
  runModel?: (request: ModelRequest) => Promise<string>; taxonomy: string[];
  onSave(review: LibraryReview): Promise<LibrarySnapshot | null>;
  operate(operation: () => Promise<LibrarySnapshot>, message?: string): Promise<LibrarySnapshot | null>;
  onDirty(dirty: boolean): void;
}
export function LibraryDocumentDetail({ doc, rootPath, adapter, busy, model, modelReady, runModel, taxonomy, onSave, operate, onDirty }: Props) {
  const [summary, setSummary] = useState(doc.summary);
  const [categories, setCategories] = useState(categoriesOf(doc).join("\n"));
  const [tags, setTags] = useState(doc.tags.join("、"));
  const [tips, setTips] = useState<LibraryTip[]>(doc.tips ?? []);
  const [locked, setLocked] = useState(doc.classificationLocked ?? doc.status === "reviewed");
  const [analysisRevision, setAnalysisRevision] = useState(doc.analysisRevision || doc.revision);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState("");
  const [editingSource, setEditingSource] = useState(false);
  const [source, setSource] = useState(doc.text);
  const mounted = useRef(true);
  const sourceSection = useRef<HTMLDetailsElement>(null);
  const quoteMark = useRef<HTMLElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = summary !== doc.summary || categories !== categoriesOf(doc).join("\n") || tags !== doc.tags.join("、") || JSON.stringify(tips) !== JSON.stringify(doc.tips ?? []) || locked !== (doc.classificationLocked ?? doc.status === "reviewed") || analysisRevision !== (doc.analysisRevision || doc.revision);
  useEffect(() => { onDirty(dirty || generating || editingSource); return () => onDirty(false); }, [dirty, generating, editingSource, onDirty]);
  useEffect(() => {
    if (!dirty && !editingSource) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editingSource]);
  useEffect(() => { if (quote) quoteMark.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [quote]);
  const blocked = busy || generating || editingSource;
  async function save(status: LibraryReview["status"]) {
    const paths = normalizeCategories(categories.split(/[\n、，,]/));
    await onSave({ id: doc.id, revision: doc.revision, metadataVersion: doc.metadataVersion ?? 0, analysisRevision, status, summary, category: paths[0] ?? "", categories: paths, tags: tags.split(/[、,，\n]/).map((tag) => tag.trim()).filter(Boolean), tips, source: "manual", classificationLocked: locked });
  }
  async function generate() {
    if (!runModel || !modelReady || generating) return;
    setGenerating(true); setMessage("");
    try {
      const suggestion = await analyzeLibraryDocument(doc, model, runModel, taxonomy, { cancelled: () => !mounted.current, onProgress: (part, total) => { if (mounted.current) setMessage(`正在分析第 ${part}/${total} 段…`); } });
      const review = aiReview({ ...doc, classificationLocked: locked }, suggestion);
      if (mounted.current) { setSummary(review.summary); setCategories((review.categories ?? []).join("\n")); setTags(review.tags.join("、")); setTips(review.tips ?? []); setAnalysisRevision(doc.revision); setMessage("建议已生成，请检查后保存。已锁定的分类和标签会保留。"); }
    } catch (error) { if (mounted.current) setMessage(`生成失败：${String(error)}`); }
    finally { if (mounted.current) setGenerating(false); }
  }
  function locate(text: string) {
    if (!doc.text.includes(text)) { setMessage("这条引用来自旧版文件，当前正文中已找不到；请重新整理。"); return; }
    if (sourceSection.current) sourceSection.current.open = true;
    setQuote(text);
  }
  const quoteIndex = quote ? doc.text.indexOf(quote) : -1;
  return <article>
    <h3>{doc.path.split("/").pop()}</h3><p className="library-path">{rootPath} / {doc.path}</p>
    <div className="library-actions library-source-actions">
      {adapter.openSource && <button onClick={async () => { try { await adapter.openSource!(doc.id); } catch (error) { if (mounted.current) setMessage(String(error)); } }}><ExternalLink size={14} />打开原文件</button>}
      {adapter.saveSource && canEditSource(doc) && <button disabled={blocked || dirty} onClick={() => { setSource(doc.text); setEditingSource(true); }}><FilePenLine size={14} />编辑原文</button>}
    </div>
    <p className="library-meta">索引更新于 {new Date(doc.updatedAt).toLocaleString()} · {doc.text.length.toLocaleString()} 字符</p>
    {isAnalysisStale(doc) && <p className="library-notice">原文件已更新。下面保留了上次的摘要和 tip，需重新核对；已确认的分类与标签仍然保留。</p>}
    {(doc.issue || doc.aiError) && <p className="library-error">{doc.issue || doc.aiError}</p>}
    {editingSource ? <section className="library-source-editor">
      <h4>编辑原文件内容</h4><p>保存到原来的文件位置，并保留上一次修改的撤销备份。</p>
      <textarea aria-label="编辑资料原文" value={source} disabled={busy} onChange={(event) => setSource(event.target.value)} />
      <div className="library-actions"><button className="library-primary" disabled={busy || source === doc.text} onClick={() => void operate(() => adapter.saveSource!(doc.id, doc.revision, source), "原文件已保存；分类保留，知识内容已标记为待更新。")}>保存原文</button><button disabled={busy} onClick={() => setEditingSource(false)}>取消编辑</button></div>
    </section> : <details className="library-content" ref={sourceSection}><summary>查看已收录正文（{doc.text.length} 字符）</summary><pre>{quoteIndex >= 0 ? <>{doc.text.slice(0, quoteIndex)}<mark ref={quoteMark}>{quote}</mark>{doc.text.slice(quoteIndex + quote.length)}</> : doc.text || "没有可预览的正文"}</pre></details>}
    <div className="library-ai"><button disabled={!modelReady || !runModel || !doc.text.trim() || blocked || Boolean(doc.issue)} onClick={() => void generate()}><Sparkles size={15} />{generating ? "正在生成…" : "AI 生成建议"}</button><small>{modelReady ? `当前模型：${model}。将分段分析已收录的正文，并核对 tip 引用。` : "请先在设置中连接模型；也可以手动整理。"}</small></div>
    {message && <p className="library-notice" role="status">{message}</p>}
    <fieldset disabled={blocked} className="library-edit-fields">
      <label>摘要<textarea aria-label="资料摘要" maxLength={6000} value={summary} onChange={(e) => { setSummary(e.target.value); setAnalysisRevision(doc.revision); }} placeholder="记录这份资料的要点…" /></label>
      <label>知识分类<textarea className="library-category-input" aria-label="资料分类" value={categories} onChange={(e) => { setCategories(e.target.value); setLocked(true); }} placeholder={"短剧创作/人物设计\n英语学习/表达"} /><small>每行一个分类，用 / 建立层级。同一文件可以属于多个分类。</small></label>
      <label>关键词标签<input aria-label="资料标签" value={tags} onChange={(e) => { setTags(e.target.value); setLocked(true); }} placeholder="用逗号或顿号分隔" /></label>
      <label className="library-check"><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />保留我确认的分类和标签，AI 不覆盖</label>
      <div className="library-tip-heading"><h4>知识 tip <span>{tips.length}/16</span></h4><button disabled={tips.length >= 16 || !doc.text} onClick={() => { setTips([...tips, { id: `manual-${Date.now()}`, content: "", quote: "" }]); setAnalysisRevision(doc.revision); }}><Plus size={14} />添加 tip</button></div>
      {tips.length === 0 && <p className="library-meta">提取可以独立理解的知识要点，并保留支持它的原文。</p>}
      {tips.map((tip, index) => <div className="library-tip-editor" key={tip.id}>
        <label>要点 {index + 1}<textarea aria-label={`知识 tip ${index + 1}`} maxLength={1000} value={tip.content} onChange={(e) => { setTips(tips.map((item, i) => i === index ? { ...item, content: e.target.value } : item)); setAnalysisRevision(doc.revision); }} /></label>
        <label>原文引用<textarea aria-label={`tip ${index + 1} 原文引用`} maxLength={500} value={tip.quote} onChange={(e) => { setTips(tips.map((item, i) => i === index ? { ...item, quote: e.target.value } : item)); setAnalysisRevision(doc.revision); }} placeholder="粘贴原文中的连续摘录，至少 4 个字符" /></label>
        <div className="library-actions"><button disabled={!tip.quote} onClick={() => locate(tip.quote)}>定位原文</button><button aria-label={`删除 tip ${index + 1}`} onClick={() => { setTips(tips.filter((_, i) => i !== index)); setAnalysisRevision(doc.revision); }}><Trash2 size={13} />删除</button></div>
      </div>)}
      {analysisRevision !== doc.revision && <button onClick={() => setAnalysisRevision(doc.revision)}>我已对照当前原文核对摘要和 tip</button>}
    </fieldset>
    <div className="library-actions"><button className="library-primary" disabled={blocked} onClick={() => void save("reviewed")}>保存整理</button><button disabled={blocked} onClick={() => void save(doc.status === "ignored" ? "pending" : "ignored")}>{doc.status === "ignored" ? "放回待整理" : "忽略此资料"}</button><button disabled={blocked || dirty || !doc.summary.trim()} title={dirty ? "请先保存整理" : "导出已保存的整理卡片"} onClick={async () => { try { const path = await adapter.exportCard(doc.id, doc.revision); if (mounted.current) setMessage(path ? `已导出：${path}` : "已取消导出。"); } catch (error) { if (mounted.current) setMessage(String(error)); } }}>导出卡片</button></div>
    {adapter.restoreSource && canEditSource(doc) && <details className="library-help"><summary>原文修改记录</summary><p>可以撤销最近一次通过 App 保存的原文修改；外部软件修改后会先核对版本。</p><button disabled={blocked || dirty} onClick={() => void operate(() => adapter.restoreSource!(doc.id, doc.revision), "已撤销上次原文修改，分类保留。")}>撤销上次原文修改</button></details>}
    {dirty && <small className="library-unsaved">有未保存的整理内容。编辑期间会暂缓自动扫描和批量 AI 整理。</small>}
  </article>;
}
