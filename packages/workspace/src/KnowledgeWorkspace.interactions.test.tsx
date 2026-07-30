/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSafetyManifest } from "@knowledge-agent/core";
import { createEmptyVault, KnowledgeWorkspace, type KnowledgeWorkspaceAdapter } from "./KnowledgeWorkspace";
import { APP_THEME_STORAGE_KEY } from "./themeModel";
import { SHORTCUT_STORAGE_KEY } from "./shortcutModel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.body.dataset.theme;
});

function createEmptyAdapter(): KnowledgeWorkspaceAdapter {
  return {
    canOpenVault: true,
    loadInitialVault: () => createEmptyVault(),
    openVault: vi.fn(async () => createEmptyVault())
  };
}

function createLoadedAdapter(): KnowledgeWorkspaceAdapter {
  const files = [
    { path: "A.md", content: "---\ntags: [alpha]\ndocument_type: \"论文\"\ncategory: \"研究\"\n---\n# A" },
    { path: "B.md", content: "---\ntags: [beta]\n---\n# B" }
  ];
  return {
    canOpenVault: true,
    loadInitialVault: () => ({
      files,
      sourceName: "Test vault",
      sourceKind: "desktop",
      safetyManifest: buildSafetyManifest(files.map((file) => file.path))
    }),
    openVault: vi.fn()
  };
}

describe("KnowledgeWorkspace navigation", () => {
  it("starts with the Agent panel collapsed and opens it only on demand", () => {
    const { container } = render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);
    const shell = container.querySelector(".obsidian-shell");

    expect(shell?.classList.contains("agent-collapsed")).toBe(true);
    expect(container.querySelector(".agent-console")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "智能体" }));

    expect(shell?.classList.contains("agent-collapsed")).toBe(false);
    expect(container.querySelector(".agent-console")).toBeTruthy();
  });

  it("exposes desktop window controls without adding them to the web workspace", () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const startDragging = vi.fn();
    const desktopAdapter = {
      ...createEmptyAdapter(),
      windowControls: { minimize, toggleMaximize, close, startDragging }
    };
    const { container } = render(<KnowledgeWorkspace adapter={desktopAdapter} />);
    const chrome = container.querySelector<HTMLElement>(".app-chrome");
    const controls = container.querySelectorAll<HTMLButtonElement>(".window-controls button");

    expect(chrome?.classList.contains("app-chrome-desktop")).toBe(true);
    expect(controls).toHaveLength(3);

    fireEvent.pointerDown(chrome!, { button: 0 });
    expect(startDragging).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(chrome!);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    controls.forEach((button) => fireEvent.click(button));
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);

    cleanup();
    const webRender = render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);
    expect(webRender.container.querySelector(".window-controls")).toBeNull();
  });

  it("opens the unified settings center from the default and a persisted custom hotkey", () => {
    const firstRender = render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "应用设置" })).toBeTruthy();
    firstRender.unmount();

    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify({ settings: ["Ctrl+Alt+S"] }));
    render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, altKey: true });

    expect(screen.getByRole("dialog", { name: "应用设置" })).toBeTruthy();
  });

  it("starts in the light theme and persists a dark-theme switch", () => {
    const { container } = render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);
    const shell = container.querySelector(".obsidian-shell");

    expect(shell?.classList.contains("theme-light")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");

    const settingsButton = container.querySelector<HTMLButtonElement>(".vault-ribbon button:last-of-type");
    expect(settingsButton).toBeTruthy();
    fireEvent.click(settingsButton!);
    fireEvent.click(screen.getByRole("button", { name: "外观与语言" }));
    fireEvent.click(screen.getByRole("button", { name: "深色" }));

    expect(shell?.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("opens the canvas directly on first launch and dismisses the storage panel", async () => {
    render(<KnowledgeWorkspace adapter={createEmptyAdapter()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "知识画布" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "存储空间" }));
    expect(screen.getByLabelText("本地存储空间")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "知识画布" }));

    expect(screen.queryByLabelText("本地存储空间")).toBeNull();
    expect(screen.getByRole("region", { name: "知识画布" })).toBeTruthy();
    expect(screen.queryByText("连接你的知识库")).toBeNull();
  });

  it("filters the file hierarchy by a clicked classification tag", async () => {
    render(<KnowledgeWorkspace adapter={createLoadedAdapter()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /#alpha/ })).toBeTruthy());
    expect(screen.getByTitle("A.md")).toBeTruthy();
    expect(screen.getByTitle("B.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /#alpha/ }));

    expect(screen.getByTitle("A.md")).toBeTruthy();
    expect(screen.queryByTitle("B.md")).toBeNull();
    expect(screen.getByText("论文 · 研究")).toBeTruthy();
  });
});
