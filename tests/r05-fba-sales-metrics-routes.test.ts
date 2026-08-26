import { describe, expect, it, vi } from "vitest";
import { FbaSalesMetricsRoutes } from
  "../src/main/fba-sales-metrics-routes";
import {
  SpExecutionContextError,
  type OpaqueAccountScope,
  type SpExecutionContext,
} from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const CONTEXT = Object.freeze({
  marketplaceId: US,
  region: "na",
  mode: "demo",
  accountScope: "opaque-r05-account" as OpaqueAccountScope,
  generation: 5,
}) satisfies SpExecutionContext;

function request(
  path: "/api/sp-api/sales-trend" | "/api/sp-api/replenishment-plan",
  query: Record<string, string>,
): ApiRequest {
  return {
    requestId: path.includes("sales-trend")
      ? "r05-sales-trend-direct-001"
      : "r05-replenishment-direct-001",
    method: "GET",
    path,
    query,
    headers: {},
  };
}

function harness(input: {
  salesTrend?: () => Promise<unknown>;
  replenishment?: () => Promise<unknown>;
  assertCurrent?: () => Promise<void>;
} = {}) {
  const capture = vi.fn(async () => CONTEXT);
  const assertCurrent = vi.fn(
    input.assertCurrent ?? (async () => undefined),
  );
  const salesTrend = vi.fn(
    input.salesTrend ?? (async () => ({ kind: "trend" })),
  );
  const replenishment = vi.fn(
    input.replenishment ?? (async () => ({ kind: "replenishment" })),
  );
  const routes = new FbaSalesMetricsRoutes({
    context: {
      capture,
      assertCurrent,
      invalidate: vi.fn(),
    },
    salesTrend,
    replenishment,
  });
  return { routes, capture, assertCurrent, salesTrend, replenishment };
}

describe("R05 FBA Sales Metrics route owner", () => {
  it("forwards only the closed Sales Trend semantics and fences the result", async () => {
    const subject = harness();
    const routeRequest = request("/api/sp-api/sales-trend", {
      marketplaceId: US,
      days: "30",
      comparison: "previous-year",
      host: "https://example.invalid",
      path: "/unsafe",
      method: "POST",
      fulfillmentNetwork: "MFN",
      granularity: "Hour",
      buyerType: "Business",
      duration: "365",
    });

    const response = await subject.routes.salesTrend(routeRequest);

    expect(subject.capture).toHaveBeenCalledWith(US);
    expect(subject.salesTrend).toHaveBeenCalledWith({
      marketplaceId: US,
      days: 30,
      startDate: null,
      endDate: null,
      comparison: "previous-year",
    });
    expect(subject.assertCurrent).toHaveBeenCalledWith(CONTEXT);
    expect(response).toMatchObject({
      status: 200,
      body: { kind: "json", value: { kind: "trend" } },
    });
  });

  it("preserves custom Sales Trend windows and the default comparison", async () => {
    const subject = harness();

    await subject.routes.salesTrend(request("/api/sp-api/sales-trend", {
      marketplaceId: US,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    }));

    expect(subject.salesTrend).toHaveBeenCalledWith({
      marketplaceId: US,
      days: null,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      comparison: "none",
    });
  });

  it("preserves the no-query US seven-day default", async () => {
    const subject = harness();

    await subject.routes.salesTrend(
      request("/api/sp-api/sales-trend", {}),
    );

    expect(subject.salesTrend).toHaveBeenCalledWith({
      marketplaceId: US,
      days: 7,
      startDate: null,
      endDate: null,
      comparison: "none",
    });
  });

  it.each([
    [{ marketplaceId: "invalid" }, "不支援這個 Amazon 站點。"],
    [
      {
        marketplaceId: US,
        days: "7",
        startDate: "2026-02-01",
        endDate: "2026-02-28",
      },
      "預設天數與自訂日期不可同時使用。",
    ],
    [
      { marketplaceId: US, startDate: "2026-02-01" },
      "自訂日期必須同時提供開始日與結束日。",
    ],
    [
      { marketplaceId: US, days: "10" },
      "銷售趨勢只支援最近 7、14、30 或 90 天。",
    ],
    [
      {
        marketplaceId: US,
        startDate: "2026-2-01",
        endDate: "2026-02-28",
      },
      "自訂日期必須使用 YYYY-MM-DD 格式。",
    ],
    [
      { marketplaceId: US, comparison: "previous-period" },
      "不支援這個銷售趨勢比較方式。",
    ],
  ] as const)(
    "preserves Sales Trend validation for %o",
    async (query, message) => {
      const subject = harness();

      const response = await subject.routes.salesTrend(
        request("/api/sp-api/sales-trend", { ...query }),
      );

      expect(response).toMatchObject({
        status: 400,
        body: { kind: "json", value: { code: "INVALID_INPUT", message } },
      });
      expect(subject.salesTrend).not.toHaveBeenCalled();
    },
  );

  it("forwards exact-SKU replenishment inputs without caller transport knobs", async () => {
    const subject = harness();
    const routeRequest = request("/api/sp-api/replenishment-plan", {
      marketplaceId: US,
      sku: " EXACT-SKU ",
      targetDays: "60",
      leadTimeDays: "35",
      safetyDays: "14",
      casePack: "6",
      duration: "90",
      fulfillmentNetwork: "MFN",
      granularity: "Hour",
      buyerType: "Business",
      host: "https://example.invalid",
      path: "/unsafe",
    });

    const response = await subject.routes.replenishment(routeRequest);

    expect(subject.capture).toHaveBeenCalledWith(US);
    expect(subject.replenishment).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "EXACT-SKU",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 6,
    });
    expect(subject.assertCurrent).toHaveBeenCalledWith(CONTEXT);
    expect(response).toMatchObject({
      status: 200,
      body: { kind: "json", value: { kind: "replenishment" } },
    });
  });

  it("preserves replenishment defaults and validation", async () => {
    const subject = harness();

    await subject.routes.replenishment(
      request("/api/sp-api/replenishment-plan", {
        marketplaceId: US,
        sku: "DEFAULT-SKU",
      }),
    );
    expect(subject.replenishment).toHaveBeenCalledWith({
      marketplaceId: US,
      sellerSku: "DEFAULT-SKU",
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 14,
      casePack: 1,
    });

    const invalidWindow = await subject.routes.replenishment(
      request("/api/sp-api/replenishment-plan", {
        marketplaceId: US,
        sku: "DEFAULT-SKU",
        targetDays: "30",
        leadTimeDays: "20",
        safetyDays: "14",
      }),
    );
    expect(invalidWindow).toMatchObject({
      status: 400,
      body: {
        kind: "json",
        value: {
          code: "INVALID_RESTOCK_WINDOW",
          message:
            "目標庫存天數不能小於補貨交期加安全庫存，否則補貨建議會互相矛盾。",
        },
      },
    });
  });

  it("preserves sanitized facade and unknown-error envelopes", async () => {
    const rateLimited = harness({
      salesTrend: async () => {
        throw new SpApiError("Amazon Sales API 正在限流，請稍後再試。", {
          status: 429,
          code: "RATE_LIMITED",
          requestId: "request-r05-rate-limit",
          retryAfter: "7",
        });
      },
    });
    const rateLimitedResponse = await rateLimited.routes.salesTrend(
      request("/api/sp-api/sales-trend", { marketplaceId: US }),
    );
    expect(rateLimitedResponse).toEqual({
      status: 429,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
        "retry-after": "7",
      },
      body: {
        kind: "json",
        value: {
          code: "RATE_LIMITED",
          message: "Amazon Sales API 正在限流，請稍後再試。",
          requestId: "request-r05-rate-limit",
          issues: [],
          operation: null,
          upstreamCode: null,
        },
      },
    });

    const invalidVelocity = harness({
      replenishment: async () => {
        throw new SpApiError(
          "FBA Sales Velocity 必須使用完整且精確的 Seller SKU。",
          { status: 400, code: "INVALID_SALES_TREND_RANGE" },
        );
      },
    });
    const invalidVelocityResponse = await invalidVelocity.routes.replenishment(
      request("/api/sp-api/replenishment-plan", {
        marketplaceId: US,
        sku: "INVALID-VELOCITY-SKU",
      }),
    );
    expect(invalidVelocityResponse).toEqual({
      status: 400,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
      body: {
        kind: "json",
        value: {
          code: "INVALID_SALES_TREND_RANGE",
          message: "FBA Sales Velocity 必須使用完整且精確的 Seller SKU。",
          requestId: null,
          issues: [],
          operation: null,
          upstreamCode: null,
        },
      },
    });

    const unknown = harness({
      replenishment: async () => {
        throw new Error("secret upstream details");
      },
    });
    const unknownResponse = await unknown.routes.replenishment(
      request("/api/sp-api/replenishment-plan", {
        marketplaceId: US,
        sku: "UNKNOWN-ERROR-SKU",
      }),
    );
    expect(unknownResponse).toEqual({
      status: 500,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
      body: {
        kind: "json",
        value: {
          code: "INTERNAL_ERROR",
          message: "建立 FBA 補貨建議時發生未預期的錯誤。",
        },
      },
    });
    expect(JSON.stringify(unknownResponse)).not.toContain("secret upstream");
  });

  it("rejects a stale execution context before publication", async () => {
    const stale = harness({
      assertCurrent: async () => {
        throw new SpExecutionContextError(
          "ACCOUNT_SCOPE_CHANGED",
          "Amazon 帳號範圍已改變；本次操作已停止。",
        );
      },
    });
    const staleResponse = await stale.routes.replenishment(
      request("/api/sp-api/replenishment-plan", {
        marketplaceId: US,
        sku: "STALE-SKU",
      }),
    );
    expect(staleResponse).toMatchObject({
      status: 409,
      body: {
        kind: "json",
        value: {
          code: "ACCOUNT_SCOPE_CHANGED",
          message: "Amazon 帳號範圍已改變；本次操作已停止。",
        },
      },
    });
  });
});
