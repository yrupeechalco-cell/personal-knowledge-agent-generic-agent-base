import { describe, expect, it } from "vitest";
import { parseNote } from "@knowledge-agent/core";
import {
  expandTemplate,
  formatDailyPath,
  normalizeNoteWorkflowSettings,
  notesInTemplateFolder,
  stripTemplateFrontmatter
} from "./noteWorkflowModel";

describe("note workflow model", () => {
  it("normalizes safe local template and daily-note settings", () => {
    expect(normalizeNoteWorkflowSettings({
      templatesFolder: "Work\\Templates",
      dailyFolder: "Journal/",
      dailyFormat: "YYYY/MM/DD",
      dailyTemplatePath: "Work/Templates/Daily"
    })).toEqual({
      templatesFolder: "Work/Templates",
      dailyFolder: "Journal",
      dailyFormat: "YYYY-MM-DD",
      dailyTemplatePath: "Work/Templates/Daily.md"
    });
  });

  it("builds a configured daily path and expands template variables", () => {
    const date = new Date(2026, 6, 24, 9, 5);
    const settings = normalizeNoteWorkflowSettings({ dailyFolder: "日记", dailyFormat: "YYYY年MM月DD日" });

    expect(formatDailyPath(settings, date)).toBe("日记/2026年07月24日.md");
    expect(expandTemplate("# {{title}}\n{{date}} {{time}}", "日记/今天.md", date)).toBe("# 今天\n2026-07-24 09:05");
  });

  it("lists templates inside the configured folder and strips template metadata", () => {
    const notes = [
      parseNote({ path: "模板/会议.md", content: "---\ntype: template\n---\n# {{title}}" }),
      parseNote({ path: "笔记/会议.md", content: "# Meeting" })
    ];

    expect(notesInTemplateFolder(notes, "模板").map((note) => note.path)).toEqual(["模板/会议.md"]);
    expect(stripTemplateFrontmatter(notes[0].content)).toBe("# {{title}}");
  });
});
