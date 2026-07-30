import { describe, expect, it } from "vitest";
import {
  isAssignableShortcut,
  normalizeShortcut,
  normalizeShortcutOverrides,
  resolveShortcutMap,
  shortcutCommandFor,
  shortcutConflict,
  shortcutFromKeyboardEvent,
  SHORTCUT_COMMANDS
} from "./shortcutModel";

describe("shortcut model", () => {
  it("creates a stable modifier order from keyboard events", () => {
    expect(shortcutFromKeyboardEvent({
      key: "f",
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false
    })).toBe("Ctrl+Shift+F");
    expect(shortcutFromKeyboardEvent({
      key: "ArrowLeft",
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      metaKey: false
    })).toBe("Alt+ArrowLeft");
  });

  it("normalizes persisted shortcuts and rejects typing-only bindings", () => {
    expect(normalizeShortcut("shift+ctrl+f")).toBe("Ctrl+Shift+F");
    expect(isAssignableShortcut("Ctrl+K")).toBe(true);
    expect(isAssignableShortcut("F6")).toBe(true);
    expect(isAssignableShortcut("K")).toBe(false);
  });

  it("keeps defaults, honors disabled overrides, and finds conflicts", () => {
    const shortcuts = resolveShortcutMap(normalizeShortcutOverrides({
      "new-note": [],
      graph: ["Ctrl+Alt+G"]
    }));

    expect(shortcuts["new-note"]).toEqual([]);
    expect(shortcuts.graph).toEqual(["Ctrl+Alt+G"]);
    expect(shortcuts.settings).toEqual(["Ctrl+,"]);
    expect(shortcutCommandFor("Ctrl+Alt+G", shortcuts)).toBe("graph");
    expect(shortcutConflict("Ctrl+Alt+G", "canvas", shortcuts)).toBe("graph");
  });

  it("ships a conflict-free keyboard-first default set", () => {
    const defaults = SHORTCUT_COMMANDS.flatMap((command) => command.defaults);

    expect(new Set(defaults).size).toBe(defaults.length);
    expect(resolveShortcutMap()["command-palette"]).toEqual(["Ctrl+P"]);
    expect(resolveShortcutMap()["quick-switcher"]).toEqual(["Ctrl+O"]);
    expect(resolveShortcutMap()["settings"]).toEqual(["Ctrl+,"]);
    expect(resolveShortcutMap()["next-tab"]).toEqual(["Ctrl+PageDown"]);
  });
});
