import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Check, FilePlus2, FileUp, FolderTree, RefreshCw, Search, Smartphone } from 'lucide-react';
import { canEditSource, categoriesOf, normalizeCategories, searchLibrary, type LibraryDocument } from '@knowledge-agent/workspace';
import { chooseKnowledgeFiles, readImportedVault } from '../importedVault';
import { emptyState, newDocument, readMobileState, resolveConflict, saveMobileDocument, updateMobileState, type LocalDocument, type MobileState } from './libraryStore';
import { pairMobile, syncMobile } from './sync';
import './mobile-library.css';

export function MobileLibraryApp() {
  const [state, setState] = useState<MobileState>(emptyState);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<'library' | 'categories' | 'sync'>('library');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<LocalDocument | null>(null);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const pairing = useRef(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => void readMobileState().then(next => { if (alive) { setState(next); setReady(true); } }).catch(e => { if (alive) setError(String(e)); });
    refresh();
    window.addEventListener('mobile-library-changed', refresh);
    const focus = () => { refresh(); void runSync(); };
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') { refresh(); void runSync(); } }, 15000);
    const token = new URLSearchParams(location.hash.slice(1)).get('pair');
    if (token && !pairing.current) {
      pairing.current = true;
      setPage('sync'); setPairCode(token);
      history.replaceState(null, '', location.pathname + location.search);
      void pairMobile(token).then(() => { setPairCode(''); return runSync(); }).catch(e => setSyncError(String(e)));
    } else void runSync();
    return () => { alive = false; window.removeEventListener('mobile-library-changed', refresh); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); window.clearInterval(interval); };
  }, []);
  async function runSync() {
    setBusy(true);
    try { await syncMobile(); setSyncError(''); }
    catch (e) { setSyncError(e instanceof TypeError || (e instanceof Error && e.name === 'AbortError') ? '暂时连不上电脑，修改已保存在本机。连接恢复后会自动重试。' : String(e)); }
    finally { setBusy(false); }
  }
  async function act(action: () => Promise<unknown>) {
    setError('');
    try { await action(); } catch (e) { setError(String(e)); }
  }
  async function importFiles() {
    // Open the native picker before the first await to preserve Safari's user gesture.
    const picked = chooseKnowledgeFiles();
    await act(async () => {
      const vault = await readImportedVault(await picked);
      if (!vault) return;
      for (const file of vault.files) await saveMobileDocument(newDocument(file.path, file.content));
      setPage('library'); void runSync();
    });
  }
  const pending = state.documents.filter(item => item.pending).length;
  const conflicts = state.documents.filter(item => item.conflict !== undefined);
  const docs = searchLibrary(state.documents.map(item => item.doc), query, 'all').filter(doc => doc.status !== 'ignored' && (!category || categoriesOf(doc).includes(category)));
  const categories = [...new Set(state.documents.filter(item => item.doc.status !== 'ignored').flatMap(item => categoriesOf(item.doc)))].sort();
  if (selected) return <MobileDocumentEditor key={selected.editId} entry={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void runSync(); }} />;
  return <div className="mobile-library-app">
    <header className="ml-header"><div><small>个人知识库</small><h1>{page === 'sync' ? '设备同步' : page === 'categories' ? '知识分类' : '我的资料'}</h1></div><button className="ml-icon" aria-label="新建笔记" disabled={!ready} onClick={() => setSelected({ doc: newDocument(), base: null, pending: true, editId: '' })}><FilePlus2 size={22} /></button></header>
    <main className="ml-main">
      {error && <p role="alert" className="ml-error">{error}</p>}
      {!ready && !error && <p role="status">正在读取本机资料…</p>}
      {page === 'library' && <>
        <button className="ml-sync-strip" onClick={() => setPage('sync')}><span className={syncError ? 'ml-dot offline' : 'ml-dot'} />{conflicts.length ? `${conflicts.length} 份资料需要合并` : pending ? `${pending} 份改动已保存本机，等待同步` : state.token ? '本机资料已保存 · 已配对电脑' : '本机资料已保存 · 可配对电脑'}<span>查看</span></button>
        <div className="ml-search"><Search size={19}/><input aria-label="搜索知识库" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜正文、标签、知识 tip" /></div>
        <div className="ml-list-heading"><strong>{category || '全部资料'} <small>{docs.length}</small></strong>{category ? <button onClick={() => setCategory('')}>清除分类</button> : <button disabled={!ready} onClick={() => void importFiles()}><FileUp size={16}/>导入</button>}</div>
        {ready && !docs.length && <section className="ml-empty"><BookOpen size={38}/><h2>{query || category ? '没有找到资料' : '从一篇笔记开始'}</h2><p>{query || category ? '换个关键词，或清除分类筛选。' : '记下想法，或导入文档。正文与分类会保存在这台设备上。'}</p>{!query && !category && <><button className="ml-primary" onClick={() => setSelected({ doc: newDocument(), base: null, pending: true, editId: '' })}>写第一篇笔记</button><button onClick={() => setPage('sync')}>连接电脑知识库</button></>}</section>}
        <div className="ml-documents">{docs.map(doc => { const entry = state.documents.find(item => item.doc.id === doc.id)!; return <button key={doc.id} className="ml-document" onClick={() => setSelected(structuredClone(entry))}><div><strong>{doc.path.split(/[\\/]/).pop()}</strong><small>{entry.conflict !== undefined ? '需要合并' : entry.pending ? '待同步' : '已保存'}</small></div><p>{doc.summary || doc.text.slice(0, 110) || doc.issue || '暂无正文'}</p><div className="ml-tags">{[...categoriesOf(doc), ...doc.tags.map(tag => `#${tag}`)].slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div></button>; })}</div>
      </>}
      {page === 'categories' && <><p className="ml-muted">分类和标签只改变知识视图，电脑上的文件仍在原位置。</p>{categories.length ? categories.map(value => <button className="ml-category" key={value} onClick={() => { setCategory(value); setPage('library'); }}><FolderTree size={20}/><strong>{value}</strong><span>{state.documents.filter(item => categoriesOf(item.doc).includes(value)).length}</span></button>) : <section className="ml-empty"><FolderTree size={36}/><h2>建立你的知识分类</h2><p>打开一篇资料，填写分类，例如「工作/项目」。保存后就能按主题浏览。</p></section>}<details className="ml-section"><summary>已归档资料</summary>{state.documents.filter(item => item.doc.status === 'ignored').map(item => <button className="ml-category" key={item.doc.id} onClick={() => setSelected(structuredClone(item))}>{item.doc.path}</button>)}</details></>}
      {page === 'sync' && <>
        <section className="ml-section"><Smartphone size={25}/><h2>{state.token ? '已配对电脑' : '连接电脑知识库'}</h2><p>在电脑 App 点击「手机同步」，选择手机新笔记的保存文件夹，再用手机扫描二维码。</p><p className="ml-muted">同一 Wi-Fi，电脑 App 和本页面打开时每 15 秒同步一次。断线时可以继续编辑已保存的资料。</p>{!state.token && <><label>配对码（也可扫描二维码）<input aria-label="配对码" value={pairCode} onChange={e => setPairCode(e.target.value.trim())}/></label><button className="ml-primary" disabled={busy || !pairCode} onClick={() => void act(async () => { await pairMobile(pairCode); setPairCode(''); await runSync(); })}>配对电脑</button></>}{state.token && <><p>{pending} 份待同步 · {state.lastSync ? `上次同步 ${new Date(state.lastSync).toLocaleString()}` : '等待首次同步'}</p><button className="ml-primary" disabled={busy} onClick={() => void runSync()}><RefreshCw size={16}/>{busy ? '正在同步…' : '立即同步'}</button><button onClick={() => void act(() => updateMobileState(next => { next.token = ''; }))}>暂停自动同步</button></>}{syncError && <p role="status" className="ml-error">{syncError}</p>}</section>
        {conflicts.map(item => <section className="ml-section ml-conflict" key={item.doc.id}><h2>需要合并 · {item.doc.path.split(/[\\/]/).pop()}</h2><p>{item.conflict ? '两端都修改了这份资料。两份内容均已保留，尚未覆盖。' : '电脑已不再收录此资料，手机副本仍然保留。'}</p><details><summary>对比两个版本</summary><h3>手机</h3><pre>{item.doc.text}</pre><p>{item.doc.summary} {item.doc.tags.join('、')} {categoriesOf(item.doc).join('、')}</p><h3>电脑</h3><pre>{item.conflict?.text ?? '已移除'}</pre><p>{item.conflict?.summary} {item.conflict?.tags.join('、')} {item.conflict ? categoriesOf(item.conflict).join('、') : ''}</p></details><button className="ml-primary" onClick={() => void act(async () => { await resolveConflict(item.doc.id, 'both'); await runSync(); })}>保留手机副本并同步</button>{item.conflict && <button onClick={() => { if (confirm('放弃这份手机改动，使用电脑版本？')) void act(() => resolveConflict(item.doc.id, 'remote')); }}>使用电脑版本</button>}</section>)}
        <section className="ml-section"><h2>本机备份</h2><p>清除 Safari 网站数据会删除手机副本。可导出全部正文、分类和待同步内容留存；备份不含配对密钥。</p><button onClick={() => { const backup = { ...state, token: '' }; download('知识库手机备份.json', JSON.stringify(backup, null, 2), 'application/json'); }}>导出完整备份</button><p className="ml-muted">当前 HTTP 测试地址需连接电脑才能重新打开页面；已经打开的页面可断线编辑。暂不支持跨网络同步、后台关闭后同步，也不下载 Word/PDF 附件本体。</p></section>
      </>}
    </main>
    <nav className="ml-nav" aria-label="手机主导航">{([['library', BookOpen, '资料'], ['categories', FolderTree, '分类'], ['sync', RefreshCw, '同步']] as const).map(([value, Icon, label]) => <button key={value} aria-current={page === value ? 'page' : undefined} onClick={() => setPage(value)}><Icon size={21}/><span>{label}</span>{value === 'sync' && pending > 0 && <i>{pending}</i>}</button>)}</nav>
  </div>;
}

function MobileDocumentEditor({ entry, onClose, onSaved }: { entry: LocalDocument; onClose(): void; onSaved(): void }) {
  const [doc, setDoc] = useState<LibraryDocument>(entry.doc);
  const [categories, setCategories] = useState(categoriesOf(entry.doc).join('\n'));
  const [tags, setTags] = useState(entry.doc.tags.join('，'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(doc) !== JSON.stringify(entry.doc) || categories !== categoriesOf(entry.doc).join('\n') || tags !== entry.doc.tags.join('，') || !entry.editId;
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  const edit = <K extends keyof LibraryDocument>(key: K, value: LibraryDocument[K]) => setDoc(current => ({ ...current, [key]: value }));
  async function save() {
    setSaving(true); setError('');
    try {
      const nextCategories = normalizeCategories(categories.split('\n'));
      await saveMobileDocument({ ...doc, categories: nextCategories, category: nextCategories[0] ?? '',
        tags: [...new Set(tags.split(/[，,\n]/).map(tag => tag.trim()).filter(Boolean))], classificationLocked: true,
        status: doc.status === 'ignored' ? 'ignored' : doc.text !== entry.doc.text || !entry.editId ? 'pending' : 'reviewed' }, entry.editId || undefined);
      onSaved();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  return <div className="mobile-library-app ml-editor"><header className="ml-header"><button className="ml-icon" aria-label="返回资料" disabled={saving} onClick={() => { if (!dirty || confirm('还有未保存的修改，放弃并返回？')) onClose(); }}><ArrowLeft size={22}/></button><div><h1>编辑资料</h1><small>{dirty ? '有未保存修改' : '已保存本机'}</small></div><button className="ml-primary" disabled={saving || !dirty} onClick={() => void save()}><Check size={16}/>{saving ? '保存中' : '保存'}</button></header><main className="ml-main">
    {error && <p role="alert" className="ml-error">{error}</p>}
    <label>标题<input aria-label="资料标题" value={doc.path.split(/[\\/]/).pop()} readOnly={Boolean(entry.base)} onChange={e => edit('path', e.target.value)} /></label>
    {entry.base && <small className="ml-muted">来源：{doc.path} · 保存正文会在同步时写回电脑原文件。</small>}
    <label>正文<textarea className="ml-body-input" aria-label="资料正文" value={doc.text} readOnly={!canEditSource(doc) && Boolean(entry.base)} onChange={e => edit('text', e.target.value)} /></label>
    {doc.issue && <p className="ml-error">{doc.issue}</p>}
    <details className="ml-section" open><summary>知识整理</summary><label>分类（每行一项，用 / 分层）<textarea aria-label="资料分类" value={categories} onChange={e => setCategories(e.target.value)} placeholder="工作/项目" rows={2}/></label><label>关键词（用逗号分隔）<input aria-label="资料标签" value={tags} onChange={e => setTags(e.target.value)}/></label><label>摘要<textarea aria-label="资料摘要" value={doc.summary} onChange={e => edit('summary', e.target.value)} rows={4}/></label>{doc.tips?.length ? <div><h3>已有知识 tip</h3>{doc.tips.map(tip => <blockquote key={tip.id}>{tip.content}<small>原文：{tip.quote}</small></blockquote>)}<p className="ml-muted">修改正文后，旧 tip 需要在电脑上重新核对或生成。</p></div> : null}</details>
    <div className="ml-editor-actions"><button onClick={() => download(doc.path.split(/[\\/]/).pop() || '笔记.md', doc.text, 'text/plain;charset=utf-8')}>导出正文</button><button onClick={() => edit('status', doc.status === 'ignored' ? 'pending' : 'ignored')}>{doc.status === 'ignored' ? '取消归档' : '归档资料'}</button></div><p className="ml-muted">归档只隐藏资料，不删除电脑原文件。在线 AI 整理仍在电脑 App 中运行，结果随资料同步。</p>
  </main></div>;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
