// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createLibraryAgentTools } from "./libraryAgentTools";
import type { AgentContext } from "@knowledge-agent/agent";
import type { LibraryAdapter } from "./libraryModel";
import { LOCAL_AUTOMATION_METHODS, runLocalAutomation, validateAutomationParams, type AutomationContext } from "./localAutomation";

describe("CLI application boundary", () => {
  it("exposes identical read-only evidence and expansion through CLI and the retained Agent", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const snapshot = { version: 2, roots: [], documents: [{ id: "one", rootId: "root", path: "example.txt", revision: "r", metadataVersion: 2, size: 10, updatedAt: 1, text: "求职资料。\n案例来自原文。", status: "pending", issue: null, category: "", tags: [], summary: "" }] };
      const library = { load: async () => structuredClone(snapshot) } as unknown as LibraryAdapter;
      const context = { adapter: { automation: {}, library }, state: () => ({}) } as unknown as AutomationContext;
      const result = await runLocalAutomation(context, "library.retrieve", { query: "求职" }) as any;
      const tools = createLibraryAgentTools(library);
      const agent = JSON.parse(await tools.find(t => t.name === "app_retrieve_library")!.run('{"query":"求职"}', {} as AgentContext));
      expect(agent).toEqual(result);
      expect(LOCAL_AUTOMATION_METHODS.find(m => m.name === "library.retrieve")).toMatchObject({ mutates: false, changesOriginals: false });
      const { id, revision, textHash, start, end } = result.documents[0].passages[0];
      const anchor = { id, revision, textHash, start, end };
      const expanded = await runLocalAutomation(context, "library.expand", anchor);
      expect(JSON.parse(await tools.find(t => t.name === "app_expand_library")!.run(JSON.stringify(anchor), {} as AgentContext))).toEqual(expanded);
      await expect(runLocalAutomation(context, "library.retrieve", { query: "求职", pageSize: 100 })).rejects.toThrow(/范围/);
      await expect(runLocalAutomation(context, "library.expand", { ...anchor, arbitraryPath: "outside" })).rejects.toThrow(/未知参数/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects malformed parameters before dispatch", () => {
    const schema = LOCAL_AUTOMATION_METHODS.find(m => m.name === "notes.write")!.parameters;
    expect(() => validateAutomationParams(schema, { path: "note.md", content: "body" })).toThrow("expectedRevision");
    expect(() => validateAutomationParams(schema, { path: "note.md", content: "body", expectedRevision: null, root: "C:/" })).toThrow("未知参数");
    expect(() => validateAutomationParams(schema, { path: "note.md", content: "body", expectedRevision: null })).not.toThrow();
  });

  it("blocks a write while the editor has unsaved changes", async () => {
    const document = vi.fn();
    const context = { adapter: { automation: { document } }, state: () => ({ sourceKind: "desktop", dirty: true }) } as unknown as AutomationContext;
    await expect(runLocalAutomation(context, "notes.write", { path: "note.md", content: "changed", expectedRevision: "rev" })).rejects.toThrow("未保存");
    expect(document).not.toHaveBeenCalled();
  });

  it("saves source-grounded AI labels while preserving manual category locks", async () => {
    const saveReview = vi.fn().mockResolvedValue({});
    const doc = { id:"one", revision:"r", metadataVersion:2, text:"This is a real source quotation.", status:"reviewed", classificationLocked:true, categories:["Manual/Category"], tags:["manual"], summary:"old" };
    const context = { adapter:{ automation:{}, library:{ load: async () => ({ documents:[doc] }), saveReview } }, state: () => ({}) } as unknown as AutomationContext;
    const parameters = { id:"one", revision:"r", metadataVersion:2, summary:"New summary", categories:["AI/Category"], tags:["ai"], tips:[{ content:"Point", quote:"real source quotation" }] };
    await runLocalAutomation(context, "library.annotate", parameters);
    expect(saveReview.mock.calls[0][0]).toMatchObject({ categories:["Manual/Category"], tags:["manual"], source:"ai", summary:"New summary" });
    saveReview.mockClear();
    await expect(runLocalAutomation(context, "library.annotate", { ...parameters, tips:[{ content:"False", quote:"made up quotation" }] })).rejects.toThrow("原文");
    expect(saveReview).not.toHaveBeenCalled();
  });
});
