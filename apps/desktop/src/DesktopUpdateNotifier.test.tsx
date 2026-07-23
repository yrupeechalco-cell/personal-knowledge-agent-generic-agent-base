// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdateNotifier } from "./DesktopUpdateNotifier";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.2.5") }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => checkMock() }));

describe("DesktopUpdateNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("offers and installs a signed desktop update", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      onEvent({ event: "Finished" });
    });
    checkMock.mockResolvedValue({
      version: "0.2.1",
      body: "Graph and agent improvements",
      downloadAndInstall
    });

    render(<DesktopUpdateNotifier />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.getByText("发现新版本 v0.2.1")).toBeTruthy();
    expect(screen.getByText("Graph and agent improvements")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(screen.getByText("v0.2.1 已安装")).toBeTruthy();
  });

  it("keeps an install error distinct and retries the same update", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValueOnce("Updater URL contains two installer names")
      .mockResolvedValueOnce(undefined);
    checkMock.mockResolvedValue({
      version: "0.2.4",
      body: "Updater repair",
      downloadAndInstall
    });

    render(<DesktopUpdateNotifier />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    });

    expect(screen.getByText("更新安装失败")).toBeTruthy();
    expect(screen.getByText("Updater URL contains two installer names")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试安装" }));
    });

    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(screen.getByText("v0.2.4 已安装")).toBeTruthy();
  });

  it("lets the user disable startup update checks and shows trust metadata", async () => {
    render(<DesktopUpdateNotifier />);
    await act(async () => {
      window.dispatchEvent(new Event("knowledge-agent:open-update-settings"));
      await Promise.resolve();
    });

    expect(screen.getByText("更新与信任")).toBeTruthy();
    expect(screen.getByText("yrupeechalco-cell")).toBeTruthy();
    expect(screen.getByText("安装前强制执行 Tauri Ed25519 验证")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(window.localStorage.getItem("knowledge-agent:auto-update-check")).toBe("false");
  });
});
