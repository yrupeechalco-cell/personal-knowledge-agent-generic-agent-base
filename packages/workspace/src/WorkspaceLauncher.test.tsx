/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "@knowledge-agent/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLauncher } from "./WorkspaceLauncher";
import type { WorkspaceLauncherItem } from "./workspaceLauncherModel";

afterEach(() => cleanup());

const items: WorkspaceLauncherItem[] = [
  { id: "graph", kind: "command", label: "打开关系图谱", shortcut: "Ctrl+G" },
  { id: "search", kind: "command", label: "全库搜索" }
];

describe("WorkspaceLauncher", () => {
  it("supports keyboard selection and modifier semantics", () => {
    const onSelect = vi.fn();

    render(
      <LanguageProvider initialLocale="zh-CN">
        <WorkspaceLauncher
          items={items}
          mode="commands"
          onClose={vi.fn()}
          onQueryChange={vi.fn()}
          onSelect={onSelect}
          open
          query=""
        />
      </LanguageProvider>
    );

    const input = screen.getByRole("textbox", { name: "命令面板" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(onSelect).toHaveBeenCalledWith(items[1], {
      createExact: true,
      openInNewTab: true
    });
  });

  it("closes with Escape and from the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <LanguageProvider initialLocale="zh-CN">
        <WorkspaceLauncher
          items={items}
          mode="notes"
          onClose={onClose}
          onQueryChange={vi.fn()}
          onSelect={vi.fn()}
          open
          query=""
        />
      </LanguageProvider>
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "快速切换" }), { key: "Escape" });
    fireEvent.mouseDown(container.querySelector(".workspace-launcher-backdrop") as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
