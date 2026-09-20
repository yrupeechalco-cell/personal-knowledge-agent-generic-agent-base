// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryInbox } from "./LibraryInbox";
import type { LibraryAdapter, LibrarySnapshot } from "./libraryModel";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const snapshot: LibrarySnapshot = { version: 1, roots: [{ id: "root", path: "C:/资料", paused: false, lastScan: 1, issue: null }], documents: [{ id: "a", rootId: "root", path: "note.txt", revision: "1", size: 20, updatedAt: 1, text: "正文关键词", issue: null, status: "pending", summary: "", category: "", tags: [] }] };
function adapter(): LibraryAdapter { return { load: vi.fn().mockResolvedValue(snapshot), scan: vi.fn().mockResolvedValue(snapshot), addFolder: vi.fn().mockResolvedValue(snapshot), updateRoot: vi.fn().mockResolvedValue(snapshot), saveReview: vi.fn().mockResolvedValue(snapshot), exportCard: vi.fn().mockResolvedValue(null) }; }
describe("library inbox", () => {
  it("honestly explains browser availability", () => { render(<LibraryInbox visible model="offline" modelReady={false} />); expect(screen.getByText("请在正式安装的 App 中添加资料")).toBeTruthy(); });
  it("searches real loaded content and saves a manually reviewed card with revision", async () => {
    const api = adapter(); render(<LibraryInbox adapter={api} visible model="offline" modelReady={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /note.txt/ }));
    fireEvent.change(screen.getByLabelText("资料摘要"), { target: { value: "手动摘要" } });
    fireEvent.click(screen.getByText("保存整理"));
    await waitFor(() => expect(api.saveReview).toHaveBeenCalledWith(expect.objectContaining({ id: "a", revision: "1", summary: "手动摘要", status: "reviewed" })));
    fireEvent.change(screen.getByLabelText("搜索资料正文"), { target: { value: "不存在的正文" } });
    expect(screen.getByText("没有找到匹配资料")).toBeTruthy();
  });
  it("shows model failure without saving incomplete suggestions", async () => {
    const api = adapter(); const model = vi.fn().mockRejectedValue(new Error("网络不可用"));
    render(<LibraryInbox adapter={api} runModel={model} visible model="test" modelReady />);
    fireEvent.click(await screen.findByRole("button", { name: /note.txt/ })); fireEvent.click(screen.getByText("AI 生成建议"));
    expect(await screen.findByText(/生成失败：.*网络不可用/)).toBeTruthy(); expect(api.saveReview).not.toHaveBeenCalled();
  });
  it("keeps background scans active when the inbox is hidden and stops after unmount", async () => {
    vi.useFakeTimers();
    const api = adapter(); const mounted = render(<LibraryInbox adapter={api} visible={false} model="offline" modelReady={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(api.scan).toHaveBeenCalledTimes(1); mounted.unmount(); await vi.advanceTimersByTimeAsync(60000); expect(api.scan).toHaveBeenCalledTimes(1);
  });
  it("guards unsaved edits before switching documents", async () => {
    const api = adapter(); api.load = vi.fn().mockResolvedValue({ ...snapshot, documents: [...snapshot.documents, { ...snapshot.documents[0], id: "b", path: "second.txt" }] });
    render(<LibraryInbox adapter={api} visible model="offline" modelReady={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /note.txt/ }));
    fireEvent.change(screen.getByLabelText("资料摘要"), { target: { value: "草稿" } });
    fireEvent.click(screen.getByRole("button", { name: /second.txt/ }));
    expect(screen.getByText("当前资料有未保存的整理内容。")).toBeTruthy();
    expect((screen.getByLabelText("资料摘要") as HTMLTextAreaElement).value).toBe("草稿");
    fireEvent.click(screen.getByText("继续编辑"));
    expect(screen.queryByText("放弃修改并切换")).toBeNull();
  });
  it("browses one original through multiple topics and exposes tip sources", async () => {
    const api = adapter(); api.load = vi.fn().mockResolvedValue({ ...snapshot, documents: [{ ...snapshot.documents[0], categories: ["创作/人物", "学习/表达"], tags: ["动机"], tips: [{ id: "tip-1", content: "人物行动要有动机", quote: "正文关键词" }] }] });
    render(<LibraryInbox adapter={api} visible model="offline" modelReady={false} />);
    fireEvent.click(await screen.findByTitle("创作")); expect(screen.getByRole("button", { name: /note.txt/ })).toBeTruthy();
    fireEvent.click(screen.getByTitle("学习/表达")); expect(screen.getByRole("button", { name: /note.txt/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "知识 tip" }));
    expect(screen.getByText("人物行动要有动机")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /查看来源/ })); expect(screen.getByLabelText("资料摘要")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "定位原文" })); expect(document.querySelector("mark")?.textContent).toBe("正文关键词");
  });
  it("retains the source editor draft when saving fails", async () => {
    const api = adapter(); api.saveSource = vi.fn().mockRejectedValue(new Error("原文件已被外部修改"));
    render(<LibraryInbox adapter={api} visible model="offline" modelReady={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /note.txt/ })); fireEvent.click(screen.getByText("编辑原文"));
    fireEvent.change(screen.getByLabelText("编辑资料原文"), { target: { value: "新的原文草稿" } }); fireEvent.click(screen.getByText("保存原文"));
    expect((await screen.findByRole("alert")).textContent).toContain("原文件已被外部修改");
    expect((screen.getByLabelText("编辑资料原文") as HTMLTextAreaElement).value).toBe("新的原文草稿");
  });
});

function queueAdapter(initial: LibrarySnapshot) {
  let data = structuredClone(initial);
  const next = () => structuredClone({ ...data, storeRevision: data.storeRevision = (data.storeRevision ?? 0) + 1 });
  const api: LibraryAdapter = {
    load: vi.fn(async () => structuredClone(data)), scan: vi.fn(async () => next()), addFolder: vi.fn(async () => next()), updateRoot: vi.fn(async () => next()), exportCard: vi.fn(async () => null),
    configure: vi.fn(async (config) => { if (config.autoAnalyze !== undefined) data.autoAnalyze = config.autoAnalyze; if (config.queueState) data.queueState = config.queueState; if (config.retryFailed) data.documents.forEach((doc) => { doc.aiError = ""; }); return next(); }),
    recordError: vi.fn(async (id, _revision, error) => { data.documents.find((doc) => doc.id === id)!.aiError = error; return next(); }),
    saveReview: vi.fn(async (review) => { const doc = data.documents.find((item) => item.id === review.id)!; Object.assign(doc, review, { metadataVersion: (doc.metadataVersion ?? 0) + 1, aiError: "" }); return next(); })
  };
  return { api, current: () => data };
}
const modelOutput = JSON.stringify({ summary: "整理完成", categories: ["学习/阅读"], tags: ["知识"], tips: [{ content: "记录关键词", quote: "正文关键词" }] });

describe("persistent library processing", () => {
  it("resumes only unfinished documents after a restart and saves every completed result", async () => {
    const { api, current } = queueAdapter({ ...snapshot, queueState: "running", documents: [{ ...snapshot.documents[0], id: "done", path: "done.txt", status: "reviewed" }, snapshot.documents[0]] });
    const model = vi.fn(async () => modelOutput);
    render(<LibraryInbox adapter={api} runModel={model} visible model="test" modelReady />);
    await waitFor(() => expect(current().queueState).toBe("idle"));
    expect(model).toHaveBeenCalledTimes(1); expect(api.saveReview).toHaveBeenCalledTimes(1); expect(current().documents[1].tips).toHaveLength(1);
  });
  it("pauses before committing an in-flight model result and continues on request", async () => {
    let finish!: (value: string) => void;
    const { api, current } = queueAdapter({ ...snapshot, queueState: "running" });
    const model = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; })).mockResolvedValue(modelOutput);
    render(<LibraryInbox adapter={api} runModel={model} visible model="test" modelReady />);
    await waitFor(() => expect(model).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByText("暂停整理"));
    await waitFor(() => expect(current().queueState).toBe("paused")); await act(async () => finish(modelOutput));
    expect(api.saveReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("继续整理")); await waitFor(() => expect(api.saveReview).toHaveBeenCalledTimes(1));
  });
  it("records invalid AI output without replacing saved metadata and retries explicitly", async () => {
    const { api, current } = queueAdapter({ ...snapshot, queueState: "running", documents: [{ ...snapshot.documents[0], summary: "以前的摘要" }] });
    const model = vi.fn().mockResolvedValueOnce("invalid JSON").mockResolvedValue(modelOutput);
    render(<LibraryInbox adapter={api} runModel={model} visible model="test" modelReady />);
    await waitFor(() => expect(current().queueState).toBe("idle")); expect(current().documents[0].summary).toBe("以前的摘要"); expect(api.saveReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("重试失败项（1）")); await waitFor(() => expect(api.saveReview).toHaveBeenCalledTimes(1));
    expect(current().documents[0].summary).toBe("整理完成");
  });
});
