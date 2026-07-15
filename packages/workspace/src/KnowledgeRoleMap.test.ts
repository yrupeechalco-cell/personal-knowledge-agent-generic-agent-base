import { describe, expect, it } from "vitest";
import { maximizeAngularDirections } from "./KnowledgeRoleMap";

describe("maximizeAngularDirections", () => {
  it("spreads small domain sets across all three axes", () => {
    const points = maximizeAngularDirections(6);
    const extents = ["x", "y", "z"].map((axis) => {
      const values = points.map((point) => point[axis as "x" | "y" | "z"]);
      return Math.max(...values) - Math.min(...values);
    });

    expect(points).toHaveLength(6);
    expect(Math.min(...extents)).toBeGreaterThan(1.45);
  });

  it("keeps larger domain sets normalized and angularly separated", () => {
    const points = maximizeAngularDirections(18);
    let closestDot = -1;

    for (let index = 0; index < points.length; index += 1) {
      expect(points[index].length()).toBeCloseTo(1, 6);
      for (let otherIndex = index + 1; otherIndex < points.length; otherIndex += 1) {
        closestDot = Math.max(closestDot, points[index].dot(points[otherIndex]));
      }
    }

    expect(closestDot).toBeLessThan(0.86);
  });
});
