import { describe, expect, it } from "vitest";
import { aiReview, analyzeLibraryDocument, categoryTree, documentChunks, hasCategory, librarySummaryRequest, parseLibrarySuggestion, searchLibrary, type LibraryDocument } from "./libraryModel";
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
    expect(parseLibrarySuggestion('```json\n{"summary":"要点","category":"学习","tags":["英语","英语"]}\n```')).toEqual({ summary: "要点", category: "学习", categories: ["学习"], tags: ["英语"], tips: [] });
  });
  it("places one original in multiple virtual categories and counts ancestors only once", () => {
    const classified = { ...doc, categories: ["创作/人物", "创作/结构", "学习/英语"] };
    expect(categoryTree([classified]).find((node) => node.path === "创作")?.count).toBe(1);
    expect(hasCategory(classified, "学习")).toBe(true);
    expect(hasCategory(classified, "创作/人物")).toBe(true);
    expect(classified.path).toBe(doc.path);
  });
  it("rejects invented source quotes and indexes actual knowledge tips", () => {
    const value = { summary: "摘要", categories: ["学习"], tags: [], tips: [{ content: "提炼知识要点", quote: "隐藏关键词" }] };
    const suggestion = parseLibrarySuggestion(JSON.stringify(value), doc.text);
    expect(searchLibrary([{ ...doc, ...suggestion }], "提炼知识", "all")).toHaveLength(1);
    expect(() => parseLibrarySuggestion(JSON.stringify(value), "另一份完全不同的正文")).toThrow(/引用/);
  });
  it("reads long document endings and stops before saving when cancelled", async () => {
    const long = { ...doc, text: "开头".repeat(6200) + "结尾的重要知识" };
    const seen: string[] = [];
    const result = await analyzeLibraryDocument(long, "test", async (request) => {
      const text = JSON.parse(request.messages[0].content).excerpt; seen.push(text);
      return JSON.stringify({ summary: text.includes("结尾的重要知识") ? "结尾内容" : "开头内容", categories: ["学习"], tags: [], tips: [] });
    }, []);
    expect(seen).toHaveLength(2); expect(seen[1]).toContain("结尾的重要知识"); expect(result.summary).toContain("结尾内容");
    expect(documentChunks("a".repeat(11999) + "😀" + "b".repeat(1000)).every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    await expect(analyzeLibraryDocument(doc, "test", async () => "{}", [], { cancelled: () => true })).rejects.toThrow(/暂停/);
  });
  it("preserves confirmed categories and tags in subsequent AI runs", () => {
    const locked = { ...doc, categories: ["我的分类/创作"], category: "我的分类/创作", tags: ["我确认的标签"], classificationLocked: true, metadataVersion: 3 };
    const review = aiReview(locked, { summary: "新摘要", categories: ["AI分类"], category: "AI分类", tags: ["AI标签"], tips: [] });
    expect(review.categories).toEqual(locked.categories); expect(review.tags).toEqual(locked.tags); expect(review.metadataVersion).toBe(3); expect(review.analysisRevision).toBe(doc.revision);
  });
});
