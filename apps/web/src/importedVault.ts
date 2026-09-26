import { buildSafetyManifest, type NoteFile } from "@knowledge-agent/core";
import type { LoadedVault } from "@knowledge-agent/workspace";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

// A standard file input also works in iOS Safari and on LAN HTTP origins.
// Keep it in the document until change/cancel; focus can fire before iOS returns files.
export function chooseKnowledgeFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.txt,text/plain,text/markdown";
    input.hidden = true;
    const finish = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    document.body.append(input);
    input.click();
  });
}

export async function readImportedVault(selected: File[]): Promise<LoadedVault | null> {
  if (selected.length === 0) return null;
  if (selected.length > MAX_FILES) throw new Error("一次最多导入 50 个文件，请分批选择。");
  if (selected.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("单个文件不能超过 2 MB。");
  if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
    throw new Error("所选文件总大小不能超过 10 MB。");
  }
  const paths = new Set<string>();
  const pending = selected.map((file) => {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      throw new Error(`${file.name}：目前支持 Markdown 和 TXT 文件。`);
    }
    if (/[\\/]/.test(file.name)) throw new Error("文件名不能包含路径分隔符。");
    const base = file.name.replace(/\.(md|markdown|txt)$/i, "");
    let path = `${base}.md`;
    let suffix = 2;
    while (paths.has(path.toLowerCase())) path = `${base} (${suffix++}).md`;
    paths.add(path.toLowerCase());
    return { file, path };
  });
  const safetyManifest = buildSafetyManifest(pending.map(({ path }) => path));
  const allowed = new Set(safetyManifest.allowed.map((entry) => entry.path));
  const files: NoteFile[] = [];
  for (const { file, path } of pending) {
    if (!allowed.has(path)) continue;
    const content = await file.text();
    if (content.includes("\0")) throw new Error(`${file.name} 不是可读取的文本文件。`);
    files.push({ path, content, modifiedAt: new Date(file.lastModified).toISOString() });
  }
  if (files.length === 0) throw new Error("没有可导入的文件，所选路径已被知识库的敏感文件规则排除。");
  return {
    files,
    sourceKind: "browser-import",
    sourceName: "导入的文件",
    safetyManifest,
    unsupportedReason: `已导入 ${files.length} 篇文档${safetyManifest.excluded.length ? `，排除 ${safetyManifest.excluded.length} 个敏感路径` : ""}。仅供本次浏览，刷新后需重新导入；不会上传或修改原文件。`
  };
}
