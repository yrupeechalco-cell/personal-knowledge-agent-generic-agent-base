import { parseNote } from "./parser";
import type { ParsedNote } from "./types";

export type TagGranularity = 1 | 2 | 3 | 4 | 5;
export type KnowledgeTagKind = "concept" | "method" | "entity" | "evidence";

export interface TagCloudItem {
  name: string;
  kind: KnowledgeTagKind;
  weight: number;
  occurrences: number;
  existing: boolean;
}

const TARGET_COUNTS: Record<TagGranularity, number> = { 1: 5, 2: 9, 3: 14, 4: 22, 5: 32 };
const STOP_WORDS = new Set([
  "一个", "一种", "一些", "这个", "那个", "这些", "那些", "可以", "可能", "需要", "进行", "通过", "以及", "其中", "因为", "所以",
  "如果", "但是", "然后", "已经", "没有", "不是", "什么", "怎么", "如何", "我们", "你们", "他们", "自己", "内容", "资料", "文档",
  "问题", "结果", "部分", "相关", "主要", "当前", "使用", "the", "and", "for", "with", "from", "that", "this", "into", "are", "was"
]);

export function tagTargetCount(granularity: TagGranularity, contentLength = 0): number {
  const target = TARGET_COUNTS[granularity];
  if (contentLength < 240) return Math.min(target, 7);
  if (contentLength < 900) return Math.min(target, 14);
  return target;
}

export function buildNoteTagCloud(note: ParsedNote, granularity: TagGranularity): TagCloudItem[] {
  const scores = new Map<string, { name: string; score: number; occurrences: number; existing: boolean }>();
  const existingKeys = new Set(note.tags.map(normalizeTagKey));

  for (const tag of note.tags) addScore(scores, tag, 7.5, 1, true);
  for (const term of extractTerms(note.title)) addScore(scores, term, 4.6, 1, existingKeys.has(normalizeTagKey(term)));
  for (const heading of note.headings) {
    for (const term of extractTerms(heading)) addScore(scores, term, 2.8, 1, existingKeys.has(normalizeTagKey(term)));
  }
  for (const term of extractTerms(stripMetadata(note.content))) {
    addScore(scores, term, 1, 1, existingKeys.has(normalizeTagKey(term)));
  }

  const ranked = [...scores.values()]
    .filter((item) => item.existing || (item.occurrences >= 2 && !STOP_WORDS.has(normalizeTagKey(item.name))))
    .sort((a, b) => b.score - a.score || b.occurrences - a.occurrences || a.name.localeCompare(b.name, "zh-CN"));
  const limit = Math.max(note.tags.length, tagTargetCount(granularity, note.content.length));
  const visible = ranked.slice(0, limit);
  const maxScore = Math.max(1, ...visible.map((item) => item.score));
  const minScore = Math.min(...visible.map((item) => item.score), maxScore);
  const spread = Math.max(0.01, maxScore - minScore);

  return visible.map((item) => ({
    name: item.name,
    kind: classifyKnowledgeTag(item.name),
    weight: round(0.24 + ((item.score - minScore) / spread) * 0.76),
    occurrences: item.occurrences,
    existing: item.existing
  }));
}

export function suggestLocalTags(note: ParsedNote, granularity: TagGranularity): string[] {
  return buildNoteTagCloud(note, granularity).map((item) => item.name);
}

export function setNoteTags(content: string, tags: string[]): string {
  const nextTags = uniqueTags(tags);
  const current = parseNote({ path: "note.md", content });
  const nextKeys = new Set(nextTags.map(normalizeTagKey));
  const removed = current.tags.filter((tag) => !nextKeys.has(normalizeTagKey(tag)));
  const frontmatterMatch = /^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n)?/.exec(content);
  let body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;

  for (const tag of removed) {
    const escaped = escapeRegExp(tag);
    body = body.replace(new RegExp(`(^|\\s)#${escaped}(?=\\s|$|[.,，。!！?？;；])`, "giu"), "$1");
  }

  const tagLine = `tags: ${JSON.stringify(nextTags)}`;
  if (!frontmatterMatch) {
    return nextTags.length > 0 ? `---\n${tagLine}\n---\n${body.replace(/^\r?\n/, "")}` : body;
  }

  const newline = frontmatterMatch[1].includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatterMatch[2].split(/\r?\n/);
  const tagIndex = lines.findIndex((line) => /^tags\s*:/.test(line));
  if (tagIndex >= 0) {
    if (nextTags.length > 0) lines[tagIndex] = tagLine;
    else lines.splice(tagIndex, 1);
  } else if (nextTags.length > 0) {
    lines.push(tagLine);
  }
  const frontmatterBody = lines.filter((line, index) => line !== "" || index > 0).join(newline);
  return `---${newline}${frontmatterBody}${newline}---${newline}${body.replace(/^\r?\n/, "")}`;
}

export function classifyKnowledgeTag(tag: string): KnowledgeTagKind {
  if (/方法|算法|流程|模型|框架|策略|法则|定理|公式|method|algorithm|workflow|model/i.test(tag)) return "method";
  if (/数据|证据|实验|论文|文献|案例|样本|报告|结论|evidence|data|paper|study/i.test(tag)) return "evidence";
  if (/人|公司|组织|国家|城市|设备|产品|系统|平台|软件|agent|app|github/i.test(tag)) return "entity";
  return "concept";
}

export function normalizeTagKey(tag: string): string {
  return tag.trim().replace(/^#/, "").replace(/\s+/g, " ").toLocaleLowerCase();
}

function extractTerms(content: string): string[] {
  const clean = content
    .replace(/^---[\s\S]*?---/m, " ")
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`>()[\]{}:：;；,.，。!?！？“”'\"/\\|+=-]/g, " ");
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const terms: string[] = [];
  for (const segment of segmenter.segment(clean)) {
    const term = segment.segment.trim();
    if (!segment.isWordLike || !isUsefulTerm(term)) continue;
    terms.push(term);
  }
  return terms;
}

function isUsefulTerm(term: string): boolean {
  const key = normalizeTagKey(term);
  if (STOP_WORDS.has(key) || /^\d+(?:\.\d+)?$/.test(key)) return false;
  if (/^[a-z]$/i.test(key)) return false;
  if (/^[\p{Script=Han}]$/u.test(key)) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}_+.-]{1,31}$/u.test(term);
}

function stripMetadata(content: string): string {
  return content.replace(/^---[\s\S]*?---\r?\n?/, "").replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "$1");
}

function addScore(
  scores: Map<string, { name: string; score: number; occurrences: number; existing: boolean }>,
  name: string,
  score: number,
  occurrences: number,
  existing: boolean
) {
  const cleaned = name.trim().replace(/^#/, "");
  if (!cleaned) return;
  const key = normalizeTagKey(cleaned);
  const current = scores.get(key);
  scores.set(key, {
    name: current?.name ?? cleaned,
    score: (current?.score ?? 0) + score,
    occurrences: (current?.occurrences ?? 0) + occurrences,
    existing: current?.existing || existing
  });
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, "").replace(/[\r\n,[\]]/g, "").slice(0, 64);
    const key = normalizeTagKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
