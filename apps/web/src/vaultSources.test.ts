import { buildVaultGraph, buildVaultIndex, type NoteFile } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { filterSafeMarkdownFiles, isDirectoryPickerSupported, loadDemoVault } from "./vaultSources";

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

  it("keeps demo usable while reporting excluded demo paths", () => {
    const vault = loadDemoVault();

    expect(vault.files.some((file) => file.path.includes("密码"))).toBe(false);
    expect(vault.safetyManifest.excluded.some((item) => item.path.includes("密码"))).toBe(true);
  });

  it("ships a dense demo graph with cross-linked topic clusters", () => {
    const vault = loadDemoVault();
    const index = buildVaultIndex(vault.files);
    const graph = buildVaultGraph(index);

    expect(index.notes.length).toBeGreaterThanOrEqual(20);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(20);
    expect(graph.edges.length).toBeGreaterThanOrEqual(45);
    expect(index.backlinks.get("03 项目/知识库 Agent 项目.md")?.length).toBeGreaterThanOrEqual(3);
    expect(index.unresolvedLinks.some((edge) => edge.target.includes("反馈回路"))).toBe(true);
  });

  it("detects browser directory picker support from the supplied window object", () => {
    expect(isDirectoryPickerSupported({ showDirectoryPicker: async () => ({}) } as unknown as Window)).toBe(true);
    expect(isDirectoryPickerSupported({} as unknown as Window)).toBe(false);
  });
});
