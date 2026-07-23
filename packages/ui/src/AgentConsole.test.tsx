/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConsole } from "./AgentConsole";
import { LanguageProvider } from "./localization";

afterEach(() => cleanup());

describe("AgentConsole", () => {
  it("submits with Enter and keeps Shift+Enter available for multiline input", () => {
    const onRun = vi.fn();

    renderAgentConsole({
      input: "总结当前笔记",
      onRun
    });

    const prompt = screen.getByLabelText("智能体输入");
    fireEvent.keyDown(prompt, { key: "Enter" });

    expect(onRun).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });

    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("does not submit while the user is composing IME text", () => {
    const onRun = vi.fn();

    renderAgentConsole({
      input: "中文输入",
      onRun
    });

    fireEvent.keyDown(screen.getByLabelText("智能体输入"), {
      key: "Enter",
      isComposing: true
    });

    expect(onRun).not.toHaveBeenCalled();
  });

  it("does not submit empty or running prompts from the keyboard", () => {
    const onRun = vi.fn();

    const { rerender } = renderAgentConsole({
      input: "   ",
      onRun
    });

    fireEvent.keyDown(screen.getByLabelText("智能体输入"), { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();

    rerender(baseAgentConsole({ input: "总结当前笔记", onRun, running: true }));
    fireEvent.keyDown(screen.getByLabelText("智能体输入"), { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("exposes model and Agent mode controls in the right-panel settings", () => {
    const onModelChange = vi.fn();
    const onAgentModeChange = vi.fn();
    const onRequestApiKey = vi.fn();
    const onToggleSettings = vi.fn();

    renderAgentConsole({
      canConfigureModel: true,
      settingsOpen: true,
      selectedModel: "deepseek-v4-pro",
      selectedAgentMode: "daily",
      modelOptions: [
        { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
        { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }
      ],
      agentModeOptions: [
        { value: "daily", label: "日常笔记 Agent" },
        { value: "linker", label: "建链图谱 Agent" }
      ],
      onAgentModeChange,
      onModelChange,
      onRequestApiKey,
      onToggleSettings
    });

    expect(screen.getByRole("dialog", { name: "Agent 设置" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Agent model"), { target: { value: "deepseek-v4-flash" } });
    fireEvent.change(screen.getByLabelText("Agent mode"), { target: { value: "linker" } });
    fireEvent.click(screen.getByText("配置"));
    fireEvent.click(screen.getByLabelText("关闭 Agent 设置"));

    expect(onModelChange).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(onAgentModeChange).toHaveBeenCalledWith("linker");
    expect(onRequestApiKey).toHaveBeenCalledTimes(1);
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("shows numbered sub-agent sessions and switches between them", () => {
    const onSelectSession = vi.fn();
    const onDeleteSession = vi.fn();

    renderAgentConsole({
      activeSessionId: "agent-2",
      onDeleteSession,
      onSelectSession,
      sessions: [
        { id: "agent-1", label: "1", running: true },
        { id: "agent-2", label: "2" }
      ]
    });

    expect(document.querySelector(".agent-session-running-dot")).not.toBeNull();
    expect(screen.getByRole("button", { name: "切换到子 Agent 2" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "切换到子 Agent 1" }));

    expect(onSelectSession).toHaveBeenCalledWith("agent-1");
    fireEvent.contextMenu(screen.getByRole("button", { name: "切换到子 Agent 2" }));
    expect(onDeleteSession).toHaveBeenCalledWith("agent-2");
    expect(onSelectSession).toHaveBeenCalledTimes(1);
  });

  it("renders the Agent controls in English when the workspace language is English", () => {
    render(
      <LanguageProvider initialLocale="en">
        {baseAgentConsole({
          settingsOpen: true,
          selectedModel: "deepseek-v4-pro",
          selectedAgentMode: "daily",
          modelOptions: [{ value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }],
          agentModeOptions: [{ value: "daily", label: "Daily note Agent" }]
        })}
      </LanguageProvider>
    );

    expect(screen.getByRole("dialog", { name: "Agent settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New sub-agent" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Model connection status" })).toBeTruthy();
    expect(screen.getByText("Local offline mode")).toBeTruthy();
  });

  it("exposes real panel controls and credential lifecycle actions", () => {
    const onDock = vi.fn();
    const onFloat = vi.fn();
    const onFocus = vi.fn();
    const onHide = vi.fn();
    const onRequestApiKey = vi.fn();
    const onValidateApiKey = vi.fn();
    const onDeleteApiKey = vi.fn();

    renderAgentConsole({
      canConfigureModel: true,
      modelConfigured: true,
      modelCredentialStorage: "windows-dpapi",
      modelCredentialStatus: "valid",
      modelCredentialUpdatedLabel: "2026/07/23 21:00",
      modelCredentialValidatedLabel: "2026/07/23 21:01",
      onDeleteApiKey,
      onDock,
      onFloat,
      onFocus,
      onHide,
      onRequestApiKey,
      onValidateApiKey,
      settingsOpen: true
    });

    fireEvent.click(screen.getByLabelText("停靠右侧"));
    fireEvent.click(screen.getByLabelText("浮动窗口"));
    fireEvent.click(screen.getByLabelText("专注模式"));
    fireEvent.click(screen.getByLabelText("收起智能体"));
    fireEvent.click(screen.getByText("轮换"));
    fireEvent.click(screen.getByText("验证"));
    fireEvent.click(screen.getByText("删除"));

    expect(screen.getByText("Windows DPAPI 已加密")).toBeTruthy();
    expect(screen.getByText("有效性检查通过")).toBeTruthy();
    expect(screen.getByText("最近验证：2026/07/23 21:01")).toBeTruthy();
    expect(onDock).toHaveBeenCalledTimes(1);
    expect(onFloat).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onRequestApiKey).toHaveBeenCalledTimes(1);
    expect(onValidateApiKey).toHaveBeenCalledTimes(1);
    expect(onDeleteApiKey).toHaveBeenCalledTimes(1);
  });
});

function renderAgentConsole(overrides: Partial<Parameters<typeof baseAgentConsole>[0]> = {}) {
  return render(baseAgentConsole(overrides));
}

function baseAgentConsole({
  activeSessionId,
  agentModeOptions,
  canConfigureModel = false,
  input = "",
  modelConfigured = false,
  modelCredentialStorage,
  modelCredentialStatus,
  modelCredentialUpdatedLabel,
  modelCredentialValidatedLabel,
  modelOptions,
  onAgentModeChange,
  onDeleteApiKey,
  onDeleteSession,
  onDock,
  onFloat,
  onFocus,
  onHide,
  onModelChange,
  onRequestApiKey,
  onSelectSession,
  onToggleSettings,
  onValidateApiKey,
  running = false,
  selectedAgentMode,
  selectedModel,
  settingsOpen = false,
  onRun = vi.fn(),
  sessions
}: {
  activeSessionId?: string;
  agentModeOptions?: Array<{ value: string; label: string; description?: string }>;
  canConfigureModel?: boolean;
  input?: string;
  modelConfigured?: boolean;
  modelCredentialStorage?: "windows-dpapi" | "environment" | "none";
  modelCredentialStatus?: "unchecked" | "valid" | "invalid";
  modelCredentialUpdatedLabel?: string;
  modelCredentialValidatedLabel?: string;
  modelOptions?: Array<{ value: string; label: string; description?: string }>;
  onAgentModeChange?: (mode: string) => void;
  onDeleteApiKey?: () => void;
  onDeleteSession?: (sessionId: string) => void;
  onDock?: () => void;
  onFloat?: () => void;
  onFocus?: () => void;
  onHide?: () => void;
  onModelChange?: (model: string) => void;
  onRequestApiKey?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onToggleSettings?: () => void;
  onValidateApiKey?: () => void;
  running?: boolean;
  selectedAgentMode?: string;
  selectedModel?: string;
  settingsOpen?: boolean;
  onRun?: () => void;
  sessions?: Array<{ id: string; label: string; running?: boolean }>;
}) {
  return (
    <AgentConsole
      activeSessionId={activeSessionId}
      agentModeOptions={agentModeOptions}
      canConfigureModel={canConfigureModel}
      diffs={[]}
      input={input}
      messages={[]}
      modelConfigured={modelConfigured}
      modelCredentialStorage={modelCredentialStorage}
      modelCredentialStatus={modelCredentialStatus}
      modelCredentialUpdatedLabel={modelCredentialUpdatedLabel}
      modelCredentialValidatedLabel={modelCredentialValidatedLabel}
      onApply={vi.fn()}
      onAgentModeChange={onAgentModeChange}
      onDeleteApiKey={onDeleteApiKey}
      onDock={onDock}
      onFloat={onFloat}
      onFocus={onFocus}
      onHide={onHide}
      onInputChange={vi.fn()}
      onModelChange={onModelChange}
      onRequestApiKey={onRequestApiKey}
      onValidateApiKey={onValidateApiKey}
      onRun={onRun}
      onDeleteSession={onDeleteSession}
      onSelectSession={onSelectSession}
      onToggleSettings={onToggleSettings}
      running={running}
      selectedAgentMode={selectedAgentMode}
      selectedModel={selectedModel}
      settingsOpen={settingsOpen}
      sessions={sessions}
      modelOptions={modelOptions}
    />
  );
}
