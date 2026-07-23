// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "./localization";
import {
  KnowledgeCanvas,
  createEmptyCanvasDocument,
  normalizeCanvasDocument,
  type KnowledgeCanvasDocument
} from "./KnowledgeCanvas";

describe("knowledge canvas document", () => {
  it("starts blank instead of injecting example cards", () => {
    const document = createEmptyCanvasDocument("Research");

    expect(document.name).toBe("Research");
    expect(document.cards).toEqual([]);
    expect(document.connections).toEqual([]);
    expect(document.groups).toEqual([]);
  });

  it("normalizes persisted cards and drops connections to missing cards", () => {
    const document = normalizeCanvasDocument({
      version: 1,
      id: "canvas-1",
      name: "Research",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
      viewport: { x: 12, y: 24, scale: 99 },
      cards: [
        { id: "a", type: "text", x: 0, y: 0, width: 80, height: 70, title: "Question", text: "Why?" },
        {
          id: "b",
          type: "table",
          x: 320,
          y: 0,
          width: 380,
          height: 250,
          title: "Evidence",
          table: { columns: ["Source", "Finding"], rows: [["Paper", "Result"]] }
        }
      ],
      connections: [
        { id: "valid", sourceId: "a", targetId: "b", relationship: "supports", label: "supports" },
        { id: "missing", sourceId: "a", targetId: "c", relationship: "relates", label: "related" }
      ],
      groups: [
        { id: "group", x: -40, y: -50, width: 800, height: 400, title: "Claim", cardIds: ["a", "b", "c"] }
      ]
    });

    expect(document.cards).toHaveLength(2);
    expect(document.cards[0]?.width).toBeGreaterThanOrEqual(180);
    expect(document.connections.map((connection) => connection.id)).toEqual(["valid"]);
    expect(document.groups[0]?.cardIds).toEqual(["a", "b"]);
    expect(document.viewport.scale).toBe(2.4);
  });

  it("creates text, table, and real note cards from the toolbar", () => {
    function Harness() {
      const [document, setDocument] = useState<KnowledgeCanvasDocument>(() => createEmptyCanvasDocument("Research"));
      return (
        <LanguageProvider initialLocale="zh-CN">
          <KnowledgeCanvas
            document={document}
            notes={[{ path: "Research/Claim.md", title: "Claim", content: "# Claim\n\nEvidence.", tags: ["evidence"] }]}
            onChange={setDocument}
            onOpenNote={() => undefined}
            saveState="saved"
          />
        </LanguageProvider>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByTitle("添加文本卡片"));
    fireEvent.click(screen.getByTitle("添加表格卡片"));
    fireEvent.click(screen.getByTitle("添加知识库笔记"));
    fireEvent.click(screen.getByText("Claim"));

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByPlaceholderText("写下观点、问题或结论…")).not.toBeNull();
    expect(screen.getByText("Research/Claim.md")).not.toBeNull();
    expect(screen.getByRole("table")).not.toBeNull();
  });
});
