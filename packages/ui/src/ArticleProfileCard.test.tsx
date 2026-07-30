/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseNote } from "@knowledge-agent/core";
import { ArticleProfileCard } from "./ArticleProfileCard";

afterEach(cleanup);

describe("ArticleProfileCard", () => {
  it("shows article metadata and reuses tags as keywords", () => {
    const note = parseNote({
      path: "Research/Test.md",
      content: "---\nsummary: \"一句话简介\"\ntags: [知识库, 分类]\ndocument_type: \"论文\"\ncreated: \"2026-07-24\"\n---\n# Test"
    });
    render(<ArticleProfileCard note={note} readOnly />);

    expect(screen.getByText("一句话简介")).toBeTruthy();
    expect(screen.getByText("论文")).toBeTruthy();
    expect(screen.getByText("#知识库")).toBeTruthy();
    expect(screen.getByText("#分类")).toBeTruthy();
  });

  it("edits and saves the complete profile in one action", () => {
    const onSave = vi.fn();
    const note = parseNote({ path: "Test.md", content: "# Test\n\n正文第一句。" });
    render(<ArticleProfileCard note={note} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑资料卡" }));
    fireEvent.change(screen.getByPlaceholderText("论文、文章、书籍、摘录、笔记…"), {
      target: { value: "文章" }
    });
    fireEvent.change(screen.getByPlaceholderText("用一句话说明这篇资料解决了什么问题或提供了什么价值"), {
      target: { value: "新的简介" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存资料卡" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      summary: "新的简介",
      documentType: "文章"
    }));
  });
});
