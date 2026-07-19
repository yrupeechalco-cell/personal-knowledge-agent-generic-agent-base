import { buildNoteTagCloud, tagTargetCount, type ParsedNote, type TagGranularity } from "@knowledge-agent/core";
import { Check, PencilLine, Plus, Sparkles, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocalization } from "./localization";

export interface NoteTagCloudProps {
  note: ParsedNote;
  readOnly?: boolean;
  extracting?: boolean;
  onExtract?(granularity: TagGranularity): void;
  onTagsChange?(tags: string[]): void;
}

const GRANULARITY_LABELS: Record<TagGranularity, string> = {
  1: "概览",
  2: "主题",
  3: "标准",
  4: "细分",
  5: "术语"
};

export function NoteTagCloud({ note, readOnly = false, extracting = false, onExtract, onTagsChange }: NoteTagCloudProps) {
  const { runtime, t } = useLocalization();
  const [granularity, setGranularity] = useState<TagGranularity>(3);
  const [editing, setEditing] = useState(false);
  const [draftTag, setDraftTag] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const cloud = useMemo(() => buildNoteTagCloud(note, 5).filter((item) => item.existing), [note]);
  const visibleLimit = tagTargetCount(granularity, note.content.length);
  const visible = editing ? cloud : cloud.slice(0, visibleLimit);

  function commitTags(tags: string[]) {
    onTagsChange?.(tags);
  }

  function addTag() {
    const tag = draftTag.trim().replace(/^#/, "");
    if (!tag) return;
    commitTags([...note.tags, tag]);
    setDraftTag("");
  }

  function removeTag(tag: string) {
    commitTags(note.tags.filter((item) => item !== tag));
  }

  function beginRename(tag: string) {
    if (!editing) return;
    setRenaming(tag);
    setRenameValue(tag);
  }

  function commitRename() {
    if (!renaming) return;
    const value = renameValue.trim().replace(/^#/, "");
    commitTags(note.tags.map((tag) => (tag === renaming ? value : tag)).filter(Boolean));
    setRenaming(null);
    setRenameValue("");
  }

  return (
    <section className="note-tag-cloud" aria-label={t("资料词云")}>
      <header className="note-tag-cloud-toolbar">
        <div className="note-tag-cloud-title">
          <Tags aria-hidden="true" size={14} />
          <strong>{t("资料词云")}</strong>
          <span>{runtime(`${visible.length}/${cloud.length} 个标签`)}</span>
        </div>
        <label className="tag-granularity">
          <span>{t("颗粒度")} {granularity} · {t(GRANULARITY_LABELS[granularity])}</span>
          <input
            aria-label={t("标签拆解颗粒度")}
            max="5"
            min="1"
            onChange={(event) => setGranularity(Number(event.target.value) as TagGranularity)}
            step="1"
            type="range"
            value={granularity}
          />
        </label>
        <div className="note-tag-cloud-actions">
          {onExtract ? (
            <button
              aria-label={t("使用 Agent 拆解标签")}
              className={extracting ? "extracting" : ""}
              disabled={extracting || readOnly}
              onClick={() => onExtract(granularity)}
              title={t("使用 Agent 拆解标签")}
              type="button"
            >
              <Sparkles size={14} />
            </button>
          ) : null}
          {!readOnly && onTagsChange ? (
            <button
              aria-label={editing ? t("完成标签编辑") : t("编辑标签")}
              className={editing ? "active" : ""}
              onClick={() => {
                setEditing((value) => !value);
                setRenaming(null);
              }}
              title={editing ? t("完成标签编辑") : t("编辑标签")}
              type="button"
            >
              {editing ? <Check size={14} /> : <PencilLine size={14} />}
            </button>
          ) : null}
        </div>
      </header>

      <div className="note-tag-cloud-words">
        {visible.map((item) => {
          const size = 11 + item.weight * 10;
          if (renaming === item.name) {
            return (
              <span className="tag-cloud-rename" key={item.name}>
                <input
                  aria-label={t("重命名标签")}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  value={renameValue}
                />
                <button aria-label={t("确认重命名")} onClick={commitRename} type="button"><Check size={12} /></button>
              </span>
            );
          }
          return (
            <span className={`tag-cloud-word kind-${item.kind}`} key={item.name} style={{ fontSize: `${size}px` }}>
              <button onClick={() => beginRename(item.name)} title={editing ? t("重命名标签") : item.name} type="button">
                {item.name}
              </button>
              {editing ? (
                <button aria-label={`${t("删除标签")} ${item.name}`} className="tag-cloud-remove" onClick={() => removeTag(item.name)} type="button">
                  <X size={10} />
                </button>
              ) : null}
            </span>
          );
        })}
        {cloud.length === 0 && !editing ? <span className="tag-cloud-empty">{t("尚无标签，使用 Agent 拆解或手动添加。")}</span> : null}
        {editing ? (
          <span className="tag-cloud-add">
            <input
              aria-label={t("新标签")}
              onChange={(event) => setDraftTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTag();
              }}
              placeholder={t("添加标签")}
              value={draftTag}
            />
            <button aria-label={t("添加标签")} disabled={!draftTag.trim()} onClick={addTag} type="button"><Plus size={12} /></button>
          </span>
        ) : null}
      </div>
    </section>
  );
}
