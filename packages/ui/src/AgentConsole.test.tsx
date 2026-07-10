/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConsole } from "./AgentConsole";

afterEach(() => cleanup());

describe("AgentConsole", () => {
  it("submits with Enter and keeps Shift+Enter available for multiline input", () => {
    const onRun = vi.fn();

    renderAgentConsole({
      input: "总结当前笔记",
      onRun
    });

    const prompt = screen.getByLabelText("Agent prompt");
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

    fireEvent.keyDown(screen.getByLabelText("Agent prompt"), {
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

    fireEvent.keyDown(screen.getByLabelText("Agent prompt"), { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();

    rerender(baseAgentConsole({ input: "总结当前笔记", onRun, running: true }));
    fireEvent.keyDown(screen.getByLabelText("Agent prompt"), { key: "Enter" });
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

    renderAgentConsole({
      activeSessionId: "agent-2",
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
  modelOptions,
  onAgentModeChange,
  onModelChange,
  onRequestApiKey,
  onSelectSession,
  onToggleSettings,
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
  modelOptions?: Array<{ value: string; label: string; description?: string }>;
  onAgentModeChange?: (mode: string) => void;
  onModelChange?: (model: string) => void;
  onRequestApiKey?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onToggleSettings?: () => void;
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
      onApply={vi.fn()}
      onAgentModeChange={onAgentModeChange}
      onInputChange={vi.fn()}
      onModelChange={onModelChange}
      onRequestApiKey={onRequestApiKey}
      onRun={onRun}
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
