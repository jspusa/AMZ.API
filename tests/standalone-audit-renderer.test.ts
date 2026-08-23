import { describe, expect, it, vi } from "vitest";
import {
  observeStandaloneAuditJob,
  parseStandaloneAuditJob,
  pollStandaloneAuditJob,
  shouldResumeStandaloneAuditJob,
  startStandaloneAuditJob,
  standaloneAuditReconnectRevision,
  standaloneAuditHomeProgress,
} from "../src/renderer/src/standalone-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function runningPayload(): Record<string, unknown> {
  return {
    jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
    contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
    kind: "content",
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    options: {},
    ready: false,
    status: "running",
    progress: {
      stage: "listing_rows",
      message: "正在核對商品文案",
      completedUnits: 3,
      totalUnits: 10,
    },
  };
}

describe("standalone audit renderer observer", () => {
  it("explains the transient Pages/new-app rollout boundary", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      code: "NOT_FOUND",
      message: "此 App 版本不支援這個操作。",
    }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    try {
      await expect(startStandaloneAuditJob({
        kind: "content",
        marketplaceId: MARKETPLACE_ID,
        mode: "live",
      })).rejects.toThrow(/Notebook Key 版本過舊/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("strictly parses a fenced job and exposes home progress", () => {
    const job = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    expect(standaloneAuditHomeProgress(job)).toEqual({
      active: true,
      label: "正在核對商品文案",
      completedUnits: 3,
      totalUnits: 10,
    });
    expect(() => parseStandaloneAuditJob({
      ...runningPayload(),
      marketplaceId: "A2EUQ1WTGCTBG2",
    }, {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    })).toThrow(/站點/u);
  });

  it("re-enters the same job when its prop advances from pending to terminal", () => {
    const pending = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    const terminal = parseStandaloneAuditJob({
      ...runningPayload(),
      ready: true,
      status: "completed",
      progress: {
        stage: "complete",
        message: "文案健檢完成",
        completedUnits: 10,
        totalUnits: 10,
      },
      snapshot: { rows: [] },
    }, {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    expect(terminal.jobId).toBe(pending.jobId);
    expect(terminal.contextId).toBe(pending.contextId);
    expect(standaloneAuditReconnectRevision(terminal))
      .not.toBe(standaloneAuditReconnectRevision(pending));
    expect(shouldResumeStandaloneAuditJob({
      initialJob: pending,
      expectedKind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      observerJobId: pending.jobId,
    })).toBe(false);
    expect(shouldResumeStandaloneAuditJob({
      initialJob: terminal,
      expectedKind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      observerJobId: pending.jobId,
    })).toBe(true);
  });

  it("reconnects with GET only and stopping the observer does not cancel the main job", async () => {
    const request = vi.fn(async (input: Readonly<{
      method: "GET";
      path: string;
      query: Record<string, string>;
      signal?: AbortSignal;
    }>) => ({
      ...runningPayload(),
      ready: true,
      status: "completed",
      progress: {
        stage: "complete",
        message: "文案健檢完成",
        completedUnits: 10,
        totalUnits: 10,
      },
      snapshot: { rows: [] },
    }));
    const expected = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    const terminal = await pollStandaloneAuditJob({
      request,
      expected,
      wait: async () => undefined,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: "GET",
      path: "/api/sp-api/standalone-audit",
      query: {
        jobId: expected.jobId,
        contextId: expected.contextId,
        kind: "content",
        marketplaceId: MARKETPLACE_ID,
      },
    });
    expect(terminal).toMatchObject({ ready: true, status: "completed" });
  });

  it("keeps the home GET observer alive through four transient failures and then completes", async () => {
    const request = vi.fn(async (_input: Readonly<{
      method: "GET";
      path: string;
      query: Record<string, string>;
      signal?: AbortSignal;
    }>): Promise<unknown> => ({
      ...runningPayload(),
      ready: true,
      status: "completed",
      progress: {
        stage: "complete",
        message: "文案健檢完成",
        completedUnits: 10,
        totalUnits: 10,
      },
      snapshot: { rows: [] },
    }));
    request
      .mockRejectedValueOnce(new TypeError("temporary network failure 1"))
      .mockRejectedValueOnce(new TypeError("temporary network failure 2"))
      .mockRejectedValueOnce(new TypeError("temporary network failure 3"))
      .mockRejectedValueOnce(new TypeError("temporary network failure 4"));
    const wait = vi.fn(async (
      _delayMs: number,
      _signal?: AbortSignal,
    ) => undefined);
    const expected = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    const terminal = await observeStandaloneAuditJob({
      request,
      expected,
      wait,
    });

    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.every(([call]) => call.method === "GET")).toBe(true);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([
      1_500,
      3_000,
      6_000,
      12_000,
    ]);
    expect(terminal).toMatchObject({ ready: true, status: "completed" });
  });

  it("does not retry an expired permanent job response", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: "AUDIT_JOB_EXPIRED",
      message: "這個背景健檢工作已過期。",
    }), {
      status: 410,
      headers: { "content-type": "application/json" },
    }));
    globalThis.fetch = fetchMock as typeof fetch;
    const expected = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });
    try {
      await expect(observeStandaloneAuditJob({
        expected,
        wait: async () => undefined,
      })).rejects.toThrow(/已過期/u);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("removes the wait abort listener after a normal polling delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let requestCount = 0;
    const request = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) return runningPayload();
      return {
        ...runningPayload(),
        ready: true,
        status: "completed",
        progress: {
          stage: "complete",
          message: "文案健檢完成",
          completedUnits: 10,
          totalUnits: 10,
        },
        snapshot: { rows: [] },
      };
    });
    const expected = parseStandaloneAuditJob(runningPayload(), {
      kind: "content",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
    });

    try {
      const pending = pollStandaloneAuditJob({
        request,
        expected,
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(750);
      await expect(pending).resolves.toMatchObject({
        ready: true,
        status: "completed",
      });
      expect(addListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
        { once: true },
      );
      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
