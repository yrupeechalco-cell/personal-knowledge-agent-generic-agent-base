import { describe, expect, it } from "vitest";
import { parseNote } from "./parser";
import { buildNoteTagCloud, setNoteTags, suggestLocalTags } from "./tags";

describe("tag cloud", () => {
  it("uses granularity to reveal more meaningful concepts", () => {
    const note = parseNote({
      path: "数学/导数.md",
      content: "# 闭区间函数最值\n\n导数用于判断函数单调性。求闭区间最值时需要比较驻点和区间端点。导数和函数最值经常一起出现。"
    });
    const overview = buildNoteTagCloud(note, 1);
    const detailed = buildNoteTagCloud(note, 5);

    expect(detailed.length).toBeGreaterThanOrEqual(overview.length);
    expect(suggestLocalTags(note, 5)).toContain("导数");
  });

  it("writes exact editable tags into frontmatter without losing other properties", () => {
    const content = "---\ndomain: 数学\ntags: [旧标签, 导数]\n---\n# 题目\n\n正文 #旧标签";
    const updated = setNoteTags(content, ["导数", "函数最值"]);
    const parsed = parseNote({ path: "题目.md", content: updated });

    expect(parsed.frontmatter.domain).toBe("数学");
    expect(parsed.tags).toEqual(["函数最值", "导数"]);
    expect(updated).not.toContain("#旧标签");
  });

  it("creates frontmatter for a previously untagged note", () => {
    const updated = setNoteTags("# Page\n\nBody", ["知识存储", "分类"]);
    expect(parseNote({ path: "Page.md", content: updated }).tags).toEqual(["分类", "知识存储"]);
  });
});
