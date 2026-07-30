import { describe, expect, it } from "vitest";
import { parseNote } from "./parser";
import {
  articleProfileFromNote,
  createArticleNoteContent,
  ensureArticleProfile,
  setArticleProfile
} from "./articleProfile";

describe("article profile", () => {
  it("reads canonical fields and common aliases without duplicating keywords", () => {
    const note = parseNote({
      path: "Research/Example.md",
      content: [
        "---",
        'description: "一句话简介"',
        "tags: [模型, 证据]",
        'type: "论文"',
        'domain: "人工智能"',
        'url: "https://example.com/paper"',
        'authors: ["A", "B"]',
        'created_at: "2026-07-24"',
        'publication_date: "2025-03-01"',
        "---",
        "# Example"
      ].join("\n")
    });

    expect(articleProfileFromNote(note)).toEqual({
      summary: "一句话简介",
      documentType: "论文",
      category: "人工智能",
      source: "https://example.com/paper",
      author: "A / B",
      created: "2026-07-24",
      published: "2025-03-01",
      keywords: ["模型", "证据"]
    });
  });

  it("creates a classified note with a stable metadata card schema", () => {
    const content = createArticleNoteContent("测试文章", "正文", {
      created: "2026-07-24",
      documentType: "文章"
    });
    const note = parseNote({ path: "测试文章.md", content });
    const profile = articleProfileFromNote(note);

    expect(note.title).toBe("测试文章");
    expect(profile.created).toBe("2026-07-24");
    expect(profile.documentType).toBe("文章");
    expect(content).toContain('summary: ""');
    expect(content).toContain("tags: []");
    expect(content).toContain("\n正文\n");
  });

  it("adds only missing profile fields to existing frontmatter", () => {
    const content = ensureArticleProfile("---\nsource: \"Book\"\ncreated: \"2020-01-01\"\n---\n# Note", {
      created: "2026-07-24",
      documentType: "摘录"
    });

    expect(content.match(/^source:/gm)).toHaveLength(1);
    expect(content).toContain('created: "2020-01-01"');
    expect(content).toContain('document_type: "摘录"');
    expect(content).toContain('published: ""');
  });

  it("updates the complete profile as one frontmatter transaction", () => {
    const original = createArticleNoteContent("Article", "", { created: "2026-07-24" });
    const updated = setArticleProfile(original, {
      summary: "新的简介",
      documentType: "论文",
      category: "计算机 / 人工智能",
      source: "https://example.com",
      author: "Researcher",
      created: "2026-07-24",
      published: "2026-06-01"
    });
    const profile = articleProfileFromNote(parseNote({ path: "Article.md", content: updated }));

    expect(profile.summary).toBe("新的简介");
    expect(profile.documentType).toBe("论文");
    expect(profile.published).toBe("2026-06-01");
  });
});
