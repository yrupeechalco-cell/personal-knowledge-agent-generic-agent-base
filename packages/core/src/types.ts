export type LinkType = "wikilink" | "embed" | "markdown";

export interface NoteFile {
  path: string;
  content: string;
  modifiedAt?: string;
}

export interface ParsedLink {
  type: LinkType;
  raw: string;
  target: string;
  alias?: string;
  heading?: string;
  resolvedPath?: string;
}

export interface ParsedNote extends NoteFile {
  title: string;
  frontmatter: Record<string, string | string[] | boolean | number>;
  tags: string[];
  links: ParsedLink[];
  headings: string[];
  excerpt: string;
}

export interface VaultIndex {
  notes: ParsedNote[];
  noteByPath: Map<string, ParsedNote>;
  backlinks: Map<string, ParsedLinkEdge[]>;
  outlinks: Map<string, ParsedLinkEdge[]>;
  unresolvedLinks: ParsedLinkEdge[];
}

export interface ParsedLinkEdge {
  source: string;
  target: string;
  resolved: boolean;
  type: LinkType;
  raw: string;
  alias?: string;
  heading?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  resolved: boolean;
  depth: 0 | 1 | 2;
  direction: "center" | "out" | "back" | "related";
}

export interface GraphEdge {
  source: string;
  target: string;
  type: LinkType;
  resolved: boolean;
}

export interface NoteGraph {
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SafetyDecision {
  path: string;
  allowed: boolean;
  reason: string;
}

export interface SafetyManifest {
  allowed: SafetyDecision[];
  excluded: SafetyDecision[];
}
