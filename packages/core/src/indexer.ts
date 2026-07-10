import { ensureMarkdownPath, isMarkdownFile, normalizePath, pathStem } from "./path";
import { parseNote } from "./parser";
import { safetyDecisionForPath } from "./safety";
import type { GraphEdge, GraphNode, NoteFile, NoteGraph, ParsedLink, ParsedLinkEdge, ParsedNote, VaultIndex } from "./types";

export function buildVaultIndex(files: NoteFile[]): VaultIndex {
  const notes = files
    .filter((file) => isMarkdownFile(file.path))
    .filter((file) => safetyDecisionForPath(file.path).allowed)
    .map(parseNote)
    .sort((a, b) => a.path.localeCompare(b.path));

  const noteByPath = new Map(notes.map((note) => [note.path.toLowerCase(), note]));
  const byStem = new Map<string, ParsedNote[]>();

  for (const note of notes) {
    const stem = pathStem(note.path);
    byStem.set(stem, [...(byStem.get(stem) ?? []), note]);
  }

  const backlinks = new Map<string, ParsedLinkEdge[]>();
  const outlinks = new Map<string, ParsedLinkEdge[]>();
  const unresolvedLinks: ParsedLinkEdge[] = [];

  for (const note of notes) {
    const edges = note.links.map((link) => linkToEdge(note.path, link, noteByPath, byStem));
    outlinks.set(note.path, edges);
    for (const edge of edges) {
      if (!edge.resolved) {
        unresolvedLinks.push(edge);
        continue;
      }
      backlinks.set(edge.target, [...(backlinks.get(edge.target) ?? []), edge]);
    }
  }

  return { notes, noteByPath, backlinks, outlinks, unresolvedLinks };
}

export function getNote(index: VaultIndex, path: string): ParsedNote | undefined {
  return index.noteByPath.get(normalizePath(path).toLowerCase());
}

export function buildNoteGraph(index: VaultIndex, centerPath: string): NoteGraph {
  const center = normalizePath(centerPath);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  addNode(nodes, center, 0, "center");
  const firstHop = [
    ...(index.outlinks.get(center) ?? []).map((edge) => ({ edge, direction: "out" as const })),
    ...(index.backlinks.get(center) ?? []).map((edge) => ({ edge, direction: "back" as const }))
  ];

  for (const item of firstHop) {
    const target = item.direction === "out" ? item.edge.target : item.edge.source;
    addNode(nodes, target, 1, item.direction, item.edge.resolved);
    edges.push(toGraphEdge(item.edge));

    const secondHop = index.outlinks.get(target) ?? [];
    for (const related of secondHop.slice(0, 6)) {
      if (!related.resolved || related.target === center) continue;
      addNode(nodes, related.target, 2, "related");
      edges.push(toGraphEdge(related));
    }
  }

  return { center, nodes: [...nodes.values()], edges };
}

export function buildVaultGraph(index: VaultIndex): NoteGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const note of index.notes) {
    addNode(nodes, note.path, 1, "related");
  }

  for (const [source, outlinks] of index.outlinks) {
    for (const edge of outlinks) {
      if (!edge.resolved || !nodes.has(edge.target)) continue;
      const key = `${source}->${edge.target}`;
      if (!edges.has(key)) {
        edges.set(key, toGraphEdge(edge));
      }
    }
  }

  return { center: "", nodes: [...nodes.values()], edges: [...edges.values()] };
}

function linkToEdge(
  source: string,
  link: ParsedLink,
  noteByPath: Map<string, ParsedNote>,
  byStem: Map<string, ParsedNote[]>
): ParsedLinkEdge {
  const resolvedPath = resolveLink(link, noteByPath, byStem);
  return {
    source,
    target: resolvedPath ?? link.target,
    resolved: Boolean(resolvedPath),
    type: link.type,
    raw: link.raw,
    alias: link.alias,
    heading: link.heading
  };
}

function resolveLink(
  link: ParsedLink,
  noteByPath: Map<string, ParsedNote>,
  byStem: Map<string, ParsedNote[]>
): string | undefined {
  const target = normalizePath(link.target);
  const exact = ensureMarkdownPath(target).toLowerCase();
  const exactMatch = noteByPath.get(exact);
  if (exactMatch) return exactMatch.path;

  const stem = pathStem(target);
  const stemMatches = byStem.get(stem) ?? [];
  return stemMatches.length === 1 ? stemMatches[0].path : undefined;
}

function addNode(
  nodes: Map<string, GraphNode>,
  id: string,
  depth: GraphNode["depth"],
  direction: GraphNode["direction"],
  resolved = true
): void {
  const existing = nodes.get(id);
  if (existing && existing.depth <= depth) {
    if (!existing.resolved && resolved) {
      nodes.set(id, { ...existing, resolved: true });
    }
    return;
  }
  nodes.set(id, { id, label: id.replace(/\.md$/i, "").split("/").pop() ?? id, resolved: existing?.resolved || resolved, depth, direction });
}

function toGraphEdge(edge: ParsedLinkEdge): GraphEdge {
  return {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    resolved: edge.resolved
  };
}
