import { describe, expect, it } from "vitest";
import { normalizeWorkspaceLayouts, upsertWorkspaceLayout, type WorkspaceLayoutSnapshot } from "./workspaceLayoutsModel";

const layout: WorkspaceLayoutSnapshot = {
  id: "layout-1",
  name: "Study",
  leftWidth: 260,
  agentWidth: 420,
  leftVisible: true,
  agentVisible: false,
  centerMode: "bases",
  graphPerspective: "knowledge",
  updatedAt: "2026-07-24T03:00:00.000Z"
};

describe("workspace layouts model", () => {
  it("normalizes persisted dimensions and modes", () => {
    expect(normalizeWorkspaceLayouts([{ ...layout, leftWidth: 20, agentWidth: 900, centerMode: "unknown" }])).toEqual([
      { ...layout, leftWidth: 180, agentWidth: 620, centerMode: "graph" }
    ]);
  });

  it("replaces a same-name layout instead of creating duplicates", () => {
    const updated = { ...layout, id: "new-id", leftWidth: 300, updatedAt: "2026-07-24T04:00:00.000Z" };
    expect(upsertWorkspaceLayout([layout], updated)).toEqual([
      { ...updated, id: "layout-1" }
    ]);
  });
});
