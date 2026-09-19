/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeWordsPlugin } from "./TypeWordsPlugin";
import { TYPEWORDS_PLUGIN } from "./typewords";
import { TypeWordsStartup } from "./TypeWordsStartup";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("TypeWords local plugin", () => {
  it("prepares enabled desktop plugins at App launch without opening an iframe", async () => {
    const adapter = { ensureStarted: vi.fn().mockResolvedValue(undefined), selectDirectory: vi.fn() };
    render(<TypeWordsStartup adapter={adapter} />);
    await waitFor(() => expect(adapter.ensureStarted).toHaveBeenCalledOnce());
    expect(screen.queryByTitle("TypeWords 英语学习")).toBeNull();
    cleanup();
    localStorage.setItem(TYPEWORDS_PLUGIN.storageKey, "false");
    render(<TypeWordsStartup adapter={adapter} />);
    expect(adapter.ensureStarted).toHaveBeenCalledOnce();
  });

  it("recovers native startup failure after selecting the installed build", async () => {
    const adapter = {
      ensureStarted: vi.fn().mockRejectedValueOnce(new Error("请选择已构建目录")).mockResolvedValue(undefined),
      selectDirectory: vi.fn().mockResolvedValue(true)
    };
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(<TypeWordsPlugin adapter={adapter} />);
    await screen.findByText("Error: 请选择已构建目录");
    fireEvent.click(screen.getByRole("button", { name: "选择 TypeWords 文件夹" }));
    await screen.findByTitle("TypeWords 英语学习");
    expect(adapter.selectDirectory).toHaveBeenCalledOnce();
    expect(adapter.ensureStarted).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });

  it("waits for native readiness before loading the page", async () => {
    let ready!: () => void;
    const adapter = { ensureStarted: vi.fn(() => new Promise<void>((resolve) => { ready = resolve; })), selectDirectory: vi.fn() };
    render(<TypeWordsPlugin adapter={adapter} />);
    expect(screen.queryByTitle("TypeWords 英语学习")).toBeNull();
    expect(screen.getByText("正在启动并连接本机 TypeWords…")).toBeTruthy();
    ready();
    await screen.findByTitle("TypeWords 英语学习");
  });

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
