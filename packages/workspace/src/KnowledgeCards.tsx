import { useEffect, useMemo, useState } from "react";
import { FileText, LockKeyhole, Share2 } from "lucide-react";
import { type KnowledgeCardRecord, type LibraryAdapter, type LibrarySnapshot } from "./libraryModel";

interface Props {
  records: KnowledgeCardRecord[]; adapter: LibraryAdapter; busy: boolean;
  operate(operation: () => Promise<LibrarySnapshot>, message?: string): Promise<LibrarySnapshot | null>;
  onDirty(value: boolean): void;
}
const AVAILABILITY = { indexed: "已收录", paused: "来源已暂停", unavailable: "原件暂不可用" };

export function KnowledgeCards({ records, adapter, busy, operate, onDirty }: Props) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const selectedRecord = records.find(r => r.card.id === selected);
  const eligible = records.filter(r => r.scope === "shared").length;
  const categories = [...new Set(records.flatMap(r => r.card.categories))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return records.filter(r => (scope === "all" || r.scope === scope) && (!category || r.card.categories.includes(category)) && words.every(word => [r.card.name, r.card.summary, ...r.card.categories, ...r.card.tags, ...r.card.tips.map(t => t.content)].join("\n").toLocaleLowerCase().includes(word)));
  }, [records, query, scope, category]);
  useEffect(() => { setPreview(""); }, [records]);
  function updateDirty(value: boolean) { setDirty(value); onDirty(value); }
  async function share(action: "preview" | "export") {
    setExporting(true); setMessage("");
    try {
      if (action === "preview") setPreview(JSON.stringify(await adapter.previewKnowledgeCards!(), null, 2));
      else { const path = await adapter.exportKnowledgeCards!(); setMessage(path ? `已导出知识卡片：${path}` : "已取消导出。"); }
    } catch (e) { setMessage(String(e)); } finally { setExporting(false); }
  }
  return <section className="knowledge-cards" aria-label="知识卡片工作区">
    <div className="knowledge-cards-intro"><strong>原件留在本机，标注组成知识卡片</strong><p>卡片可按多个主题整理；原件暂不可用时仍能修改标注。全部卡片默认「仅本机」，设为「可共享」后才进入导出范围。账户同步尚未接入。</p>
      <div className="library-actions"><span>{records.length} 张卡片 · {eligible} 张可共享</span><button disabled={busy || dirty || exporting || !adapter.previewKnowledgeCards} onClick={() => void share("preview")}>预览可共享内容</button><button disabled={busy || dirty || exporting || !eligible || !adapter.exportKnowledgeCards} onClick={() => void share("export")}>导出可共享卡片</button></div>
      <small>导出包含名称、摘要、标签、要点和来源设备；正文、引用原文、附件及本机路径保留在电脑。请先核对摘要和要点是否适合共享。</small>
    </div>
    {message && <p role="status" className="library-notice">{message}</p>}
    {preview && <details open className="knowledge-card-preview"><summary>本次可共享内容（尚未发送）<button onClick={e => { e.preventDefault(); setPreview(""); }}>关闭预览</button></summary><pre aria-label="知识卡片共享预览">{preview}</pre></details>}
    <div className="knowledge-card-filters"><input aria-label="搜索知识卡片" placeholder="搜索卡片名称、摘要、分类、标签…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="按卡片分类查看" value={category} onChange={e => setCategory(e.target.value)}><option value="">所有分类视角</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><select aria-label="卡片共享范围筛选" value={scope} onChange={e => setScope(e.target.value)}><option value="all">全部卡片</option><option value="local">仅本机</option><option value="shared">可共享</option></select></div>
    <div className="library-columns">
      <div className="library-list" aria-label="知识卡片列表">
        {filtered.map(({ card, scope }) => <button key={card.id} disabled={dirty && selected !== card.id} className={`library-item${selected === card.id ? " selected" : ""}`} onClick={() => setSelected(card.id)}>
          <strong><FileText size={16}/>{card.name}</strong><p>{card.summary || "尚未填写摘要，可手动整理或在资料页生成 AI 建议。"}</p><div className="library-item-tags">{card.categories.map(c => <span key={c}>{c}</span>)}</div><span>{scope === "local" ? <LockKeyhole size={12}/> : <Share2 size={12}/>} {scope === "local" ? "仅本机" : "可共享"} · {AVAILABILITY[card.source.availability]}</span>
        </button>)}
        {!filtered.length && <div className="library-empty"><h3>{records.length ? "没有匹配的卡片" : "从一个资料文件夹开始"}</h3><p>{records.length ? "试试其他关键词或共享范围。" : "点击上方「添加监测文件夹」，为资料建立卡片。"}</p></div>}
      </div>
      <div className="library-detail">{selectedRecord ? <CardEditor key={`${selectedRecord.card.id}:${selectedRecord.card.version}`} record={selectedRecord} adapter={adapter} busy={busy || exporting} operate={operate} onDirty={updateDirty}/> : <div className="library-empty"><h3>选择一张知识卡片</h3><p>查看来源、调整分类和标签，决定哪些内容可以共享。</p></div>}</div>
    </div>
  </section>;
}

function CardEditor({ record, adapter, busy, operate, onDirty }: Omit<Props, "records"> & { record: KnowledgeCardRecord }) {
  const { card } = record;
  const [summary, setSummary] = useState(card.summary);
  const [categories, setCategories] = useState(card.categories.join("\n"));
  const [tags, setTags] = useState(card.tags.join("、"));
  const [scope, setScope] = useState(record.scope);
  const dirty = summary !== card.summary || categories !== card.categories.join("\n") || tags !== card.tags.join("、") || scope !== record.scope;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty]);
  function discard() { setSummary(card.summary); setCategories(card.categories.join("\n")); setTags(card.tags.join("、")); setScope(record.scope); }
  return <article className="knowledge-card-editor">
    <h3>{card.name}</h3><p className="library-meta">原件所在设备：{card.source.deviceName} · {AVAILABILITY[card.source.availability]}</p>
    <small className="library-meta">最后观察：{card.source.lastSeenAt ? new Date(card.source.lastSeenAt).toLocaleString() : "尚未扫描"}</small>
    {card.analysisStale && <p className="library-notice">原件已变化，摘要与要点仍需核对。</p>}
    <fieldset disabled={busy} className="library-edit-fields">
      <label>卡片摘要<textarea aria-label="卡片摘要" maxLength={6000} value={summary} onChange={e => setSummary(e.target.value)}/></label>
      <label>多维分类<textarea aria-label="卡片分类" placeholder={"项目/装修\n主题/预算\n人物/供应商"} value={categories} onChange={e => setCategories(e.target.value)}/><small>每行一个分类，同一张卡片可以从多个角度找到。</small></label>
      <label>关键词<input aria-label="卡片标签" value={tags} onChange={e => setTags(e.target.value)} placeholder="用逗号或顿号分隔"/></label>
      <label>共享范围<select aria-label="卡片共享范围" value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="local">仅本机</option><option value="shared">可共享（纳入卡片导出）</option></select><small>共享范围只控制知识卡片，保存不会上传文件。</small></label>
    </fieldset>
    <div className="library-actions"><button className="library-primary" disabled={busy || !dirty || !adapter.saveKnowledgeCard} onClick={() => void operate(() => adapter.saveKnowledgeCard!({ id: card.id, expectedVersion: card.version, summary, categories: categories.split(/\n/).map(c => c.trim()).filter(Boolean), tags: tags.split(/[,，、\n]/).map(t => t.trim()).filter(Boolean), scope }), "知识卡片已保存，原文件未改动。")}>保存卡片</button><button disabled={busy || !dirty} onClick={discard}>放弃修改</button></div>
    {dirty && <p className="library-unsaved">有未保存的卡片标注；保存或放弃后再切换。</p>}
    {card.tips.length > 0 && <section><h4>知识要点</h4>{card.tips.map(t => <p key={t.id}>{t.content}</p>)}<small>这里显示已提取的要点；原文引用留在资料页。</small></section>}
    <details className="library-help"><summary>卡片编号</summary><code className="knowledge-card-id">{card.id}</code><p>编号独立于文件路径。本版可识别部分明确的同目录文本重命名；无法确认的移动不会自动合并。</p></details>
  </article>;
}
