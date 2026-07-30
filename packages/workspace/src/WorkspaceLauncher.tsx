import { Command, FilePlus2, FileSearch2, FileText, LayoutTemplate, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLocalization } from "@knowledge-agent/ui";
import type { WorkspaceLauncherItem } from "./workspaceLauncherModel";

export type WorkspaceLauncherMode = "commands" | "notes" | "search" | "templates" | "headings" | "merge";

export interface WorkspaceLauncherSelectionOptions {
  createExact: boolean;
  openInNewTab: boolean;
}

export interface WorkspaceLauncherProps {
  items: WorkspaceLauncherItem[];
  mode: WorkspaceLauncherMode;
  open: boolean;
  query: string;
  onClose(): void;
  onQueryChange(query: string): void;
  onSelect(item: WorkspaceLauncherItem, options: WorkspaceLauncherSelectionOptions): void;
}

export function WorkspaceLauncher({
  items,
  mode,
  open,
  query,
  onClose,
  onQueryChange,
  onSelect
}: WorkspaceLauncherProps) {
  const { t } = useLocalization();
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [mode, open]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, items.length - 1)));
  }, [items.length, query]);

  if (!open) return null;
  const activeItem = items[activeIndex];

  function selectItem(item: WorkspaceLauncherItem | undefined, event?: KeyboardEvent<HTMLInputElement>) {
    if (!item) return;
    onSelect(item, {
      createExact: Boolean(event?.shiftKey),
      openInNewTab: Boolean(event?.ctrlKey || event?.metaKey)
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectItem(activeItem, event);
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="workspace-launcher-backdrop" onMouseDown={closeFromBackdrop}>
      <section
        aria-label={t(launcherTitle(mode))}
        aria-modal="true"
        className="workspace-launcher"
        role="dialog"
      >
        <header>
          <span aria-hidden="true">{launcherIcon(mode)}</span>
          <input
            aria-label={t(launcherTitle(mode))}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(launcherPlaceholder(mode))}
            ref={inputRef}
            value={query}
          />
          <button aria-label={t("关闭")} onClick={onClose} title={t("关闭")} type="button">
            <X size={15} />
          </button>
        </header>
        <div aria-label={t("结果")} className="workspace-launcher-results" role="listbox">
          {items.length === 0 ? (
            <div className="workspace-launcher-empty">
              <Search size={18} />
              <span>{t(mode === "search" && !query.trim() ? "输入关键词开始全库搜索" : "没有匹配结果")}</span>
            </div>
          ) : (
            items.map((item, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : ""}
                key={item.id}
                onClick={() => selectItem(item)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span className={`workspace-launcher-kind ${item.kind}`} aria-hidden="true">
                  {itemIcon(item)}
                </span>
                <span className="workspace-launcher-copy">
                  <strong>{item.kind === "create" ? t(item.label) : item.label}</strong>
                  {item.detail ? <small>{item.detail}</small> : null}
                </span>
                {typeof item.matchCount === "number" ? <b>{item.matchCount}</b> : null}
                {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function launcherTitle(mode: WorkspaceLauncherMode) {
  if (mode === "notes") return "快速切换";
  if (mode === "search") return "全库搜索";
  if (mode === "templates") return "插入模板";
  if (mode === "headings") return "按标题拆分笔记";
  if (mode === "merge") return "合并笔记内容";
  return "命令面板";
}

function launcherPlaceholder(mode: WorkspaceLauncherMode) {
  if (mode === "notes") return "输入标题、路径或别名";
  if (mode === "search") return "搜索正文，支持 file:、path:、tag:、task: 和 [属性]";
  if (mode === "templates") return "选择要插入的模板";
  if (mode === "headings") return "选择要提取为新笔记的标题";
  if (mode === "merge") return "选择要合并到当前笔记的文档";
  return "输入命令";
}

function launcherIcon(mode: WorkspaceLauncherMode) {
  if (mode === "notes") return <FileSearch2 size={17} />;
  if (mode === "search") return <Search size={17} />;
  if (mode === "templates") return <LayoutTemplate size={17} />;
  if (mode === "headings" || mode === "merge") return <FileText size={17} />;
  return <Command size={17} />;
}

function itemIcon(item: WorkspaceLauncherItem) {
  if (item.kind === "create") return <FilePlus2 size={15} />;
  if (item.kind === "note") return <FileText size={15} />;
  if (item.kind === "search") return <Search size={15} />;
  return <Command size={15} />;
}
