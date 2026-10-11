import { describe, expect, it, vi } from "vitest";
import { LOCAL_AUTOMATION_METHODS, runLocalAutomation, validateAutomationParams, type AutomationContext } from "./localAutomation";

describe("CLI application boundary", () => {
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
