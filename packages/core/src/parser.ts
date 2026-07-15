import { ensureMarkdownPath, isMarkdownFile, normalizePath, noteTitleFromPath } from "./path";
import type { NoteFile, ParsedLink, ParsedNote } from "./types";

const WIKILINK_RE = /(!)?\[\[([^\]\n]+)\]\]/g;
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]\n]+\]\(([^)\n]+?\.md(?:#[^)]+)?)\)/g;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const HEADING_RE = /^#{1,6}\s+(.+)$/gm;

export function parseNote(file: NoteFile): ParsedNote {
  const normalizedPath = normalizePath(file.path);
  const { body, frontmatter } = parseFrontmatter(file.content);
  const title = titleFromBodyOrPath(body, normalizedPath);
  const headings = [...body.matchAll(HEADING_RE)].map((match) => match[1].trim());
  const frontmatterTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String)
    : typeof frontmatter.tags === "string"
      ? [frontmatter.tags]
      : [];
  const tags = [...new Set([...frontmatterTags, ...[...body.matchAll(TAG_RE)].map((match) => match[2])])].sort();
  const links = [...parseWikiLinks(body), ...parseMarkdownLinks(body)];
  const excerpt = body
    .replace(HEADING_RE, "")
    .replace(WIKILINK_RE, "$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return {
    ...file,
    path: normalizedPath,
    title,
    frontmatter,
    tags,
    links,
    headings,
    excerpt
  };
}

function parseFrontmatter(content: string): {
  body: string;
  frontmatter: ParsedNote["frontmatter"];
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { body: content, frontmatter: {} };
  }

  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return { body: content, frontmatter: {} };
  }

  const raw = content.slice(4, end).trim();
  const frontmatter: ParsedNote["frontmatter"] = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([^:#]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (value === "true" || value === "false") {
      frontmatter[key] = value === "true";
    } else if (value !== "" && !Number.isNaN(Number(value))) {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return { body: content.slice(end + 4), frontmatter };
}

function titleFromBodyOrPath(body: string, path: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading?.[1].trim() || noteTitleFromPath(path);
}

function parseWikiLinks(content: string): ParsedLink[] {
  return [...content.matchAll(WIKILINK_RE)].map((match) => {
    const raw = match[2].trim();
    const [targetAndHeading, alias] = raw.split("|").map((part) => part.trim());
    const [target, heading] = targetAndHeading.split("#").map((part) => part.trim());
    return {
      type: match[1] ? "embed" : "wikilink",
      raw,
      target: normalizePath(target),
      alias: alias || undefined,
      heading: heading || undefined
    };
  });
}

function parseMarkdownLinks(content: string): ParsedLink[] {
  return [...content.matchAll(MARKDOWN_LINK_RE)].map((match) => {
    const raw = decodeURIComponent(match[1].trim());
    const [target, heading] = raw.split("#").map((part) => part.trim());
    return {
      type: "markdown",
      raw,
      target: isMarkdownFile(target) ? normalizePath(target) : ensureMarkdownPath(target),
      heading: heading || undefined
    };
  });
}
