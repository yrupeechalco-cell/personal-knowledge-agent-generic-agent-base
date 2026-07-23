import {
  buildSafetyManifest,
  isMarkdownFile,
  normalizePath,
  safetyDecisionForPath,
  type NoteFile
} from "@knowledge-agent/core";
import { normalizeCanvasDocument, type KnowledgeCanvasDocument } from "@knowledge-agent/ui";
import { createEmptyVault, type LoadedVault } from "@knowledge-agent/workspace";
import type { BrowserFileSystemDirectoryHandle, BrowserFileSystemFileHandle, DirectoryPickerWindow } from "./browserTypes";

const CANVAS_DIRECTORY = ".knowledge-agent";
const CANVAS_FILE = "canvas.json";
let activeBrowserDirectory: BrowserFileSystemDirectoryHandle | null = null;

export function isDirectoryPickerSupported(win: Window = window): boolean {
  return typeof (win as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export function loadEmptyVault(): LoadedVault {
  activeBrowserDirectory = null;
  return createEmptyVault();
}

export async function loadBrowserDirectoryVault(win: Window = window): Promise<LoadedVault> {
  const picker = (win as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    return createEmptyVault("当前浏览器不支持文件夹选择器。请使用最新版 Chrome 或 Edge。");
  }

  const root = await picker({ mode: "readwrite" });
  activeBrowserDirectory = root;
  const allFiles = await readMarkdownFilesFromDirectory(root);
  return {
    files: filterSafeMarkdownFiles(allFiles),
    sourceName: root.name,
    sourceKind: "browser-directory",
    safetyManifest: buildSafetyManifest(allFiles.map((file) => file.path))
  };
}

export function clearBrowserDirectoryVault() {
  activeBrowserDirectory = null;
}

export async function loadBrowserCanvasDocument(): Promise<KnowledgeCanvasDocument | null> {
  if (!activeBrowserDirectory) return null;
  try {
    const metadataDirectory = await activeBrowserDirectory.getDirectoryHandle(CANVAS_DIRECTORY);
    const fileHandle = await metadataDirectory.getFileHandle(CANVAS_FILE);
    const file = await fileHandle.getFile();
    return normalizeCanvasDocument(JSON.parse(await file.text()), activeBrowserDirectory.name);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function saveBrowserCanvasDocument(document: KnowledgeCanvasDocument): Promise<void> {
  if (!activeBrowserDirectory) {
    throw new Error("请先打开一个可写的本地知识库文件夹。");
  }
  const metadataDirectory = await activeBrowserDirectory.getDirectoryHandle(CANVAS_DIRECTORY, { create: true });
  const fileHandle = await metadataDirectory.getFileHandle(CANVAS_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(document, null, 2));
  } finally {
    await writable.close();
  }
}

export function filterSafeMarkdownFiles(files: NoteFile[]): NoteFile[] {
  return files
    .filter((file) => isMarkdownFile(file.path))
    .filter((file) => safetyDecisionForPath(file.path).allowed)
    .map((file) => ({ ...file, path: normalizePath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function readMarkdownFilesFromDirectory(root: BrowserFileSystemDirectoryHandle): Promise<NoteFile[]> {
  const files: NoteFile[] = [];
  await walkDirectory(root, "", files);
  return files;
}

async function walkDirectory(
  directory: BrowserFileSystemDirectoryHandle,
  prefix: string,
  files: NoteFile[]
): Promise<void> {
  for await (const entry of directory.values()) {
    const path = normalizePath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (!safetyDecisionForPath(path).allowed && entry.kind === "directory") {
      continue;
    }
    if (entry.kind === "directory") {
      await walkDirectory(entry, path, files);
      continue;
    }
    await addFile(entry, path, files);
  }
}

async function addFile(entry: BrowserFileSystemFileHandle, path: string, files: NoteFile[]): Promise<void> {
  if (!isMarkdownFile(path) || !safetyDecisionForPath(path).allowed) return;
  const file = await entry.getFile();
  files.push({
    path,
    content: await file.text(),
    modifiedAt: new Date(file.lastModified).toISOString()
  });
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "NotFoundError"
    : error instanceof Error && /not found|notfound/i.test(error.message);
}
