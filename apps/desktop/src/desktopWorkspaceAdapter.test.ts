import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopWorkspaceAdapter } from "./desktopWorkspaceAdapter";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

const invokeMock = vi.mocked(invoke);

describe("desktop workspace startup", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("opens an empty workspace when a new installation has no saved vault", async () => {
    invokeMock.mockResolvedValueOnce({});

    const vault = await createDesktopWorkspaceAdapter().loadInitialVault();

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toEqual([]);
    expect(vault.safetyManifest.allowed).toEqual([]);
    expect(vault.unsupportedReason).toContain("请选择一个本地知识库文件夹");
  });

  it("does not inject fallback notes when desktop settings cannot be read", async () => {
    invokeMock.mockRejectedValueOnce(new Error("settings unavailable"));

    const vault = await createDesktopWorkspaceAdapter().loadInitialVault();

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toEqual([]);
    expect(vault.unsupportedReason).toContain("settings unavailable");
  });

  it("routes note moves through the atomic desktop command before reloading", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_app_settings") return { vaultPath: "F:\\Knowledge" };
      if (command === "load_vault_notes") {
        return [{ path: "new/topic.md", content: "# Topic" }];
      }
      if (command === "list_trash_entries") return [];
      if (command === "move_notes_atomic") return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
    const adapter = createDesktopWorkspaceAdapter();
    await adapter.loadInitialVault();

    const result = await adapter.moveNotes?.([
      { from: "old/topic.md", to: "new/topic.md" }
    ]);

    expect(invokeMock).toHaveBeenCalledWith("move_notes_atomic", {
      root: "F:\\Knowledge",
      moves: [{ from: "old/topic.md", to: "new/topic.md" }]
    });
    expect(result?.files?.map((file) => file.path)).toEqual(["new/topic.md"]);
    expect(result?.message).toContain("原子事务");
  });
});
