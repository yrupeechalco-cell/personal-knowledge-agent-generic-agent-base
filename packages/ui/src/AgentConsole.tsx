import type { AgentDiff, AgentMessage } from "@knowledge-agent/agent";
import {
  Focus,
  FolderUp,
  History,
  KeyRound,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  SquarePlus,
  Trash2
} from "lucide-react";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useLocalization, type TranslationValues } from "./localization";

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
  modelCredentialStorage?: "windows-dpapi" | "environment" | "none";
  modelCredentialStatus?: "unchecked" | "valid" | "invalid";
  modelCredentialUpdatedLabel?: string;
  modelCredentialValidatedLabel?: string;
  modelCredentialBusy?: boolean;
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
  onDeleteApiKey?(): void;
  onValidateApiKey?(): void;
  onDock?(): void;
  onFloat?(): void;
  onHide?(): void;
  onFocus?(): void;
  onNewSession?(): void;
  onResetSession?(): void;
  onRestoreSession?(): void;
  onSelectSession?(sessionId: string): void;
  onDeleteSession?(sessionId: string): void;
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
  modelCredentialStorage = "none",
  modelCredentialStatus = "unchecked",
  modelCredentialUpdatedLabel,
  modelCredentialValidatedLabel,
  modelCredentialBusy = false,
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
  onDeleteApiKey,
  onValidateApiKey,
  onDock,
  onFloat,
  onHide,
  onFocus,
  onNewSession,
  onResetSession,
  onRestoreSession,
  onSelectSession,
  onDeleteSession,
  onUploadContext,
  onInputChange,
  onRun,
  onApply
}: AgentConsoleProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const { runtime, t } = useLocalization();
  const visibleModelLabel = localizedModelLabel(modelLabel, t);

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
        modelCredentialBusy,
        modelCredentialStatus,
        modelCredentialStorage,
        modelCredentialUpdatedLabel,
        modelCredentialValidatedLabel,
        modelOptions,
        onAgentModeChange,
        onModelChange,
        onDeleteApiKey,
        onRequestApiKey,
        onToggleSettings,
        onValidateApiKey,
        selectedAgentMode,
        selectedModel,
        t
      })
    : null;

  return (
    <aside className="agent-console">
      <header className="agent-console-header">
        <div className="agent-title-block">
          <h2>{t("笔记智能体")}</h2>
          <p>{t("知识库工作台智能控制器")}</p>
        </div>
        <section className={modelConfigured ? "agent-model ready" : "agent-model"} aria-label={t("模型连接状态")}>
          <div className="agent-model-state">
            <span>{modelConfigured ? t("已连接") : t("离线")}</span>
            <strong>{visibleModelLabel}</strong>
          </div>
          <button
            aria-expanded={settingsOpen}
            aria-label={t("Agent 设置")}
            className="agent-settings-toggle agent-settings-icon"
            disabled={readOnly}
            onClick={onToggleSettings}
            title={t("Agent 设置：模型、推理强度和权限")}
            type="button"
          >
            <SlidersHorizontal className="agent-settings-icon-control" size={15} />
          </button>
          {settingsDialog}
          {!modelConfigured && canConfigureModel ? (
            <p className="agent-model-warning">{t("需要填写本机 DeepSeek API key 后才能使用在线模型。")}</p>
          ) : null}
        </section>
        <div className="agent-panel-controls" aria-label={t("智能体面板布局")}>
          <button aria-label={t("停靠右侧")} onClick={onDock} title={t("停靠右侧")} type="button">
            <PanelRightOpen size={14} />
          </button>
          <button aria-label={t("浮动窗口")} onClick={onFloat} title={t("浮动窗口")} type="button">
            <PictureInPicture2 size={14} />
          </button>
          <button aria-label={t("专注模式")} onClick={onFocus} title={t("专注模式")} type="button">
            <Focus size={14} />
          </button>
          <button aria-label={t("收起智能体")} onClick={onHide} title={t("收起智能体")} type="button">
            <PanelRightClose size={14} />
          </button>
        </div>
      </header>

      <div className="agent-messages" ref={messagesRef}>
        {readOnly ? <article className="agent-message tool">{t("只读磁盘结构模式：Agent 已暂停，不会读取正文、创建草稿或执行本地操作。")}</article> : null}
        {messages.map((message) => (
          <article className={`agent-message ${message.role}${message.status ? ` ${message.status}` : ""}`} key={message.id}>
            {message.role === "tool" || message.status === "thinking" ? runtime(message.content) : message.content}
          </article>
        ))}
      </div>

      <div className="agent-diffs">
        {diffs.map((diff, index) => (
          <section className={`diff-card ${diff.permission}`} key={`${diff.path}-${diff.summary}-${index}`}>
            <h3>{diff.summary}</h3>
            <p>{diff.path}</p>
            <pre>{runtime(diffPreview(diff))}</pre>
            <button disabled={readOnly || diff.permission === "blocked"} onClick={() => onApply(diff)} type="button">
              {diff.permission === "confirm" ? t("确认应用") : diff.permission === "blocked" ? t("已阻止") : t("应用改动")}
            </button>
          </section>
        ))}
      </div>

      <footer>
        <div className="agent-session-bar">
          {sessions.length > 0 ? (
            <div className="agent-session-tabs" aria-label={t("子 Agent 会话")}>
              {sessions.map((session) => (
                <button
                  aria-current={session.id === activeSessionId ? "true" : undefined}
                  aria-label={`${t("切换到子 Agent")} ${session.label}`}
                  className={[session.id === activeSessionId ? "active" : "", session.running ? "running" : ""].filter(Boolean).join(" ")}
                  disabled={readOnly}
                  key={session.id}
                  onClick={() => onSelectSession?.(session.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!readOnly) onDeleteSession?.(session.id);
                  }}
                  title={`${t("子 Agent 会话")} ${session.label}: ${t("左键进入，右键删除")}`}
                  type="button"
                >
                  {session.label}
                  {session.running ? <span aria-hidden="true" className="agent-session-running-dot" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        <div className="agent-footer-tools" aria-label={t("Agent 工具")}>
          <button aria-label={t("新建子智能体")} disabled={readOnly} onClick={onNewSession} title={t("新建子智能体：开启一个独立聊天")} type="button">
            <SquarePlus size={15} />
          </button>
          <button aria-label={t("刷新当前聊天")} disabled={readOnly} onClick={onResetSession} title={t("刷新当前聊天：清空当前 Agent 会话")} type="button">
            <RefreshCw size={14} />
          </button>
          <button
            aria-label={t("回溯最近聊天")}
            disabled={readOnly || !canRestoreSession}
            onClick={onRestoreSession}
            title={t("回溯最近聊天：恢复上一段 Agent 会话和记忆")}
            type="button"
          >
            <History size={14} />
          </button>
        </div>
        </div>
        <textarea
          aria-label={t("智能体输入")}
          disabled={readOnly}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={submitFromKeyboard}
          placeholder={readOnly ? t("只读磁盘结构模式已暂停 Agent") : t("可以总结当前笔记、建议链接、生成目录或整理内容")}
          value={input}
        />
        <button className="agent-send-button" disabled={readOnly || running || input.trim() === ""} onClick={onRun} type="button">
          {running ? t("运行中") : t("发送")}
        </button>
        <div className="agent-status-strip" aria-label={t("模型状态")}>
          <span className="agent-status-model">{t(modelShortLabel ?? shortModelName(visibleModelLabel))}</span>
          <span>
            {t("推理强度")}:
            <strong>{t(formatEffort(reasoningEffort))}</strong>
          </span>
          <span className="agent-context-meter" title={contextUsage ? runtime(contextUsage.label) : t("上下文用量暂不可用")}>
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
  if (/offline/i.test(label)) return "本地";
  return "模型";
}

function localizedModelLabel(
  label: string,
  t: (source: string, values?: TranslationValues) => string
): string {
  return /^offline(?::offline)?$/i.test(label.trim()) ? t("本地离线模式") : label;
}

function formatEffort(effort: "low" | "medium" | "high"): string {
  if (effort === "low") return "低";
  if (effort === "high") return "高";
  return "中";
}

interface SettingsDialogProps {
  agentModeOptions: AgentSelectOption[];
  canConfigureModel: boolean;
  modelConfigured: boolean;
  modelCredentialBusy: boolean;
  modelCredentialStatus: "unchecked" | "valid" | "invalid";
  modelCredentialStorage: "windows-dpapi" | "environment" | "none";
  modelCredentialUpdatedLabel?: string;
  modelCredentialValidatedLabel?: string;
  modelOptions: AgentSelectOption[];
  onAgentModeChange?(mode: string): void;
  onModelChange?(model: string): void;
  onDeleteApiKey?(): void;
  onRequestApiKey?(): void;
  onToggleSettings?(): void;
  onValidateApiKey?(): void;
  selectedAgentMode: string;
  selectedModel: string;
  t(source: string, values?: TranslationValues): string;
}

function renderSettingsDialog({
  agentModeOptions,
  canConfigureModel,
  modelConfigured,
  modelCredentialBusy,
  modelCredentialStatus,
  modelCredentialStorage,
  modelCredentialUpdatedLabel,
  modelCredentialValidatedLabel,
  modelOptions,
  onAgentModeChange,
  onModelChange,
  onDeleteApiKey,
  onRequestApiKey,
  onToggleSettings,
  onValidateApiKey,
  selectedAgentMode,
  selectedModel,
  t
}: SettingsDialogProps) {
  const overlay = (
    <div
      className="agent-settings-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onToggleSettings?.();
      }}
      role="presentation"
    >
      <section aria-label={t("Agent 设置")} aria-modal="true" className="agent-settings-dialog" role="dialog">
        <button aria-label={t("关闭 Agent 设置")} className="agent-settings-close" onClick={onToggleSettings} type="button">
          ×
        </button>
        <header>
          <span>{t("笔记智能体")}</span>
          <h2>{t("Agent 设置")}</h2>
          <p>{t("切换模型、笔记 Agent 模式和本机模型连接。")}</p>
        </header>
        <div className="agent-settings-panel">
          <label>
            <span>{t("模型")}</span>
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
            <span>{t("智能体")}</span>
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
                <span>{t("模型连接")}</span>
                <strong>
                  {modelConfigured
                    ? modelCredentialStorage === "windows-dpapi"
                      ? t("Windows DPAPI 已加密")
                      : modelCredentialStorage === "environment"
                        ? t("由系统环境变量提供")
                        : t("密钥已配置")
                    : t("未配置密钥")}
                </strong>
                {modelCredentialUpdatedLabel ? <small>{t("最近轮换：{time}", { time: modelCredentialUpdatedLabel })}</small> : null}
                {modelCredentialValidatedLabel ? <small>{t("最近验证：{time}", { time: modelCredentialValidatedLabel })}</small> : null}
                {modelConfigured ? (
                  <small className={`agent-key-health ${modelCredentialStatus}`}>
                    <ShieldCheck size={12} />
                    {modelCredentialStatus === "valid"
                      ? t("有效性检查通过")
                      : modelCredentialStatus === "invalid"
                        ? t("密钥已失效")
                        : t("尚未检查有效性")}
                  </small>
                ) : null}
              </div>
              <div className="agent-key-actions">
                <button className="agent-key-button" disabled={modelCredentialBusy} onClick={onRequestApiKey} type="button">
                  <KeyRound size={13} />
                  {modelConfigured ? t("轮换") : t("配置")}
                </button>
                {modelConfigured ? (
                  <button className="agent-key-button" disabled={modelCredentialBusy} onClick={onValidateApiKey} type="button">
                    <ShieldCheck size={13} />
                    {t("验证")}
                  </button>
                ) : null}
                {modelConfigured && modelCredentialStorage !== "environment" ? (
                  <button className="agent-key-button danger" disabled={modelCredentialBusy} onClick={onDeleteApiKey} type="button">
                    <Trash2 size={13} />
                    {t("删除")}
                  </button>
                ) : null}
              </div>
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
  return lines.join("\n") || "没有可见行变化。";
}
