import type { NoteGraph, ParsedNote } from "@knowledge-agent/core";
import { MiniStarGraph } from "./MiniStarGraph";
import { useLocalization } from "./localization";

export interface NoteEditorProps {
  note?: ParsedNote;
  miniGraph?: NoteGraph;
  mode: "edit" | "preview";
  readOnly?: boolean;
  onModeChange(mode: "edit" | "preview"): void;
  onChange(content: string): void;
  onSelectGraphNode?(path: string): void;
}

export function NoteEditor({ note, miniGraph, mode, onModeChange, onChange, onSelectGraphNode, readOnly = false }: NoteEditorProps) {
  const { t } = useLocalization();
  if (!note) {
    return <main className="note-editor empty">{t("选择一篇笔记开始。")}</main>;
  }

  return (
    <main className="note-editor">
      <header className="note-header">
        <div>
          <h1>{note.title}</h1>
          <p>{note.path}</p>
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

      {mode === "edit" && !readOnly ? (
        <textarea className="markdown-input" value={note.content} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <article className="markdown-preview">{renderPreview(note.content)}</article>
      )}
      {miniGraph && onSelectGraphNode ? (
        <MiniStarGraph currentPath={note.path} graph={miniGraph} onSelect={onSelectGraphNode} />
      ) : null}
    </main>
  );
}

function renderPreview(content: string) {
  return content.split(/\r?\n/).map((line, index) => {
    if (line.startsWith("# ")) return <h1 key={index}>{renderInlineMarkdownText(line.slice(2))}</h1>;
    if (line.startsWith("## ")) return <h2 key={index}>{renderInlineMarkdownText(line.slice(3))}</h2>;
    if (line.startsWith("- ")) return <li key={index}>{renderInlineMarkdownText(line.slice(2))}</li>;
    if (line.trim() === "") return <br key={index} />;
    return <p key={index}>{renderInlineMarkdownText(line)}</p>;
  });
}

export function renderInlineMarkdownText(text: string): string {
  return text.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_raw, target: string, alias?: string) => {
    return alias?.trim() || target;
  });
}
