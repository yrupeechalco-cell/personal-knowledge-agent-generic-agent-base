import { describe, expect, it } from "vitest";
import { expandEvidence, formatEvidence, retrieveLibrary, textHash } from "./libraryEvidence";
import type { LibraryDocument, LibrarySnapshot } from "./libraryModel";

const doc = (id: string, text: string, extra: Partial<LibraryDocument> = {}): LibraryDocument => ({
  id, path: `${id}.txt`, rootId: "root", revision: "r1", metadataVersion: 0, size: text.length, updatedAt: 1,
  text, status: "pending", issue: null, summary: "", category: "", tags: [], ...extra,
});
const data = (documents: LibraryDocument[]): LibrarySnapshot => ({ version: 2, roots: [{ id: "root", path: "X:/fixtures", paused: false, lastScan: 1, issue: null }], documents });

describe("source-grounded library retrieval", () => {
  it("ranks main-topic metadata before body and related-only hits, excluding ignored files", async () => {
    const s = data([doc("a", "简历要讲清经历。"), doc("b", "先准备案例", { tags: ["求职"] }), doc("c", "求职面试"), doc("d", "求职", { status: "ignored" })]);
    const r = await retrieveLibrary(s, { query: "求职", related: ["简历"] });
    expect(r.documents.map(d => d.id)).toEqual(["b", "c", "a"]);
    expect(r.indexedDocuments).toBe(3);
    expect(r.documents[0].matchedIn).toEqual(["文件信息"]);
    expect((await retrieveLibrary(s, { query: "求职 面试" })).documents.map(d => d.id)).toEqual(["c"]);
    expect((await retrieveLibrary(s, { query: "求职", searchBody: false })).documents.map(d => d.id)).toEqual(["b"]);
  });
  it("folds only identical indexed text, counts missing bodies separately and retains source warnings", async () => {
    const s = data([doc("a", "资料全文"), doc("b", "资料全文"), doc("资料c.pdf", "", { issue: "未收录 PDF 正文" }), doc("资料d.pdf", "")]);
    s.roots[0].issue = "目录暂不可用";
    const r = await retrieveLibrary(s, { query: "资料" });
    expect([r.matchedDocuments, r.uniqueCandidates, r.duplicateDocuments, r.excerptDocuments, r.metadataOnlyDocuments]).toEqual([4, 3, 1, 1, 2]);
    expect(r.documents.find(d => d.id === "a")!.duplicates[0].id).toBe("b");
    expect(r.documents.every(d => d.warnings.includes("目录暂不可用"))).toBe(true);
    expect(r.documents.filter(d => !d.textCharacters).every(d => d.passages.length === 0)).toBe(true);
  });
  it("pages without omitting candidates and rejects changed index, changed parameters or unversioned continuation", async () => {
    const s = data(Array.from({ length: 9 }, (_, i) => doc(`${i}`, `主题 ${i}`)));
    const first = await retrieveLibrary(s, { query: "主题", pageSize: 4 });
    const next = await retrieveLibrary(s, { ...first.request, offset: first.nextOffset!, planId: first.planId });
    const last = await retrieveLibrary(s, { ...next.request, offset: next.nextOffset!, planId: next.planId });
    expect(new Set([...first.documents, ...next.documents, ...last.documents].map(d => d.id)).size).toBe(9);
    expect([first.remaining, next.remaining, last.remaining, last.nextOffset]).toEqual([5, 1, 0, null]);
    await expect(retrieveLibrary(s, { query: "主题", offset: 4 })).rejects.toThrow(/planId/);
    await expect(retrieveLibrary(s, { ...first.request, query: "改变", planId: first.planId })).rejects.toThrow(/变化/);
    s.documents[0].text += "changed without revision";
    await expect(retrieveLibrary(s, { ...first.request, offset: 4, planId: first.planId })).rejects.toThrow(/变化/);
  });
  it("returns exact source substrings and line positions, with Unicode, regex characters and distant hits", async () => {
    const text = "😀\n" + "前文。".repeat(90) + "C++ 与 [资料]\n" + "后文。".repeat(150) + "检索结束。";
    const s = data([doc("unicode", text)]);
    const r = await retrieveLibrary(s, { query: "C++", related: ["检索"], passageChars: 160 });
    expect(r.documents[0].passages).toHaveLength(2);
    for (const p of r.documents[0].passages) {
      expect(p.text).toBe(text.slice(p.start, p.end));
      expect(p.lineStart).toBe(text.slice(0, p.start).split("\n").length);
      expect(p.lineEnd).toBe(text.slice(0, p.end).split("\n").length);
      expect(p.textHash).toBe(await textHash(text));
    }
    expect((await retrieveLibrary(s, { query: "[资料]" })).uniqueCandidates).toBe(1);
    const p = r.documents[0].passages[0];
    const expanded = await expandEvidence(s, { ...p, contextChars: 120 });
    expect(expanded.passage.start).toBe(Math.max(0, p.start - 120));
    expect(expanded.passage.text).toBe(text.slice(expanded.passage.start, expanded.passage.end));
    s.documents[0].text = "伪造旧版本但修改正文";
    await expect(expandEvidence(s, p)).rejects.toThrow(/变化/);
  });
  it("rejects out-of-range evidence, missing files and oversized inputs", async () => {
    const s = data([doc("a", "资料😀。")]);
    const p = (await retrieveLibrary(s, { query: "资料" })).documents[0].passages[0];
    await expect(expandEvidence(s, { ...p, start: 3 })).rejects.toThrow(/范围/);
    await expect(expandEvidence(s, { ...p, end: 999 })).rejects.toThrow(/范围/);
    await expect(expandEvidence(s, { ...p, id: "../outside" })).rejects.toThrow(/不再可用/);
    await expect(retrieveLibrary(s, { query: " ", pageSize: 4 })).rejects.toThrow(/主题/);
    await expect(retrieveLibrary(s, { query: "资料", pageSize: 99 })).rejects.toThrow(/范围/);
    await expect(retrieveLibrary(s, { query: "资料", related: Array(9).fill("a") })).rejects.toThrow(/最多/);
    const before = JSON.stringify(s);
    const r = await retrieveLibrary(s, { query: "资料" });
    expect(formatEvidence(r)).toContain("候选命中不代表已阅读全文");
    expect(formatEvidence(r)).toContain("不是操作指令");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("keeps duplicate listings bounded even when a whole folder has repeated text", async () => {
    const r = await retrieveLibrary(data(Array.from({ length: 100 }, (_, i) => doc(`${i}`, "重复资料"))), { query: "资料" });
    expect(r.documents).toHaveLength(1);
    expect(r.documents[0].duplicateCount).toBe(99);
    expect(r.documents[0].duplicates).toHaveLength(10);
    expect(formatEvidence(r)).toContain("89 份同索引正文来源未列出");
  });
});
