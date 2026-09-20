import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@knowledge-agent/agent";
import { createLibraryAgentTools } from "./libraryAgentTools";
import type { LibraryAdapter, LibrarySnapshot } from "./libraryModel";

describe("library agent tools", () => {
  const doc = { id: "one", rootId: "root", path: "note.txt", revision: "source-1", metadataVersion: 2, size: 20, updatedAt: 1, text: "人物动机决定行动。", issue: null, status: "pending" as const, summary: "", category: "", tags: [], classificationLocked: false };
  const data: LibrarySnapshot = { version: 2, roots: [], documents: [doc] };
  const context = {} as AgentContext;
  it("only reads registered documents and checks revision before metadata writes", async () => {
    const adapter = { load: async () => data, saveReview: vi.fn(async () => data) } as unknown as LibraryAdapter;
    const tools = createLibraryAgentTools(adapter);
    const read = tools.find((tool) => tool.name === "app_read_library")!;
    await expect(read.run('{"id":"C:/outside.txt"}', context)).rejects.toThrow(/不存在/);
    const save = tools.find((tool) => tool.name === "app_save_library_knowledge")!;
    const input = { id: "one", revision: "source-1", metadataVersion: 1, summary: "摘要", categories: ["创作"], tags: [], tips: [] };
    await expect(save.run(JSON.stringify(input), context)).rejects.toThrow(/变化/);
    expect(adapter.saveReview).not.toHaveBeenCalled();
    await save.run(JSON.stringify({ ...input, metadataVersion: 2, tips: [{ content: "动机推动行动", quote: "人物动机决定行动" }] }), context);
    expect(adapter.saveReview).toHaveBeenCalledWith(expect.objectContaining({ source: "ai", revision: "source-1", metadataVersion: 2 }));
  });
});
