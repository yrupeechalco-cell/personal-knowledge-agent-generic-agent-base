import { buildNoteGraph, buildSafetyManifest, getNote, noteTitleFromPath } from "@knowledge-agent/core";
import type { AgentTool } from "./types";

export const builtInTools: AgentTool[] = [
  {
    name: "search_notes",
    description: "Search note titles and content.",
    parameters: toolSchema({ query: { type: "string", description: "Search text." } }, ["query"]),
    run(input, context) {
      const query = toolString(input, "query").toLowerCase();
      return context.index.notes
        .filter((note) => note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query))
        .slice(0, 8)
        .map((note) => `- ${note.path}: ${note.excerpt}`)
        .join("\n");
    }
  },
  {
    name: "read_note",
    description: "Read the current note or a specific path.",
    parameters: toolSchema({ path: { type: "string", description: "Vault-relative note path. Empty means the current note." } }),
    run(input, context) {
      const path = toolString(input, "path") || context.currentPath;
      return getNote(context.index, path)?.content ?? `Note not found: ${path}`;
    }
  },
  {
    name: "list_backlinks",
    description: "List backlinks for the current note.",
    parameters: toolSchema({ path: { type: "string", description: "Vault-relative note path. Empty means the current note." } }),
    run(input, context) {
      const path = toolString(input, "path") || context.currentPath;
      return (context.index.backlinks.get(path) ?? [])
        .map((edge) => `- ${edge.source} -> ${edge.target}`)
        .join("\n") || "No backlinks.";
    }
  },
  {
    name: "list_outlinks",
    description: "List outlinks for the current note.",
    parameters: toolSchema({ path: { type: "string", description: "Vault-relative note path. Empty means the current note." } }),
    run(input, context) {
      const path = toolString(input, "path") || context.currentPath;
      return (context.index.outlinks.get(path) ?? [])
        .map((edge) => `- ${edge.source} -> ${edge.target}${edge.resolved ? "" : " (unresolved)"}`)
        .join("\n") || "No outlinks.";
    }
  },
  {
    name: "build_graph",
    description: "Return current-note graph JSON for model analysis only. Do not use this to show the App graph UI or to generate test documents.",
    parameters: toolSchema({ path: { type: "string", description: "Vault-relative note path. Empty means the current note." } }),
    run(input, context) {
      return JSON.stringify(buildNoteGraph(context.index, toolString(input, "path") || context.currentPath), null, 2);
    }
  },
  {
    name: "suggest_links",
    description: "Suggest related links for the current note.",
    parameters: toolSchema({}),
    run(_input, context) {
      const current = getNote(context.index, context.currentPath);
      if (!current) return "No current note.";
      const words = new Set(current.content.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
      return context.index.notes
        .filter((note) => note.path !== current.path)
        .map((note) => ({
          note,
          score: [...words].filter((word) => note.content.toLowerCase().includes(word) || note.title.toLowerCase().includes(word)).length
        }))
        .filter((item) => item.score > 1)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((item) => `- [[${item.note.path.replace(/\.md$/i, "")}|${item.note.title}]] score=${item.score}`)
        .join("\n") || "No strong link suggestions.";
    }
  },
  {
    name: "summarize_note",
    description: "Summarize the current note locally.",
    parameters: toolSchema({}),
    run(_input, context) {
      const current = getNote(context.index, context.currentPath);
      if (!current) return "No current note.";
      const backlinks = context.index.backlinks.get(current.path)?.length ?? 0;
      const outlinks = context.index.outlinks.get(current.path)?.length ?? 0;
      return `《${current.title}》包含 ${current.content.length} 个字符，${outlinks} 个出链，${backlinks} 个反链。摘要：${current.excerpt || "内容较短，暂无摘要。"}`;
    }
  },
  {
    name: "create_moc",
    description: "Create a simple map-of-content outline from related notes.",
    parameters: toolSchema({}),
    run(_input, context) {
      const current = getNote(context.index, context.currentPath);
      if (!current) return "No current note.";
      const related = [
        ...(context.index.outlinks.get(current.path) ?? []).map((edge) => edge.target),
        ...(context.index.backlinks.get(current.path) ?? []).map((edge) => edge.source)
      ];
      return [`# ${current.title} MOC`, "", ...[...new Set(related)].map((path) => `- [[${path.replace(/\.md$/i, "")}|${noteTitleFromPath(path)}]]`)].join("\n");
    }
  },
  {
    name: "git_status",
    description: "Build a safety manifest for changed paths before Git operations.",
    run(input, _context) {
      const paths = input
        .split(/\r?\n|,/)
        .map((path) => path.trim())
        .filter(Boolean);
      return JSON.stringify(buildSafetyManifest(paths), null, 2);
    }
  }
];

function toolSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function toolString(input: string, key: string): string {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    return typeof parsed[key] === "string" ? parsed[key].trim() : "";
  } catch {
    return input.trim();
  }
}
