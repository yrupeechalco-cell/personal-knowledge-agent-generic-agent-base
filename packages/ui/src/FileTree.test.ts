import type { ParsedNote } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { ancestorFolderPaths, buildFileTree } from "./FileTree";

describe("FileTree", () => {
  it("builds a nested storage hierarchy from note paths", () => {
    const tree = buildFileTree([
      note("01 思维模型/系统/反馈.md"),
      note("01 思维模型/系统/复利.md"),
      note("02 AIGC/提示词.md"),
      note("根文档.md")
    ]);

    expect(tree.noteCount).toBe(4);
    expect(tree.notes.map((item) => item.path)).toEqual(["根文档.md"]);
    expect(tree.folders.map((folder) => folder.name)).toEqual(["01 思维模型", "02 AIGC"]);
    expect(tree.folders[0].noteCount).toBe(2);
    expect(tree.folders[0].folders[0].name).toBe("系统");
    expect(tree.folders[0].folders[0].notes.map((item) => item.title)).toEqual(["反馈", "复利"]);
  });

  it("collects ancestor folder paths for auto-expanding the current note", () => {
    expect(ancestorFolderPaths("01 思维模型/系统/反馈.md")).toEqual(["01 思维模型", "01 思维模型/系统"]);
  });
});

function note(path: string): ParsedNote {
  return {
    path,
    content: "",
    title: path.split("/").pop()?.replace(/\.md$/i, "") ?? path,
    frontmatter: {},
    tags: [],
    links: [],
    headings: [],
    excerpt: ""
  };
}
