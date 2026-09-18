import { describe, expect, it } from "vitest";
import { librarySummaryRequest, parseLibrarySuggestion, searchLibrary, type LibraryDocument } from "./libraryModel";
const doc: LibraryDocument = { id: "a", rootId: "root", path: "资料/note.txt", revision: "1", size: 20, updatedAt: 1, text: "A long document contains 隐藏关键词", issue: null, status: "pending", summary: "", category: "", tags: [] };
describe("document library", () => {
  it("searches body, saved suggestions and all query terms with status filters", () => {
    expect(searchLibrary([doc], "隐藏关键词 document", "pending")).toHaveLength(1);
    expect(searchLibrary([doc], "隐藏关键词", "reviewed")).toHaveLength(0);
    expect(searchLibrary([{ ...doc, summary: "会议记录", tags: ["项目甲"] }], "会议 项目甲", "all")).toHaveLength(1);
    expect(searchLibrary([{ ...doc, issue: "Unsupported" }], "note", "issues")).toHaveLength(1);
  });
  it("sends only a bounded excerpt and file name without parent directory or tools", () => {
    const request = librarySummaryRequest({ ...doc, text: "a".repeat(13000) }, "model");
    const payload = JSON.parse(request.messages[0].content);
    expect(payload.fileName).toBe("note.txt"); expect(payload.excerpt).toHaveLength(12000); expect(payload.isExcerpt).toBe(true);
    expect(request.tools).toBeUndefined(); expect(request.cwd).toBeUndefined();
  });
  it("rejects malformed model output and limits suggested fields", () => {
    expect(() => parseLibrarySuggestion("done")).toThrow();
    expect(() => parseLibrarySuggestion('{"summary":"ok","category":"","tags":[{}]}')).toThrow();
    expect(parseLibrarySuggestion('```json\n{"summary":"要点","category":"学习","tags":["英语","英语"]}\n```')).toEqual({ summary: "要点", category: "学习", tags: ["英语"] });
  });
});
