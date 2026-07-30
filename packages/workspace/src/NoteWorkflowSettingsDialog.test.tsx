/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseNote } from "@knowledge-agent/core";
import { LanguageProvider } from "@knowledge-agent/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteWorkflowSettingsDialog } from "./NoteWorkflowSettingsDialog";
import { DEFAULT_NOTE_WORKFLOW_SETTINGS } from "./noteWorkflowModel";

afterEach(() => cleanup());

describe("NoteWorkflowSettingsDialog", () => {
  it("saves normalized template and daily-note settings", () => {
    const onSave = vi.fn();
    render(
      <LanguageProvider initialLocale="zh-CN">
        <NoteWorkflowSettingsDialog
          onClose={vi.fn()}
          onSave={onSave}
          settings={DEFAULT_NOTE_WORKFLOW_SETTINGS}
          templates={[parseNote({ path: "模板/日记.md", content: "# {{title}}" })]}
        />
      </LanguageProvider>
    );

    fireEvent.change(screen.getByLabelText("模板文件夹"), { target: { value: "Work\\Templates" } });
    fireEvent.change(screen.getByLabelText("日记文件夹"), { target: { value: "Journal/" } });
    fireEvent.change(screen.getByLabelText("日期格式"), { target: { value: "YYYY/MM/DD" } });
    fireEvent.change(screen.getByLabelText("日记模板"), { target: { value: "模板/日记.md" } });
    fireEvent.click(screen.getByText("保存"));

    expect(onSave).toHaveBeenCalledWith({
      templatesFolder: "Work/Templates",
      dailyFolder: "Journal",
      dailyFormat: "YYYY-MM-DD",
      dailyTemplatePath: "模板/日记.md"
    });
  });
});
