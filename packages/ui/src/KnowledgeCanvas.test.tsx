// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./localization";
import {
  KnowledgeCanvas,
  createEmptyCanvasDocument,
  normalizeCanvasDocument,
  moveCanvasNodes,
  arrangeCanvasCards,
  type KnowledgeCanvasDocument
} from "./KnowledgeCanvas";

beforeAll(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterAll(() => vi.unstubAllGlobals());

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

  it("moves grouped cards exactly once when a group and its member are dragged together", () => {
    const document = normalizeCanvasDocument({ cards: [
      { id: "a", type: "text", x: 50, y: 60, width: 260, height: 170, title: "A" },
      { id: "b", type: "note", x: 350, y: 60, width: 300, height: 200, title: "B", notePath: "B.md" }
    ], groups: [{ id: "g", x: 0, y: 0, width: 700, height: 300, cardIds: ["a", "b"], title: "Group" }] });
    const moved = moveCanvasNodes(document, [
      { type: "position", id: "group:g", position: { x: 100, y: 200 } },
      { type: "position", id: "card:a", position: { x: 150, y: 260 } }
    ]);
    expect(moved.cards.map(card => [card.x, card.y])).toEqual([[150, 260], [450, 260]]);
    expect(document.cards[0]?.x).toBe(50);
    expect(moved.cards[1]?.notePath).toBe("B.md");
    expect(moveCanvasNodes(document, [{ type: "dimensions", id: "card:a", dimensions: { width: 1, height: 1 } }])).toBe(document);
  });

  it("arranges without losing old v1 contents, relationships, and source links", () => {
    const document = normalizeCanvasDocument({ cards: [
      { id: "a", type: "text", x: 0, y: 0, width: 260, height: 170, title: "A", text: "Keep this" },
      { id: "b", type: "note", x: 0, y: 0, width: 300, height: 200, title: "B", notePath: "B.md" }
    ], connections: [{ id: "e", sourceId: "a", targetId: "b", relationship: "references", label: "source" }],
    groups: [{ id: "g", x: -10, y: -10, width: 500, height: 300, cardIds: ["a", "b"], title: "G" }] });
    const arranged = arrangeCanvasCards(document);
    expect(arranged.cards[1]!.x).toBeGreaterThan(arranged.cards[0]!.x + arranged.cards[0]!.width);
    expect(arranged.cards[0]?.text).toBe("Keep this");
    expect(arranged.cards[1]?.notePath).toBe("B.md");
    expect(arranged.connections).toEqual(document.connections);
    expect(arranged.groups[0]?.cardIds).toEqual(["a", "b"]);
    expect(normalizeCanvasDocument(JSON.parse(JSON.stringify(arranged)))).toEqual(arranged);
  });
});
