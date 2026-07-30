/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseNote } from "@knowledge-agent/core";
import { LanguageProvider } from "@knowledge-agent/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteInspector, type NoteInspectorProps } from "./NoteInspector";

afterEach(() => cleanup());

const note = parseNote({
  path: "Project/Page.md",
  content: "---\nstatus: draft\npublished: false\n---\n# Page\n\n## Method"
});

describe("NoteInspector", () => {
  it("edits typed properties and adds new properties", () => {
    const onUpdateProperty = vi.fn();
    const onAddProperty = vi.fn();
    renderInspector({ onAddProperty, onUpdateProperty, tab: "properties" });

    const statusInput = screen.getByDisplayValue("draft");
    fireEvent.change(statusInput, { target: { value: "published" } });
    fireEvent.blur(statusInput);
    fireEvent.click(screen.getByLabelText("published", { selector: "input" }));
    fireEvent.change(screen.getByLabelText("新属性名称"), { target: { value: "priority" } });
    fireEvent.change(screen.getByLabelText("新属性值"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("添加属性"));

    expect(onUpdateProperty).toHaveBeenCalledWith("status", "published");
    expect(onUpdateProperty).toHaveBeenCalledWith("published", true);
    expect(onAddProperty).toHaveBeenCalledWith("priority", 2);
  });

  it("navigates headings, links, bookmarks and toggles the current bookmark", () => {
    const onNavigateHeading = vi.fn();
    const onOpenLink = vi.fn();
    const onTabChange = vi.fn();
    const onToggleBookmark = vi.fn();
    const { rerender } = renderInspector({
      onNavigateHeading,
      onOpenLink,
      onTabChange,
      onToggleBookmark,
      tab: "outline"
    });

    fireEvent.click(screen.getByText("Method"));
    fireEvent.click(screen.getByLabelText("收藏当前笔记"));
    fireEvent.click(screen.getByLabelText("链接"));

    expect(onNavigateHeading).toHaveBeenCalledTimes(1);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("links");

    rerender(inspectorElement({ onNavigateHeading, onOpenLink, onTabChange, onToggleBookmark, tab: "links" }));
    fireEvent.click(screen.getByText("Related"));
    expect(onOpenLink).toHaveBeenCalledWith("Related.md");
  });
});

function renderInspector(overrides: Partial<NoteInspectorProps> = {}) {
  return render(inspectorElement(overrides));
}

function inspectorElement(overrides: Partial<NoteInspectorProps> = {}) {
  return (
    <LanguageProvider initialLocale="zh-CN">
      <NoteInspector
        backlinks={[]}
        bookmarkedNotes={[]}
        currentBookmarked={false}
        note={note}
        onAddProperty={vi.fn()}
        onNavigateHeading={vi.fn()}
        onOpenLink={vi.fn()}
        onRemoveProperty={vi.fn()}
        onTabChange={vi.fn()}
        onToggleBookmark={vi.fn()}
        onUpdateProperty={vi.fn()}
        outline={[{ id: "5:Method", text: "Method", level: 2, line: 5 }]}
        outlinks={[{ id: "out:1", label: "Related", path: "Related.md", resolved: true }]}
        readOnly={false}
        tab="properties"
        {...overrides}
      />
    </LanguageProvider>
  );
}
