import { describe, expect, it } from "vitest";
import { buildNoteGraph, buildSafetyManifest, buildVaultGraph, buildVaultIndex, parseNote, safetyDecisionForPath } from ".";

describe("parseNote", () => {
  it("parses Obsidian links, embeds, markdown links, tags, headings, and frontmatter", () => {
    const note = parseNote({
      path: "AIGC/Index.md",
      content: `---
tags: [aigc, music]
published: true
---
# Index
See [[AIGC/代码生成电音#Hook|电音]] and ![[assets/cover.png]].
Also [read](../Other.md#Part).
#tag-one`
    });

    expect(note.title).toBe("Index");
    expect(note.frontmatter.tags).toEqual(["aigc", "music"]);
    expect(note.tags).toEqual(["aigc", "music", "tag-one"]);
    expect(note.frontmatter.published).toBe(true);
    expect(note.tags).toContain("tag-one");
    expect(note.headings).toContain("Index");
    expect(note.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "wikilink",
          target: "AIGC/代码生成电音",
          heading: "Hook",
          alias: "电音"
        }),
        expect.objectContaining({ type: "embed", target: "assets/cover.png" }),
        expect.objectContaining({ type: "markdown", target: "../Other.md", heading: "Part" })
      ])
    );
  });
});

describe("buildVaultIndex", () => {
  const index = buildVaultIndex([
    { path: "A.md", content: "# A\n[[B]] [[Folder/C|See C]] [[Missing]]" },
    { path: "B.md", content: "# B\n[[Folder/C]]" },
    { path: "Folder/C.md", content: "# C\n#topic" },
    { path: "密码/账号密码.md", content: "[[A]]" }
  ]);

  it("resolves wikilinks and excludes sensitive notes", () => {
    expect(index.notes.map((note) => note.path)).toEqual(["A.md", "B.md", "Folder/C.md"]);
    expect(index.outlinks.get("A.md")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "B.md", resolved: true }),
        expect.objectContaining({ target: "Folder/C.md", resolved: true }),
        expect.objectContaining({ target: "Missing", resolved: false })
      ])
    );
    expect(index.backlinks.get("Folder/C.md")).toHaveLength(2);
    expect(index.unresolvedLinks).toHaveLength(1);
  });

  it("can include path-only structure entries when the caller explicitly requests a read-only map", () => {
    const structureIndex = buildVaultIndex(
      [
        { path: "Projects/__folder.structure.md", content: "# Projects\n[[Projects/secret.txt.structure-file]]" },
        { path: "Projects/secret.txt.structure-file.md", content: "# secret.txt" }
      ],
      { includeExcludedPaths: true }
    );

    expect(structureIndex.notes.map((note) => note.path)).toEqual([
      "Projects/__folder.structure.md",
      "Projects/secret.txt.structure-file.md"
    ]);
    expect(structureIndex.outlinks.get("Projects/__folder.structure.md")).toEqual([
      expect.objectContaining({ target: "Projects/secret.txt.structure-file.md", resolved: true })
    ]);
  });

  it("builds a current-note graph with first and second hop nodes", () => {
    const graph = buildNoteGraph(index, "A.md");
    expect(graph.center).toBe("A.md");
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "A.md", depth: 0 }),
        expect.objectContaining({ id: "B.md", depth: 1 }),
        expect.objectContaining({ id: "Folder/C.md", depth: 1 }),
        expect.objectContaining({ id: "Missing", depth: 1, resolved: false })
      ])
    );
    expect(graph.edges.some((edge) => edge.source === "A.md" && edge.target === "B.md")).toBe(true);
  });

  it("builds a vault overview graph from every safe note", () => {
    const graph = buildVaultGraph(index);
    expect(graph.center).toBe("");
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["A.md", "B.md", "Folder/C.md"]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "A.md", target: "B.md" }),
        expect.objectContaining({ source: "A.md", target: "Folder/C.md" }),
        expect.objectContaining({ source: "B.md", target: "Folder/C.md" })
      ])
    );
    expect(graph.edges.some((edge) => edge.target === "Missing")).toBe(false);
  });
});

describe("safety", () => {
  it("blocks hidden, tool, and sensitive paths before GitHub sync", () => {
    expect(safetyDecisionForPath(".obsidian/workspace.json").allowed).toBe(false);
    expect(safetyDecisionForPath(".claude/skills/SKILL.md").allowed).toBe(false);
    expect(safetyDecisionForPath("密码/账号密码.md").allowed).toBe(false);
    expect(safetyDecisionForPath("AIGC/个人动画.md").allowed).toBe(true);

    const manifest = buildSafetyManifest(["A.md", ".env", "账号/token.md"]);
    expect(manifest.allowed.map((decision) => decision.path)).toEqual(["A.md"]);
    expect(manifest.excluded).toHaveLength(2);
  });
});
