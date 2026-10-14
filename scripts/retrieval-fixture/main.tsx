// Synthetic documents for browser QA only. This directory is never included in app resources.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryInbox } from '../../packages/workspace/src/LibraryInbox';
import '../../packages/workspace/src/styles.css';
import type { LibraryAdapter, LibrarySnapshot } from '../../packages/workspace/src/libraryModel';
const snapshot: LibrarySnapshot = {
  version: 2, roots: [{ id: 'fixture', path: '测试资料（非用户文件）', paused: false, lastScan: 1, issue: null }],
  documents: Array.from({ length: 7 }, (_, i) => ({ id: `fixture-${i}`, rootId: 'fixture', path: `求职/案例${i + 1}${i === 6 ? '.pdf' : '.txt'}`, revision: 'fixture-1', size: 100, updatedAt: 1, text: i === 6 ? '' : `求职准备：案例 ${i === 5 ? 0 : i}。\n${'根据目标岗位整理经历，用具体事实说明工作成果。\n'.repeat(40)}`, issue: i === 6 ? 'PDF 正文暂未收录' : null, status: 'pending', summary: '', category: '', tags: [] })),
};
const adapter = { load: async () => structuredClone(snapshot), scan: async () => { throw Error('检索不应扫描'); }, saveKnowledgeCard: async () => { throw Error('检索不应写入'); } } as unknown as LibraryAdapter;
createRoot(document.getElementById('root')!).render(<div className="theme-light"><LibraryInbox adapter={adapter} visible model="offline" modelReady={false}/></div>);
