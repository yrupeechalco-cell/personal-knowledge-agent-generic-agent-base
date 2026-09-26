import { useMemo, useState } from "react";
import { BookOpen, FileText, FolderPlus, FolderSearch, Lightbulb, Pause, Play, RefreshCw, Search, Sparkles } from "lucide-react";
import type { ModelRequest } from "@knowledge-agent/agent";
import { categoriesOf, categoryTree, hasCategory, isAnalysisStale, pendingDocuments, searchLibrary, type LibraryAdapter, type LibraryFilter } from "./libraryModel";
import { LibraryDocumentDetail } from "./LibraryDocumentDetail";
import { KnowledgeCards } from "./KnowledgeCards";
import { useLibraryController } from "./useLibraryController";

interface Props { adapter?: LibraryAdapter; runModel?: (request: ModelRequest) => Promise<string>; model: string; modelReady: boolean; visible: boolean }
const STATUS = { pending: "待整理", reviewed: "已整理", ignored: "已忽略" };

export function LibraryInbox({ adapter, runModel, model, modelReady, visible }: Props) {
  const [detailDirty, setDetailDirty] = useState(false);
  const { data, busy, error, notice, progress, autoScan, setAutoScan, operate, configure } = useLibraryController(adapter, runModel, model, modelReady, detailDirty);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [selected, setSelected] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [rootId, setRootId] = useState("");
  const [view, setView] = useState<"documents" | "tips" | "cards">(adapter?.saveKnowledgeCard ? "cards" : "documents");
  const [pendingSelection, setPendingSelection] = useState("");
  const [removeId, setRemoveId] = useState("");
  const results = useMemo(() => searchLibrary(data.documents, query, filter).filter((doc) => (filter !== "all" || doc.status !== "ignored") && hasCategory(doc, category) && (!tag || doc.tags.includes(tag)) && (!rootId || doc.rootId === rootId)), [data.documents, query, filter, category, tag, rootId]);
  const tree = useMemo(() => categoryTree(data.documents), [data.documents]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    data.documents.filter((doc) => doc.status !== "ignored" && hasCategory(doc, category)).forEach((doc) => doc.tags.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [data.documents, category]);
  const document = data.documents.find((item) => item.id === selected);
  const pending = pendingDocuments(data).length;
  const failures = data.documents.filter((doc) => doc.aiError).length;
  const tipCount = data.documents.filter((doc) => doc.status !== "ignored").reduce((count, doc) => count + (doc.tips?.length ?? 0), 0);
  const queueActive = data.queueState === "running" || (data.autoAnalyze && data.queueState !== "paused");
  function selectDocument(id: string) { if (id === selected) return; if (detailDirty) setPendingSelection(id); else { setSelected(id); setView("documents"); } }
  return <section className="library-host" hidden={!visible} aria-label="文件知识库">
    <div className="library-heading">
      <div><h2><BookOpen size={22} />文件知识库</h2><p>文件留在原位，按主题、关键词和知识要点重新组织</p></div>
      <div className="library-actions">
        <button disabled={!adapter || busy || detailDirty} onClick={() => adapter && void operate(adapter.scan, "扫描完成，新增或变化的资料已进入待整理。")}><RefreshCw size={15} />{busy && !progress ? "处理中…" : "立即扫描"}</button>
        <button className="library-primary" disabled={!adapter || busy || detailDirty} onClick={() => adapter && void operate(adapter.addFolder)}><FolderPlus size={15} />添加监测文件夹</button>
      </div>
    </div>
    {!adapter ? <div className="library-empty"><FolderSearch size={32} /><h3>请在正式安装的 App 中添加资料</h3><p>选择一个电脑文件夹，在这里浏览主题分类、关键词和知识 tip。</p><p>文件读取与编辑需要桌面 App。网页预览不会扫描你的电脑。</p></div> : <>
      <div className="library-stats"><span><strong>{data.documents.filter((doc) => doc.status !== "ignored").length}</strong> 份资料</span><span><strong>{tree.filter((node) => node.depth === 0).length}</strong> 个主题</span><span><strong>{tipCount}</strong> 条知识 tip</span><span><strong>{data.documents.filter((doc) => doc.status === "pending").length}</strong> 份待整理</span></div>
      <div className="library-settings"><label><input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />本次运行自动扫描（每 30 秒）</label><span>{detailDirty ? "正在编辑，后台整理暂缓" : "分类和标签保存在本机知识索引中"}</span></div>
      {error && <p className="library-error" role="alert">{error}<button disabled={busy || detailDirty} onClick={() => void operate(adapter.load)}>重试读取</button></p>}
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {adapter.configure && <section className="library-queue" aria-label="AI 整理任务">
        <div><strong><Sparkles size={16} />AI 整理</strong><p>{progress || (data.queueState === "paused" ? "已暂停，已完成的整理结果已保存。" : !modelReady ? "请先在设置中连接模型。" : pending ? `${pending} 份可整理资料，完成后自动保存分类和 tip。` : "当前没有可自动整理的资料。")}</p></div>
        <div className="library-actions">{queueActive ? <button onClick={() => void configure({ queueState: "paused" })}><Pause size={14} />暂停整理</button> : <button disabled={!modelReady || !runModel || busy || detailDirty || pending === 0} onClick={() => void configure({ queueState: "running", retryFailed: true })}><Play size={14} />{data.queueState === "paused" ? "继续整理" : "整理全部待处理"}</button>}{failures > 0 && <button disabled={!modelReady || busy || detailDirty} onClick={() => void configure({ retryFailed: true, queueState: "running" })}>重试失败项（{failures}）</button>}</div>
        <label className="library-check"><input type="checkbox" disabled={(!modelReady && !data.autoAnalyze) || detailDirty} checked={data.autoAnalyze ?? false} onChange={(e) => void configure({ autoAnalyze: e.target.checked, queueState: e.target.checked ? "running" : "paused" })} />自动 AI 整理新增和更新的资料</label>
        <small>启用后，在 App 运行期间将所选目录内支持的文件名与正文分段发送给当前模型；逐份保存，重开后继续未完成资料。可随时暂停。</small>
      </section>}
      <details className="library-roots" open={data.roots.length === 0 ? true : undefined}>
        <summary>监测文件夹（{data.roots.length}）{data.roots.some((root) => root.issue) ? " · 有目录需要检查" : ""}</summary>
        {data.roots.length === 0 && <p>添加存放资料的文件夹。整理分类只改变 App 中的知识视图，文件仍在原来的位置。</p>}
        {data.roots.map((root) => <div className="library-root" key={root.id}>
          <div><strong title={root.path}>{root.path}</strong><small>{root.paused ? "已暂停" : root.lastScan ? `上次扫描 ${new Date(root.lastScan).toLocaleString()}` : "等待扫描"}</small>{root.issue && <small className="library-error">{root.issue}</small>}</div>
          <button disabled={busy || detailDirty} onClick={() => void operate(() => adapter.updateRoot(root.id, root.paused ? "resume" : "pause"))}>{root.paused ? "恢复" : "暂停"}</button>
          <button disabled={busy || detailDirty} onClick={() => setRemoveId(root.id)}>移除</button>
          {removeId === root.id && <div className="library-remove"><span>{adapter.saveKnowledgeCard ? "停止接入此目录，已有知识卡片保留并设为仅本机；原文件不变。" : "移除此目录的索引和整理卡片，原文件保留。重要 tip 可先导出。"}</span><button disabled={busy || detailDirty} onClick={() => { setRemoveId(""); void operate(() => adapter.updateRoot(root.id, "remove")); }}>确认移除索引</button><button onClick={() => setRemoveId("")}>取消</button></div>}
        </div>)}
      </details>
      {adapter.saveKnowledgeCard && <div className="library-view-controls knowledge-card-navigation" role="group" aria-label="资料查看方式"><div><button disabled={detailDirty} aria-pressed={view === "cards"} className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>知识卡片</button><button disabled={detailDirty} aria-pressed={view !== "cards"} className={view !== "cards" ? "active" : ""} onClick={() => setView("documents")}>原文与 AI 整理</button></div></div>}
      {view === "cards" ? <KnowledgeCards records={data.knowledgeCards?.records ?? []} adapter={adapter} busy={busy} operate={operate} onDirty={setDetailDirty}/> : <div className="library-workbench">
        <aside className="library-taxonomy" aria-label="知识分类">
          <h3>知识分类</h3><button className={!category ? "active" : ""} onClick={() => { setCategory(""); setFilter("all"); setTag(""); }}>全部资料</button>
          <button className={category === "__uncategorized" ? "active" : ""} onClick={() => { setCategory("__uncategorized"); setFilter("all"); setTag(""); }}>未分类 <span>{data.documents.filter((doc) => doc.status !== "ignored" && !categoriesOf(doc).length).length}</span></button>
          {tree.map((node) => <button title={node.path} key={node.path} className={category === node.path ? "active" : ""} style={{ paddingLeft: `${10 + node.depth * 14}px` }} onClick={() => { setCategory(node.path); setFilter("all"); setTag(""); }}><span>{node.path.split("/").pop()}</span><small>{node.count}</small></button>)}
          {tree.length === 0 && <p>保存整理后，主题会出现在这里。用“主题/子主题”建立层级。</p>}
          <h3>关键词</h3><div className="library-tag-cloud">{tags.map(([value, count]) => <button key={value} className={tag === value ? "active" : ""} onClick={() => setTag(tag === value ? "" : value)}>{value}<small>{count}</small></button>)}</div>
        </aside>
        <div className="library-main">
          <div className="library-search"><Search size={17} /><input aria-label="搜索资料正文" placeholder="搜索文件名、正文、分类或知识 tip…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="library-filters" role="group" aria-label="资料状态">{([["all", "全部"], ["pending", "待整理"], ["reviewed", "已整理"], ["issues", "处理提示"], ["ignored", "已忽略"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}<span>{results.length} 份资料</span></div>
          <div className="library-view-controls"><div><button aria-pressed={view === "documents"} className={view === "documents" ? "active" : ""} onClick={() => setView("documents")}><FileText size={14} />资料</button><button disabled={detailDirty} aria-pressed={view === "tips"} className={view === "tips" ? "active" : ""} onClick={() => setView("tips")}><Lightbulb size={14} />知识 tip</button></div><select aria-label="按来源文件夹筛选" value={rootId} onChange={(e) => setRootId(e.target.value)}><option value="">所有来源文件夹</option>{data.roots.map((root) => <option key={root.id} value={root.id}>{root.path}</option>)}</select></div>
          {(category || tag) && <p className="library-breadcrumb">{category === "__uncategorized" ? "未分类" : category || "全部主题"}{tag ? ` · #${tag}` : ""}<button onClick={() => { setCategory(""); setTag(""); }}>清除筛选</button></p>}
          {pendingSelection && <div className="library-remove" role="alert"><span>当前资料有未保存的整理内容。</span><button onClick={() => { setSelected(pendingSelection); setPendingSelection(""); setDetailDirty(false); setView("documents"); }}>放弃修改并切换</button><button onClick={() => setPendingSelection("")}>继续编辑</button></div>}
          {view === "tips" ? <div className="library-tip-grid" aria-label="知识 tip 列表">
            {results.flatMap((doc) => (doc.tips ?? []).map((tip) => <article className="library-tip-card" key={`${doc.id}:${tip.id}`}><p>{tip.content}</p><blockquote>{tip.quote}</blockquote>{isAnalysisStale(doc) && <small className="library-error">来自旧版原文，待核对</small>}<small>{categoriesOf(doc).join(" · ")}</small><button onClick={() => { setSelected(doc.id); setView("documents"); }}>查看来源 · {doc.path.split("/").pop()}</button></article>))}
            {!results.some((doc) => doc.tips?.length) && <div className="library-empty"><Lightbulb size={30} /><h3>这里还没有知识 tip</h3><p>整理资料后，可以跨文件回顾知识要点，并查看每条的原文出处。</p></div>}
          </div> : <div className="library-columns">
            <div className="library-list" aria-label="资料列表">
              {results.length === 0 && <div className="library-empty"><FileText size={26} /><h3>{data.roots.length === 0 ? "从一个资料文件夹开始" : query ? "没有找到匹配资料" : "这里暂时没有资料"}</h3><p>{query ? "试试正文中的关键词，或切换到「全部」。" : "添加资料，或调整分类、标签和状态筛选。"}</p></div>}
              {results.map((doc) => <button className={`library-item${selected === doc.id ? " selected" : ""}`} key={doc.id} onClick={() => selectDocument(doc.id)}><strong><FileText size={15} />{doc.path.split("/").pop()}</strong><small title={doc.path}>{doc.path}</small><p>{doc.issue || doc.aiError || doc.summary || doc.text.slice(0, 100) || "文件正文为空"}</p><div className="library-item-tags">{categoriesOf(doc).slice(0, 2).map((path) => <span key={path}>{path}</span>)}</div><span>{STATUS[doc.status]} · {doc.tips?.length ?? 0} 条 tip{isAnalysisStale(doc) ? " · 原文已更新" : ""}{doc.issue ? " · 未收录正文" : ""}</span></button>)}
            </div>
            <div className="library-detail">{document ? <LibraryDocumentDetail key={`${document.id}:${document.revision}:${document.metadataVersion ?? 0}:${document.issue ?? ""}`} doc={document} rootPath={data.roots.find((root) => root.id === document.rootId)?.path ?? ""} adapter={adapter} busy={busy} model={model} modelReady={modelReady} runModel={runModel} taxonomy={tree.map((node) => node.path)} onDirty={setDetailDirty} operate={operate} onSave={(review) => operate(() => adapter.saveReview(review), "整理结果已保存；分类视图已更新，原文件未改动。")}/> : <div className="library-empty"><BookOpen size={30} /><h3>选择一份资料</h3><p>查看正文、调整知识分类，或提取带有原文出处的知识 tip。</p></div>}</div>
          </div>}
        </div>
      </div>}
    </>}
    <details className="library-help"><summary>收录范围与使用说明</summary><p>支持 UTF-8 的 Markdown、TXT、CSV、TSV、JSON、YAML、XML、HTML，以及 DOCX 主正文。单份正文上限 1 MB，Word 文件上限 20 MB；PDF、图片、旧版 Word、Excel 等暂仅收录文件名。正文索引总量 16 MB，最多 1500 个文件、10 个不重叠目录。</p><p>分类、标签、摘要和 tip 存在本机知识索引中。原文件更新后保留已确认分类，旧知识内容标记待更新。自动扫描与自动 AI 整理只在 App 运行时进行；正在编辑资料时暂缓。暂停请求会等待当前模型调用返回，然后停止后续分段与保存。</p><p>本地扫描和搜索不调用 AI。点击 AI 整理或开启自动整理后，文件名与已收录正文会分段发送给当前模型。AI 分类和要点需要核对；引用逐字匹配也不能保证推论正确。分类整理不移动或改写原文件，只有「保存原文」会修改文件内容。</p></details>
  </section>;
}
