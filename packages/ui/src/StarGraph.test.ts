import { describe, expect, it } from "vitest";
import { fitGraphViewport, selectNodesInBounds, shouldClearSelectionOnGraphClick } from "./StarGraph";

describe("fitGraphViewport", () => {
  it("centers a small graph without shrinking it", () => {
    const viewport = fitGraphViewport(
      [
        { x: 300, y: 220 },
        { x: 460, y: 300 }
      ],
      { width: 760, height: 520 }
    );

    expect(viewport.scale).toBeGreaterThanOrEqual(1);
    expect(viewport.x + 380 * viewport.scale).toBeCloseTo(380, 0);
    expect(viewport.y + 260 * viewport.scale).toBeCloseTo(260, 0);
  });

  it("shrinks a large graph enough to fit the viewbox", () => {
    const viewport = fitGraphViewport(
      [
        { x: -2000, y: -1200 },
        { x: 2200, y: 1300 }
      ],
      { width: 760, height: 520 }
    );

    expect(viewport.scale).toBeLessThan(0.2);
    expect(viewport.scale).toBeGreaterThanOrEqual(0.08);
  });
});

describe("selectNodesInBounds", () => {
  it("returns every graph node inside a Ctrl-drag selection rectangle", () => {
    expect(
      selectNodesInBounds(
        [
          { id: "A.md", x: 120, y: 140 },
          { id: "B.md", x: 260, y: 240 },
          { id: "C.md", x: 480, y: 320 }
        ],
        { left: 100, right: 300, top: 100, bottom: 260 }
      )
    ).toEqual(["A.md", "B.md"]);
  });
});

describe("shouldClearSelectionOnGraphClick", () => {
  it("clears a batch selection from blank space or an unrelated node, but preserves it for selected nodes", () => {
    expect(shouldClearSelectionOnGraphClick(["A.md", "B.md"])).toBe(true);
    expect(shouldClearSelectionOnGraphClick(["A.md", "B.md"], "C.md")).toBe(true);
    expect(shouldClearSelectionOnGraphClick(["A.md", "B.md"], "A.md")).toBe(false);
  });
});
