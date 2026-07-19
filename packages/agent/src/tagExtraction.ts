import { buildNoteTagCloud, normalizeTagKey, tagTargetCount, type ParsedNote, type TagGranularity } from "@knowledge-agent/core";
import type { ModelRequest } from "./types";

interface ExtractedTagPayload {
  tags?: Array<string | { name?: string; label?: string }>;
}

export function buildTagExtractionRequest(note: ParsedNote, granularity: TagGranularity, model: string): ModelRequest {
  const target = tagTargetCount(granularity, note.content.length);
  const localCandidates = buildNoteTagCloud(note, 5)
    .slice(0, Math.max(target * 2, 18))
    .map((item) => item.name);
  return {
    system: `You are the classification engine inside a local-first knowledge storage app.
Extract reusable knowledge labels from one document. Labels become both editable tags and nodes in a knowledge map.
Return JSON only in this exact shape: {"tags":[{"name":"标签"}]}.
Prefer concrete concepts, methods, entities, evidence types, and named topics. Avoid generic words such as 内容, 问题, 方法, 资料, 结果.
Keep labels concise, merge synonyms, do not invent facts that are absent from the document, and preserve useful existing tags.
Target about ${target} labels. Granularity is ${granularity}/5, where 1 is broad overview and 5 includes detailed terminology.`,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        createdAt: new Date().toISOString(),
        content: `Path: ${note.path}\nTitle: ${note.title}\nExisting tags: ${note.tags.join(", ") || "(none)"}\nLocal candidates: ${localCandidates.join(", ") || "(none)"}\n\nDocument:\n${truncate(note.content, 28_000)}`
      }
    ],
    model,
    thinking: true,
    reasoningEffort: granularity >= 4 ? "high" : "medium"
  };
}

export function parseExtractedTags(response: string, note: ParsedNote, granularity: TagGranularity): string[] {
  const fallback = localExtractedTags(note, granularity);
  const json = extractJson(response);
  if (!json) return fallback;
  try {
    const payload = JSON.parse(json) as ExtractedTagPayload;
    const extracted = (payload.tags ?? [])
      .map((item) => (typeof item === "string" ? item : item.name ?? item.label ?? ""))
      .map(cleanTag)
      .filter(Boolean);
    return mergeTags(note.tags, extracted, tagTargetCount(granularity, note.content.length));
  } catch {
    return fallback;
  }
}

export function localExtractedTags(note: ParsedNote, granularity: TagGranularity): string[] {
  return mergeTags(note.tags, buildNoteTagCloud(note, granularity).map((item) => item.name), tagTargetCount(granularity, note.content.length));
}

function mergeTags(existing: string[], extracted: string[], target: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...existing, ...extracted]) {
    const tag = cleanTag(raw);
    const key = normalizeTagKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, Math.max(existing.length, target));
}

function cleanTag(value: string): string {
  return value.trim().replace(/^#+/, "").replace(/[\r\n,[\]{}]/g, "").slice(0, 64);
}

function extractJson(value: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value)?.[1];
  const source = fenced ?? value;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  return start >= 0 && end > start ? source.slice(start, end + 1) : null;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[truncated]`;
}
