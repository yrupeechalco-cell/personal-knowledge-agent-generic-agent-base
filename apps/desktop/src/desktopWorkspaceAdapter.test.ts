import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopWorkspaceAdapter } from "./desktopWorkspaceAdapter";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

const windowControlMocks = vi.hoisted(() => ({
  close: vi.fn(),
  minimize: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn()
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => windowControlMocks)
}));

const invokeMock = vi.mocked(invoke);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);

describe("desktop workspace startup", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    getCurrentWindowMock.mockClear();
    Object.values(windowControlMocks).forEach((mock) => mock.mockReset());
  });

  it("connects the shared chrome controls to the active Tauri window", async () => {
    const controls = createDesktopWorkspaceAdapter().windowControls;

    await controls?.minimize();
    await controls?.toggleMaximize();
    await controls?.startDragging();
    await controls?.close();

    expect(windowControlMocks.minimize).toHaveBeenCalledOnce();
    expect(windowControlMocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowControlMocks.startDragging).toHaveBeenCalledOnce();
    expect(windowControlMocks.close).toHaveBeenCalledOnce();
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

  it("loads the real local Codex connection status", async () => {
    invokeMock.mockResolvedValueOnce({
      available: true,
      authenticated: true,
      planType: "plus",
      models: []
    });

    const status = await createDesktopWorkspaceAdapter().loadCodexStatus?.();

    expect(invokeMock).toHaveBeenCalledWith("codex_status");
    expect(status?.authenticated).toBe(true);
  });

  it("routes Codex models to the Codex App Server commands", async () => {
    invokeMock
      .mockResolvedValueOnce("Codex reply")
      .mockResolvedValueOnce({ content: "Codex turn", toolCalls: [] });
    const adapter = createDesktopWorkspaceAdapter();
    const request = {
      system: "Answer directly",
      messages: [{
        id: "message-1",
        role: "user" as const,
        content: "Hello",
        createdAt: "2026-07-31T00:00:00.000Z"
      }],
      model: "codex:gpt-5.4"
    };

    await adapter.runModel?.(request);
    await adapter.runModelTurn?.(request);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "codex_chat_completion", { request });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "codex_tool_completion", { request });
  });
});
