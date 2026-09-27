import { useState } from "react";
import { FileText, Folder, Image, Film, Music, Link2, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReadOnlyDirectoryEntry, ReadOnlyDirectoryListing } from "./KnowledgeWorkspace";
import "./directory-map.css";

const PAGE_SIZE = 16;
export function directoryEntryKind(entry: ReadOnlyDirectoryEntry) {
  if (entry.kind === "directory") return "folder";
  if (entry.kind !== "file") return "other";
  const extension = (entry.extension ?? entry.name.split(".").at(-1) ?? "").toLowerCase();
  if (/^(png|jpe?g|gif|webp|svg|heic|bmp|avif)$/.test(extension)) return "image";
  if (/^(mp4|mov|mkv|avi|webm|m4v)$/.test(extension)) return "video";
  if (/^(mp3|wav|m4a|aac|flac|ogg)$/.test(extension)) return "audio";
  return "file";
}
const ICONS = { folder: Folder, image: Image, video: Film, audio: Music, file: FileText, other: Link2 };
const TYPES = { folder: "文件夹 · 点击进入", image: "图片", video: "视频", audio: "音频", file: "文件", other: "链接或特殊条目 · 不展开" };
function sizeLabel(size?: number) {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

/** Only real immediate directory entries are drawn. Edges mean containment, never AI similarity. */
export function DirectoryMap({ listing, query, busy, selectedPath, onOpenDirectory, onOpenFile }: {
  listing: ReadOnlyDirectoryListing; query: string; busy: boolean; selectedPath?: string;
  onOpenDirectory(path: string): void; onOpenFile(path: string): void;
}) {
  const [page, setPage] = useState(0);
  const entries = listing.entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = entries.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const rows = Math.ceil(visible.length / 2);
  const height = Math.max(420, rows * 82 + 48);
  const folders = listing.entries.filter(entry => entry.kind === "directory").length;
  const files = listing.entries.filter(entry => entry.kind === "file").length;
  const name = listing.path.split("/").filter(Boolean).at(-1) ?? listing.root.split(/[\\/]/).filter(Boolean).at(-1) ?? listing.root;
  return <section className="directory-map" aria-label="文件分布图" aria-busy={busy}>
    <div className="directory-map-caption"><span><i/> 文件夹</span><span><i/> 文件</span><p>连线表示“包含” · 点击文件夹往下看，点击文件查看信息</p></div>
    {entries.length === 0 ? <div className="directory-map-empty"><Folder size={38}/><h3>{query ? "当前文件夹没有匹配项" : "这个文件夹是空的"}</h3><p>{query ? "试试其他文件名，或清空搜索。" : "可以从上方返回上一级或选择其他文件夹。"}</p></div> : <div className="directory-map-scroll">
      <div className="directory-map-surface" style={{ height }}>
        <svg className="directory-map-lines" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {visible.map((entry, index) => { const left = index % 2 === 0; const y = 40 + Math.floor(index / 2) * 82 + (height - rows * 82) / 2; return <path key={entry.path} d={`M ${left ? 420 : 580} ${height / 2} C ${left ? 360 : 640} ${height / 2}, ${left ? 380 : 620} ${y}, ${left ? 340 : 660} ${y}`} />; })}
        </svg>
        <div className="directory-map-center" style={{ top: height / 2 - 74 }}><Folder size={32}/><strong title={listing.path || listing.root}>{name}</strong><span>当前文件夹</span><small>{folders} 个文件夹 · {files} 个文件{listing.truncated ? "（已列出）" : ""}</small></div>
        {visible.map((entry, index) => { const kind = directoryEntryKind(entry); const Icon = ICONS[kind]; const y = 40 + Math.floor(index / 2) * 82 + (height - rows * 82) / 2; return <button type="button" key={entry.path} className={`directory-map-node ${kind}${selectedPath === entry.path ? " selected" : ""}`} style={{ left: index % 2 === 0 ? "3%" : "66%", top: y - 32 }} title={entry.path} disabled={busy || (entry.kind !== "directory" && entry.kind !== "file")} onClick={() => entry.kind === "directory" ? onOpenDirectory(entry.path) : onOpenFile(entry.path)}>
          <span className="directory-map-node-icon"><Icon size={22}/></span><span className="directory-map-node-copy"><strong>{entry.name}</strong><small>{TYPES[kind]}{entry.kind === "file" ? ` · ${sizeLabel(entry.size)}` : ""}</small></span>
        </button>; })}
      </div>
    </div>}
    <footer className="directory-map-footer"><span>{query ? `匹配 ${entries.length} 项` : `当前层级 ${listing.entries.length} 项`} · 按原始位置展示</span>{pageCount > 1 && <div><button disabled={busy || current === 0} onClick={() => setPage(current - 1)} aria-label="上一页"><ChevronLeft size={15}/></button><span>{current + 1} / {pageCount}</span><button disabled={busy || current + 1 >= pageCount} onClick={() => setPage(current + 1)} aria-label="下一页"><ChevronRight size={15}/></button></div>}</footer>
  </section>;
}
