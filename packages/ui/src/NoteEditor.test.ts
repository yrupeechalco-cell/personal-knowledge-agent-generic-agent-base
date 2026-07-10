import { describe, expect, it } from "vitest";
import { renderInlineMarkdownText } from "./NoteEditor";

describe("renderInlineMarkdownText", () => {
  it("renders Obsidian wikilinks without leaking raw syntax", () => {
    expect(renderInlineMarkdownText("[[AIGC/AIGC]]")).toBe("AIGC/AIGC");
    expect(renderInlineMarkdownText("[[AIGC/AIGC|AIGC]]")).toBe("AIGC");
    expect(renderInlineMarkdownText("[[AIGC/AIGC#heading|Alias]]")).toBe("Alias");
    expect(renderInlineMarkdownText("![[asset.png]]")).toBe("asset.png");
  });
});
