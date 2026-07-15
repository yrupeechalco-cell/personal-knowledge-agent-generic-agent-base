import { type NoteFile } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { filterSafeMarkdownFiles, isDirectoryPickerSupported, loadBrowserDirectoryVault, loadEmptyVault } from "./vaultSources";

describe("web vault sources", () => {
  it("filters non-markdown and sensitive paths before indexing", () => {
    const files: NoteFile[] = [
      { path: "Inbox/Idea.md", content: "" },
      { path: "密码/账号密码.md", content: "" },
      { path: ".obsidian/workspace.json", content: "" },
      { path: "Assets/photo.png", content: "" },
      { path: "Secrets/token.md", content: "" }
    ];

    expect(filterSafeMarkdownFiles(files).map((file) => file.path)).toEqual(["Inbox/Idea.md"]);
  });

  it("starts without any built-in notes", () => {
    const vault = loadEmptyVault();

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toHaveLength(0);
    expect(vault.safetyManifest.allowed).toHaveLength(0);
    expect(vault.safetyManifest.excluded).toHaveLength(0);
  });

  it("keeps an unsupported browser empty instead of injecting fallback documents", async () => {
    const vault = await loadBrowserDirectoryVault({} as Window);

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toEqual([]);
    expect(vault.unsupportedReason).toContain("不支持文件夹选择器");
  });

  it("detects browser directory picker support from the supplied window object", () => {
    expect(isDirectoryPickerSupported({ showDirectoryPicker: async () => ({}) } as unknown as Window)).toBe(true);
    expect(isDirectoryPickerSupported({} as unknown as Window)).toBe(false);
  });
});
