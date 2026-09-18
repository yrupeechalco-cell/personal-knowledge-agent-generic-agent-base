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
});
