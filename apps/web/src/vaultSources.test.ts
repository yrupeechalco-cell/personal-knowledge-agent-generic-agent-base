import { buildVaultGraph, buildVaultIndex, type NoteFile } from "@knowledge-agent/core";
import { buildKnowledgeRoleModel } from "@knowledge-agent/workspace";
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

  it("ships only safe public files in the built-in demo", () => {
    const vault = loadDemoVault();

    expect(vault.files).toHaveLength(36);
    expect(vault.safetyManifest.allowed).toHaveLength(36);
    expect(vault.safetyManifest.excluded).toHaveLength(0);
  });

  it("ships a dense demo graph with cross-linked topic clusters", () => {
    const vault = loadDemoVault();
    const index = buildVaultIndex(vault.files);
    const graph = buildVaultGraph(index);
    const roleModel = buildKnowledgeRoleModel(index);

    expect(index.notes).toHaveLength(36);
    expect(graph.nodes).toHaveLength(36);
    expect(graph.edges.length).toBeGreaterThanOrEqual(110);
    expect(new Set(index.notes.map((note) => note.path.split("/")[0]))).toHaveLength(12);
    expect(roleModel.domains).toHaveLength(12);
    expect(roleModel.domainRelations).toHaveLength(36);
    expect(index.backlinks.get("08-生态网络/生态网络-关键节点.md")?.length).toBeGreaterThanOrEqual(3);
    expect(index.unresolvedLinks.some((edge) => edge.target.includes("共识边界"))).toBe(true);
  });

  it("detects browser directory picker support from the supplied window object", () => {
    expect(isDirectoryPickerSupported({ showDirectoryPicker: async () => ({}) } as unknown as Window)).toBe(true);
    expect(isDirectoryPickerSupported({} as unknown as Window)).toBe(false);
  });
});
