import { describe, expect, it } from "vitest";
import { splitMarkdownSlides } from "./slidesModel";

describe("splitMarkdownSlides", () => {
  it("ignores frontmatter and splits on horizontal rules outside code fences", () => {
    const slides = splitMarkdownSlides(
      "---\ntags: [talk]\n---\n# Intro\nHello\n\n---\n\n## Demo\n```md\n---\n```\nDone"
    );
    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ id: "slide-1", title: "Intro" });
    expect(slides[1].lines).toContain("---");
  });

  it("returns one slide when no divider exists", () => {
    expect(splitMarkdownSlides("# Only\n\nContent")).toEqual([
      { id: "slide-1", title: "Only", lines: ["# Only", "", "Content"] }
    ]);
  });
});
