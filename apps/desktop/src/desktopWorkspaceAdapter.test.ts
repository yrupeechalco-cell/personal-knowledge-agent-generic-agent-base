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
});
