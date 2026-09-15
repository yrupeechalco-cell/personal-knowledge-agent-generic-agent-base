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
  it("renders everyday Markdown while preserving heading source positions", () => {
    const content = '---\ntags: [demo]\n---\n# Reading\n\n**bold** and *emphasis* [source](https://example.com)\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n- [x] Done\n\n```md\n# literal\n[[No link]]\n```\n\n> quotation\n\n![example](https://example.com/image.png)\n\nText[^a]\n\n[^a]: A footnote';
    const { container } = render(<NoteEditor mode="preview" note={parseNote({ path: "Reading.md", content })} onChange={() => undefined} onModeChange={() => undefined} />);
    const preview = container.querySelector(".markdown-preview")!;
    expect(preview.querySelector("h1")?.getAttribute("data-outline-line")).toBe("4");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.querySelector("em")?.textContent).toBe("emphasis");
    expect(preview.querySelector("table td")?.textContent).toBe("A");
    expect((preview.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(preview.querySelector("pre code")?.textContent).toContain("# literal\n[[No link]]");
    expect(preview.querySelectorAll("h1")).toHaveLength(1);
    expect(preview.querySelector("blockquote")?.textContent).toContain("quotation");
    expect(screen.getByRole("link", { name: "source" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("img", { name: "example" }).getAttribute("src")).toBe("https://example.com/image.png");
    expect(preview.querySelector("[data-footnotes]")?.textContent).toContain("A footnote");
  });

  it("does not activate unsafe links or raw HTML from notes", () => {
    const { container } = render(<NoteEditor mode="preview" note={parseNote({ path: "Safety.md", content: '[bad](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![local](assets/local.png)' })} onChange={() => undefined} onModeChange={() => undefined} />);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("本地附件预览尚未接入");
  });

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
