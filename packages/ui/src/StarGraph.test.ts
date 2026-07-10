import { describe, expect, it } from "vitest";
import { fitGraphViewport } from "./StarGraph";

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
