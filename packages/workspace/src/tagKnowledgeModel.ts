import { buildNoteTagCloud, classifyKnowledgeTag, normalizeTagKey, type KnowledgeTagKind, type VaultIndex } from "@knowledge-agent/core";
import type { KnowledgeContribution, KnowledgeDomain, KnowledgeDomainKind, KnowledgeRoleModel } from "./knowledgeRoleModel";

export type KnowledgeViewDomain = "classification" | "context" | "application" | "source";
export type TagKnowledgeRelationBasis = "co-occurrence" | "explicit-link";

export interface TagKnowledgeNode {
  id: string;
  label: string;
  kind: KnowledgeTagKind;
  weight: number;
  centrality: number;
  application: number;
  documentPaths: string[];
  dominantSource: string;
}

export interface TagKnowledgeRelation {
  source: string;
  target: string;
  strength: number;
  evidenceCount: number;
  basis: TagKnowledgeRelationBasis;
  documentPaths: string[];
}

export interface TagKnowledgeModel {
  nodes: TagKnowledgeNode[];
  relations: TagKnowledgeRelation[];
  sourceCount: number;
}

interface MutableNode {
  id: string;
  label: string;
  kind: KnowledgeTagKind;
  salience: number;
  application: number;
  documentPaths: Set<string>;
  sources: Map<string, number>;
}

interface MutableRelation {
  source: string;
  target: string;
  evidenceCount: number;
  explicitCount: number;
  documentPaths: Set<string>;
}

const APPLICATION_PATTERN = /应用|实践|项目|工程|案例|实现|部署|使用|解决|产品|实验|application|project|practice|implementation/i;
const MAX_TAG_NODES = 84;
const MAX_RELATIONS = 240;

export function buildTagKnowledgeModel(index: VaultIndex): TagKnowledgeModel {
  const nodes = new Map<string, MutableNode>();
  const relations = new Map<string, MutableRelation>();
  const tagsByPath = new Map<string, string[]>();

  for (const note of index.notes) {
    const source = topLevelSource(note.path);
    const cloud = buildNoteTagCloud(note, 5).filter((item) => item.existing);
    const noteTagIds: string[] = [];
    for (const item of cloud) {
      const id = normalizeTagKey(item.name);
      if (!id) continue;
      noteTagIds.push(id);
      const current = nodes.get(id) ?? {
        id,
        label: item.name,
        kind: classifyKnowledgeTag(item.name),
        salience: 0,
        application: 0,
        documentPaths: new Set<string>(),
        sources: new Map<string, number>()
      };
      current.salience += 0.45 + item.weight;
      current.application += APPLICATION_PATTERN.test(`${note.path}\n${note.title}\n${note.content}`) ? 1 : 0;
      current.documentPaths.add(note.path);
      current.sources.set(source, (current.sources.get(source) ?? 0) + 1);
      nodes.set(id, current);
    }

    const uniqueIds = [...new Set(noteTagIds)].slice(0, 18);
    tagsByPath.set(note.path, uniqueIds);
    for (let sourceIndex = 0; sourceIndex < uniqueIds.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < uniqueIds.length; targetIndex += 1) {
        addRelation(relations, uniqueIds[sourceIndex], uniqueIds[targetIndex], note.path, false);
      }
    }
  }

  for (const edges of index.outlinks.values()) {
    for (const edge of edges) {
      if (!edge.resolved) continue;
      const sourceTags = tagsByPath.get(edge.source)?.slice(0, 3) ?? [];
      const targetTags = tagsByPath.get(edge.target)?.slice(0, 3) ?? [];
      for (const sourceTag of sourceTags) {
        for (const targetTag of targetTags) {
          if (sourceTag === targetTag) continue;
          addRelation(relations, sourceTag, targetTag, `${edge.source} → ${edge.target}`, true);
        }
      }
    }
  }

  const rankedMutableNodes = [...nodes.values()]
    .sort((a, b) => nodeRawWeight(b) - nodeRawWeight(a) || a.label.localeCompare(b.label, "zh-CN"))
    .slice(0, MAX_TAG_NODES);
  const visibleIds = new Set(rankedMutableNodes.map((node) => node.id));
  const visibleRelations = [...relations.values()]
    .filter((relation) => visibleIds.has(relation.source) && visibleIds.has(relation.target))
    .sort((a, b) => relationRawWeight(b) - relationRawWeight(a))
    .slice(0, MAX_RELATIONS);
  const maxNodeWeight = Math.max(1, ...rankedMutableNodes.map(nodeRawWeight));
  const maxApplication = Math.max(1, ...rankedMutableNodes.map((node) => node.application));
  const maxRelationWeight = Math.max(1, ...visibleRelations.map(relationRawWeight));
  const degree = new Map<string, number>();
  for (const relation of visibleRelations) {
    degree.set(relation.source, (degree.get(relation.source) ?? 0) + relationRawWeight(relation));
    degree.set(relation.target, (degree.get(relation.target) ?? 0) + relationRawWeight(relation));
  }
  const maxDegree = Math.max(1, ...degree.values());

  return {
    nodes: rankedMutableNodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      weight: round(nodeRawWeight(node) / maxNodeWeight),
      centrality: round((degree.get(node.id) ?? 0) / maxDegree),
      application: round(node.application / maxApplication),
      documentPaths: [...node.documentPaths].sort((a, b) => a.localeCompare(b, "zh-CN")),
      dominantSource: dominantSource(node.sources)
    })),
    relations: visibleRelations.map((relation) => ({
      source: relation.source,
      target: relation.target,
      strength: round(relationRawWeight(relation) / maxRelationWeight),
      evidenceCount: relation.evidenceCount,
      basis: relation.explicitCount > 0 ? "explicit-link" : "co-occurrence",
      documentPaths: [...relation.documentPaths]
    })),
    sourceCount: new Set(index.notes.map((note) => topLevelSource(note.path))).size
  };
}

export function domainNodeWeight(node: TagKnowledgeNode, domain: KnowledgeViewDomain): number {
  if (domain === "context") return round(node.weight * 0.42 + node.centrality * 0.58);
  if (domain === "application") return round(node.weight * 0.35 + node.application * 0.65);
  if (domain === "source") return round(Math.min(1, 0.25 + Math.sqrt(node.documentPaths.length) * 0.24));
  return node.weight;
}

export function globalNodeScale(node: TagKnowledgeNode): number {
  return round(0.88 + Math.sqrt(Math.max(0, Math.min(1, node.weight))) * 0.28);
}

export function relationLineOpacity(strength: number): number {
  return round(0.05 + Math.max(0, Math.min(1, strength)) * 0.2);
}

export function buildTagRootDomain(node: TagKnowledgeNode, roleModel: KnowledgeRoleModel): KnowledgeDomain {
  const paths = new Set(node.documentPaths);
  const contributions = new Map<string, KnowledgeContribution>();
  for (const domain of roleModel.domains) {
    for (const contribution of domain.contributions) {
      if (!paths.has(contribution.path)) continue;
      const current = contributions.get(contribution.path);
      if (!current || contribution.score > current.score) contributions.set(contribution.path, contribution);
    }
  }
  return {
    id: `tag:${node.id}`,
    label: node.label,
    kind: tagKindToDomainKind(node.kind),
    notePaths: [...node.documentPaths],
    importance: node.weight,
    confidence: round(Math.min(1, 0.45 + node.centrality * 0.42 + Math.min(0.13, node.documentPaths.length * 0.02))),
    contributions: [...contributions.values()].sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
  };
}

function tagKindToDomainKind(kind: KnowledgeTagKind): KnowledgeDomainKind {
  if (kind === "method") return "method";
  if (kind === "evidence") return "archive";
  if (kind === "entity") return "project";
  return "topic";
}

function addRelation(relations: Map<string, MutableRelation>, rawSource: string, rawTarget: string, evidence: string, explicit: boolean) {
  const [source, target] = [rawSource, rawTarget].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const key = `${source}\u0000${target}`;
  const current = relations.get(key) ?? {
    source,
    target,
    evidenceCount: 0,
    explicitCount: 0,
    documentPaths: new Set<string>()
  };
  current.evidenceCount += 1;
  if (explicit) current.explicitCount += 1;
  current.documentPaths.add(evidence);
  relations.set(key, current);
}

function nodeRawWeight(node: MutableNode): number {
  return node.salience + Math.sqrt(node.documentPaths.size) * 1.4;
}

function relationRawWeight(relation: MutableRelation): number {
  return relation.evidenceCount + relation.explicitCount * 1.6;
}

function dominantSource(sources: Map<string, number>): string {
  return [...sources.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))[0]?.[0] ?? "根目录";
}

function topLevelSource(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0].replace(/^\d+[\s._-]*/, "") : "根目录";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
