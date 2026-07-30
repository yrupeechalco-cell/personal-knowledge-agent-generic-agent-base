import { setNoteProperty, type FrontmatterValue } from "./properties";
import type { ParsedNote } from "./types";

export const ARTICLE_PROFILE_KEYS = {
  summary: "summary",
  documentType: "document_type",
  category: "category",
  source: "source",
  author: "author",
  created: "created",
  published: "published"
} as const;

export type ArticleProfileField = keyof typeof ARTICLE_PROFILE_KEYS;

export interface ArticleProfile {
  summary: string;
  documentType: string;
  category: string;
  source: string;
  author: string;
  created: string;
  published: string;
  keywords: string[];
}

export type EditableArticleProfile = Omit<ArticleProfile, "keywords">;

export interface ArticleProfileSeed {
  created?: string;
  documentType?: string;
}

const FIELD_ALIASES: Record<ArticleProfileField, string[]> = {
  summary: ["summary", "description", "abstract", "简介", "摘要"],
  documentType: ["document_type", "type", "kind", "文档类型", "资料类型"],
  category: ["category", "categories", "domain", "分类", "领域"],
  source: ["source", "origin", "url", "来源"],
  author: ["author", "authors", "creator", "作者"],
  created: ["created", "created_at", "date_created", "录入日期", "创建日期"],
  published: ["published", "published_at", "publication_date", "发布日期", "出版日期"]
};

export function articleProfileFromNote(note: ParsedNote): ArticleProfile {
  return {
    summary: readProfileValue(note, "summary"),
    documentType: readProfileValue(note, "documentType"),
    category: readProfileValue(note, "category"),
    source: readProfileValue(note, "source"),
    author: readProfileValue(note, "author"),
    created: readProfileValue(note, "created"),
    published: readProfileValue(note, "published"),
    keywords: note.tags
  };
}

export function createArticleNoteContent(
  title: string,
  body = "",
  seed: ArticleProfileSeed = {}
): string {
  const created = seed.created ?? formatProfileDate(new Date());
  const documentType = seed.documentType ?? "笔记";
  const cleanBody = body.trim();
  return [
    "---",
    'summary: ""',
    "tags: []",
    `document_type: ${JSON.stringify(documentType)}`,
    'category: ""',
    'source: ""',
    'author: ""',
    `created: ${JSON.stringify(created)}`,
    'published: ""',
    "---",
    `# ${title}`,
    cleanBody ? `\n${cleanBody}` : "",
    ""
  ].join("\n");
}

export function ensureArticleProfile(
  content: string,
  seed: ArticleProfileSeed = {}
): string {
  const virtualNote = parseProfileFrontmatter(content);
  let next = content;
  const defaults: Record<string, FrontmatterValue> = {
    summary: "",
    tags: [],
    document_type: seed.documentType ?? "笔记",
    category: "",
    source: "",
    author: "",
    created: seed.created ?? formatProfileDate(new Date()),
    published: ""
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (Object.prototype.hasOwnProperty.call(virtualNote, key)) continue;
    next = setNoteProperty(next, key, value);
  }
  return next;
}

export function setArticleProfile(content: string, profile: EditableArticleProfile): string {
  let next = content;
  for (const field of Object.keys(ARTICLE_PROFILE_KEYS) as ArticleProfileField[]) {
    next = setNoteProperty(next, ARTICLE_PROFILE_KEYS[field], profile[field].trim());
  }
  return next;
}

export function formatProfileDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function readProfileValue(note: ParsedNote, field: ArticleProfileField): string {
  for (const key of FIELD_ALIASES[field]) {
    const value = note.frontmatter[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) return value.map(String).filter(Boolean).join(" / ");
    if (typeof value === "boolean") return value ? "true" : "false";
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseProfileFrontmatter(content: string): Record<string, true> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) return {};
  const keys: Record<string, true> = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const key = /^([^:#]+):/u.exec(line)?.[1].trim();
    if (key) keys[key] = true;
  }
  return keys;
}
