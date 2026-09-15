/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeWordsPlugin } from "./TypeWordsPlugin";
import { TYPEWORDS_PLUGIN } from "./typewords";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("TypeWords local plugin", () => {
  it("connects locally and persists disabling without touching learning data", async () => {
    const request = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", request);
    render(<TypeWordsPlugin />);
    const frame = await screen.findByTitle("TypeWords 英语学习");
    expect(frame.getAttribute("src")).toBe(TYPEWORDS_PLUGIN.entryUrl);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    fireEvent.click(screen.getByRole("button", { name: "停用插件" }));
    expect(screen.queryByTitle("TypeWords 英语学习")).toBeNull();
    expect(localStorage.getItem(TYPEWORDS_PLUGIN.storageKey)).toBe("false");
    cleanup();
    render(<TypeWordsPlugin />);
    expect(screen.getByText("英语学习插件已停用")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "启用插件" }));
    await screen.findByTitle("TypeWords 英语学习");
  });

  it("shows recovery instructions and reconnects after the service starts", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    vi.stubGlobal("fetch", request);
    render(<TypeWordsPlugin />);
    await screen.findByText("尚未连接 TypeWords");
    expect(screen.queryByTitle("TypeWords 英语学习")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await screen.findByTitle("TypeWords 英语学习");
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
