import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopInstallGate,
  DesktopUpdater,
} from "../src/main/desktop-updater";

class FakeUpdaterAdapter extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn(async () => {
    this.emit("checking-for-update");
    this.emit("update-available", { version: "0.1.38" });
    return { updateInfo: { version: "0.1.38" } };
  });
  downloadUpdate = vi.fn(async () => {
    this.emit("update-downloaded", { version: "0.1.38" });
    return [] as string[];
  });
  quitAndInstall = vi.fn();
}

describe("signed desktop updater", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks and downloads in the background after a signed app starts", async () => {
    vi.useFakeTimers();
    const adapter = new FakeUpdaterAdapter();
    const statuses: string[] = [];
    const updater = new DesktopUpdater({
      adapter,
      currentVersion: "0.1.37",
      policy: { enabled: true, message: null },
      publishStatus: (status) => statuses.push(status.state),
      installBlockReason: () => null,
      prepareInstall: () => undefined,
      initialCheckDelayMs: 1_000,
      checkIntervalMs: 60_000,
    });

    updater.start();
    expect(adapter.checkForUpdates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(adapter.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    expect(statuses).toContain("downloaded");

    updater.stop();
  });

  it("keeps the target version while publishing a rounded and bounded percentage", () => {
    const adapter = new FakeUpdaterAdapter();
    const published: Array<{ state: string; percent?: number }> = [];
    const updater = new DesktopUpdater({
      adapter,
      currentVersion: "0.1.37",
      policy: { enabled: true, message: null },
      publishStatus: (status) => published.push(status),
      installBlockReason: () => null,
      prepareInstall: () => undefined,
    });

    updater.start();
    adapter.emit("update-available", { version: "0.1.38" });
    adapter.emit("download-progress", { percent: 48.6 });
    adapter.emit("download-progress", { percent: 140 });

    expect(published.at(-2)).toEqual({
      state: "downloading",
      version: "0.1.38",
      percent: 49,
    });
    expect(published.at(-1)).toEqual({
      state: "downloading",
      version: "0.1.38",
      percent: 100,
    });
    updater.stop();
  });

  it("turns repeated restart clicks into one installer handoff", () => {
    const adapter = new FakeUpdaterAdapter();
    const prepareInstall = vi.fn();
    const updater = new DesktopUpdater({
      adapter,
      currentVersion: "0.1.37",
      policy: { enabled: true, message: null },
      publishStatus: () => undefined,
      installBlockReason: () => null,
      prepareInstall,
    });

    updater.start();
    adapter.emit("update-downloaded", { version: "0.1.38" });
    updater.install();
    updater.install();

    expect(prepareInstall).toHaveBeenCalledTimes(1);
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(adapter.quitAndInstall).toHaveBeenCalledWith(true, true);
    updater.stop();
  });

  it("blocks protected operations during handoff and rolls back a synchronous installer failure", () => {
    const adapter = new FakeUpdaterAdapter();
    const installGate = new DesktopInstallGate();
    adapter.quitAndInstall.mockImplementationOnce(() => {
      expect(() => installGate.assertOperationAllowed()).toThrow(
        "安全更新正在安裝",
      );
      throw new Error("installer handoff failed");
    });
    const updater = new DesktopUpdater({
      adapter,
      currentVersion: "0.1.37",
      policy: { enabled: true, message: null },
      publishStatus: () => undefined,
      installBlockReason: () => null,
      prepareInstall: () => installGate.begin(),
    });

    updater.start();
    adapter.emit("update-downloaded", { version: "0.1.38" });
    expect(() => updater.install()).toThrow("installer handoff failed");
    expect(() => installGate.assertOperationAllowed()).not.toThrow();
    updater.stop();
  });

  it("rolls back the install gate when the updater reports an asynchronous handoff error", () => {
    const adapter = new FakeUpdaterAdapter();
    const installGate = new DesktopInstallGate();
    const updater = new DesktopUpdater({
      adapter,
      currentVersion: "0.1.37",
      policy: { enabled: true, message: null },
      publishStatus: () => undefined,
      installBlockReason: () => null,
      prepareInstall: () => installGate.begin(),
    });

    updater.start();
    adapter.emit("update-downloaded", { version: "0.1.38" });
    updater.install();
    expect(() => installGate.assertOperationAllowed()).toThrow(
      "安全更新正在安裝",
    );

    adapter.emit("error", new Error("installer handoff failed later"));
    expect(() => installGate.assertOperationAllowed()).not.toThrow();
    expect(updater.currentStatus()).toMatchObject({
      state: "error",
      message: "安全更新未能啟動；既有 App 仍可正常使用，請重新檢查後再試。",
    });

    adapter.emit("update-downloaded", { version: "0.1.38" });
    updater.install();
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(2);
    adapter.emit("error", new Error("test cleanup"));
    updater.stop();
  });
});
