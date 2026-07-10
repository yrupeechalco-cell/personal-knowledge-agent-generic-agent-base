import type { NoteGraph } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { layoutMiniGraph } from "./MiniStarGraph";

describe("layoutMiniGraph", () => {
  it("keeps the current note centered and lays related notes around it", () => {
    const graph: NoteGraph = {
      center: "A.md",
      nodes: [
        { id: "A.md", label: "A", resolved: true, depth: 0, direction: "center" },
        { id: "B.md", label: "B", resolved: true, depth: 1, direction: "out" },
        { id: "C.md", label: "C", resolved: true, depth: 1, direction: "back" }
      ],
      edges: [
        { source: "A.md", target: "B.md", type: "wikilink", resolved: true },
        { source: "C.md", target: "A.md", type: "wikilink", resolved: true },
        { source: "X.md", target: "Y.md", type: "wikilink", resolved: true }
      ]
    };

    const layout = layoutMiniGraph(graph, "A.md");

    expect(layout.nodes).toHaveLength(3);
    expect(layout.nodeById.get("A.md")).toMatchObject({ x: 180, y: 66 });
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.some((edge) => edge.source === "X.md")).toBe(false);
  });
});
