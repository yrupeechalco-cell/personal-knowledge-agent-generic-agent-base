import {
  parseEditablePropertyValue,
  type FrontmatterValue,
  type ParsedNote
} from "@knowledge-agent/core";
import { useLocalization } from "@knowledge-agent/ui";
import {
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  FileInput,
  FileOutput,
  Link2,
  ListTree,
  Plus,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { NoteInspectorLink, NoteOutlineItem } from "./noteInspectorModel";

export type NoteInspectorTab = "properties" | "outline" | "links" | "bookmarks";

export interface NoteInspectorProps {
  backlinks: NoteInspectorLink[];
  bookmarkedNotes: ParsedNote[];
  currentBookmarked: boolean;
  note: ParsedNote;
  onAddProperty(key: string, value: FrontmatterValue): void;
  onNavigateHeading(item: NoteOutlineItem): void;
  onOpenLink(path: string): void;
  onRemoveProperty(key: string): void;
  onTabChange(tab: NoteInspectorTab): void;
  onToggleBookmark(): void;
  onUpdateProperty(key: string, value: FrontmatterValue): void;
  outline: NoteOutlineItem[];
  outlinks: NoteInspectorLink[];
  readOnly: boolean;
  tab: NoteInspectorTab;
}

export function NoteInspector({
  backlinks,
  bookmarkedNotes,
  currentBookmarked,
  note,
  onAddProperty,
  onNavigateHeading,
  onOpenLink,
  onRemoveProperty,
  onTabChange,
  onToggleBookmark,
  onUpdateProperty,
  outline,
  outlinks,
  readOnly,
  tab
}: NoteInspectorProps) {
  const { t } = useLocalization();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  function addProperty() {
    const key = newKey.trim();
    if (!key) return;
    onAddProperty(key, parseEditablePropertyValue(newValue));
    setNewKey("");
    setNewValue("");
  }

  return (
    <section className="vault-panel note-inspector">
      <div className="note-inspector-tabs" role="tablist" aria-label={t("笔记导航")}>
        <InspectorTab active={tab === "properties"} label={t("属性")} onClick={() => onTabChange("properties")}>
          <SlidersHorizontal />
        </InspectorTab>
        <InspectorTab active={tab === "outline"} label={t("大纲")} onClick={() => onTabChange("outline")}>
          <ListTree />
        </InspectorTab>
        <InspectorTab active={tab === "links"} label={t("链接")} onClick={() => onTabChange("links")}>
          <Link2 />
        </InspectorTab>
        <InspectorTab active={tab === "bookmarks"} label={t("书签")} onClick={() => onTabChange("bookmarks")}>
          <Bookmark />
        </InspectorTab>
        <button
          aria-label={currentBookmarked ? t("取消当前笔记书签") : t("收藏当前笔记")}
          className={`note-bookmark-toggle ${currentBookmarked ? "active" : ""}`}
          onClick={onToggleBookmark}
          title={currentBookmarked ? t("取消当前笔记书签") : t("收藏当前笔记")}
          type="button"
        >
          {currentBookmarked ? <BookmarkCheck /> : <Bookmark />}
        </button>
      </div>

      <div className="note-inspector-body">
        {tab === "properties" ? (
          <div className="property-list">
            {Object.entries(note.frontmatter).length === 0 ? <p>{t("暂无属性")}</p> : null}
            {Object.entries(note.frontmatter).map(([key, value]) => (
              <PropertyRow
                key={key}
                name={key}
                onCommit={(nextValue) => onUpdateProperty(key, nextValue)}
                onRemove={() => onRemoveProperty(key)}
                readOnly={readOnly}
                value={value}
              />
            ))}
            {!readOnly ? (
              <div className="property-add-row">
                <input
                  aria-label={t("新属性名称")}
                  onChange={(event) => setNewKey(event.target.value)}
                  placeholder={t("属性名")}
                  value={newKey}
                />
                <input
                  aria-label={t("新属性值")}
                  onChange={(event) => setNewValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addProperty();
                  }}
                  placeholder={t("值")}
                  value={newValue}
                />
                <button aria-label={t("添加属性")} disabled={!newKey.trim()} onClick={addProperty} title={t("添加属性")} type="button">
                  <Plus />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "outline" ? (
          <div className="outline-list">
            {outline.length === 0 ? <p>{t("当前笔记没有标题大纲")}</p> : outline.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigateHeading(item)}
                style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }}
                type="button"
              >
                <ChevronRight />
                <span>{item.text}</span>
              </button>
            ))}
          </div>
        ) : null}

        {tab === "links" ? (
          <div className="inspector-links">
            <LinkGroup
              emptyLabel={t("没有出链")}
              icon={<FileOutput />}
              label={t("出链")}
              links={outlinks}
              onOpen={onOpenLink}
            />
            <LinkGroup
              emptyLabel={t("没有反链")}
              icon={<FileInput />}
              label={t("反链")}
              links={backlinks}
              onOpen={onOpenLink}
            />
          </div>
        ) : null}

        {tab === "bookmarks" ? (
          <div className="bookmark-list">
            {bookmarkedNotes.length === 0 ? <p>{t("暂无书签")}</p> : bookmarkedNotes.map((bookmark) => (
              <button key={bookmark.path} onClick={() => onOpenLink(bookmark.path)} type="button">
                <Bookmark />
                <span>
                  <strong>{bookmark.title}</strong>
                  <small>{bookmark.path}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InspectorTab({
  active,
  children,
  label,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      aria-selected={active}
      className={active ? "active" : ""}
      onClick={onClick}
      role="tab"
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function PropertyRow({
  name,
  onCommit,
  onRemove,
  readOnly,
  value
}: {
  name: string;
  onCommit(value: FrontmatterValue): void;
  onRemove(): void;
  readOnly: boolean;
  value: FrontmatterValue;
}) {
  if (typeof value === "boolean") {
    return (
      <label className="property-row boolean">
        <span>{name}</span>
        <input checked={value} disabled={readOnly} onChange={(event) => onCommit(event.target.checked)} type="checkbox" />
        {!readOnly ? <button aria-label={`删除属性 ${name}`} onClick={onRemove} type="button"><X /></button> : null}
      </label>
    );
  }
  return (
    <div className="property-row">
      <span title={name}>{name}</span>
      <PropertyInput onCommit={onCommit} readOnly={readOnly} value={value} />
      {!readOnly ? <button aria-label={`删除属性 ${name}`} onClick={onRemove} type="button"><X /></button> : null}
    </div>
  );
}

function PropertyInput({
  onCommit,
  readOnly,
  value
}: {
  onCommit(value: FrontmatterValue): void;
  readOnly: boolean;
  value: FrontmatterValue;
}) {
  const formatted = Array.isArray(value) ? value.join(", ") : String(value);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);

  function commit() {
    if (draft !== formatted) onCommit(parseEditablePropertyValue(draft, value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.currentTarget.blur();
  }

  return (
    <input
      disabled={readOnly}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      type={typeof value === "number" ? "number" : "text"}
      value={draft}
    />
  );
}

function LinkGroup({
  emptyLabel,
  icon,
  label,
  links,
  onOpen
}: {
  emptyLabel: string;
  icon: ReactNode;
  label: string;
  links: NoteInspectorLink[];
  onOpen(path: string): void;
}) {
  return (
    <section>
      <header>
        {icon}
        <strong>{label}</strong>
        <span>{links.length}</span>
      </header>
      {links.length === 0 ? <p>{emptyLabel}</p> : links.map((link) => (
        <button className={link.resolved ? "" : "unresolved"} key={link.id} onClick={() => onOpen(link.path)} type="button">
          <span>{link.label}</span>
          {link.detail ? <small>{link.detail}</small> : null}
        </button>
      ))}
    </section>
  );
}
