import { describe, expect, it, vi } from "vitest";
import {
  SUPPLY_BOSS_OPERATIONS_BOARD_URL,
  SupplyBossOperationsBoard,
} from "../src/main/supply-boss-operations-board";

const SNAPSHOT = {
  schemaVersion: 1 as const,
  revision: 3,
  updatedAt: "2026-09-03T04:00:00.000Z",
  items: [{
    id: "8a9f0a88-e3e1-4fe9-9056-6b06fb990105",
    type: "expiry" as const,
    marketplaceId: "ATVPDKIKX0DER",
    sellerSku: "GSCL03",
    expiryDate: "2027-04-30",
    note: "需出清",
  }],
};

describe("Supply Boss operations board", () => {
  it("reads only the fixed public endpoint and keeps a last-known-good snapshot", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(SNAPSHOT), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockRejectedValueOnce(new Error("private network detail"));
    const board = new SupplyBossOperationsBoard({ request });

    await expect(board.read()).resolves.toMatchObject({
      snapshot: SNAPSHOT,
      source: "shared",
      stale: false,
      status: "ready",
    });
    await expect(board.read()).resolves.toMatchObject({
      snapshot: SNAPSHOT,
      source: "last-known-good",
      stale: true,
      status: "unavailable",
    });
    expect(request).toHaveBeenCalledWith(
      SUPPLY_BOSS_OPERATIONS_BOARD_URL,
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("keeps the password and bearer token inside main while replacing by revision", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/operations-board/login")) {
        expect(init?.body).toBe(JSON.stringify({
          username: "API",
          password: "temporary-test-password",
        }));
        return new Response(JSON.stringify({
          token: "a".repeat(80),
          expiresAt: "2026-09-03T12:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(new Headers(init?.headers).get("authorization"))
        .toBe(`Bearer ${"a".repeat(80)}`);
      expect(init?.body).toBe(JSON.stringify({
        baseRevision: 3,
        items: SNAPSHOT.items,
      }));
      return new Response(JSON.stringify({
        ...SNAPSHOT,
        revision: 4,
        updatedAt: "2026-09-03T04:05:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const board = new SupplyBossOperationsBoard({
      request,
      now: () => new Date("2026-09-03T04:00:00.000Z"),
    });

    await board.login({ username: "API", password: "temporary-test-password" });
    expect(board.sessionSummary()).toEqual({
      authenticated: true,
      username: "API",
      expiresAt: "2026-09-03T12:00:00.000Z",
    });
    await expect(board.replace({ baseRevision: 3, items: SNAPSHOT.items }))
      .resolves.toMatchObject({ revision: 4, items: SNAPSHOT.items });

    const serializedCalls = JSON.stringify(request.mock.calls);
    expect(serializedCalls).toContain("temporary-test-password");
    expect(JSON.stringify(board.sessionSummary())).not.toContain("temporary-test-password");
    expect(JSON.stringify(board.sessionSummary())).not.toContain("a".repeat(80));
  });

  it("clears an expired/rejected session and never retries an unknown write", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "b".repeat(80),
        expiresAt: "2026-09-03T12:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }));
    const board = new SupplyBossOperationsBoard({
      request,
      now: () => new Date("2026-09-03T04:00:00.000Z"),
    });
    await board.login({ username: "API", password: "temporary-test-password" });
    await expect(board.replace({ baseRevision: 3, items: SNAPSHOT.items }))
      .rejects.toMatchObject({ code: "OPERATIONS_BOARD_AUTH_REQUIRED" });
    expect(board.sessionSummary().authenticated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "server failure",
      () => new Response(JSON.stringify({ error: "temporary" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ],
    [
      "malformed success body",
      () => new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
    [
      "wrong success content type",
      () => new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ],
  ])("treats a %s as an unknown write result and does not retry", async (_label, response) => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "c".repeat(80),
        expiresAt: "2026-09-03T12:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response());
    const board = new SupplyBossOperationsBoard({
      request,
      now: () => new Date("2026-09-03T04:00:00.000Z"),
    });
    await board.login({ username: "API", password: "temporary-test-password" });

    await expect(board.replace({ baseRevision: 3, items: SNAPSHOT.items }))
      .rejects.toMatchObject({
        code: "OPERATIONS_BOARD_WRITE_UNKNOWN",
        message: expect.stringContaining("不會自動重送"),
      });
    expect(board.sessionSummary().authenticated).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports a validated pre-write 400 as rejected rather than unknown", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "d".repeat(80),
        expiresAt: "2026-09-03T12:00:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "公布欄內容格式不正確" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }));
    const board = new SupplyBossOperationsBoard({
      request,
      now: () => new Date("2026-09-03T04:00:00.000Z"),
    });
    await board.login({ username: "API", password: "temporary-test-password" });

    await expect(board.replace({ baseRevision: 3, items: SNAPSHOT.items }))
      .rejects.toMatchObject({
        code: "OPERATIONS_BOARD_WRITE_REJECTED",
        message: "公布欄內容格式不正確",
      });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels a chunked response as soon as it exceeds the 128 KiB bound", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(70 * 1024).fill(97));
        if (pulls >= 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const board = new SupplyBossOperationsBoard({
      request: vi.fn().mockResolvedValue(new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });

    await expect(board.login({
      username: "API",
      password: "temporary-test-password",
    })).rejects.toMatchObject({ code: "OPERATIONS_BOARD_TOO_LARGE" });
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });
});
