import type { NoteFile, SafetyManifest, VaultIndex } from "@knowledge-agent/core";

export type AgentPermission = "auto" | "confirm" | "blocked";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  status?: "thinking";
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
  reasoningContent?: string;
}

export interface AgentContext {
  currentPath: string;
  files: NoteFile[];
  index: VaultIndex;
  messages?: AgentMessage[];
  pinnedPaths?: string[];
}

export interface AgentDiff {
  path: string;
  before: string;
  after: string;
  summary: string;
  permission: AgentPermission;
  reason: string;
}

export interface AgentResult {
  message: AgentMessage;
  diffs: AgentDiff[];
  safetyManifest?: SafetyManifest;
  toolCalls: string[];
}

export interface ModelRequest {
  system: string;
  messages: AgentMessage[];
  model?: string;
  thinking?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
  tools?: ModelToolDefinition[];
}

export interface ModelProvider {
  name: string;
  generate(request: ModelRequest): Promise<string>;
  generateTurn?(request: ModelRequest): Promise<ModelTurnResponse>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  run(input: string, context: AgentContext): Promise<string> | string;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelTurnResponse {
  content: string;
  reasoningContent?: string;
  toolCalls: ModelToolCall[];
}
