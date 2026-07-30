import { describe, expect, it } from "vitest";
import { convertMarkdownFormat, type MarkdownFormatConversionOptions } from "./formatConverter";

const allOptions: MarkdownFormatConversionOptions = {
  roamTags: true,
  roamHighlights: true,
  roamTodos: true,
  bearHighlights: true,
  deprecatedProperties: true
};

describe("convertMarkdownFormat", () => {
  it("converts supported Roam and Bear syntax", () => {
    const result = convertMarkdownFormat(
      "# Note\n\n#topic #[[deep topic]] ^^important^^ ::bear:: {{[[TODO]]}}",
      allOptions
    );
    expect(result.content).toContain("[[topic]] [[deep topic]] ==important== ==bear== [ ]");
    expect(result.changes).toBe(5);
  });

  it("converts deprecated property names to list-valued current properties", () => {
    const result = convertMarkdownFormat(
      "---\nalias: My Note\ntag: project, important\ncssclass: wide\n---\n# Note",
      allOptions
    );
    expect(result.content).toContain("aliases:");
    expect(result.content).toContain("tags:");
    expect(result.content).toContain("cssclasses:");
    expect(result.content).not.toMatch(/^alias:/m);
    expect(result.content).not.toMatch(/^tag:/m);
    expect(result.content).not.toMatch(/^cssclass:/m);
  });

  it("does nothing when every conversion is disabled", () => {
    const content = "#tag ^^highlight^^";
    expect(convertMarkdownFormat(content, {
      roamTags: false,
      roamHighlights: false,
      roamTodos: false,
      bearHighlights: false,
      deprecatedProperties: false
    })).toEqual({ content, changes: 0 });
  });
});
