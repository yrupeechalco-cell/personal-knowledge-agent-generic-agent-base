/**
 * @vitest-environment jsdom
 */
import { parseNote } from "@knowledge-agent/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "./NoteEditor";

afterEach(cleanup);

describe("NoteEditor interactions", () => {
  it("opens resolved wikilinks and exposes a page preview", () => {
    const onSelectGraphNode = vi.fn();
    const page = parseNote({ path: "Topic.md", content: "# Topic\n\nA useful linked note." });
    const note = parseNote({ path: "Home.md", content: "# Home\n\nRead [[Topic|this topic]]." });

    render(
      <NoteEditor
        mode="preview"
        note={note}
        onChange={() => undefined}
        onModeChange={() => undefined}
        onSelectGraphNode={onSelectGraphNode}
        resolveNote={(target) => target === "Topic" ? page : undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "this topic" }));
    expect(onSelectGraphNode).toHaveBeenCalledWith("Topic.md");
    expect(screen.getByRole("tooltip").textContent).toContain("A useful linked note.");
  });

  it("applies a slash command from the keyboard", () => {
    function Harness() {
      const [content, setContent] = useState("/");
      return (
        <NoteEditor
          mode="edit"
          note={parseNote({ path: "Draft.md", content })}
          onChange={setContent}
          onModeChange={() => undefined}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByLabelText("Markdown 编辑器");
    fireEvent.select(editor, { target: { selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getByRole("listbox", { name: "斜杠命令" })).toBeTruthy();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect((editor as HTMLTextAreaElement).value).toBe("# ");
  });
});
