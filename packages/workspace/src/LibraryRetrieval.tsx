import { useRef, useState } from "react";
import { Copy, Search } from "lucide-react";
import type { LibraryAdapter, LibrarySnapshot } from "./libraryModel";
import { expandEvidence, formatEvidence, retrieveLibrary, type EvidencePassage, type RetrievalDocument, type RetrievalResult } from "./libraryEvidence";
import "./library-retrieval.css";

export function LibraryRetrieval({ adapter, snapshot }: { adapter: LibraryAdapter; snapshot: LibrarySnapshot }) {
  const [query, setQuery] = useState("");
  const [related, setRelated] = useState("");
  const [searchBody, setSearchBody] = useState(true);
  const [result, setResult] = useState<RetrievalResult | null>(null);
  const [documents, setDocuments] = useState<RetrievalDocument[]>([]);
  const [expanded, setExpanded] = useState<Record<string, EvidencePassage>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function perform(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function search(next = false) {
    await perform(async () => {
      const data = await adapter.load();
      const request = next && result ? { ...result.request, offset: result.nextOffset ?? 0, planId: result.planId }
        : { query, related: related.split(/[，,\n]/).map(t => t.trim()).filter(Boolean), searchBody };
      const page = await retrieveLibrary(data, request);
      setResult(page);
      setDocuments(old => next ? [...old, ...page.documents] : page.documents);
      if (!next) setExpanded({});
    });
  }
  async function copy() {
    if (!result) return;
    await perform(async () => {
      // Check the entire search plan again before sharing previously displayed excerpts.
      await retrieveLibrary(await adapter.load(), { ...result.request, offset: 0, planId: result.planId });
      await navigator.clipboard.writeText(formatEvidence(result, documents));
      setNotice("已复制已显示的原文节选和出处。包含文件名与正文，请自行决定分享对象。");
    });
  }
  const read = documents.filter(d => d.passages.length > 0).length;
  return <section className="library-retrieval" aria-label="检索与引用">
    <div className="retrieval-intro"><h3>带着问题找资料</h3><p>跨文件找相关段落，保留出处，按需补读上下文。直接检索本机索引，无需连接 AI。</p></div>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <label>检索主题<input value={query} onChange={e => setQuery(e.target.value)} maxLength={200} placeholder="例如：求职、学习方法、人物动机" required /></label>
      <label>相关词（可选，用逗号分隔）<input value={related} onChange={e => setRelated(e.target.value)} placeholder="例如：简历，面试，工作经历" /></label>
      <div className="retrieval-actions"><label><input type="checkbox" checked={searchBody} onChange={e => setSearchBody(e.target.checked)} />同时检索已收录正文</label><button className="library-primary" disabled={busy || !query.trim()} type="submit"><Search size={15} />{busy ? "读取中…" : "查找相关资料"}</button></div>
    </form>
    {error && <p className="library-error" role="alert">{error}</p>}
    {notice && <p className="library-notice" role="status">{notice}</p>}
    {!result && <div className="retrieval-empty"><Search size={28}/><h3>从一个主题开始</h3><p>当前索引有 {snapshot.documents.filter(d => d.status !== "ignored").length} 份资料。输入关键词后，先看相关段落，再展开上下文。</p><p>主题按字面匹配，多个词用空格分隔时需要全部命中；相关词用于扩大范围，不会自动推断近义词。</p></div>}
    {result && <>
      <div className="retrieval-summary" role="status"><div><strong>“{result.request.query}” · {result.uniqueCandidates} 组候选</strong><p>已显示 {read} 组正文节选 · {documents.length - read} 组仅文件信息 · 还有 {result.remaining} 组待查看</p><small>{result.duplicateDocuments ? `${result.duplicateDocuments} 份相同索引正文已合并。` : ""}节选来自已保存索引，不表示已阅读全文或已核对磁盘最新内容。</small></div><button disabled={busy || !documents.length} onClick={() => void copy()}><Copy size={15}/>复制节选与出处</button></div>
      {documents.length === 0 && <div className="retrieval-empty"><h3>没有找到相关资料</h3><p>试试文件中的具体用词，添加相关词，或开启正文检索。PDF、图片等尚未收录正文的文件只能按已有名称与标注匹配。</p></div>}
      <div className="retrieval-results">{documents.map(doc => <article className="retrieval-document" key={doc.id} aria-label={`检索结果 ${doc.path}`}>
        <header><div><h4>{doc.path.split(/[\\/]/).pop()}</h4><p className="retrieval-path">{doc.path}</p></div>{adapter.openSource && <button disabled={busy} onClick={() => void perform(async () => { await adapter.openSource!(doc.id); })}>打开原文件</button>}</header>
        <small>命中：{doc.matchedTerms.join("、")} · {doc.matchedIn.join("、")}{!doc.matchedIn.includes("正文") && doc.passages.length > 0 ? " · 以下为开头节选，尚未定位正文关键词" : ""}</small>
        {doc.warnings.map((w, i) => <p className="retrieval-warning" key={i}>{w}</p>)}
        {doc.passages.map(p => {
          const key = `${doc.id}:${p.start}`, context = expanded[key];
          return <div className="retrieval-passage" key={key}><small>索引正文 L{p.lineStart}–{p.lineEnd} · 字符 {p.start}–{p.end}</small><blockquote>{p.text}</blockquote>
            <button disabled={busy} onClick={() => context ? setExpanded(old => { const next = { ...old }; delete next[key]; return next; }) : void perform(async () => {
              const latest = await expandEvidence(await adapter.load(), { id: p.id, revision: p.revision, textHash: p.textHash, start: p.start, end: p.end });
              setExpanded(old => ({ ...old, [key]: latest.passage }));
            })}>{context ? "收起上下文" : "补读上下文"}</button>
            {context && <div className="retrieval-context"><small>上下文 · 索引 L{context.lineStart}–{context.lineEnd}</small><blockquote>{context.text}</blockquote></div>}
          </div>;
        })}
        {doc.duplicateCount > 0 && <details><summary>另有 {doc.duplicateCount} 份相同索引正文</summary><p>只比较已收录的文字，不代表原文件、排版或附件相同。最多列出 10 个副本来源，其余可按文件名另行检索。</p>{doc.duplicates.map(d => <p className="retrieval-path" key={d.id}>{d.path}{d.warnings.length ? ` · ${d.warnings.join("；")}` : ""}</p>)}</details>}
      </article>)}</div>
      {result.nextOffset !== null && <button className="retrieval-next" disabled={busy} onClick={() => void search(true)}>继续查看下一批（剩余 {result.remaining} 组）</button>}
    </>}
    <p className="retrieval-footnote">行号和字符位置对应 App 中的正文索引，并非 Word 或 PDF 页码。本页不扫描新文件、不改动原文，也不会自动发送资料给模型。</p>
  </section>;
}
