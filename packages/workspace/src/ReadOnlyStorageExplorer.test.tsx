// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadOnlyStorageExplorer, type ReadOnlyDirectoryListing } from "./KnowledgeWorkspace";

afterEach(cleanup);

describe("ReadOnlyStorageExplorer", () => {
  it("navigates folders and requests file previews without exposing mutation controls", () => {
    const onOpenDirectory = vi.fn();
    const onOpenFile = vi.fn();
    const listing: ReadOnlyDirectoryListing = {
      root: "F:\\",
      path: "",
      truncated: false,
      entries: [
        { name: "项目", path: "项目", kind: "directory", modifiedAtMs: 1_700_000_000_000 },
        { name: "说明.md", path: "说明.md", kind: "file", extension: "md", size: 128, modifiedAtMs: 1_700_000_000_000 }
      ]
    };

    const view = render(
      <ReadOnlyStorageExplorer
        busy={false}
        listing={listing}
        onClosePreview={() => undefined}
        onOpenDirectory={onOpenDirectory}
        onOpenFile={onOpenFile}
        preview={null}
      />
    );

    fireEvent.click(screen.getByTitle("项目"));
    fireEvent.click(screen.getByTitle("说明.md"));
    expect(onOpenDirectory).toHaveBeenCalledWith("项目");
    expect(onOpenFile).toHaveBeenCalledWith("说明.md");
    expect(screen.queryByText("删除")).toBeNull();
    expect(screen.queryByText("重命名")).toBeNull();

    view.rerender(
      <ReadOnlyStorageExplorer
        busy={false}
        listing={listing}
        onClosePreview={() => undefined}
        onOpenDirectory={onOpenDirectory}
        onOpenFile={onOpenFile}
        preview={{
          root: "F:\\",
          path: "说明.md",
          name: "说明.md",
          previewKind: "text",
          content: "# 只读说明",
          size: 128,
          modifiedAtMs: 1_700_000_000_000
        }}
      />
    );

    expect(screen.getByText("# 只读说明")).toBeTruthy();
    expect(screen.getByText("本视图没有写入、重命名或删除权限")).toBeTruthy();
  });
});
