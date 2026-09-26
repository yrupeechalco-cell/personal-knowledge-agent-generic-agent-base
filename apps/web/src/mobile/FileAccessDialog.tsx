import { useEffect, useRef } from 'react';
import { FileText, FolderOpen, ShieldCheck } from 'lucide-react';

export function FileAccessDialog({ onCancel, onAllow }: { onCancel(): void; onAllow(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} className="ml-file-access" aria-labelledby="ml-file-access-title" aria-describedby="ml-file-access-purpose" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="ml-access-brand"><ShieldCheck size={18}/><span>个人知识库 · 文件访问</span></div>
    <div className="ml-access-icon"><FolderOpen size={30}/></div>
    <h2 id="ml-file-access-title">允许读取你选择的文件？</h2>
    <p id="ml-file-access-purpose">用于搜索正文、添加分类和关键词。</p>
    <ul>
      <li><strong>仅访问所选文件</strong><span>支持 TXT、Markdown，每次导入由你选择。</span></li>
      <li><strong>保存在知识库中</strong><span>保存副本，手机原文件保持不变。</span></li>
      <li><strong>配对后同步到电脑</strong><span>未配对时保存在本机；配对后参与自动同步。</span></li>
    </ul>
    <p className="ml-access-note"><FileText size={16}/><span>点击允许后，仍需在系统中选择文件。取消选择不会导入任何资料。</span></p>
    <div className="ml-access-actions"><button onClick={onCancel}>暂不允许</button><button className="ml-primary" onClick={onAllow}>允许并选择文件</button></div>
  </dialog>;
}
