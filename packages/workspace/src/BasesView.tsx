import type { ParsedNote } from "@knowledge-agent/core";
import { ArrowDownAZ, ArrowUpAZ, Columns3, Database, Search } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useLocalization } from "@knowledge-agent/ui";
import {
  DEFAULT_BASE_VIEW_SETTINGS,
  baseValue,
  baseViewStorageKey,
  collectBasePropertyColumns,
  filterAndSortBaseNotes,
  formatBaseValue,
  normalizeBaseViewSettings,
  type BaseViewSettings
} from "./basesModel";

export interface BasesViewProps {
  notes: ParsedNote[];
  readOnly?: boolean;
  sourceKind: string;
  sourceName: string;
  onOpenNote(path: string): void;
  onPropertyChange?(path: string, key: string, value: string): void;
}

export function BasesView({
  notes,
  readOnly = false,
  sourceKind,
  sourceName,
  onOpenNote,
  onPropertyChange
}: BasesViewProps) {
  const { t } = useLocalization();
  const columns = useMemo(() => collectBasePropertyColumns(notes), [notes]);
  const availablePropertySignature = columns.map((column) => column.key).join("\n");
  const storageKey = baseViewStorageKey(sourceKind, sourceName);
  const [storedView, setStoredView] = useState<{ key: string; settings: BaseViewSettings }>({
    key: storageKey,
    settings: DEFAULT_BASE_VIEW_SETTINGS
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const settings = storedView.key === storageKey ? storedView.settings : DEFAULT_BASE_VIEW_SETTINGS;
  const visibleProperties = settings.visibleProperties.length > 0
    ? settings.visibleProperties
    : columns.slice(0, 4).map((column) => column.key);
  const rows = useMemo(
    () => filterAndSortBaseNotes(notes, settings),
    [notes, settings]
  );

  useEffect(() => {
    let stored: unknown = DEFAULT_BASE_VIEW_SETTINGS;
    try {
      stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    } catch {
      stored = DEFAULT_BASE_VIEW_SETTINGS;
    }
    setStoredView({
      key: storageKey,
      settings: normalizeBaseViewSettings(stored, columns.map((column) => column.key))
    });
  }, [availablePropertySignature, storageKey]);

  function updateSettings(updater: (current: BaseViewSettings) => BaseViewSettings) {
    const next = updater(settings);
    setStoredView({ key: storageKey, settings: next });
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The view remains available for this session.
    }
  }

  function toggleProperty(key: string) {
    updateSettings((current) => ({
      ...current,
      visibleProperties: current.visibleProperties.includes(key)
        ? current.visibleProperties.filter((item) => item !== key)
        : [...current.visibleProperties, key]
    }));
  }

  function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  return (
    <section className="bases-view" aria-label={t("属性数据库")}>
      <header className="bases-toolbar">
        <div className="bases-title">
          <Database size={18} />
          <div>
            <strong>{t("属性数据库")}</strong>
            <span>{t("{visible} / {total} 篇笔记", { visible: rows.length, total: notes.length })}</span>
          </div>
        </div>
        <label className="bases-search">
          <Search size={13} />
          <input
            aria-label={t("筛选数据库")}
            onChange={(event) => updateSettings((current) => ({ ...current, query: event.target.value }))}
            placeholder={t("搜索标题、路径、标签或属性")}
            value={settings.query}
          />
        </label>
        <label className="bases-sort">
          <span>{t("排序")}</span>
          <select
            aria-label={t("排序字段")}
            onChange={(event) => updateSettings((current) => ({ ...current, sortKey: event.target.value }))}
            value={settings.sortKey}
          >
            <option value="title">{t("标题")}</option>
            <option value="path">{t("路径")}</option>
            <option value="tags">{t("标签")}</option>
            {columns.map((column) => <option key={column.key} value={column.key}>{column.key}</option>)}
          </select>
        </label>
        <button
          aria-label={t("切换排序方向")}
          className="bases-icon-button"
          onClick={() => updateSettings((current) => ({
            ...current,
            sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
          }))}
          title={settings.sortDirection === "asc" ? t("升序") : t("降序")}
          type="button"
        >
          {settings.sortDirection === "asc" ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
        </button>
        <div className="bases-column-control">
          <button
            aria-expanded={columnsOpen}
            className="bases-columns-button"
            onClick={() => setColumnsOpen((open) => !open)}
            type="button"
          >
            <Columns3 size={15} />
            {t("列")}
          </button>
          {columnsOpen ? (
            <div className="bases-column-menu">
              {columns.length === 0 ? <span>{t("暂无自定义属性")}</span> : columns.map((column) => (
                <label key={column.key}>
                  <input
                    checked={visibleProperties.includes(column.key)}
                    onChange={() => toggleProperty(column.key)}
                    type="checkbox"
                  />
                  <span>{column.key}</span>
                  <small>{column.type} · {column.count}</small>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="bases-table-wrap">
        <table className="bases-table">
          <thead>
            <tr>
              <th>{t("标题")}</th>
              <th>{t("路径")}</th>
              <th>{t("标签")}</th>
              {visibleProperties.map((key) => <th key={key}>{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="bases-empty" colSpan={3 + visibleProperties.length}>{t("没有匹配的笔记")}</td></tr>
            ) : rows.map((note) => (
              <tr key={note.path}>
                <td>
                  <button className="bases-note-link" onClick={() => onOpenNote(note.path)} type="button">
                    {note.title}
                  </button>
                </td>
                <td><span className="bases-path">{note.path}</span></td>
                <td><span className="bases-tags">{note.tags.map((tag) => `#${tag}`).join(" ")}</span></td>
                {visibleProperties.map((key) => (
                  <td key={key}>
                    {readOnly || !onPropertyChange ? (
                      <span>{formatBaseValue(baseValue(note, key))}</span>
                    ) : (
                      <input
                        aria-label={`${note.title} · ${key}`}
                        defaultValue={formatBaseValue(baseValue(note, key))}
                        key={`${note.path}:${key}:${formatBaseValue(baseValue(note, key))}`}
                        onBlur={(event) => onPropertyChange(note.path, key, event.target.value)}
                        onKeyDown={commitOnEnter}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
