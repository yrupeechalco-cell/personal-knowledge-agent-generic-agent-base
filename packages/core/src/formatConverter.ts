import { parseNote } from "./parser";
import { removeNoteProperty, setNoteProperty } from "./properties";

export interface MarkdownFormatConversionOptions {
  roamTags: boolean;
  roamHighlights: boolean;
  roamTodos: boolean;
  bearHighlights: boolean;
  deprecatedProperties: boolean;
}

export interface MarkdownFormatConversionResult {
  content: string;
  changes: number;
}

export const DEFAULT_FORMAT_CONVERSION_OPTIONS: MarkdownFormatConversionOptions = {
  roamTags: false,
  roamHighlights: true,
  roamTodos: true,
  bearHighlights: true,
  deprecatedProperties: true
};

export function convertMarkdownFormat(
  content: string,
  options: MarkdownFormatConversionOptions
): MarkdownFormatConversionResult {
  let next = content;
  let changes = 0;
  const replace = (pattern: RegExp, replacement: string | ((substring: string, ...args: string[]) => string)) => {
    next = next.replace(pattern, (...args) => {
      changes += 1;
      if (typeof replacement === "string") return interpolateReplacement(replacement, args);
      return replacement(...(args as [string, ...string[]]));
    });
  };

  if (options.roamTags) {
    replace(/#\[\[([^\]]+)\]\]/gu, "[[$1]]");
    replace(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gmu, "$1[[$2]]");
  }
  if (options.roamHighlights) {
    replace(/\^\^([^!\n][\s\S]*?)\^\^/gu, "==$1==");
  }
  if (options.roamTodos) {
    replace(/\{\{\[\[TODO\]\]\}\}/gu, "[ ]");
  }
  if (options.bearHighlights) {
    replace(/::([^:\n][\s\S]*?)::/gu, "==$1==");
  }
  if (options.deprecatedProperties) {
    const converted = convertDeprecatedProperties(next);
    next = converted.content;
    changes += converted.changes;
  }
  return { content: next, changes };
}

function convertDeprecatedProperties(content: string): MarkdownFormatConversionResult {
  const note = parseNote({ path: "format-converter.md", content });
  let next = content;
  let changes = 0;
  const mappings = [
    { from: "alias", to: "aliases" },
    { from: "tag", to: "tags" },
    { from: "cssclass", to: "cssclasses" }
  ] as const;
  for (const mapping of mappings) {
    const value = note.frontmatter[mapping.from];
    if (value === undefined) continue;
    const normalized = normalizeLegacyList(value);
    next = setNoteProperty(next, mapping.to, normalized);
    next = removeNoteProperty(next, mapping.from);
    changes += 1;
  }
  return { content: next, changes };
}

function normalizeLegacyList(value: string | string[] | boolean | number): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function interpolateReplacement(replacement: string, args: unknown[]): string {
  return replacement.replace(/\$(\d+)/g, (_match, index: string) => String(args[Number(index)] ?? ""));
}
