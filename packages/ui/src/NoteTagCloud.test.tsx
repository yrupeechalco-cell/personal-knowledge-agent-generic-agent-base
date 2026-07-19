/**
 * @vitest-environment jsdom
 */
import { parseNote } from "@knowledge-agent/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteTagCloud } from "./NoteTagCloud";

afterEach(cleanup);

const note = parseNote({ path: "Page.md", content: "---\ntags: [知识存储, 分类]\n---\n# 知识存储\n\n分类整理。" });

describe("NoteTagCloud", () => {
  it("lets the user edit the exact tag set", () => {
    const onTagsChange = vi.fn();
    render(<NoteTagCloud note={note} onTagsChange={onTagsChange} />);

    fireEvent.click(screen.getByLabelText("编辑标签"));
    fireEvent.click(screen.getByLabelText("删除标签 分类"));
    expect(onTagsChange).toHaveBeenCalledWith(["知识存储"]);
  });

  it("passes the selected granularity to Agent extraction", () => {
    const onExtract = vi.fn();
    render(<NoteTagCloud note={note} onExtract={onExtract} />);

    fireEvent.change(screen.getByLabelText("标签拆解颗粒度"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("使用 Agent 拆解标签"));
    expect(onExtract).toHaveBeenCalledWith(5);
  });
});
