import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { ParsedNote } from "@knowledge-agent/core";

export interface FileTreeProps {
  notes: ParsedNote[];
  currentPath: string;
  onSelect(path: string): void;
  onFolderContextMenu?(folder: FileTreeFolder, event: ReactMouseEvent<HTMLElement>): void;
  onNoteContextMenu?(note: ParsedNote, event: ReactMouseEvent<HTMLElement>): void;
}

export interface FileTreeFolder {
  name: string;
  path: string;
  folders: FileTreeFolder[];
  notes: ParsedNote[];
  noteCount: number;
}

export interface FileTreeRoot {
  folders: FileTreeFolder[];
  notes: ParsedNote[];
  noteCount: number;
}

interface MutableFolder {
  name: string;
  path: string;
  folders: Map<string, MutableFolder>;
  notes: ParsedNote[];
}

export function FileTree({ notes, currentPath, onFolderContextMenu, onNoteContextMenu, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(notes), [notes]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ancestors = ancestorFolderPaths(currentPath);
    if (ancestors.length === 0) return;
    setCollapsedFolders((current) => {
      const next = new Set(current);
      let changed = false;
      for (const ancestor of ancestors) {
        if (next.delete(ancestor)) changed = true;
      }
      return changed ? next : current;
    });
  }, [currentPath]);

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function renderFolder(folder: FileTreeFolder, depth: number) {
    const collapsed = collapsedFolders.has(folder.path);
    return (
      <section className="tree-folder" key={folder.path}>
        <button
          aria-expanded={!collapsed}
          className={`tree-folder-row ${folderWeightClass(folder, depth)}`}
          onContextMenu={(event) => onFolderContextMenu?.(folder, event)}
          onClick={() => toggleFolder(folder.path)}
          style={treeDepthStyle(depth)}
          title={folder.path}
          type="button"
        >
          <span className="tree-folder-caret" aria-hidden="true" />
          <span className="tree-folder-name">{folder.name}</span>
          <small>{folder.noteCount}</small>
        </button>
        <div
          aria-hidden={collapsed}
          className={collapsed ? "tree-folder-children-wrap collapsed" : "tree-folder-children-wrap expanded"}
          style={treeDepthStyle(depth)}
        >
          <div className="tree-folder-children">
            {folder.folders.map((child) => renderFolder(child, depth + 1))}
            {folder.notes.map((note) => renderNote(note, depth + 1))}
          </div>
        </div>
      </section>
    );
  }

  function renderNote(note: ParsedNote, depth: number) {
    return (
      <button
        className={`${note.path === currentPath ? "tree-note active" : "tree-note"} ${noteWeightClass(depth)}`}
        key={note.path}
        onContextMenu={(event) => onNoteContextMenu?.(note, event)}
        onClick={() => onSelect(note.path)}
        style={treeDepthStyle(depth)}
        title={note.path}
        type="button"
      >
        <span>{note.title}</span>
        {note.tags.length > 0 ? <small>#{note.tags[0]}</small> : null}
      </button>
    );
  }

  return (
    <nav className="file-tree" aria-label="Vault files">
      {tree.folders.map((folder) => renderFolder(folder, 0))}
      {tree.notes.map((note) => renderNote(note, 0))}
    </nav>
  );
}

export function buildFileTree(notes: ParsedNote[]): FileTreeRoot {
  const root: MutableFolder = {
    name: "",
    path: "",
    folders: new Map(),
    notes: []
  };

  for (const note of [...notes].sort(compareNotes)) {
    const parts = note.path.split("/").filter(Boolean);
    const fileName = parts.at(-1);
    if (!fileName) continue;
    const folderParts = parts.slice(0, -1);
    let current = root;
    const pathParts: string[] = [];

    for (const folderName of folderParts) {
      pathParts.push(folderName);
      const folderPath = pathParts.join("/");
      let folder = current.folders.get(folderName);
      if (!folder) {
        folder = { name: folderName, path: folderPath, folders: new Map(), notes: [] };
        current.folders.set(folderName, folder);
      }
      current = folder;
    }

    current.notes.push(note);
  }

  return freezeFolder(root);
}

export function ancestorFolderPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean).slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function freezeFolder(folder: MutableFolder): FileTreeRoot {
  const folders = [...folder.folders.values()].map(freezeChildFolder).sort(compareFolders);
  const notes = [...folder.notes].sort(compareNotes);
  return {
    folders,
    notes,
    noteCount: notes.length + folders.reduce((sum, child) => sum + child.noteCount, 0)
  };
}

function freezeChildFolder(folder: MutableFolder): FileTreeFolder {
  const folders = [...folder.folders.values()].map(freezeChildFolder).sort(compareFolders);
  const notes = [...folder.notes].sort(compareNotes);
  return {
    name: folder.name,
    path: folder.path,
    folders,
    notes,
    noteCount: notes.length + folders.reduce((sum, child) => sum + child.noteCount, 0)
  };
}

function treeDepthStyle(depth: number): CSSProperties {
  return { "--tree-depth": depth } as CSSProperties;
}

function folderWeightClass(folder: FileTreeFolder, depth: number): string {
  if (depth === 0 || folder.noteCount >= 8) return "tree-node-weight-large";
  if (folder.noteCount >= 3) return "tree-node-weight-medium";
  return "tree-node-weight-small";
}

function noteWeightClass(depth: number): string {
  if (depth === 0) return "tree-note-weight-root";
  if (depth >= 3) return "tree-note-weight-small";
  return "tree-note-weight-regular";
}

function compareFolders(left: FileTreeFolder, right: FileTreeFolder) {
  return left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true });
}

function compareNotes(left: ParsedNote, right: ParsedNote) {
  return left.title.localeCompare(right.title, "zh-Hans-CN", { numeric: true }) || left.path.localeCompare(right.path);
}
