import type { ParsedNote, VaultIndex } from "@knowledge-agent/core";

export interface NoteOutlineItem {
  id: string;
  text: string;
  level: number;
  line: number;
}

export interface NoteInspectorLink {
  id: string;
  label: string;
  path: string;
  resolved: boolean;
  detail?: string;
}

export function buildNoteOutline(content: string): NoteOutlineItem[] {
  const lines = content.split(/\r?\n/);
  const items: NoteOutlineItem[] = [];
  let inFence = false;
  let inFrontmatter = lines[0]?.trim() === "---";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > 0 && inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      continue;
    }
    if (inFrontmatter) continue;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;
    items.push({
      id: `${index + 1}:${text}`,
      text,
      level: match[1].length,
      line: index + 1
    });
  }
  return items;
}

export function buildInspectorLinks(index: VaultIndex, note: ParsedNote | undefined): {
  backlinks: NoteInspectorLink[];
  outlinks: NoteInspectorLink[];
} {
  if (!note) return { backlinks: [], outlinks: [] };
  const backlinks = (index.backlinks.get(note.path) ?? []).map((edge, itemIndex) => {
    const source = index.noteByPath.get(edge.source);
    return {
      id: `back:${edge.source}:${itemIndex}`,
      label: source?.title ?? leafName(edge.source),
      path: edge.source,
      resolved: true,
      detail: edge.heading ? `#${edge.heading}` : undefined
    };
  });
  const outlinks = (index.outlinks.get(note.path) ?? []).map((edge, itemIndex) => {
    const target = index.noteByPath.get(edge.target);
    return {
      id: `out:${edge.target}:${itemIndex}`,
      label: edge.alias || target?.title || leafName(edge.target),
      path: edge.target,
      resolved: edge.resolved,
      detail: edge.heading ? `#${edge.heading}` : edge.resolved ? undefined : "未解析"
    };
  });
  return { backlinks, outlinks };
}

export function bookmarkStorageKey(sourceKind: string, sourceName: string): string {
  return `knowledge-agent.bookmarks.v1:${sourceKind}:${sourceName.trim() || "default"}`;
}

export function normalizeBookmarkPaths(paths: unknown, availablePaths?: Iterable<string>): string[] {
  if (!Array.isArray(paths)) return [];
  const available = availablePaths ? new Set([...availablePaths].map((path) => path.toLocaleLowerCase())) : null;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of paths) {
    if (typeof value !== "string") continue;
    const path = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    const key = path.toLocaleLowerCase();
    if (!path || seen.has(key) || (available && !available.has(key))) continue;
    seen.add(key);
    normalized.push(path);
  }
  return normalized;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_raw, target: string, alias?: string) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function leafName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
