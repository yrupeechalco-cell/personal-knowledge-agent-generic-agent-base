import { type NoteFile } from "@knowledge-agent/core";
import { createEmptyCanvasDocument } from "@knowledge-agent/ui";
import { describe, expect, it } from "vitest";
import type { BrowserFileSystemDirectoryHandle, BrowserFileSystemFileHandle } from "./browserTypes";
import {
  filterSafeMarkdownFiles,
  isDirectoryPickerSupported,
  loadBrowserCanvasDocument,
  loadBrowserDirectoryVault,
  loadEmptyVault,
  saveBrowserCanvasDocument
} from "./vaultSources";

describe("web vault sources", () => {
  it("filters non-markdown and sensitive paths before indexing", () => {
    const files: NoteFile[] = [
      { path: "Inbox/Idea.md", content: "" },
      { path: "密码/账号密码.md", content: "" },
      { path: ".obsidian/workspace.json", content: "" },
      { path: "Assets/photo.png", content: "" },
      { path: "Secrets/token.md", content: "" }
    ];

    expect(filterSafeMarkdownFiles(files).map((file) => file.path)).toEqual(["Inbox/Idea.md"]);
  });

  it("starts without any built-in notes", () => {
    const vault = loadEmptyVault();

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toHaveLength(0);
    expect(vault.safetyManifest.allowed).toHaveLength(0);
    expect(vault.safetyManifest.excluded).toHaveLength(0);
  });

  it("keeps an unsupported browser empty instead of injecting fallback documents", async () => {
    const vault = await loadBrowserDirectoryVault({} as Window);

    expect(vault.sourceKind).toBe("empty");
    expect(vault.files).toEqual([]);
    expect(vault.unsupportedReason).toContain("不支持文件夹选择器");
  });

  it("detects browser directory picker support from the supplied window object", () => {
    expect(isDirectoryPickerSupported({ showDirectoryPicker: async () => ({}) } as unknown as Window)).toBe(true);
    expect(isDirectoryPickerSupported({} as unknown as Window)).toBe(false);
  });

  it("persists the canvas inside the selected local directory", async () => {
    let storedCanvas = "";
    const canvasFile: BrowserFileSystemFileHandle = {
      kind: "file",
      name: "canvas.json",
      async getFile() {
        return {
          lastModified: Date.now(),
          text: async () => storedCanvas
        } as File;
      },
      async createWritable() {
        return {
          async write(data) {
            storedCanvas = data;
          },
          async close() {
            return undefined;
          }
        };
      }
    };
    const metadataDirectory: BrowserFileSystemDirectoryHandle = {
      kind: "directory",
      name: ".knowledge-agent",
      async *values() {
        return;
      },
      async getDirectoryHandle() {
        throw new Error("not used");
      },
      async getFileHandle() {
        return canvasFile;
      }
    };
    const root: BrowserFileSystemDirectoryHandle = {
      kind: "directory",
      name: "Research",
      async *values() {
        return;
      },
      async getDirectoryHandle() {
        return metadataDirectory;
      },
      async getFileHandle() {
        throw new Error("not used");
      }
    };
    const win = {
      showDirectoryPicker: async () => root
    } as unknown as Window;

    await loadBrowserDirectoryVault(win);
    const document = createEmptyCanvasDocument("Research");
    await saveBrowserCanvasDocument(document);
    const reloaded = await loadBrowserCanvasDocument();

    expect(JSON.parse(storedCanvas).id).toBe(document.id);
    expect(reloaded?.name).toBe("Research");
  });
});
