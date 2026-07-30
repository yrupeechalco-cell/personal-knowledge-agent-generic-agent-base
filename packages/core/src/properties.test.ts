import { describe, expect, it } from "vitest";
import { parseNote } from "./parser";
import { parseEditablePropertyValue, removeNoteProperty, setNoteProperty } from "./properties";

describe("note properties", () => {
  it("adds and updates typed properties without changing existing tags or body", () => {
    const source = "---\ntags: [知识库, 本地]\nstatus: draft\n---\n# 标题\n\n正文";
    const updated = setNoteProperty(setNoteProperty(source, "status", "published"), "priority", 2);
    const parsed = parseNote({ path: "Page.md", content: updated });

    expect(parsed.frontmatter.tags).toEqual(["知识库", "本地"]);
    expect(parsed.frontmatter.status).toBe("published");
    expect(parsed.frontmatter.priority).toBe(2);
    expect(updated).toContain("# 标题\n\n正文");
  });

  it("creates and removes frontmatter while preserving note content", () => {
    const added = setNoteProperty("# Note\n\nBody", "aliases", ["A", "B"]);
    expect(parseNote({ path: "Page.md", content: added }).frontmatter.aliases).toEqual(["A", "B"]);
    expect(removeNoteProperty(added, "aliases")).toBe("# Note\n\nBody");
  });

  it("parses values according to the existing property type", () => {
    expect(parseEditablePropertyValue("false", true)).toBe(false);
    expect(parseEditablePropertyValue("3.5", 1)).toBe(3.5);
    expect(parseEditablePropertyValue("a, b", ["old"])).toEqual(["a", "b"]);
    expect(parseEditablePropertyValue("plain text")).toBe("plain text");
  });
});
