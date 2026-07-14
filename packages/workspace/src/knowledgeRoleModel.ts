import type { ParsedNote, VaultIndex } from "@knowledge-agent/core";

export type KnowledgeDomainKind = "project" | "topic" | "method" | "archive";
export type KnowledgeNoteRole = "question" | "evidence" | "decision" | "output" | "reference";
export type KnowledgeRelationBasis = "explicit-link" | "shared-tag";

export interface KnowledgeContribution {
  path: string;
  title: string;
  role: KnowledgeNoteRole;
  score: number;
  structural: number;
  projectUse: number;
  evidence: number;
  uniqueness: number;
  explanation: string;
}

export interface KnowledgeDomain {
  id: string;
  label: string;
  kind: KnowledgeDomainKind;
  notePaths: string[];
  importance: number;
  confidence: number;
  contributions: KnowledgeContribution[];
}

export interface KnowledgeDomainRelation {
  source: string;
  target: string;
  strength: number;
  basis: KnowledgeRelationBasis;
  evidenceCount: number;
}

export interface KnowledgeNoteRelation {
  source: string;
  target: string;
  basis: KnowledgeRelationBasis;
  confidence: number;
}

export interface KnowledgeRoleModel {
  domains: KnowledgeDomain[];
  domainRelations: KnowledgeDomainRelation[];
  noteRelations: KnowledgeNoteRelation[];
}

const PROJECT_PATTERN = /项目|工程|产品|app|github|发布|版本|计划|路线/i;
const METHOD_PATTERN = /方法|流程|工具|算法|模型|框架|教程|规范/i;
const ARCHIVE_PATTERN = /归档|附件|素材|摘录|clipping|archive|草稿|临时|待整理|收件箱|inbox/i;
const QUESTION_PATTERN = /问题|疑问|挑战|瓶颈|为什么|假设/i;
const EVIDENCE_PATTERN = /证据|实验|数据|研究|论文|文献|资料|验证/i;
const DECISION_PATTERN = /决策|方案|选择|计划|路线|取舍|设计/i;
const OUTPUT_PATTERN = /成果|结论|发布|版本|总结|完成|交付/i;
const AI_PATTERN = /\bai\b|aigc|agent|智能体|大模型|提示词|自动化|deepseek/i;
const THINKING_PATTERN = /思维|理论|定理|哲学|认知|第一性|系统论|意义|原则/i;
const RESEARCH_PATTERN = /读书|阅读|文献|论文|书籍|研究|摘录|实验|数据/i;
const LOG_PATTERN = /日志|日记|复盘|周报|月报|过程记录/i;
const SAFETY_PATTERN = /安全|密码|账号|账户|secret|token|权限|隐私/i;

export function buildKnowledgeRoleModel(index: VaultIndex): KnowledgeRoleModel {
  if (index.notes.length === 0) {
    return { domains: [], domainRelations: [], noteRelations: [] };
  }

  const domainForPath = assignDomains(index.notes);
  const grouped = new Map<string, ParsedNote[]>();
  for (const note of index.notes) {
    const domainId = domainForPath.get(note.path) ?? "未分类";
    grouped.set(domainId, [...(grouped.get(domainId) ?? []), note]);
  }

  const maxDegree = Math.max(
    1,
    ...index.notes.map((note) => (index.backlinks.get(note.path)?.length ?? 0) + (index.outlinks.get(note.path)?.length ?? 0))
  );

  const domains = [...grouped.entries()].map(([id, notes]) => buildDomain(id, notes, index, maxDegree));
  const maxImportance = Math.max(1, ...domains.map((domain) => domain.importance));
  for (const domain of domains) {
    domain.importance = round(domain.importance / maxImportance);
  }

  return {
    domains: domains.sort((a, b) => b.importance - a.importance || a.label.localeCompare(b.label, "zh-CN")),
    domainRelations: buildDomainRelations(index, domainForPath),
    noteRelations: buildNoteRelations(index)
  };
}

function assignDomains(notes: ParsedNote[]): Map<string, string> {
  const tagCount = new Map<string, number>();

  for (const note of notes) {
    for (const tag of note.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const note of notes) {
    const semanticDomain = inferSemanticDomain(note);
    const primaryTag = [...note.tags].sort((a, b) => (tagCount.get(b) ?? 0) - (tagCount.get(a) ?? 0))[0];
    result.set(note.path, semanticDomain || primaryTag || cleanFolderLabel(topLevelFolder(note.path)) || "未分类");
  }
  return result;
}

function buildDomain(id: string, notes: ParsedNote[], index: VaultIndex, maxDegree: number): KnowledgeDomain {
  const contributions = notes
    .map((note) => buildContribution(note, index, maxDegree))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-CN"));
  const linkEvidence = notes.reduce(
    (total, note) => total + (index.backlinks.get(note.path)?.length ?? 0) + (index.outlinks.get(note.path)?.length ?? 0),
    0
  );
  const importance = contributions.reduce((total, contribution) => total + contribution.score, 0) / Math.max(1, Math.sqrt(notes.length));

  return {
    id,
    label: id,
    kind: classifyDomain(id, notes),
    notePaths: notes.map((note) => note.path),
    importance: round(importance),
    confidence: round(Math.min(1, 0.42 + linkEvidence * 0.06 + notes.length * 0.035)),
    contributions
  };
}

function buildContribution(note: ParsedNote, index: VaultIndex, maxDegree: number): KnowledgeContribution {
  const backlinks = index.backlinks.get(note.path)?.length ?? 0;
  const outlinks = index.outlinks.get(note.path)?.length ?? 0;
  const degree = backlinks + outlinks;
  const body = `${note.path}\n${note.title}\n${note.content}`;
  const structural = degree / maxDegree;
  const projectUse = Math.min(1, backlinks / 4 + (PROJECT_PATTERN.test(body) ? 0.35 : 0));
  const evidence = Math.min(1, (EVIDENCE_PATTERN.test(body) ? 0.68 : 0.18) + outlinks * 0.07);
  const uniqueness = Math.min(1, 0.35 + note.tags.length * 0.12 + (note.headings.length > 3 ? 0.18 : 0));
  const score = round(structural * 0.38 + projectUse * 0.27 + evidence * 0.2 + uniqueness * 0.15);
  const role = classifyNoteRole(body);

  return {
    path: note.path,
    title: note.title,
    role,
    score,
    structural: round(structural),
    projectUse: round(projectUse),
    evidence: round(evidence),
    uniqueness: round(uniqueness),
    explanation: contributionExplanation(role, backlinks, outlinks)
  };
}

function buildDomainRelations(index: VaultIndex, domainForPath: Map<string, string>): KnowledgeDomainRelation[] {
  const relations = new Map<string, KnowledgeDomainRelation>();

  for (const edges of index.outlinks.values()) {
    for (const edge of edges) {
      if (!edge.resolved) continue;
      const sourceDomain = domainForPath.get(edge.source);
      const targetDomain = domainForPath.get(edge.target);
      if (!sourceDomain || !targetDomain || sourceDomain === targetDomain) continue;
      const [source, target] = [sourceDomain, targetDomain].sort((a, b) => a.localeCompare(b, "zh-CN"));
      const key = `${source}\u0000${target}`;
      const current = relations.get(key);
      relations.set(key, {
        source,
        target,
        strength: round(Math.min(1, (current?.evidenceCount ?? 0) * 0.14 + 0.28)),
        basis: "explicit-link",
        evidenceCount: (current?.evidenceCount ?? 0) + 1
      });
    }
  }

  return [...relations.values()];
}

function buildNoteRelations(index: VaultIndex): KnowledgeNoteRelation[] {
  const relations: KnowledgeNoteRelation[] = [];
  const seen = new Set<string>();

  for (const edges of index.outlinks.values()) {
    for (const edge of edges) {
      if (!edge.resolved) continue;
      const key = `${edge.source}\u0000${edge.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ source: edge.source, target: edge.target, basis: "explicit-link", confidence: 1 });
    }
  }

  const notes = index.notes;
  for (let sourceIndex = 0; sourceIndex < notes.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < notes.length; targetIndex += 1) {
      const source = notes[sourceIndex];
      const target = notes[targetIndex];
      const sharedTags = source.tags.filter((tag) => target.tags.includes(tag));
      if (sharedTags.length === 0) continue;
      const key = `${source.path}\u0000${target.path}`;
      const reverseKey = `${target.path}\u0000${source.path}`;
      if (seen.has(key) || seen.has(reverseKey)) continue;
      seen.add(key);
      relations.push({
        source: source.path,
        target: target.path,
        basis: "shared-tag",
        confidence: round(Math.min(0.78, 0.42 + sharedTags.length * 0.12))
      });
    }
  }

  return relations;
}

function classifyDomain(id: string, notes: ParsedNote[]): KnowledgeDomainKind {
  if (id === "项目与产品") return "project";
  if (id === "方法与工作流") return "method";
  if (id === "资料与归档" || id === "日志与复盘") return "archive";
  const content = notes.map((note) => `${note.path}\n${note.title}`).join("\n");
  if (PROJECT_PATTERN.test(id) && PROJECT_PATTERN.test(content)) return "project";
  return "topic";
}

function classifyNoteRole(content: string): KnowledgeNoteRole {
  if (EVIDENCE_PATTERN.test(content)) return "evidence";
  if (DECISION_PATTERN.test(content)) return "decision";
  if (QUESTION_PATTERN.test(content)) return "question";
  if (OUTPUT_PATTERN.test(content)) return "output";
  return "reference";
}

function contributionExplanation(role: KnowledgeNoteRole, backlinks: number, outlinks: number): string {
  const roleLabel = {
    question: "定义问题",
    evidence: "提供证据",
    decision: "支撑决策",
    output: "沉淀成果",
    reference: "补充背景"
  }[role];
  if (backlinks > 0) return `${roleLabel}；被 ${backlinks} 篇文档依赖，并连接 ${outlinks} 个依据。`;
  if (outlinks > 0) return `${roleLabel}；连接 ${outlinks} 个已有知识依据。`;
  return `${roleLabel}；当前尚未形成明确的文档依赖。`;
}

function topLevelFolder(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "未分类";
}

function inferSemanticDomain(note: ParsedNote): string | null {
  const content = `${note.path}\n${note.title}\n${note.tags.join(" ")}\n${note.content}`;
  if (SAFETY_PATTERN.test(content)) return "安全与权限";
  if (AI_PATTERN.test(content)) return "AI 与智能体";
  if (PROJECT_PATTERN.test(content)) return "项目与产品";
  if (THINKING_PATTERN.test(content)) return "思维与理论";
  if (METHOD_PATTERN.test(content)) return "方法与工作流";
  if (RESEARCH_PATTERN.test(content)) return "研究与阅读";
  if (LOG_PATTERN.test(content)) return "日志与复盘";
  if (ARCHIVE_PATTERN.test(content)) return "资料与归档";
  return null;
}

function cleanFolderLabel(folder: string): string {
  return folder.replace(/^\d+[\s._-]*/, "").trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
