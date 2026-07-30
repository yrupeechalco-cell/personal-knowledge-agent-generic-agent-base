import type { EditableArticleProfile, NoteGraph, ParsedNote, TagGranularity } from "@knowledge-agent/core";
import {
  createElement,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { MiniStarGraph } from "./MiniStarGraph";
import { NoteTagCloud } from "./NoteTagCloud";
import { ArticleProfileCard } from "./ArticleProfileCard";
import { useLocalization } from "./localization";

export interface NoteEditorProps {
  note?: ParsedNote;
  miniGraph?: NoteGraph;
  mode: "edit" | "preview";
  readOnly?: boolean;
  tagExtracting?: boolean;
  onExtractTags?(granularity: TagGranularity): void;
  onModeChange(mode: "edit" | "preview"): void;
  onChange(content: string): void;
  onProfileSave?(profile: EditableArticleProfile): void;
  onTagsChange?(tags: string[]): void;
  onSelectGraphNode?(path: string): void;
  resolveNote?(target: string): ParsedNote | undefined;
}

export interface NoteReadingMetrics {
  words: number;
  characters: number;
  readingMinutes: number;
}

export type SlashCommandId =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "task"
  | "quote"
  | "code-block"
  | "wikilink"
  | "horizontal-rule"
  | "date"
  | "time";

export interface SlashCommandMatch {
  start: number;
  end: number;
  indent: string;
  query: string;
}

export interface AppliedSlashCommand {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface SlashCommandDefinition {
  id: SlashCommandId;
  label: string;
  hint: string;
  keywords: string;
}

interface InlinePreviewOptions {
  onSelectGraphNode?: (path: string) => void;
  resolveNote?: (target: string) => ParsedNote | undefined;
  t?: (source: string, values?: Record<string, string | number>) => string;
  footnotes?: Map<string, string>;
}

const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { id: "heading-1", label: "一级标题", hint: "#", keywords: "h1 heading title 一级 标题" },
  { id: "heading-2", label: "二级标题", hint: "##", keywords: "h2 heading subtitle 二级 标题" },
  { id: "heading-3", label: "三级标题", hint: "###", keywords: "h3 heading subtitle 三级 标题" },
  { id: "bullet-list", label: "项目符号列表", hint: "-", keywords: "bullet list ul 列表 项目" },
  { id: "task", label: "待办事项", hint: "- [ ]", keywords: "task todo checkbox 待办 任务" },
  { id: "quote", label: "引用块", hint: ">", keywords: "quote blockquote 引用" },
  { id: "code-block", label: "代码块", hint: "```", keywords: "code block 代码" },
  { id: "wikilink", label: "双向链接", hint: "[[]]", keywords: "link wikilink 双链 链接" },
  { id: "horizontal-rule", label: "分隔线", hint: "---", keywords: "rule divider hr 分隔线" },
  { id: "date", label: "当前日期", hint: "YYYY-MM-DD", keywords: "date today 日期 今天" },
  { id: "time", label: "当前时间", hint: "HH:mm", keywords: "time now 时间 现在" }
];

export function NoteEditor({
  note,
  miniGraph,
  mode,
  onModeChange,
  onChange,
  onSelectGraphNode,
  onExtractTags,
  onProfileSave,
  onTagsChange,
  resolveNote,
  readOnly = false,
  tagExtracting = false
}: NoteEditorProps) {
  const { t } = useLocalization();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dismissedSlash, setDismissedSlash] = useState("");
  const metrics = useMemo(() => measureNoteContent(note?.content ?? ""), [note?.content]);
  const slashMatch = useMemo(
    () => mode === "edit" && !readOnly && note ? findSlashCommand(note.content, caret) : undefined,
    [caret, mode, note, readOnly]
  );
  const slashKey = slashMatch ? `${slashMatch.start}:${slashMatch.query}` : "";
  const matchingSlashCommands = useMemo(
    () => filterSlashCommands(slashMatch?.query ?? ""),
    [slashMatch?.query]
  );
  const showSlashMenu = Boolean(slashMatch && slashKey !== dismissedSlash && matchingSlashCommands.length > 0);

  if (!note) {
    return <main className="note-editor empty">{t("选择一篇笔记开始。")}</main>;
  }
  const activeNote = note;

  function updateCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart);
    setDismissedSlash("");
  }

  function runSlashCommand(commandId: SlashCommandId) {
    if (!slashMatch) return;
    const applied = applySlashCommand(activeNote.content, slashMatch, commandId);
    onChange(applied.content);
    setCaret(applied.selectionStart);
    setDismissedSlash("");
    setSlashIndex(0);
    const restoreSelection = () => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(applied.selectionStart, applied.selectionEnd);
    };
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(restoreSelection);
    } else {
      setTimeout(restoreSelection, 0);
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!showSlashMenu) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashIndex((current) => (current + 1) % matchingSlashCommands.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashIndex((current) => (current - 1 + matchingSlashCommands.length) % matchingSlashCommands.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      runSlashCommand(matchingSlashCommands[Math.min(slashIndex, matchingSlashCommands.length - 1)].id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedSlash(slashKey);
    }
  }

  return (
    <main className="note-editor">
      <header className="note-header">
        <div className="note-heading-block">
          <h1>{note.title}</h1>
          <p>{note.path}</p>
          <div className="note-reading-metrics" aria-label={t("笔记统计")}>
            <span>{t("{count} 字", { count: metrics.words })}</span>
            <span>{t("{count} 字符", { count: metrics.characters })}</span>
            <span>{t("约 {count} 分钟阅读", { count: metrics.readingMinutes })}</span>
          </div>
        </div>
        <div className="segmented">
          <button disabled={readOnly} className={mode === "edit" ? "active" : ""} onClick={() => onModeChange("edit")} type="button">
            {t("编辑")}
          </button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => onModeChange("preview")} type="button">
            {t("阅读")}
          </button>
        </div>
      </header>

      <ArticleProfileCard
        note={note}
        onSave={onProfileSave}
        readOnly={readOnly}
      />

      <NoteTagCloud
        extracting={tagExtracting}
        note={note}
        onExtract={onExtractTags}
        onTagsChange={onTagsChange}
        readOnly={readOnly}
      />

      {mode === "edit" && !readOnly ? (
        <div className="markdown-editor-shell">
          <textarea
            aria-label={t("Markdown 编辑器")}
            className="markdown-input"
            onChange={(event) => {
              onChange(event.target.value);
              updateCaret(event.target);
              setSlashIndex(0);
            }}
            onClick={(event) => updateCaret(event.currentTarget)}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={(event) => updateCaret(event.currentTarget)}
            onSelect={(event) => updateCaret(event.currentTarget)}
            ref={textareaRef}
            value={note.content}
          />
          {showSlashMenu ? (
            <div className="slash-command-menu" aria-label={t("斜杠命令")} role="listbox">
              <div className="slash-command-menu-title">
                <strong>{t("插入内容")}</strong>
                <span>{t("↑↓ 选择 · Enter 插入 · Esc 关闭")}</span>
              </div>
              {matchingSlashCommands.map((command, index) => (
                <button
                  aria-selected={index === slashIndex}
                  className={index === slashIndex ? "active" : ""}
                  key={command.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runSlashCommand(command.id);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{t(command.label)}</span>
                  <kbd>{command.hint}</kbd>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <article className="markdown-preview">
          {renderPreview(note.content, { onSelectGraphNode, resolveNote, t })}
        </article>
      )}
      {miniGraph && onSelectGraphNode ? (
        <MiniStarGraph currentPath={note.path} graph={miniGraph} onSelect={onSelectGraphNode} />
      ) : null}
    </main>
  );
}

export function measureNoteContent(content: string): NoteReadingMetrics {
  const text = visibleNoteText(content);
  const characters = (text.match(/\S/gu) ?? []).length;
  const cjkCharacters = (
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []
  ).length;
  const nonCjkText = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    " "
  );
  const latinWords = (nonCjkText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const words = cjkCharacters + latinWords;
  const readingMinutes = words === 0 ? 0 : Math.max(1, Math.ceil(cjkCharacters / 500 + latinWords / 220));
  return { words, characters, readingMinutes };
}

export function findSlashCommand(content: string, caret: number): SlashCommandMatch | undefined {
  const safeCaret = Math.max(0, Math.min(caret, content.length));
  const start = content.lastIndexOf("\n", safeCaret - 1) + 1;
  const beforeCaret = content.slice(start, safeCaret);
  const match = /^(\s*)\/([^\s/]*)$/u.exec(beforeCaret);
  if (!match) return undefined;
  return {
    start,
    end: safeCaret,
    indent: match[1],
    query: match[2].toLowerCase()
  };
}

export function applySlashCommand(
  content: string,
  match: SlashCommandMatch,
  commandId: SlashCommandId,
  now = new Date()
): AppliedSlashCommand {
  const definition = slashInsertion(commandId, now);
  const replacement = `${match.indent}${definition.text}`;
  const nextContent = `${content.slice(0, match.start)}${replacement}${content.slice(match.end)}`;
  const selectionStart = match.start + match.indent.length + definition.selectionStart;
  const selectionEnd = match.start + match.indent.length + definition.selectionEnd;
  return { content: nextContent, selectionStart, selectionEnd };
}

function filterSlashCommands(query: string): SlashCommandDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => (
    `${command.label} ${command.keywords} ${command.hint}`.toLowerCase().includes(normalizedQuery)
  ));
}

function slashInsertion(commandId: SlashCommandId, now: Date): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} {
  const date = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const insertions: Record<SlashCommandId, { text: string; selectionStart: number; selectionEnd: number }> = {
    "heading-1": { text: "# ", selectionStart: 2, selectionEnd: 2 },
    "heading-2": { text: "## ", selectionStart: 3, selectionEnd: 3 },
    "heading-3": { text: "### ", selectionStart: 4, selectionEnd: 4 },
    "bullet-list": { text: "- ", selectionStart: 2, selectionEnd: 2 },
    task: { text: "- [ ] ", selectionStart: 6, selectionEnd: 6 },
    quote: { text: "> ", selectionStart: 2, selectionEnd: 2 },
    "code-block": { text: "```\n\n```", selectionStart: 4, selectionEnd: 4 },
    wikilink: { text: "[[]]", selectionStart: 2, selectionEnd: 2 },
    "horizontal-rule": { text: "---", selectionStart: 3, selectionEnd: 3 },
    date: { text: date, selectionStart: date.length, selectionEnd: date.length },
    time: { text: time, selectionStart: time.length, selectionEnd: time.length }
  };
  return insertions[commandId];
}

function visibleNoteText(content: string): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
  return withoutFrontmatter
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/gu, (_raw, target: string, alias?: string) => alias?.trim() || target)
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/```[\w-]*\r?\n?/gu, "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, "")
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gmu, "")
    .replace(/[*_~`]/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .trim();
}

function renderPreview(content: string, options: InlinePreviewOptions) {
  const lines = content.split(/\r?\n/);
  const footnotes = collectFootnotes(content);
  const previewOptions = { ...options, footnotes };
  let inFrontmatter = lines[0]?.trim() === "---";
  const blocks = lines.map((line, index) => {
    if (index > 0 && inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      return null;
    }
    if (inFrontmatter) return null;
    if (/^\[\^[^\]]+\]:\s*/.test(line)) return null;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      return createElement(
        `h${heading[1].length}`,
        { key: index, "data-outline-line": index + 1 },
        renderInlineMarkdownNodes(heading[2], previewOptions, index)
      );
    }
    if (line.startsWith("- ")) {
      return <li key={index}>{renderInlineMarkdownNodes(line.slice(2), previewOptions, index)}</li>;
    }
    if (line.trim() === "") return <br key={index} />;
    return <p key={index}>{renderInlineMarkdownNodes(line, previewOptions, index)}</p>;
  });
  if (footnotes.size === 0) return blocks;
  blocks.push(
    <section className="markdown-footnotes" key="footnotes">
      <h2>{options.t?.("脚注") ?? "脚注"}</h2>
      <ol>
        {[...footnotes.entries()].map(([id, text]) => (
          <li id={`footnote-${safeFootnoteId(id)}`} key={id}>
            {renderInlineMarkdownNodes(text, { ...previewOptions, footnotes: new Map() }, lines.length + id.length)}
            <button
              aria-label={options.t?.("返回脚注引用") ?? "返回脚注引用"}
              onClick={() => document.querySelector<HTMLElement>(`[data-footnote-ref="${safeFootnoteId(id)}"]`)?.scrollIntoView({ block: "center" })}
              type="button"
            >
              ↩
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
  return blocks;
}

function renderInlineMarkdownNodes(
  text: string,
  options: InlinePreviewOptions,
  lineIndex: number
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(...renderFootnoteReferences(text.slice(cursor, match.index), options, `${lineIndex}:${cursor}`));
    const embedded = match[1] === "!";
    const target = match[2].trim();
    const heading = match[3]?.trim();
    const alias = match[4]?.trim();
    const resolved = options.resolveNote?.(target);
    const display = alias || target;
    const destination = resolved?.path ?? target;
    const translate = options.t ?? ((source: string) => source);
    nodes.push(
      <span
        className={`wikilink-with-preview${resolved ? " resolved" : " unresolved"}${embedded ? " embedded" : ""}`}
        key={`${lineIndex}:${match.index}:${match[0]}`}
      >
        <button
          onClick={() => options.onSelectGraphNode?.(destination)}
          title={resolved ? resolved.path : translate("未解析：{target}", { target })}
          type="button"
        >
          {embedded ? "↳ " : ""}
          {display}
          {heading ? ` › ${heading}` : ""}
        </button>
        <span className="wikilink-page-preview" role="tooltip">
          <strong>{resolved?.title ?? display}</strong>
          <small>{resolved?.path ?? translate("尚未创建的笔记")}</small>
          <span className="wikilink-preview-excerpt">
            {resolved?.excerpt || translate("点击可创建并打开这篇笔记。")}
          </span>
          {resolved?.tags.length ? (
            <span className="wikilink-preview-tags">
              {resolved.tags.slice(0, 4).map((tag) => <em key={tag}>#{tag}</em>)}
            </span>
          ) : null}
        </span>
      </span>
    );
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) nodes.push(...renderFootnoteReferences(text.slice(cursor), options, `${lineIndex}:${cursor}`));
  return nodes;
}

export function collectFootnotes(content: string): Map<string, string> {
  const footnotes = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let activeId = "";
  for (const line of lines) {
    const definition = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (definition) {
      activeId = definition[1].trim();
      if (activeId) footnotes.set(activeId, definition[2].trim());
      continue;
    }
    if (activeId && /^(?: {2,}|\t)\S/.test(line)) {
      footnotes.set(activeId, `${footnotes.get(activeId) ?? ""} ${line.trim()}`.trim());
    } else if (line.trim()) {
      activeId = "";
    }
  }
  return footnotes;
}

function renderFootnoteReferences(text: string, options: InlinePreviewOptions, keyPrefix: string): ReactNode[] {
  if (!options.footnotes?.size) return [text];
  const nodes: ReactNode[] = [];
  const pattern = /\[\^([^\]]+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const id = match[1].trim();
    if (!options.footnotes.has(id)) {
      nodes.push(match[0]);
    } else {
      const safeId = safeFootnoteId(id);
      nodes.push(
        <sup className="footnote-reference" data-footnote-ref={safeId} key={`${keyPrefix}:${match.index}`}>
          <button
            onClick={() => document.getElementById(`footnote-${safeId}`)?.scrollIntoView({ block: "center" })}
            title={options.footnotes.get(id)}
            type="button"
          >
            {id}
          </button>
        </sup>
      );
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function safeFootnoteId(id: string): string {
  return encodeURIComponent(id).replace(/%/g, "_");
}

export function renderInlineMarkdownText(text: string): string {
  return text.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_raw, target: string, alias?: string) => {
    return alias?.trim() || target;
  });
}
