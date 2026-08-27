import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceId } from "../src/shared/marketplaces";
import {
  createFbaSalesTrend,
  throwFbaSalesFacadeError,
  type FbaSalesTrendDependencies,
} from "../src/main/amazon/fba-sales-trend";
import { FbaSalesMetricsError } from
  "../src/main/amazon/fba-sales-metrics";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-03-10T12:00:00.000Z");

function dependencies(input: {
  demoMode: boolean;
  configured: boolean;
  label?: string;
}): FbaSalesTrendDependencies {
  return {
    usesDemoMode: () => input.demoMode,
    isConfiguredForMarketplace: () => input.configured,
    marketplaceLabel: () => input.label ?? "美國",
    getAccessToken: async () => "unused-in-demo-tests",
    invalidateAccessToken: () => undefined,
  };
}

async function demoNotice(input: {
  configured: boolean;
  label?: string;
}): Promise<string> {
  const getSalesTrend = createFbaSalesTrend(
    dependencies({ demoMode: true, ...input }),
  );
  const snapshot = await getSalesTrend({
    marketplaceId: MARKETPLACE_ID,
    days: 7,
  });
  return snapshot.notice;
}

describe("FBA sales trend facade module", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves the forced-demo notice when credentials are configured", async () => {
    await expect(demoNotice({ configured: true })).resolves.toBe(
      "目前由 SP_API_MODE 強制使用展示資料；趨勢只供版面測試。",
    );
  });

  it("preserves the marketplace-specific notice when credentials are absent", async () => {
    await expect(
      demoNotice({ configured: false, label: "美國" }),
    ).resolves.toBe(
      "美國站尚未在本機系統安全儲存區加入 refresh token，因此顯示展示趨勢。",
    );
  });

  it("maps planning failures to the existing public range error", async () => {
    const getSalesTrend = createFbaSalesTrend(
      dependencies({ demoMode: true, configured: false }),
    );

    const failure = getSalesTrend({
      marketplaceId: MARKETPLACE_ID,
      days: 10,
    } as unknown as Parameters<typeof getSalesTrend>[0]);

    await expect(failure).rejects.toBeInstanceOf(SpApiError);
    await expect(failure).rejects.toMatchObject({
      status: 400,
      code: "INVALID_SALES_TREND_RANGE",
      requestId: null,
      retryAfter: null,
    });
  });

  it("preserves Sales API status, code, request id, and retry-after", () => {
    const source = new FbaSalesMetricsError("Amazon Sales API 正在限流。", {
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-safe-123",
      retryAfter: "7",
    });

    let mapped: unknown;
    try {
      throwFbaSalesFacadeError(source);
    } catch (error) {
      mapped = error;
    }

    expect(mapped).toBeInstanceOf(SpApiError);
    expect(mapped).toMatchObject({
      message: "Amazon Sales API 正在限流。",
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-safe-123",
      retryAfter: "7",
    });
  });

  it("does not reinterpret unrelated failures", () => {
    const source = new Error("local invariant");
    expect(() => throwFbaSalesFacadeError(source)).toThrow(source);
  });

  it("keeps the public input tied to a marketplace id", async () => {
    const seen: MarketplaceId[] = [];
    const getSalesTrend = createFbaSalesTrend({
      ...dependencies({ demoMode: true, configured: true }),
      usesDemoMode: (marketplaceId) => {
        seen.push(marketplaceId);
        return true;
      },
    });

    await getSalesTrend({ marketplaceId: MARKETPLACE_ID, days: 7 });

    expect(seen).toEqual([MARKETPLACE_ID]);
  });
});
