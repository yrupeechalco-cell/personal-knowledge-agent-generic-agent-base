import { describe, expect, it } from "vitest";
import {
  applySlashCommand,
  collectFootnotes,
  findSlashCommand,
  measureNoteContent,
  renderInlineMarkdownText
} from "./NoteEditor";

describe("renderInlineMarkdownText", () => {
  it("renders Obsidian wikilinks without leaking raw syntax", () => {
    expect(renderInlineMarkdownText("[[AIGC/AIGC]]")).toBe("AIGC/AIGC");
    expect(renderInlineMarkdownText("[[AIGC/AIGC|AIGC]]")).toBe("AIGC");
    expect(renderInlineMarkdownText("[[AIGC/AIGC#heading|Alias]]")).toBe("Alias");
    expect(renderInlineMarkdownText("![[asset.png]]")).toBe("asset.png");
  });
});

describe("measureNoteContent", () => {
  it("counts visible CJK characters and Latin words without frontmatter or Markdown syntax", () => {
    const metrics = measureNoteContent("---\ntags: [hidden]\n---\n# 标题\n\nHello world [[Page|页面]]");
    expect(metrics).toEqual({
      words: 6,
      characters: 14,
      readingMinutes: 1
    });
  });

  it("returns zero reading time for an empty note", () => {
    expect(measureNoteContent("---\ntags: []\n---\n")).toEqual({
      words: 0,
      characters: 0,
      readingMinutes: 0
    });
  });
});

describe("slash commands", () => {
  it("detects a slash query only on the active line", () => {
    expect(findSlashCommand("# Note\n  /h2", 12)).toEqual({
      start: 7,
      end: 12,
      indent: "  ",
      query: "h2"
    });
    expect(findSlashCommand("# Note\ntext /h2", 15)).toBeUndefined();
  });

  it("replaces the slash query and places the caret after the inserted syntax", () => {
    const match = findSlashCommand("before\n/h2", 10);
    expect(match).toBeDefined();
    expect(applySlashCommand("before\n/h2", match!, "heading-2")).toEqual({
      content: "before\n## ",
      selectionStart: 10,
      selectionEnd: 10
    });
  });

  it("uses the supplied clock for date insertion", () => {
    const match = findSlashCommand("/", 1);
    const applied = applySlashCommand("/", match!, "date", new Date(2026, 6, 24, 8, 5));
    expect(applied.content).toBe("2026-07-24");
  });
});

describe("collectFootnotes", () => {
  it("collects single-line and indented continuation definitions", () => {
    expect([...collectFootnotes("Text[^a]\n\n[^a]: First line\n  continued\n[^b]: Second").entries()]).toEqual([
      ["a", "First line continued"],
      ["b", "Second"]
    ]);
  });
});
