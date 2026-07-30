/**
 * @vitest-environment jsdom
 */
import { parseNote } from "@knowledge-agent/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormatConverterDialog } from "./FormatConverterDialog";

afterEach(cleanup);

describe("FormatConverterDialog", () => {
  it("previews changes and applies the selected conversion settings", () => {
    const onApply = vi.fn();
    render(
      <FormatConverterDialog
        notes={[parseNote({ path: "Roam.md", content: "# Note\n\n^^important^^ {{[[TODO]]}}" })]}
        onApply={onApply}
        onClose={() => undefined}
      />
    );
    expect(screen.getByText(/将修改 1 篇笔记，共 2 处/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "开始转换" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
