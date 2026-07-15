import {
  buildSafetyManifest,
  isMarkdownFile,
  normalizePath,
  safetyDecisionForPath,
  type NoteFile
} from "@knowledge-agent/core";
import { createEmptyVault, type LoadedVault } from "@knowledge-agent/workspace";
import type { BrowserFileSystemDirectoryHandle, BrowserFileSystemFileHandle, DirectoryPickerWindow } from "./browserTypes";

export function isDirectoryPickerSupported(win: Window = window): boolean {
  return typeof (win as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export function loadEmptyVault(): LoadedVault {
  return createEmptyVault();
}

export async function loadBrowserDirectoryVault(win: Window = window): Promise<LoadedVault> {
  const picker = (win as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    return createEmptyVault("当前浏览器不支持文件夹选择器。请使用最新版 Chrome 或 Edge。");
  }

  const root = await picker();
  const allFiles = await readMarkdownFilesFromDirectory(root);
  return {
    files: filterSafeMarkdownFiles(allFiles),
    sourceName: root.name,
    sourceKind: "browser-directory",
    safetyManifest: buildSafetyManifest(allFiles.map((file) => file.path))
  };
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
