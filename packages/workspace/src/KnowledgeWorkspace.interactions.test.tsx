/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSafetyManifest } from "@knowledge-agent/core";
import { createEmptyVault, KnowledgeWorkspace, type KnowledgeWorkspaceAdapter } from "./KnowledgeWorkspace";
import { APP_THEME_STORAGE_KEY } from "./themeModel";
import { SHORTCUT_STORAGE_KEY } from "./shortcutModel";

// These are workspace interaction tests; jsdom cannot create a WebGL context.
vi.mock("./TagKnowledgeMap", () => ({ TagKnowledgeMap: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  it("switches sidebar features without title-bar tabs and retains the English iframe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
    const adapter = createEmptyAdapter();
    render(<KnowledgeWorkspace adapter={adapter} />);
    await waitFor(() => expect(screen.getAllByText(/请选择一个|未连接|尚未连接/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "英语学习" }));
    const frame = await screen.findByTitle("TypeWords 英语学习");
    expect(adapter.openVault).not.toHaveBeenCalled();
    expect(screen.queryByRole("tablist")).toBeNull();
    for (const name of ["知识画布", "属性数据库", "资源查询", "文件知识库", "关系图谱"]) {
      const button = screen.getByRole("button", { name });
      fireEvent.click(button);
      expect(button.classList.contains("active")).toBe(true);
      expect(screen.queryByRole("tab")).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "关系图谱" }));
    expect(frame.closest(".typewords-plugin-host")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "英语学习" }));
    expect(screen.getByTitle("TypeWords 英语学习")).toBe(frame);
    expect(frame.closest(".typewords-plugin-host")?.hasAttribute("hidden")).toBe(false);
  });

  it("preserves document tabs while switching features and navigates only between documents", async () => {
    render(<KnowledgeWorkspace adapter={createLoadedAdapter()} />);
    fireEvent.click(await screen.findByTitle("A.md"));
    fireEvent.click(screen.getByTitle("B.md"));
    const tabs = within(screen.getByRole("tablist", { name: "Open document tabs" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.getAttribute("title"))).toEqual(["A.md", "B.md"]);
    for (const name of ["知识画布", "属性数据库", "资源查询", "回收站", "文件知识库", "关系图谱"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(tabs.getAllByRole("tab")).toHaveLength(2);
      expect(tabs.queryByRole("tab", { selected: true })).toBeNull();
    }
    fireEvent.click(tabs.getByRole("tab", { name: /B/ }));
    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    expect(tabs.getByRole("tab", { selected: true }).getAttribute("title")).toBe("A.md");
    fireEvent.click(screen.getByRole("button", { name: "前进" }));
    expect(tabs.getByRole("tab", { selected: true }).getAttribute("title")).toBe("B.md");
  });

  it.each([false, true])("stages destructive Agent edits and guards stale proposals (stale=%s)", async (stale) => {
    const files = [{ path: "A.md", content: "# A\n\n" + "需要保留的重要笔记内容。".repeat(30) }];
    const vault = { files, sourceName: "Review vault", sourceKind: "desktop" as const, safetyManifest: buildSafetyManifest(["A.md"]) };
    let refresh: Parameters<NonNullable<KnowledgeWorkspaceAdapter["watchVault"]>>[0] | undefined;
    let turns = 0;
    const writeChanges = vi.fn(async (_changes: Parameters<NonNullable<KnowledgeWorkspaceAdapter["writeChanges"]>>[0]) => ({ message: "saved" }));
    const adapter: KnowledgeWorkspaceAdapter = {
      canOpenVault: true,
      loadInitialVault: () => vault,
      openVault: vi.fn(),
      writeChanges,
      watchVault: (callback) => { refresh = callback; return () => undefined; },
      runModel: async () => "ready",
      runModelTurn: async () => ++turns === 1
        ? { content: "", toolCalls: [{ id: "edit-1", name: "app_replace_note", arguments: JSON.stringify({ path: "A.md", content: "# A\n\n摘要" }) }] }
        : { content: "提案已准备好", toolCalls: [] }
    };
    render(<KnowledgeWorkspace adapter={adapter} />);
    await waitFor(() => expect(refresh).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "智能体" }));
    fireEvent.change(screen.getByLabelText("智能体输入"), { target: { value: "请精简当前笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("提案已准备好");
    const apply = screen.getByRole("button", { name: "确认应用" });
    expect(writeChanges).not.toHaveBeenCalled();
    if (stale) {
      const { act } = await import("@testing-library/react");
      act(() => refresh!({ ...vault, files: [{ ...files[0], content: "# A\n\n外部编辑的新内容" }] }, ["A.md"]));
    }
    fireEvent.click(apply);
    if (stale) {
      expect(screen.getByText("笔记已发生变化，旧提案未应用。请根据最新内容重新生成提案。")).toBeTruthy();
      expect(writeChanges).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(writeChanges).toHaveBeenCalled());
      expect(writeChanges.mock.calls[0]?.[0]).toEqual([{ path: "A.md", kind: "modified", before: files[0].content, after: "# A\n\n摘要" }]);
      expect(screen.queryByRole("button", { name: "确认应用" })).toBeNull();
    }
  });

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
