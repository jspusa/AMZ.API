import { describe, expect, it, vi } from "vitest";
import {
  abortableDelay,
  forwardAbort,
  throwIfAborted,
  waitForPromiseWithSignal,
} from "../src/main/abort-utils";

describe("main-process abort utilities", () => {
  it("forwards the exact abort reason and can detach", () => {
    const source = new AbortController();
    const target = new AbortController();
    const stop = forwardAbort(target, source.signal);
    const reason = new Error("stopped");
    source.abort(reason);
    expect(target.signal.aborted).toBe(true);
    expect(target.signal.reason).toBe(reason);
    stop();
  });

  it("rejects a pending delay without leaving its timer active", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws synchronously for an already-aborted signal", () => {
    const controller = new AbortController();
    controller.abort(new Error("already stopped"));
    expect(() => throwIfAborted(controller.signal)).toThrow("already stopped");
  });

  it("cancels one waiter without cancelling a shared promise", async () => {
    let resolve!: (value: string) => void;
    const shared = new Promise<string>((done) => { resolve = done; });
    const controller = new AbortController();
    const cancelled = waitForPromiseWithSignal(shared, controller.signal);
    const survivor = waitForPromiseWithSignal(shared);
    controller.abort(new Error("drawer closed"));
    await expect(cancelled).rejects.toThrow("drawer closed");
    resolve("ready");
    await expect(survivor).resolves.toBe("ready");
  });
});
