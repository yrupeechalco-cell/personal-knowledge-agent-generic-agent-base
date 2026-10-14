// Isolated synthetic QA canvas. Never packaged with the app or written to user vaults.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KnowledgeCanvas, normalizeCanvasDocument } from '../../packages/ui/src/KnowledgeCanvas';
import { LanguageProvider } from '../../packages/ui/src/localization';
import '../../packages/workspace/src/styles.css';
const seed = { version: 1, id: 'legacy-v1', name: '画布升级验收（演示资料）',
  cards: [
    { id: 'a', type: 'text', x: 120, y: 150, width: 260, height: 170, title: '研究问题', text: '如何把资料关联起来？' },
    { id: 'b', type: 'note', x: 530, y: 150, width: 300, height: 200, title: '资料来源', notePath: '案例/资料来源.md' },
    { id: 'c', type: 'table', x: 530, y: 430, width: 380, height: 250, title: '对照记录', table: { columns: ['视角', '结论'], rows: [['主题', '保留原文件位置']] } }
  ], connections: [{ id: 'ab', sourceId: 'a', targetId: 'b', label: '原文依据', relationship: 'references' }],
  groups: [{ id: 'g', x: 70, y: 90, width: 820, height: 300, title: '知识主题', cardIds: ['a','b'] }], viewport: { x: 0, y: 0, scale: 1 }
};
function App() {
  const [document, setDocument] = useState(() => normalizeCanvasDocument(JSON.parse(localStorage.getItem('canvas-test') ?? JSON.stringify(seed))));
  const [theme, setTheme] = useState('light');
  const [opened, setOpened] = useState('');
  const readOnly = new URLSearchParams(location.search).has('readonly');
  return <LanguageProvider initialLocale="zh-CN"><div className={`obsidian-shell theme-${theme}`} style={{ display:'flex', flexDirection:'column', height:'100vh', fontFamily:'"Segoe UI", "Microsoft YaHei", sans-serif' }}>
    <header style={{padding:'10px 20px', display:'flex', justifyContent:'space-between'}}><strong>知识画布 · 演示资料</strong><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</button><span data-testid="opened">{opened}</span></header>
    <KnowledgeCanvas document={document} notes={[{ path:'案例/资料来源.md', title:'资料来源', content:'# 资料来源\n\n资料保留原位，通过画布整理观点与出处。', tags:['资料整理'] }]}
      onChange={value => { setDocument(value); localStorage.setItem('canvas-test', JSON.stringify(value)); }} onOpenNote={setOpened} readOnly={readOnly} saveState={readOnly ? 'read-only' : 'saved'}/>
  </div></LanguageProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
