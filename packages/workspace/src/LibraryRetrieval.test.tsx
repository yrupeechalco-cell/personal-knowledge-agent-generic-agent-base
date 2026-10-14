// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryRetrieval } from "./LibraryRetrieval";
import type { LibraryAdapter, LibrarySnapshot } from "./libraryModel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("retrieval workflow", () => {
  it("reads across batches, expands context, copies actual excerpts and refuses stale copies", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const s: LibrarySnapshot = { version: 2, roots: [], documents: Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, path: `求职${i}.txt`, rootId: "root", revision: "1", size: 10, updatedAt: 1, text: `求职案例${i}\n${"更多上下文".repeat(200)}`, issue: null, status: "pending", summary: "", category: "", tags: [] })) };
    const api = { load: vi.fn(async () => structuredClone(s)), scan: vi.fn(), saveReview: vi.fn() } as unknown as LibraryAdapter;
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<LibraryRetrieval adapter={api} snapshot={s} />);
    fireEvent.change(screen.getByLabelText("检索主题"), { target: { value: "求职" } });
    fireEvent.click(screen.getByRole("button", { name: "查找相关资料" }));
    expect(await screen.findByText(/已显示 4 组正文节选/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "补读上下文" })[0]);
    expect(await screen.findByText(/上下文 · 索引/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续查看下一批/ }));
    expect(await screen.findByText(/已显示 5 组正文节选/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制节选与出处" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("求职4.txt");
    await screen.findByText(/已复制已显示/);
    s.documents[0].text += "已修改";
    fireEvent.click(screen.getByRole("button", { name: "复制节选与出处" }));
    expect((await screen.findByRole("alert")).textContent).toContain("变化");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(api.scan).not.toHaveBeenCalled(); expect(api.saveReview).not.toHaveBeenCalled();
  });
});
