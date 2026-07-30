import type { ParsedNote } from "@knowledge-agent/core";

export interface NoteWorkflowSettings {
  templatesFolder: string;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplatePath: string;
}

export const DEFAULT_NOTE_WORKFLOW_SETTINGS: NoteWorkflowSettings = {
  templatesFolder: "模板",
  dailyFolder: "日记",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplatePath: ""
};

export function normalizeNoteWorkflowSettings(value: unknown): NoteWorkflowSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_NOTE_WORKFLOW_SETTINGS };
  const source = value as Partial<Record<keyof NoteWorkflowSettings, unknown>>;
  return {
    templatesFolder: normalizeFolder(source.templatesFolder, DEFAULT_NOTE_WORKFLOW_SETTINGS.templatesFolder),
    dailyFolder: normalizeFolder(source.dailyFolder, DEFAULT_NOTE_WORKFLOW_SETTINGS.dailyFolder),
    dailyFormat: normalizeFormat(source.dailyFormat),
    dailyTemplatePath: normalizeNotePath(source.dailyTemplatePath)
  };
}

export function noteWorkflowStorageKey(sourceKind: string, sourceName: string): string {
  return `knowledge-agent.note-workflows.v1:${sourceKind}:${sourceName.trim() || "default"}`;
}

export function notesInTemplateFolder(notes: ParsedNote[], templatesFolder: string): ParsedNote[] {
  const folder = normalizeFolder(templatesFolder, "").toLocaleLowerCase();
  if (!folder) return [];
  const prefix = `${folder}/`;
  return notes.filter((note) => note.path.toLocaleLowerCase().startsWith(prefix));
}

export function formatDailyPath(settings: NoteWorkflowSettings, date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  const name = settings.dailyFormat
    .replace(/YYYY/g, year)
    .replace(/YY/g, year.slice(-2))
    .replace(/MM/g, month.padStart(2, "0"))
    .replace(/DD/g, day.padStart(2, "0"))
    .replace(/M/g, month)
    .replace(/D/g, day);
  return `${settings.dailyFolder ? `${settings.dailyFolder}/` : ""}${name}.md`;
}

export function expandTemplate(content: string, notePath: string, date = new Date()): string {
  const title = (notePath.split("/").pop() ?? notePath).replace(/\.md$/i, "");
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const timeText = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return content
    .replace(/\{\{title\}\}/gi, title)
    .replace(/\{\{date\}\}/gi, dateText)
    .replace(/\{\{time\}\}/gi, timeText);
}

export function stripTemplateFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function normalizeFolder(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) return fallback;
  return normalized;
}

function normalizeNotePath(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.split("/").some((segment) => segment === "." || segment === "..")) return "";
  return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

function normalizeFormat(value: unknown): string {
  if (typeof value !== "string" || !/[YMD]/.test(value)) return DEFAULT_NOTE_WORKFLOW_SETTINGS.dailyFormat;
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || DEFAULT_NOTE_WORKFLOW_SETTINGS.dailyFormat;
}
