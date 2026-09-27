// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryMap } from "./DirectoryMap";
import { ReadOnlyStorageExplorer, type ReadOnlyDirectoryListing } from "./KnowledgeWorkspace";
import { LibraryInbox } from "./LibraryInbox";
import type { LibraryAdapter } from "./libraryModel";
afterEach(() => { cleanup(); vi.useRealTimers(); });
const listing: ReadOnlyDirectoryListing = { root: "C:\\资料", path: "", truncated: false, entries: [
  { name: "照片", path: "照片", kind: "directory" },
  { name: "大视频.mp4", path: "大视频.mp4", kind: "file", extension: "mp4", size: 2 * 1024 ** 3 },
  { name: "外部链接", path: "外部链接", kind: "symlink" }
] };
describe("physical directory map", () => {
  it("shows actual parent entries including large media, without opening linked targets", () => {
    const folder = vi.fn(), file = vi.fn();
    render(<DirectoryMap listing={listing} query="" busy={false} onOpenDirectory={folder} onOpenFile={file}/>);
    fireEvent.click(screen.getByRole("button", { name: /照片/ }));
    fireEvent.click(screen.getByRole("button", { name: /大视频/ }));
    fireEvent.click(screen.getByRole("button", { name: /外部链接/ }));
    expect(folder).toHaveBeenCalledExactlyOnceWith("照片");
    expect(file).toHaveBeenCalledExactlyOnceWith("大视频.mp4");
    expect(screen.getByText("视频 · 2.0 GB")).toBeTruthy();
    expect(document.querySelectorAll(".directory-map-lines path")).toHaveLength(3);
  });
  it("paginates large directories and recovers when refresh removes the last page", () => {
    const many = { ...listing, entries: Array.from({ length: 33 }, (_, i) => ({ name: `file-${i}.txt`, path: `file-${i}.txt`, kind: "file" as const })) };
    const props = { query: "", busy: false, onOpenDirectory: vi.fn(), onOpenFile: vi.fn() };
    const mounted = render(<DirectoryMap listing={many} {...props}/>);
    expect(document.querySelectorAll(".directory-map-node")).toHaveLength(16);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByRole("button", { name: /file-32/ })).toBeTruthy();
    mounted.rerender(<DirectoryMap listing={listing} {...props}/>);
    expect(screen.getByRole("button", { name: /照片/ })).toBeTruthy();
  });
  it("clears the parent search when drilling down and preserves a list fallback", () => {
    const props = { busy: false, onOpenDirectory: vi.fn(), onOpenFile: vi.fn(), onClosePreview: vi.fn(), preview: null };
    const mounted = render(<ReadOnlyStorageExplorer listing={listing} {...props}/>);
    fireEvent.change(screen.getByPlaceholderText("搜索当前目录"), { target: { value: "照片" } });
    mounted.rerender(<ReadOnlyStorageExplorer listing={{ ...listing, path: "照片", entries: [{ name: "海边.jpg", path: "照片/海边.jpg", kind: "file", extension: "jpg" }] }} {...props}/>);
    expect((screen.getByPlaceholderText("搜索当前目录") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /海边/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "列表" }));
    expect(screen.getByRole("table", { name: "文件和文件夹" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "上一级" }));
    expect(props.onOpenDirectory).toHaveBeenCalledWith("");
  });
  it("suspends hidden library scans and cancels saving an in-flight AI result", async () => {
    vi.useFakeTimers();
    const snapshot = { version: 3, roots: [{ id: "r", path: "C:/资料", paused: false, lastScan: 1, issue: null }], documents: [{ id: "d", rootId: "r", path: "a.txt", text: "测试文件正文", revision: "1", size: 10, updatedAt: 1, issue: null, status: "pending" as const, summary: "", category: "", tags: [] }], queueState: "running" as const };
    let resolve!: (text: string) => void;
    const model = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const api = { load: vi.fn(async () => snapshot), scan: vi.fn(async () => snapshot), configure: vi.fn(async () => snapshot), saveReview: vi.fn(async () => snapshot) } as unknown as LibraryAdapter;
    const mounted = render(<LibraryInbox adapter={api} visible={false} model="test" modelReady runModel={model}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(model).toHaveBeenCalledTimes(1);
    mounted.rerender(<LibraryInbox adapter={api} visible={false} model="test" modelReady runModel={model} suspended/>);
    await act(async () => { resolve(JSON.stringify({ summary: "摘要", categories: ["分类"], tags: [] })); await vi.advanceTimersByTimeAsync(60000); });
    expect(api.scan).not.toHaveBeenCalled();
    expect(api.saveReview).not.toHaveBeenCalled();
    expect(model).toHaveBeenCalledTimes(1);
  });
});
