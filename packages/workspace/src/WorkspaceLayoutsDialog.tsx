import { LayoutDashboard, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useState, type FormEvent, type MouseEvent } from "react";
import { useLocalization } from "@knowledge-agent/ui";
import type { WorkspaceLayoutSnapshot } from "./workspaceLayoutsModel";

export function WorkspaceLayoutsDialog({
  layouts,
  onClose,
  onDelete,
  onRestore,
  onSave
}: {
  layouts: WorkspaceLayoutSnapshot[];
  onClose(): void;
  onDelete(id: string): void;
  onRestore(layout: WorkspaceLayoutSnapshot): void;
  onSave(name: string): void;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) return;
    onSave(normalized);
    setName("");
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="workspace-layouts-backdrop" onMouseDown={closeFromBackdrop}>
      <section aria-label={t("工作区布局")} aria-modal="true" className="workspace-layouts-dialog" role="dialog">
        <header>
          <div>
            <LayoutDashboard size={18} />
            <span>
              <strong>{t("工作区布局")}</strong>
              <small>{t("保存侧栏宽度、显隐状态和当前主视图")}</small>
            </span>
          </div>
          <button aria-label={t("关闭")} onClick={onClose} type="button"><X size={15} /></button>
        </header>
        <form onSubmit={submit}>
          <input
            aria-label={t("布局名称")}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("例如：学习、项目、专注阅读")}
            value={name}
          />
          <button disabled={!name.trim()} type="submit"><Save size={14} />{t("保存当前布局")}</button>
        </form>
        <div className="workspace-layout-list">
          {layouts.length === 0 ? (
            <div className="workspace-layout-empty">
              <LayoutDashboard size={22} />
              <span>{t("还没有保存的布局")}</span>
            </div>
          ) : layouts.map((layout) => (
            <article key={layout.id}>
              <div>
                <strong>{layout.name}</strong>
                <span>{t(centerModeLabel(layout.centerMode))} · {layout.leftVisible ? t("左栏开启") : t("左栏关闭")} · {layout.agentVisible ? t("Agent 开启") : t("Agent 收起")}</span>
              </div>
              <button onClick={() => onRestore(layout)} title={t("恢复布局")} type="button">
                <RotateCcw size={14} />
              </button>
              <button className="danger" onClick={() => onDelete(layout.id)} title={t("删除布局")} type="button">
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function centerModeLabel(mode: WorkspaceLayoutSnapshot["centerMode"]): string {
  if (mode === "canvas") return "知识画布";
  if (mode === "bases") return "属性数据库";
  if (mode === "slides") return "幻灯片";
  if (mode === "explorer") return "资源查询";
  if (mode === "trash") return "回收站";
  if (mode === "edit") return "笔记";
  return "关系图谱";
}
