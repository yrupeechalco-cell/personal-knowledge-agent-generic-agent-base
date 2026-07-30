import {
  DEFAULT_FORMAT_CONVERSION_OPTIONS,
  convertMarkdownFormat,
  type MarkdownFormatConversionOptions,
  type ParsedNote
} from "@knowledge-agent/core";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { useLocalization } from "@knowledge-agent/ui";

export function FormatConverterDialog({
  notes,
  onApply,
  onClose
}: {
  notes: ParsedNote[];
  onApply(options: MarkdownFormatConversionOptions): void;
  onClose(): void;
}) {
  const { t } = useLocalization();
  const [options, setOptions] = useState(DEFAULT_FORMAT_CONVERSION_OPTIONS);
  const preview = useMemo(() => {
    let noteCount = 0;
    let changeCount = 0;
    for (const note of notes) {
      const result = convertMarkdownFormat(note.content, options);
      if (result.changes > 0) noteCount += 1;
      changeCount += result.changes;
    }
    return { noteCount, changeCount };
  }, [notes, options]);

  function toggle(key: keyof MarkdownFormatConversionOptions) {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="format-converter-backdrop" onMouseDown={closeFromBackdrop}>
      <section aria-label={t("格式转换器")} aria-modal="true" className="format-converter-dialog" role="dialog">
        <header>
          <div>
            <RefreshCw size={18} />
            <span>
              <strong>{t("格式转换器")}</strong>
              <small>{t("将其他应用的 Markdown 语法转换为当前格式")}</small>
            </span>
          </div>
          <button aria-label={t("关闭")} onClick={onClose} type="button"><X size={15} /></button>
        </header>
        <div className="format-converter-options">
          <ConversionOption
            checked={options.roamTags}
            description={t("将 #tag 与 #[[tag]] 转为 [[tag]]")}
            label="Roam · Tags"
            onChange={() => toggle("roamTags")}
          />
          <ConversionOption
            checked={options.roamHighlights}
            description={t("将 ^^highlight^^ 转为 ==highlight==")}
            label="Roam · Highlights"
            onChange={() => toggle("roamHighlights")}
          />
          <ConversionOption
            checked={options.roamTodos}
            description={t("将 {{[[TODO]]}} 转为 [ ]")}
            label="Roam · TODO"
            onChange={() => toggle("roamTodos")}
          />
          <ConversionOption
            checked={options.bearHighlights}
            description={t("将 ::highlight:: 转为 ==highlight==")}
            label="Bear · Highlights"
            onChange={() => toggle("bearHighlights")}
          />
          <ConversionOption
            checked={options.deprecatedProperties}
            description={t("将 alias、tag、cssclass 转为当前列表属性")}
            label={t("旧属性格式")}
            onChange={() => toggle("deprecatedProperties")}
          />
        </div>
        <div className="format-converter-summary">
          <AlertTriangle size={17} />
          <div>
            <strong>{t("将修改 {notes} 篇笔记，共 {changes} 处", { notes: preview.noteCount, changes: preview.changeCount })}</strong>
            <span>{t("这是批量操作。确认后改动会进入现有草稿与自动保存流程。")}</span>
          </div>
        </div>
        <footer>
          <button onClick={onClose} type="button">{t("取消")}</button>
          <button
            className="primary"
            disabled={preview.changeCount === 0}
            onClick={() => onApply(options)}
            type="button"
          >
            {t("开始转换")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ConversionOption({
  checked,
  description,
  label,
  onChange
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange(): void;
}) {
  return (
    <label>
      <input checked={checked} onChange={onChange} type="checkbox" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
