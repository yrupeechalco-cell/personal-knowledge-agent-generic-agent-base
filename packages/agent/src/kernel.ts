import { buildSafetyManifest, getNote } from "@knowledge-agent/core";
import { classifyEdit, permissionRank } from "./permissions";
import { OfflineModelProvider } from "./provider";
import { builtInTools } from "./tools";
import type { AgentContext, AgentDiff, AgentMessage, AgentResult, AgentTool, ModelProvider, ModelToolDefinition } from "./types";

const SYSTEM_PROMPT = `You are a focused knowledge-base Agent. You operate through safe, explicit app tools. In the desktop app, controlled local-file tools may create folders, read safe Markdown notes, write notes, move deleted notes to the app trash, and create simple Word documents on the user's Desktop. Do not request broad shell or unrestricted computer-control access; use only the app's explicit file capabilities.`;

export class NoteAgentKernel {
  private readonly tools: Map<string, AgentTool>;
  private readonly provider: ModelProvider;

  constructor(options?: { provider?: ModelProvider; tools?: AgentTool[] }) {
    this.provider = options?.provider ?? new OfflineModelProvider();
    this.tools = new Map([...builtInTools, ...(options?.tools ?? [])].map((tool) => [tool.name, tool]));
  }

  async run(input: string, context: AgentContext): Promise<AgentResult> {
    const normalized = input.trim();
    const toolCalls: string[] = [];
    const diffs: AgentDiff[] = [];
    let content = "";

    if (shouldRunLocalShortcut(this.provider, normalized, "summarize")) {
      content = await this.callTool("summarize_note", "", context, toolCalls);
    } else if (shouldRunLocalShortcut(this.provider, normalized, "links")) {
      content = await this.callTool("suggest_links", "", context, toolCalls);
    } else if (shouldRunLocalShortcut(this.provider, normalized, "graph")) {
      content = await this.callTool("build_graph", "", context, toolCalls);
    } else if (shouldRunLocalShortcut(this.provider, normalized, "moc")) {
      const moc = await this.callTool("create_moc", "", context, toolCalls);
      content = "已生成 MOC 提案。";
      diffs.push(this.proposeNoteAppend(context, `\n\n${moc}\n`, "Append generated MOC section"));
    } else if (shouldRunLocalShortcut(this.provider, normalized, "organize")) {
      const diff = this.organizeCurrentNote(context);
      content = diff ? "已生成当前笔记整理提案。" : "当前笔记不存在，无法整理。";
      if (diff) diffs.push(diff);
    } else if (this.provider.generateTurn) {
      content = await this.runToolLoop(normalized, context, toolCalls);
    } else {
      content = await this.provider.generate({
        system: buildSystemPrompt(context),
        messages: buildConversationMessages(normalized, context.messages),
        model: "deepseek-v4-pro",
        thinking: true,
        reasoningEffort: "high"
      });
    }

    const changedPaths = diffs.map((diff) => diff.path);
    const safetyManifest = changedPaths.length > 0 ? buildSafetyManifest(changedPaths) : undefined;
    const blockedBySafety = safetyManifest?.excluded.map((decision) => decision.path) ?? [];

    for (const diff of diffs) {
      if (blockedBySafety.includes(diff.path) && permissionRank(diff.permission) < permissionRank("blocked")) {
        diff.permission = "blocked";
        diff.reason = "blocked by sync safety manifest";
      }
    }

    return {
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        createdAt: new Date().toISOString()
      },
      diffs,
      safetyManifest,
      toolCalls
    };
  }

  private async runToolLoop(input: string, context: AgentContext, toolCalls: string[]): Promise<string> {
    const tools = [...this.tools.values()]
      .filter((tool) => tool.parameters)
      .map(
        (tool): ModelToolDefinition => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} }
        })
      );
    const messages = buildConversationMessages(input, context.messages);

    for (let turn = 0; turn < 6; turn += 1) {
      const response = await this.provider.generateTurn!({
        system: buildSystemPrompt(context),
        messages,
        tools,
        model: "deepseek-v4-pro",
        thinking: true,
        reasoningEffort: "high"
      });
      if (response.toolCalls.length === 0) {
        return response.content || "操作已完成。";
      }

      messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.content,
        createdAt: new Date().toISOString(),
        reasoningContent: response.reasoningContent,
        toolCalls: response.toolCalls
      });

      for (const call of response.toolCalls) {
        const result = await this.callTool(call.name, call.arguments, context, toolCalls);
        messages.push({
          id: crypto.randomUUID(),
          role: "tool",
          content: result,
          createdAt: new Date().toISOString(),
          toolCallId: call.id
        });
      }
    }

    return "工具调用已达到本轮上限，请把任务拆成更小的步骤后重试。";
  }

  private async callTool(name: string, input: string, context: AgentContext, toolCalls: string[]): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Tool not found: ${name}`;
    toolCalls.push(name);
    return tool.run(input, context);
  }

  private proposeNoteAppend(context: AgentContext, append: string, summary: string): AgentDiff {
    const current = getNote(context.index, context.currentPath);
    const before = current?.content ?? "";
    const after = `${before.trimEnd()}${append}`;
    return {
      path: context.currentPath,
      before,
      after,
      summary,
      ...classifyEdit(before, after, context.currentPath)
    };
  }

  private organizeCurrentNote(context: AgentContext): AgentDiff | undefined {
    const current = getNote(context.index, context.currentPath);
    if (!current) return undefined;
    const hasTitle = /^#\s+/m.test(current.content);
    const hasLinksSection = /##\s+相关链接/m.test(current.content);
    const related = (context.index.outlinks.get(current.path) ?? []).map((edge) => `- [[${edge.target.replace(/\.md$/i, "")}]]`);
    const sections = [
      hasTitle ? current.content.trim() : `# ${current.title}\n\n${current.content.trim()}`,
      !hasLinksSection && related.length > 0 ? `\n\n## 相关链接\n${related.join("\n")}` : ""
    ];
    const after = sections.join("").trimEnd() + "\n";
    return {
      path: current.path,
      before: current.content,
      after,
      summary: "Normalize title and add a related-links section",
      ...classifyEdit(current.content, after, current.path)
    };
  }
}

function shouldRunLocalShortcut(provider: ModelProvider, input: string, command: string): boolean {
  if (provider.generateTurn) return input.trim().toLowerCase() === `/${command}`;
  return isCommand(input, command);
}

function isCommand(input: string, command: string): boolean {
  const lowered = input.toLowerCase();
  return lowered === `/${command}` || lowered.includes(command) || lowered.includes(commandZh(command));
}

function commandZh(command: string): string {
  return (
    {
      summarize: "总结",
      links: "链接",
      graph: "图谱",
      moc: "moc",
      organize: "整理"
    } as Record<string, string>
  )[command];
}

function buildSystemPrompt(context: AgentContext): string {
  const current = getNote(context.index, context.currentPath);
  const outlinks = (context.index.outlinks.get(context.currentPath) ?? [])
    .slice(0, 12)
    .map((edge) => `${edge.target}${edge.resolved ? "" : " (unresolved)"}`)
    .join(", ");
  const backlinks = (context.index.backlinks.get(context.currentPath) ?? [])
    .slice(0, 12)
    .map((edge) => edge.source)
    .join(", ");
  const nearbyNotes = context.index.notes
    .filter((note) => note.path !== context.currentPath)
    .slice(0, 32)
    .map((note) => `- ${note.path}: ${note.title}`)
    .join("\n");
  const pinnedNotes = [...new Set(context.pinnedPaths ?? [])]
    .map((path) => getNote(context.index, path))
    .filter((note): note is NonNullable<typeof note> => Boolean(note))
    .slice(0, 6)
    .map((note) => `Pinned note: ${note.path}\n${truncateForModel(note.content, 2200)}`)
    .join("\n\n");

  return `${SYSTEM_PROMPT}

You are embedded inside a local-first personal knowledge-base app.
You must not claim that desktop local-file operations are impossible. When edits are needed, explain whether the app can perform them directly through a controlled tool or whether it must show a diff/confirmation first.
Prefer Chinese answers when the user writes Chinese.

Current note:
Path: ${context.currentPath || "(none)"}
Title: ${current?.title ?? "(none)"}
Outlinks: ${outlinks || "(none)"}
Backlinks: ${backlinks || "(none)"}

Current note content:
${truncateForModel(current?.content ?? "(no current note)", 7000)}

Vault overview:
${nearbyNotes || "(no other notes)"}

Pinned Agent context:
${pinnedNotes || "(none)"}`;
}

function truncateForModel(content: string, limit: number) {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n\n[truncated ${content.length - limit} chars]`;
}

function buildConversationMessages(input: string, messages: AgentMessage[] | undefined): AgentMessage[] {
  const history = (messages ?? [])
    .filter((message) => message.status !== "thinking")
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12);
  const last = history.at(-1);
  if (last?.role === "user" && last.content.trim() === input.trim()) {
    return history;
  }
  return [
    ...history,
    {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      createdAt: new Date().toISOString()
    }
  ];
}
