export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function noteTitleFromPath(path: string): string {
  const normalized = normalizePath(path);
  const fileName = normalized.split("/").pop() ?? normalized;
  return fileName.replace(/\.md$/i, "");
}

export function ensureMarkdownPath(target: string): string {
  const normalized = normalizePath(target);
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

export function pathStem(path: string): string {
  return noteTitleFromPath(path).toLowerCase();
}

export function isMarkdownFile(path: string): boolean {
  return /\.md$/i.test(path);
}
