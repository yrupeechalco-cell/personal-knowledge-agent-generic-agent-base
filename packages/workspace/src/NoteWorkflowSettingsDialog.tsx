import type { ParsedNote } from "@knowledge-agent/core";
import { useLocalization } from "@knowledge-agent/ui";
import { CalendarDays, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  normalizeNoteWorkflowSettings,
  type NoteWorkflowSettings
} from "./noteWorkflowModel";

export function NoteWorkflowSettingsDialog({
  onClose,
  onSave,
  settings,
  templates
}: {
  onClose(): void;
  onSave(settings: NoteWorkflowSettings): void;
  settings: NoteWorkflowSettings;
  templates: ParsedNote[];
}) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState(settings);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(normalizeNoteWorkflowSettings(draft));
  }

  return (
    <div className="note-workflow-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form aria-label={t("模板与日记设置")} className="note-workflow-dialog" onSubmit={submit} role="dialog">
        <header>
          <span><CalendarDays /></span>
          <div>
            <h2>{t("模板与日记")}</h2>
            <p>{t("这些设置只保存在当前设备，并按知识库分别记录。")}</p>
          </div>
          <button aria-label={t("关闭")} onClick={onClose} type="button"><X /></button>
        </header>
        <label>
          <span>{t("模板文件夹")}</span>
          <input
            aria-label={t("模板文件夹")}
            onChange={(event) => setDraft((current) => ({ ...current, templatesFolder: event.target.value }))}
            placeholder="模板"
            value={draft.templatesFolder}
          />
        </label>
        <label>
          <span>{t("日记文件夹")}</span>
          <input
            aria-label={t("日记文件夹")}
            onChange={(event) => setDraft((current) => ({ ...current, dailyFolder: event.target.value }))}
            placeholder="日记"
            value={draft.dailyFolder}
          />
        </label>
        <label>
          <span>{t("日期格式")}</span>
          <input
            aria-label={t("日期格式")}
            onChange={(event) => setDraft((current) => ({ ...current, dailyFormat: event.target.value }))}
            placeholder="YYYY-MM-DD"
            value={draft.dailyFormat}
          />
          <small>{t("支持 YYYY、YY、MM、M、DD、D。文件名非法字符会转换为连字符。")}</small>
        </label>
        <label>
          <span>{t("日记模板")}</span>
          <select
            aria-label={t("日记模板")}
            onChange={(event) => setDraft((current) => ({ ...current, dailyTemplatePath: event.target.value }))}
            value={draft.dailyTemplatePath}
          >
            <option value="">{t("不使用模板")}</option>
            {templates.map((template) => <option key={template.path} value={template.path}>{template.title} · {template.path}</option>)}
          </select>
        </label>
        <footer>
          <span>{t("模板变量：{{title}}、{{date}}、{{time}}")}</span>
          <div>
            <button onClick={onClose} type="button">{t("取消")}</button>
            <button className="primary" type="submit">{t("保存")}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
