import type { ParsedNote } from "@knowledge-agent/core";

export type WorkspaceLauncherItemKind = "command" | "note" | "search" | "create";

export interface WorkspaceLauncherItem {
  id: string;
  kind: WorkspaceLauncherItemKind;
  label: string;
  detail?: string;
  shortcut?: string;
  keywords?: string[];
  path?: string;
  matchCount?: number;
}

export function filterLauncherItems(
  items: WorkspaceLauncherItem[],
  query: string,
  recentIds: string[] = []
): WorkspaceLauncherItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));
  return items
    .map((item, index) => {
      const searchable = [item.id, item.label, item.detail, item.path, ...(item.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      const fuzzyScore = normalized ? fuzzyMatchScore(searchable, normalized) : 1;
      const recent = recentRank.has(item.id) ? Math.max(0, 12 - (recentRank.get(item.id) ?? 12)) : 0;
      return { item, index, score: fuzzyScore + recent };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

export function buildQuickSwitcherItems(
  notes: ParsedNote[],
  query: string,
  writable: boolean,
  recentPaths: string[] = []
): WorkspaceLauncherItem[] {
  const noteItems = notes.map((note) => ({
    id: `note:${note.path}`,
    kind: "note" as const,
    label: note.title,
    detail: note.path,
    path: note.path,
    keywords: aliasesForNote(note)
  }));
  const filtered = filterLauncherItems(
    noteItems,
    query,
    recentPaths.map((path) => `note:${path}`)
  );
  const exactPath = ensureMarkdownName(query);
  const exactExists = notes.some((note) => {
    const loweredQuery = query.trim().toLocaleLowerCase();
    return (
      note.path.toLocaleLowerCase() === exactPath.toLocaleLowerCase()
      || note.title.toLocaleLowerCase() === loweredQuery
      || aliasesForNote(note).some((alias) => alias.toLocaleLowerCase() === loweredQuery)
    );
  });
  if (writable && query.trim() && !exactExists) {
    filtered.push({
      id: `create:${exactPath}`,
      kind: "create",
      label: "创建新笔记",
      detail: `${query.trim()} · ${exactPath}`,
      path: exactPath
    });
  }
  return filtered.slice(0, 80);
}

export interface VaultSearchMatch {
  note: ParsedNote;
  matchCount: number;
  score: number;
  snippet: string;
}

export function searchVaultNotes(notes: ParsedNote[], rawQuery: string): VaultSearchMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];
  const groups = splitOrGroups(query).map(tokenizeSearchGroup).filter((group) => group.length > 0);
  if (groups.length === 0) return [];

  return notes
    .map((note) => {
      const evaluations = groups.map((group) => evaluateSearchGroup(note, group));
      const best = evaluations
        .filter((evaluation) => evaluation.matches)
        .sort((left, right) => right.score - left.score)[0];
      if (!best) return null;
      return {
        note,
        matchCount: best.matchCount,
        score: best.score,
        snippet: searchSnippet(note.content, best.firstNeedle)
      };
    })
    .filter((match): match is VaultSearchMatch => Boolean(match))
    .sort((left, right) => right.score - left.score || left.note.title.localeCompare(right.note.title))
    .slice(0, 200);
}

interface SearchToken {
  negative: boolean;
  field?: string;
  value: string;
  regex?: RegExp;
  property?: { key: string; value?: string };
}

function splitOrGroups(query: string): string[] {
  const groups: string[] = [];
  let current = "";
  let quote = false;
  let regex = false;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    const previous = query[index - 1];
    if (char === "\"" && previous !== "\\") quote = !quote;
    if (char === "/" && previous !== "\\" && !quote) regex = !regex;
    if (!quote && !regex && query.slice(index, index + 4).toUpperCase() === " OR ") {
      groups.push(current.trim());
      current = "";
      index += 3;
      continue;
    }
    current += char;
  }
  if (current.trim()) groups.push(current.trim());
  return groups;
}

function tokenizeSearchGroup(group: string): SearchToken[] {
  const rawTokens = group.match(/-?(?:[a-z-]+:)?(?:"(?:\\.|[^"])*"|\/(?:\\.|[^/])+\/[gimsuy]*|\[[^\]]+\]|\S+)/gi) ?? [];
  return rawTokens.map((raw) => {
    const negative = raw.startsWith("-");
    const token = negative ? raw.slice(1) : raw;
    if (token.startsWith("[") && token.endsWith("]")) {
      const [key, ...rest] = token.slice(1, -1).split(":");
      return {
        negative,
        value: token,
        property: { key: key.trim(), value: rest.join(":").trim() || undefined }
      };
    }
    const fieldMatch = /^([a-z-]+):(.*)$/i.exec(token);
    const field = fieldMatch?.[1].toLowerCase();
    const value = stripSearchQuotes(fieldMatch?.[2] ?? token);
    const regexMatch = /^\/(.+)\/([gimsuy]*)$/.exec(value);
    let regex: RegExp | undefined;
    if (regexMatch) {
      try {
        regex = new RegExp(regexMatch[1], regexMatch[2].replace("g", ""));
      } catch {
        regex = undefined;
      }
    }
    return { negative, field, value, regex };
  });
}

function evaluateSearchGroup(note: ParsedNote, tokens: SearchToken[]) {
  let score = 0;
  let matchCount = 0;
  let firstNeedle = "";
  for (const token of tokens) {
    const result = evaluateSearchToken(note, token);
    if (token.negative ? result.matches : !result.matches) {
      return { matches: false, score: 0, matchCount: 0, firstNeedle: "" };
    }
    if (!token.negative) {
      score += result.score;
      matchCount += result.count;
      if (!firstNeedle) firstNeedle = result.needle;
    }
  }
  return { matches: true, score, matchCount, firstNeedle };
}

function evaluateSearchToken(note: ParsedNote, token: SearchToken) {
  if (token.property) {
    const value = note.frontmatter[token.property.key];
    if (value === undefined) return emptyTokenResult();
    if (!token.property.value) return { matches: true, score: 5, count: 1, needle: token.property.key };
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    const count = values.filter((item) => includesSearchValue(item, token.property?.value ?? "")).length;
    return { matches: count > 0, score: count * 5, count, needle: token.property.value };
  }

  const field = token.field;
  if (field === "task" || field === "task-todo" || field === "task-done") {
    const taskLines = note.content.split(/\r?\n/).filter((line) => {
      if (field === "task-todo") return /^\s*[-*]\s+\[ \]/.test(line);
      if (field === "task-done") return /^\s*[-*]\s+\[[xX]\]/.test(line);
      return /^\s*[-*]\s+\[[ xX]\]/.test(line);
    });
    const count = taskLines.filter((line) => tokenMatches(line, token)).length;
    return { matches: count > 0, score: count * 4, count, needle: token.value };
  }

  const sources =
    field === "file"
      ? [{ value: leafName(note.path), weight: 7 }]
      : field === "path"
        ? [{ value: note.path, weight: 6 }]
        : field === "content"
          ? [{ value: note.content, weight: 2 }]
          : field === "tag"
            ? note.tags.map((tag) => ({ value: `#${tag}`, weight: 6 }))
            : [
                { value: note.title, weight: 8 },
                { value: note.path, weight: 5 },
                ...aliasesForNote(note).map((alias) => ({ value: alias, weight: 7 })),
                { value: note.content, weight: 1 }
              ];
  let count = 0;
  let score = 0;
  for (const source of sources) {
    const sourceCount = tokenMatchCount(source.value, token);
    count += sourceCount;
    score += sourceCount * source.weight;
  }
  return { matches: count > 0, score, count, needle: token.value };
}

function tokenMatches(source: string, token: SearchToken): boolean {
  return token.regex ? token.regex.test(source) : includesSearchValue(source, token.value);
}

function tokenMatchCount(source: string, token: SearchToken): number {
  if (!token.value) return 0;
  if (token.regex) return token.regex.test(source) ? 1 : 0;
  const haystack = source.toLocaleLowerCase();
  const needle = token.value.toLocaleLowerCase();
  let count = 0;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, needle.length);
  }
  return count;
}

function aliasesForNote(note: ParsedNote): string[] {
  const aliases = note.frontmatter.aliases ?? note.frontmatter.alias;
  if (Array.isArray(aliases)) return aliases.map(String).filter(Boolean);
  return aliases ? [String(aliases)] : [];
}

function searchSnippet(content: string, needle: string): string {
  const compact = content.replace(/^---[\s\S]*?\n---\s*/m, "").replace(/\s+/g, " ").trim();
  if (!compact) return "（空笔记）";
  const index = needle ? compact.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (index < 0) return compact.slice(0, 180);
  const start = Math.max(0, index - 64);
  const end = Math.min(compact.length, index + needle.length + 100);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function includesSearchValue(source: string, query: string): boolean {
  return source.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function stripSearchQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, "$1").replace(/\\"/g, "\"");
}

function ensureMarkdownName(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function leafName(path: string): string {
  return path.split("/").pop() ?? path;
}

function fuzzyMatchScore(source: string, query: string): number {
  if (!query) return 1;
  if (source === query) return 120;
  if (source.startsWith(query)) return 90 - Math.min(30, source.length - query.length);
  const directIndex = source.indexOf(query);
  if (directIndex >= 0) return 70 - Math.min(35, directIndex);
  let queryIndex = 0;
  let score = 0;
  let previousMatch = -2;
  for (let sourceIndex = 0; sourceIndex < source.length && queryIndex < query.length; sourceIndex += 1) {
    if (source[sourceIndex] !== query[queryIndex]) continue;
    score += previousMatch === sourceIndex - 1 ? 5 : 2;
    if (sourceIndex === 0 || /[\s/_-]/.test(source[sourceIndex - 1])) score += 4;
    previousMatch = sourceIndex;
    queryIndex += 1;
  }
  return queryIndex === query.length ? score : 0;
}

function emptyTokenResult() {
  return { matches: false, score: 0, count: 0, needle: "" };
}
