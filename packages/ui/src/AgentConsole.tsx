import type { AgentDiff, AgentMessage } from "@knowledge-agent/agent";
import { FolderUp, History, RefreshCw, SlidersHorizontal, SquarePlus } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface AgentSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentConsoleProps {
  sessions?: AgentSessionTab[];
  activeSessionId?: string;
  messages: AgentMessage[];
  diffs: AgentDiff[];
  input: string;
  running: boolean;
  readOnly?: boolean;
  modelLabel?: string;
  modelShortLabel?: string;
  reasoningEffort?: "low" | "medium" | "high";
  contextUsage?: AgentContextUsage;
  canRestoreSession?: boolean;
  contextUploadLabel?: string;
  modelConfigured?: boolean;
  canConfigureModel?: boolean;
  settingsOpen?: boolean;
  selectedModel?: string;
  selectedAgentMode?: string;
  modelOptions?: AgentSelectOption[];
  agentModeOptions?: AgentSelectOption[];
  onToggleSettings?(): void;
  onModelChange?(model: string): void;
  onAgentModeChange?(mode: string): void;
  onRequestApiKey?(): void;
  onNewSession?(): void;
  onResetSession?(): void;
  onRestoreSession?(): void;
  onSelectSession?(sessionId: string): void;
  onUploadContext?(): void;
  onInputChange(input: string): void;
  onRun(): void;
  onApply(diff: AgentDiff): void;
}

export interface AgentSessionTab {
  id: string;
  label: string;
  running?: boolean;
}

export interface AgentContextUsage {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  label: string;
}

export function AgentConsole({
  sessions = [],
  activeSessionId,
  messages,
  diffs,
  input,
  running,
  readOnly = false,
  modelLabel = "offline",
  modelShortLabel,
  reasoningEffort = "medium",
  contextUsage,
  canRestoreSession = false,
  contextUploadLabel = "添加当前笔记到 Agent 上下文",
  modelConfigured = false,
  canConfigureModel = false,
  settingsOpen = false,
  selectedModel = "",
  selectedAgentMode = "",
  modelOptions = [],
  agentModeOptions = [],
  onToggleSettings,
  onModelChange,
  onAgentModeChange,
  onRequestApiKey,
  onNewSession,
  onResetSession,
  onRestoreSession,
  onSelectSession,
  onUploadContext,
  onInputChange,
  onRun,
  onApply
}: AgentConsoleProps) {
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, diffs, running]);

  function submitFromKeyboard(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      readOnly ||
      running ||
      input.trim() === ""
    ) {
      return;
    }
    event.preventDefault();
    onRun();
  }

  const settingsDialog = settingsOpen
    ? renderSettingsDialog({
        agentModeOptions,
        canConfigureModel,
        modelConfigured,
        modelOptions,
        onAgentModeChange,
        onModelChange,
        onRequestApiKey,
        onToggleSettings,
        selectedAgentMode,
        selectedModel
      })
    : null;

  return (
    <aside className="agent-console">
      <header className="agent-console-header">
        <div className="agent-title-block">
          <h2>Note Agent</h2>
          <p>GenericAgent-inspired workspace controller</p>
        </div>
        <section className={modelConfigured ? "agent-model ready" : "agent-model"} aria-label="模型连接状态">
          <div className="agent-model-state">
            <span>{modelConfigured ? "Connected" : "Offline"}</span>
            <strong>{modelLabel}</strong>
          </div>
          <button
            aria-expanded={settingsOpen}
            aria-label="Agent 设置"
            className="agent-settings-toggle agent-settings-icon"
            disabled={readOnly}
            onClick={onToggleSettings}
            title="Agent 设置：模型、推理强度和权限"
            type="button"
          >
            <SlidersHorizontal className="agent-settings-icon-control" size={15} />
          </button>
          {settingsDialog}
          {!modelConfigured && canConfigureModel ? (
            <p className="agent-model-warning">需要填写本机 DeepSeek API key 后才能使用在线模型。</p>
          ) : null}
        </section>
      </header>

      <div className="agent-messages" ref={messagesRef}>
        {readOnly ? <article className="agent-message tool">只读磁盘结构模式：Agent 已暂停，不会读取正文、创建草稿或执行本地操作。</article> : null}
        {messages.map((message) => (
          <article className={`agent-message ${message.role}${message.status ? ` ${message.status}` : ""}`} key={message.id}>
            {message.content}
          </article>
        ))}
      </div>

      <div className="agent-diffs">
        {diffs.map((diff, index) => (
          <section className={`diff-card ${diff.permission}`} key={`${diff.path}-${diff.summary}-${index}`}>
            <h3>{diff.summary}</h3>
            <p>{diff.path}</p>
            <pre>{diffPreview(diff)}</pre>
            <button disabled={readOnly || diff.permission === "blocked"} onClick={() => onApply(diff)} type="button">
              {diff.permission === "confirm" ? "Confirm apply" : diff.permission === "blocked" ? "Blocked" : "Apply"}
            </button>
          </section>
        ))}
      </div>

      <footer>
        <div className="agent-session-bar">
          {sessions.length > 0 ? (
            <div className="agent-session-tabs" aria-label="子 Agent 会话">
              {sessions.map((session) => (
                <button
                  aria-current={session.id === activeSessionId ? "true" : undefined}
                  aria-label={`切换到子 Agent ${session.label}`}
                  className={[session.id === activeSessionId ? "active" : "", session.running ? "running" : ""].filter(Boolean).join(" ")}
                  disabled={readOnly}
                  key={session.id}
                  onClick={() => onSelectSession?.(session.id)}
                  title={`子 Agent ${session.label}`}
                  type="button"
                >
                  {session.label}
                  {session.running ? <span aria-hidden="true" className="agent-session-running-dot" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        <div className="agent-footer-tools" aria-label="Agent 工具">
          <button aria-label="新建子智能体" disabled={readOnly} onClick={onNewSession} title="新建子智能体：开启一个独立聊天" type="button">
            <SquarePlus size={15} />
          </button>
          <button aria-label="刷新当前聊天" disabled={readOnly} onClick={onResetSession} title="刷新当前聊天：清空当前 Agent 会话" type="button">
            <RefreshCw size={14} />
          </button>
          <button
            aria-label="回溯最近聊天"
            disabled={readOnly || !canRestoreSession}
            onClick={onRestoreSession}
            title="回溯最近聊天：恢复上一段 Agent 会话和记忆"
            type="button"
          >
            <History size={14} />
          </button>
        </div>
        </div>
        <textarea
          aria-label="Agent prompt"
          disabled={readOnly}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={submitFromKeyboard}
          placeholder={readOnly ? "只读磁盘结构模式已暂停 Agent" : "Try: summarize current note / suggest links / generate MOC / organize current note"}
          value={input}
        />
        <button className="agent-send-button" disabled={readOnly || running || input.trim() === ""} onClick={onRun} type="button">
          {running ? "Running" : "Send"}
        </button>
        <div className="agent-status-strip" aria-label="模型状态">
          <span className="agent-status-model">{modelShortLabel ?? shortModelName(modelLabel)}</span>
          <span>
            Effort:
            <strong>{formatEffort(reasoningEffort)}</strong>
          </span>
          <span className="agent-context-meter" title={contextUsage?.label ?? "Context usage unavailable"}>
            <i style={{ "--context-percent": `${contextUsage?.percent ?? 0}%` } as CSSProperties} />
            <strong>{contextUsage?.percent ?? 0}%</strong>
          </span>
          <button className="agent-context-upload" disabled={readOnly} onClick={onUploadContext} title={contextUploadLabel} type="button">
            <FolderUp size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function shortModelName(label: string): string {
  if (/flash/i.test(label)) return "Flash";
  if (/pro/i.test(label)) return "Pro";
  if (/offline/i.test(label)) return "Local";
  return "Model";
}

function formatEffort(effort: "low" | "medium" | "high"): string {
  return effort[0].toUpperCase() + effort.slice(1);
}

interface SettingsDialogProps {
  agentModeOptions: AgentSelectOption[];
  canConfigureModel: boolean;
  modelConfigured: boolean;
  modelOptions: AgentSelectOption[];
  onAgentModeChange?(mode: string): void;
  onModelChange?(model: string): void;
  onRequestApiKey?(): void;
  onToggleSettings?(): void;
  selectedAgentMode: string;
  selectedModel: string;
}

function renderSettingsDialog({
  agentModeOptions,
  canConfigureModel,
  modelConfigured,
  modelOptions,
  onAgentModeChange,
  onModelChange,
  onRequestApiKey,
  onToggleSettings,
  selectedAgentMode,
  selectedModel
}: SettingsDialogProps) {
  const overlay = (
    <div
      className="agent-settings-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onToggleSettings?.();
      }}
      role="presentation"
    >
      <section aria-label="Agent 设置" aria-modal="true" className="agent-settings-dialog" role="dialog">
        <button aria-label="关闭 Agent 设置" className="agent-settings-close" onClick={onToggleSettings} type="button">
          ×
        </button>
        <header>
          <span>Note Agent</span>
          <h2>Agent 设置</h2>
          <p>切换模型、笔记 Agent 模式和本机模型连接。</p>
        </header>
        <div className="agent-settings-panel">
          <label>
            <span>模型</span>
            <select
              aria-label="Agent model"
              disabled={modelOptions.length === 0}
              onChange={(event) => onModelChange?.(event.target.value)}
              value={selectedModel}
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Agent</span>
            <select
              aria-label="Agent mode"
              disabled={agentModeOptions.length === 0}
              onChange={(event) => onAgentModeChange?.(event.target.value)}
              value={selectedAgentMode}
            >
              {agentModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p>{agentModeOptions.find((option) => option.value === selectedAgentMode)?.description}</p>
          {canConfigureModel ? (
            <div className={modelConfigured ? "agent-connection-card ready" : "agent-connection-card"}>
              <div>
                <span>模型连接</span>
                <strong>{modelConfigured ? "本机密钥已保存" : "未配置密钥"}</strong>
              </div>
              <button className="agent-key-button" onClick={onRequestApiKey} type="button">
                配置
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}

function diffPreview(diff: AgentDiff): string {
  const before = diff.before.split(/\r?\n/);
  const after = diff.after.split(/\r?\n/);
  const lines: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if ((before[index] ?? "") === (after[index] ?? "")) continue;
    if (before[index]) lines.push(`- ${before[index]}`);
    if (after[index]) lines.push(`+ ${after[index]}`);
    if (lines.length > 12) break;
  }
  return lines.join("\n") || "No visible line changes.";
}
