export type ShortcutCategory =
  | "navigation"
  | "notes"
  | "views"
  | "workspace"
  | "agent"
  | "settings";

export const SHORTCUT_STORAGE_KEY = "knowledge-agent.shortcuts.v1";

export const SHORTCUT_COMMANDS = [
  { id: "command-palette", category: "navigation", defaults: ["Ctrl+P"], allowInInput: true },
  { id: "quick-switcher", category: "navigation", defaults: ["Ctrl+O"], allowInInput: true },
  { id: "search", category: "navigation", defaults: ["Ctrl+Shift+F"], allowInInput: true },
  { id: "navigate-back", category: "navigation", defaults: ["Alt+ArrowLeft"], allowInInput: true },
  { id: "navigate-forward", category: "navigation", defaults: ["Alt+ArrowRight"], allowInInput: true },
  { id: "previous-tab", category: "navigation", defaults: ["Ctrl+PageUp"], allowInInput: true },
  { id: "next-tab", category: "navigation", defaults: ["Ctrl+PageDown"], allowInInput: true },
  { id: "close-tab", category: "navigation", defaults: ["Ctrl+W"], allowInInput: true },
  { id: "focus-editor", category: "navigation", defaults: ["Ctrl+Alt+E"], allowInInput: true },
  { id: "focus-agent", category: "navigation", defaults: ["Ctrl+Alt+A"], allowInInput: true },
  { id: "new-note", category: "notes", defaults: ["Ctrl+N"], allowInInput: true },
  { id: "unique-note", category: "notes", defaults: ["Ctrl+Shift+N"], allowInInput: true },
  { id: "daily-note", category: "notes", defaults: ["Ctrl+Shift+D"], allowInInput: true },
  { id: "insert-template", category: "notes", defaults: ["Ctrl+Shift+T"], allowInInput: true },
  { id: "random-note", category: "notes", defaults: ["Ctrl+Shift+R"], allowInInput: true },
  { id: "split-note", category: "notes", defaults: [], allowInInput: true },
  { id: "merge-note", category: "notes", defaults: [], allowInInput: true },
  { id: "toggle-editor", category: "notes", defaults: ["Ctrl+E"], allowInInput: true },
  { id: "graph", category: "views", defaults: ["Ctrl+G"], allowInInput: true },
  { id: "canvas", category: "views", defaults: ["Ctrl+Shift+C"], allowInInput: true },
  { id: "bases", category: "views", defaults: ["Ctrl+Shift+B"], allowInInput: true },
  { id: "slides", category: "views", defaults: [], allowInInput: true },
  { id: "explorer", category: "views", defaults: ["Ctrl+Shift+E"], allowInInput: true },
  { id: "trash", category: "views", defaults: ["Ctrl+Shift+Backspace"], allowInInput: true },
  { id: "storage", category: "workspace", defaults: ["Ctrl+Alt+O"], allowInInput: true },
  { id: "toggle-left", category: "workspace", defaults: ["Ctrl+Shift+L"], allowInInput: true },
  { id: "toggle-agent", category: "workspace", defaults: ["Ctrl+Shift+A"], allowInInput: true },
  { id: "workspaces", category: "workspace", defaults: [], allowInInput: true },
  { id: "workflow-settings", category: "workspace", defaults: [], allowInInput: true },
  { id: "format-converter", category: "workspace", defaults: [], allowInInput: true },
  { id: "new-agent-session", category: "agent", defaults: ["Ctrl+Alt+N"], allowInInput: true },
  { id: "reset-agent-session", category: "agent", defaults: ["Ctrl+Alt+R"], allowInInput: true },
  { id: "upload-agent-context", category: "agent", defaults: ["Ctrl+Alt+U"], allowInInput: true },
  { id: "toggle-theme", category: "settings", defaults: ["Ctrl+Alt+T"], allowInInput: true },
  { id: "toggle-language", category: "settings", defaults: [], allowInInput: true },
  { id: "shortcut-settings", category: "settings", defaults: ["Ctrl+Alt+K"], allowInInput: true },
  { id: "settings", category: "settings", defaults: ["Ctrl+,"], allowInInput: true }
] as const satisfies readonly ShortcutCommandDefinition[];

export type ShortcutCommandId = (typeof SHORTCUT_COMMANDS)[number]["id"];
export type ShortcutOverrides = Partial<Record<ShortcutCommandId, string[]>>;
export type ResolvedShortcutMap = Record<ShortcutCommandId, string[]>;

export interface ShortcutCommandDefinition {
  id: string;
  category: ShortcutCategory;
  defaults: readonly string[];
  allowInInput?: boolean;
}

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

type ShortcutModifier = "Ctrl" | "Alt" | "Shift" | "Meta";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);
const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  Backspace: "Backspace",
  Delete: "Delete",
  End: "End",
  Enter: "Enter",
  Escape: "Escape",
  Home: "Home",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Tab: "Tab"
};

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | null {
  if (!event.key || MODIFIER_KEYS.has(event.key)) return null;
  const key = canonicalKey(event.key);
  if (!key) return null;
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : ""
  ].filter(Boolean);
  return [...modifiers, key].join("+");
}

export function normalizeShortcut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = canonicalKey(parts[parts.length - 1]);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  const modifiers = new Set<ShortcutModifier>(
    parts
      .slice(0, -1)
      .map(canonicalModifier)
      .filter((modifier): modifier is ShortcutModifier => modifier !== null)
  );
  const prefix = (["Ctrl", "Alt", "Shift", "Meta"] as ShortcutModifier[])
    .filter((modifier) => modifiers.has(modifier));
  return [...prefix, key].join("+");
}

export function isAssignableShortcut(shortcut: string): boolean {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  return parts.length > 1 || /^F(?:[1-9]|1[0-2])$/.test(key);
}

export function normalizeShortcutOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const validIds = new Set<string>(SHORTCUT_COMMANDS.map((command) => command.id));
  const overrides: ShortcutOverrides = {};
  for (const [id, rawShortcuts] of Object.entries(source)) {
    if (!validIds.has(id) || !Array.isArray(rawShortcuts)) continue;
    const shortcuts = [...new Set(rawShortcuts.map(normalizeShortcut).filter((shortcut): shortcut is string => Boolean(shortcut)))];
    overrides[id as ShortcutCommandId] = shortcuts;
  }
  return overrides;
}

export function resolveShortcutMap(overrides: ShortcutOverrides = {}): ResolvedShortcutMap {
  return Object.fromEntries(
    SHORTCUT_COMMANDS.map((command) => [
      command.id,
      Object.prototype.hasOwnProperty.call(overrides, command.id)
        ? overrides[command.id] ?? []
        : [...command.defaults]
    ])
  ) as ResolvedShortcutMap;
}

export function shortcutCommandFor(
  shortcut: string,
  shortcuts: ResolvedShortcutMap
): ShortcutCommandId | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;
  return SHORTCUT_COMMANDS.find((command) => shortcuts[command.id].includes(normalized))?.id ?? null;
}

export function shortcutConflict(
  shortcut: string,
  commandId: ShortcutCommandId,
  shortcuts: ResolvedShortcutMap
): ShortcutCommandId | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return null;
  return SHORTCUT_COMMANDS.find(
    (command) => command.id !== commandId && shortcuts[command.id].includes(normalized)
  )?.id ?? null;
}

export function shortcutDefinition(commandId: ShortcutCommandId) {
  return SHORTCUT_COMMANDS.find((command) => command.id === commandId)!;
}

function canonicalModifier(value: string): "Ctrl" | "Alt" | "Shift" | "Meta" | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "ctrl" || normalized === "control") return "Ctrl";
  if (normalized === "alt" || normalized === "option") return "Alt";
  if (normalized === "shift") return "Shift";
  if (normalized === "meta" || normalized === "cmd" || normalized === "command") return "Meta";
  return null;
}

function canonicalKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value === " " ? "Space" : "";
  if (KEY_ALIASES[trimmed]) return KEY_ALIASES[trimmed];
  if (trimmed.length === 1) return /[a-z]/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
  if (/^f(?:[1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}
