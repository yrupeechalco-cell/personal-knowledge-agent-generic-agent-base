import type { FrontmatterValue, ParsedNote } from "@knowledge-agent/core";

export type BaseSortDirection = "asc" | "desc";

export interface BaseViewSettings {
  query: string;
  sortKey: string;
  sortDirection: BaseSortDirection;
  visibleProperties: string[];
}

export interface BasePropertyColumn {
  key: string;
  type: "text" | "number" | "boolean" | "list" | "mixed";
  count: number;
}

export const DEFAULT_BASE_VIEW_SETTINGS: BaseViewSettings = {
  query: "",
  sortKey: "title",
  sortDirection: "asc",
  visibleProperties: []
};

export function baseViewStorageKey(sourceKind: string, sourceName: string): string {
  return `knowledge-agent.base-view.v1:${sourceKind}:${sourceName.trim() || "default"}`;
}

export function normalizeBaseViewSettings(
  value: unknown,
  availableProperties: readonly string[]
): BaseViewSettings {
  if (!value || typeof value !== "object") return DEFAULT_BASE_VIEW_SETTINGS;
  const input = value as Partial<BaseViewSettings>;
  const available = new Set(availableProperties);
  const visibleProperties = Array.isArray(input.visibleProperties)
    ? input.visibleProperties.filter((key): key is string => typeof key === "string" && available.has(key))
    : [];
  const requestedSort = typeof input.sortKey === "string" ? input.sortKey : "title";
  const sortKey = ["title", "path", "tags", ...availableProperties].includes(requestedSort)
    ? requestedSort
    : "title";
  return {
    query: typeof input.query === "string" ? input.query : "",
    sortKey,
    sortDirection: input.sortDirection === "desc" ? "desc" : "asc",
    visibleProperties
  };
}

export function collectBasePropertyColumns(notes: readonly ParsedNote[]): BasePropertyColumn[] {
  const values = new Map<string, FrontmatterValue[]>();
  for (const note of notes) {
    for (const [key, value] of Object.entries(note.frontmatter)) {
      values.set(key, [...(values.get(key) ?? []), value]);
    }
  }
  return [...values.entries()]
    .map(([key, propertyValues]) => ({
      key,
      type: propertyType(propertyValues),
      count: propertyValues.length
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export function filterAndSortBaseNotes(
  notes: readonly ParsedNote[],
  settings: BaseViewSettings
): ParsedNote[] {
  const query = settings.query.trim().toLocaleLowerCase();
  const filtered = query
    ? notes.filter((note) => baseSearchText(note).includes(query))
    : [...notes];
  const direction = settings.sortDirection === "desc" ? -1 : 1;
  return filtered.sort((left, right) => (
    compareBaseValues(baseValue(left, settings.sortKey), baseValue(right, settings.sortKey)) * direction
    || left.path.localeCompare(right.path, undefined, { numeric: true })
  ));
}

export function baseValue(note: ParsedNote, key: string): FrontmatterValue | string {
  if (key === "title") return note.title;
  if (key === "path") return note.path;
  if (key === "tags") return note.tags;
  return note.frontmatter[key] ?? "";
}

export function formatBaseValue(value: FrontmatterValue | string | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return value === undefined ? "" : String(value);
}

function propertyType(values: FrontmatterValue[]): BasePropertyColumn["type"] {
  const types = new Set(values.map((value) => (
    Array.isArray(value) ? "list" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text"
  )));
  return types.size === 1 ? ([...types][0] as BasePropertyColumn["type"]) : "mixed";
}

function baseSearchText(note: ParsedNote): string {
  return [
    note.title,
    note.path,
    note.tags.join(" "),
    ...Object.entries(note.frontmatter).flatMap(([key, value]) => [key, formatBaseValue(value)])
  ].join("\n").toLocaleLowerCase();
}

function compareBaseValues(left: FrontmatterValue | string, right: FrontmatterValue | string): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return formatBaseValue(left).localeCompare(formatBaseValue(right), undefined, { numeric: true });
}
