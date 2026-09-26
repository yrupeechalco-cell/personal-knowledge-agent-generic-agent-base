// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryInbox } from "./LibraryInbox";
import type { KnowledgeCardRecord, LibraryAdapter, LibrarySnapshot } from "./libraryModel";

afterEach(cleanup);
function fixture() {
  const record: KnowledgeCardRecord = { scope: "local", card: { id: "card-1", version: 1, name: "预算.txt", fileType: "txt", summary: "装修费用", categories: ["项目/装修", "主题/预算"], tags: ["报价"], tips: [{ id: "tip-1", content: "预留机动预算" }], source: { deviceId: "PC", deviceName: "电脑", revision: "1", lastSeenAt: 1, availability: "unavailable" }, analysisStale: false, classificationLocked: true, updatedAt: 1 } };
  const data: LibrarySnapshot = { version: 3, storeRevision: 1, roots: [], documents: [], knowledgeCards: { deviceId: "PC", records: [record, { ...structuredClone(record), card: { ...record.card, id: "card-2", name: "灵感.txt", categories: ["项目/写作"] } }] } };
  const api: LibraryAdapter = {
    load: vi.fn(async () => structuredClone(data)), scan: vi.fn(async () => structuredClone(data)), addFolder: vi.fn(async () => structuredClone(data)), updateRoot: vi.fn(async () => structuredClone(data)), saveReview: vi.fn(), exportCard: vi.fn(), saveSource: vi.fn(),
    saveKnowledgeCard: vi.fn(async review => { const current = data.knowledgeCards!.records.find(r => r.card.id === review.id)!; Object.assign(current.card, { summary: review.summary, categories: review.categories, tags: review.tags, version: current.card.version + 1 }); current.scope = review.scope; data.storeRevision!++; return structuredClone(data); }),
    previewKnowledgeCards: vi.fn(async () => ({ schema: "knowledge-cards/v1" as const, deviceId: "PC", generatedAt: 1, cards: data.knowledgeCards!.records.filter(r => r.scope === "shared").map(r => r.card) })),
    exportKnowledgeCards: vi.fn(async () => "cards.json")
  };
  render(<LibraryInbox adapter={api} model="offline" modelReady={false} visible/>);
  return { api, data };
}

it("opens independent cards and edits annotations while the source is unavailable", async () => {
  const { api, data } = fixture();
  fireEvent.click(await screen.findByRole("button", { name: /预算.txt/ }));
  fireEvent.change(screen.getByLabelText("卡片摘要"), { target: { value: "离线补充预算说明" } });
  fireEvent.click(screen.getByRole("button", { name: "保存卡片" }));
  await waitFor(() => expect(data.knowledgeCards!.records[0].card.summary).toBe("离线补充预算说明"));
  expect(api.saveSource).not.toHaveBeenCalled(); expect(api.saveReview).not.toHaveBeenCalled();
  expect(api.saveKnowledgeCard).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1", expectedVersion: 1, scope: "local" }));
  expect(screen.getByText("知识卡片已保存，原文件未改动。")).toBeTruthy();
});

it("requires an explicit saved sharing choice and previews the actual export contract", async () => {
  const { api } = fixture(); await screen.findByRole("button", { name: /预算.txt/ });
  expect((screen.getByText("导出可共享卡片") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("预览可共享内容"));
  expect(JSON.parse((await screen.findByLabelText("知识卡片共享预览")).textContent!).cards).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /预算.txt/ }));
  fireEvent.change(screen.getByLabelText("卡片共享范围"), { target: { value: "shared" } });
  expect((screen.getByText("预览可共享内容") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("保存卡片"));
  await waitFor(() => expect((screen.getByText("预览可共享内容") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("预览可共享内容"));
  const preview = JSON.parse((await screen.findByLabelText("知识卡片共享预览")).textContent!);
  expect(preview.cards.map((c: { id: string }) => c.id)).toEqual(["card-1"]);
  expect(api.exportKnowledgeCards).not.toHaveBeenCalled();
});

it("keeps a failed save draft and prevents navigation or exports from bypassing it", async () => {
  const { api } = fixture(); api.saveKnowledgeCard = vi.fn().mockRejectedValue(new Error("卡片版本已改变"));
  fireEvent.click(await screen.findByRole("button", { name: /预算.txt/ }));
  fireEvent.change(screen.getByLabelText("卡片摘要"), { target: { value: "不能丢的草稿" } });
  fireEvent.click(screen.getByText("保存卡片"));
  expect((await screen.findByRole("alert")).textContent).toContain("卡片版本已改变");
  expect((screen.getByLabelText("卡片摘要") as HTMLTextAreaElement).value).toBe("不能丢的草稿");
  expect((screen.getByText("原文与 AI 整理") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /灵感.txt/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("放弃修改"));
  await waitFor(() => expect((screen.getByText("原文与 AI 整理") as HTMLButtonElement).disabled).toBe(false));
});

it("finds the same card through different classifications without copying it", async () => {
  fixture(); await screen.findByRole("button", { name: /预算.txt/ });
  for (const category of ["项目/装修", "主题/预算"]) {
    fireEvent.change(screen.getByLabelText("按卡片分类查看"), { target: { value: category } });
    const list = within(screen.getByLabelText("知识卡片列表"));
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(list.getByRole("button", { name: /预算.txt/ })).toBeTruthy();
  }
  fireEvent.change(screen.getByLabelText("搜索知识卡片"), { target: { value: "不存在" } });
  expect(screen.getByText("没有匹配的卡片")).toBeTruthy();
});
