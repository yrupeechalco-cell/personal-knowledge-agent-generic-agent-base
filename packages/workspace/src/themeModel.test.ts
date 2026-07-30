import { describe, expect, it } from "vitest";
import { DEFAULT_APP_THEME, normalizeAppTheme, oppositeAppTheme } from "./themeModel";

describe("workspace theme model", () => {
  it("uses the white theme for a new installation", () => {
    expect(DEFAULT_APP_THEME).toBe("light");
    expect(normalizeAppTheme(null)).toBe("light");
    expect(normalizeAppTheme("unknown")).toBe("light");
  });

  it("preserves valid preferences and toggles between both themes", () => {
    expect(normalizeAppTheme("dark")).toBe("dark");
    expect(normalizeAppTheme("light")).toBe("light");
    expect(oppositeAppTheme("light")).toBe("dark");
    expect(oppositeAppTheme("dark")).toBe("light");
  });
});
