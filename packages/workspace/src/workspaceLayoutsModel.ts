export type SavedCenterMode = "graph" | "canvas" | "edit" | "explorer" | "trash" | "bases" | "slides";

export interface WorkspaceLayoutSnapshot {
  id: string;
  name: string;
  leftWidth: number;
  agentWidth: number;
  leftVisible: boolean;
  agentVisible: boolean;
  centerMode: SavedCenterMode;
  graphPerspective: "knowledge" | "files";
  updatedAt: string;
}

export function workspaceLayoutsStorageKey(sourceKind: string, sourceName: string): string {
  return `knowledge-agent.workspace-layouts.v1:${sourceKind}:${sourceName.trim() || "default"}`;
}

export function normalizeWorkspaceLayouts(value: unknown): WorkspaceLayoutSnapshot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): WorkspaceLayoutSnapshot[] => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<WorkspaceLayoutSnapshot>;
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 50) : "";
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      leftWidth: clampNumber(input.leftWidth, 180, 520, 248),
      agentWidth: clampNumber(input.agentWidth, 260, 620, 380),
      leftVisible: input.leftVisible !== false,
      agentVisible: input.agentVisible !== false,
      centerMode: normalizeCenterMode(input.centerMode),
      graphPerspective: input.graphPerspective === "files" ? "files" : "knowledge",
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString()
    }];
  }).slice(0, 24);
}

export function upsertWorkspaceLayout(
  layouts: WorkspaceLayoutSnapshot[],
  layout: WorkspaceLayoutSnapshot
): WorkspaceLayoutSnapshot[] {
  const duplicateByName = layouts.find((item) => item.name.toLocaleLowerCase() === layout.name.toLocaleLowerCase());
  const next = duplicateByName
    ? layouts.map((item) => item.id === duplicateByName.id ? { ...layout, id: duplicateByName.id } : item)
    : [layout, ...layouts];
  return next
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 24);
}

function normalizeCenterMode(value: unknown): SavedCenterMode {
  return value === "canvas" || value === "edit" || value === "explorer" || value === "trash" || value === "bases" || value === "slides"
    ? value
    : "graph";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
