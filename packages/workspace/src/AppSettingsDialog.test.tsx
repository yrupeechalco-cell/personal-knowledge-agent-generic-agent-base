/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@knowledge-agent/ui";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { resolveShortcutMap, SHORTCUT_COMMANDS } from "./shortcutModel";

describe("AppSettingsDialog", () => {
  it("records a new non-conflicting shortcut", () => {
    const onShortcutChange = vi.fn();
    render(
      <LanguageProvider initialLocale="zh-CN">
        <AppSettingsDialog
          activeSection="shortcuts"
          agentModeOptions={[]}
          appTheme="light"
          canConfigureModel={false}
          graphFilter=""
          graphRadius={1}
          graphShowLabels
          graphShowRelated
          locale="zh-CN"
          modelConfigured={false}
          modelCredentialBusy={false}
          modelCredentialStatus="unchecked"
          modelOptions={[]}
          modelProvider="deepseek"
          onAgentModeChange={() => undefined}
          onClose={() => undefined}
          onDeleteApiKey={() => undefined}
          onGraphFilterChange={() => undefined}
          onGraphRadiusChange={() => undefined}
          onGraphShowLabelsChange={() => undefined}
          onGraphShowRelatedChange={() => undefined}
          onLocaleChange={() => undefined}
          onModelChange={() => undefined}
          onOpenFormatConverter={() => undefined}
          onOpenLayouts={() => undefined}
          onOpenNoteWorkflow={() => undefined}
          onOpenStorage={() => undefined}
          onOpenTrash={() => undefined}
          onOpenUpdates={() => undefined}
          onRequestApiKey={() => undefined}
          onResetAllShortcuts={() => undefined}
          onResetShortcut={() => undefined}
          onSectionChange={() => undefined}
          onShortcutChange={onShortcutChange}
          onThemeChange={() => undefined}
          onValidateApiKey={() => undefined}
          open
          selectedAgentMode=""
          selectedModel=""
          shortcutMap={resolveShortcutMap()}
          shortcuts={[{
            id: "graph",
            label: "打开关系图谱",
            category: "views",
            shortcuts: ["Ctrl+G"],
            defaults: SHORTCUT_COMMANDS.find((command) => command.id === "graph")!.defaults
          }]}
          sourceName="Test"
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Ctrl+G" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "请按新的快捷键…" }), {
      key: "g",
      ctrlKey: true,
      altKey: true
    });

    expect(onShortcutChange).toHaveBeenCalledWith("graph", ["Ctrl+Alt+G"]);
  });
});
