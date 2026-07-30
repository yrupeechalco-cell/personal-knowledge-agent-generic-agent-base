import { describe, expect, it } from "vitest";
import { buildVaultIndex, getNote } from "@knowledge-agent/core";
import {
  bookmarkStorageKey,
  buildInspectorLinks,
  buildNoteOutline,
  normalizeBookmarkPaths
} from "./noteInspectorModel";

describe("note inspector model", () => {
  it("builds a level-aware outline while ignoring frontmatter and fenced code", () => {
    const outline = buildNoteOutline("---\ntitle: Example\n---\n# 总览\n## [[方法|核心方法]]\n```\n# 不是标题\n```\n### 结论");

    expect(outline).toEqual([
      { id: "4:总览", text: "总览", level: 1, line: 4 },
      { id: "5:核心方法", text: "核心方法", level: 2, line: 5 },
      { id: "9:结论", text: "结论", level: 3, line: 9 }
    ]);
  });

  it("builds resolved backlinks and resolved or unresolved outlinks", () => {
    const index = buildVaultIndex([
      { path: "A.md", content: "# A\n\n[[B]] and [[Missing|待补]]" },
      { path: "B.md", content: "# B\n\n[[A#总览]]" }
    ]);

    expect(buildInspectorLinks(index, getNote(index, "A.md"))).toEqual({
      backlinks: [
        expect.objectContaining({ label: "B", path: "B.md", resolved: true, detail: "#总览" })
      ],
      outlinks: [
        expect.objectContaining({ label: "B", path: "B.md", resolved: true }),
        expect.objectContaining({ label: "待补", resolved: false })
      ]
    });
  });

  it("normalizes bookmark storage by source and available note paths", () => {
    expect(bookmarkStorageKey("desktop", "F:/Vault")).toContain("desktop:F:/Vault");
    expect(normalizeBookmarkPaths(["A.md", "a.md", "Missing.md", 4], ["A.md", "B.md"])).toEqual(["A.md"]);
  });
});
