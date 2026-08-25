import { describe, expect, it, vi } from "vitest";
import {
  SubscriptionAuditOwner,
  type SubscriptionAuditSnapshotReader,
  type SubscriptionAuditSnapshot,
} from "../src/main/amazon/subscription-audit-owner";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const DIRECT_EXPORT_ID = "11111111-1111-4111-8111-111111111111";
const STANDALONE_EXPORT_ID = "22222222-2222-4222-8222-222222222222";
const LATE_EXPORT_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_EXPORT_ID = "44444444-4444-4444-8444-444444444444";

function get(path: string, query: Record<string, string>): ApiRequest {
  return {
    requestId: `subscription-owner-${path}-${Object.keys(query).length}`,
    method: "GET",
    path,
    query,
    headers: {},
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON response");
  return response.body.value as Record<string, unknown>;
}

function snapshot(): SubscriptionAuditSnapshot {
  const interval = {
    month: "2026-07",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-01T00:00:00.000Z",
  };
  return {
    mode: "demo",
    marketplaceId: US,
    requestedMonths: 6,
    fetchedAt: "2026-08-26T00:00:00.000Z",
    intervals: [interval],
    offers: [{
      sellerSku: "SUBSCRIPTION-OWNER-SKU",
      asin: "B000000001",
      price: { amount: 12.5, currencyCode: "USD" },
      sellerFundedBaseDiscount: null,
      sellerFundedTieredDiscount: null,
      currentActiveSubscriptions: 3,
      forecastDeliveries: null,
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      monthlySeries: [{
        interval,
        currencyCode: "USD",
        subscriptionRevenue: 25,
        shippedSubscriptionUnits: 2,
        activeSubscriptionsAtPeriodEnd: 3,
      }],
    }],
    excluded: [],
    upstreamCoverage: {
      status: "complete",
      returnedOfferRows: 1,
      acceptedOfferRows: 1,
      returnedMetricRows: 1,
      acceptedMetricRows: 1,
      invalidOfferRows: [],
      problemSkuRows: [],
      unprovenExactSkuProblems: {
        exactSkuCount: 0,
        affectedOfferRows: 0,
        affectedMetricRows: 0,
        minimumUnresolvedOfferMonths: 0,
      },
      rejectedSellerSkuRows: 0,
      minimumUnresolvedOfferMonths: 0,
      notice: "Complete.",
    },
    summary: {
      currentActiveSubscriptions: 3,
      provenSubscriptionRevenue: 25,
      revenueCurrencyCode: "USD",
      revenueCoverage: {
        status: "complete",
        expectedOfferMonths: 1,
        reportedOfferMonths: 1,
      },
      monthly: [],
    },
    historyCapability: {
      supportsSinceEnrollmentMonthlySeries: false,
      maximumOfficialLookbackMonths: 23,
      replacement: "REQUESTED_COMPLETE_CALENDAR_MONTHS",
      notice: "Fixed completed months.",
    },
    inventoryEvidence: {
      source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
      coverage: "complete",
      returnedInventoryRows: 1,
      provenSkuCount: 1,
      unrecognizedSellerSkuRows: 0,
      verifiableReplenishmentOfferCount: 1,
      unverifiedFbaSkuCount: 0,
    },
    notice: "FBA only.",
  } as unknown as SubscriptionAuditSnapshot;
}

describe("SubscriptionAuditOwner", () => {
  it("uses one capture/publish source for direct and standalone snapshots with distinct retention", async () => {
    let now = 100;
    const ids = [DIRECT_EXPORT_ID, STANDALONE_EXPORT_ID];
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "subscription-owner-account",
    }));
    const readSnapshot = vi.fn(async (
      _input: Parameters<SubscriptionAuditSnapshotReader>[0],
    ) => snapshot());
    const createWorkbook = vi.fn(() => new Uint8Array([1, 2, 3]));
    const owner = new SubscriptionAuditOwner({
      context,
      readSnapshot,
      createWorkbook,
      directTtlMs: 10,
      standaloneTtlMs: 30,
      now: () => now,
      createId: () => ids.shift() ?? "99999999-9999-4999-8999-999999999999",
    });

    const direct = await owner.read(get("/api/sp-api/subscription-audit", {
      marketplaceId: US,
      months: "6",
    }));
    expect(direct.status).toBe(200);
    expect(jsonValue(direct)).toMatchObject({
      marketplaceId: US,
      requestedMonths: 6,
      exportId: DIRECT_EXPORT_ID,
      offers: [{
        sellerSku: "SUBSCRIPTION-OWNER-SKU",
        monthlySeries: [{ month: "2026-07", subscriptionRevenue: 25 }],
      }],
    });

    const standalone = await owner.runStandalone({
      marketplaceId: US,
      months: 6,
      signal: new AbortController().signal,
    });
    expect(standalone).toMatchObject({
      marketplaceId: US,
      exportId: STANDALONE_EXPORT_ID,
    });
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(readSnapshot.mock.calls[0]?.[0]).toMatchObject({
      marketplaceId: US,
      months: 6,
      expectedContext: expect.objectContaining({
        marketplaceId: US,
        mode: "demo",
      }),
    });

    now = 111;
    const expiredDirect = await owner.download(get(
      "/api/sp-api/subscription-audit/export",
      { marketplaceId: US, exportId: DIRECT_EXPORT_ID },
    ));
    expect(expiredDirect.status).toBe(410);
    expect(jsonValue(expiredDirect)).toEqual({
      code: "SNAPSHOT_EXPIRED",
      message: "Subscribe & Save 健檢快照已過期或站點不符，請重新同步。",
    });

    const exported = await owner.download(get(
      "/api/sp-api/subscription-audit/export",
      { marketplaceId: US, exportId: STANDALONE_EXPORT_ID },
    ));
    expect(exported.status).toBe(200);
    expect(exported.body).toEqual({
      kind: "bytes",
      value: new Uint8Array([1, 2, 3]),
    });
    expect(exported.headers).toMatchObject({
      "cache-control": "private, no-store, max-age=0",
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x-content-type-options": "nosniff",
      "x-exported-fba-offer-count": "1",
      "x-subscription-audit-months": "6",
    });
    expect(createWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      metricMonths: ["2026-07"],
      problems: [expect.objectContaining({
        sellerSku: "SUBSCRIPTION-OWNER-SKU",
        bucket: null,
        problem:
          "Amazon 未回傳 Seller 基礎折扣；只列入問題 SKU，並非 0%。",
      })],
    }));

    owner.clear();
    const cleared = await owner.download(get(
      "/api/sp-api/subscription-audit/export",
      { marketplaceId: US, exportId: STANDALONE_EXPORT_ID },
    ));
    expect(cleared.status).toBe(410);
  });

  it("does not publish a late semantic result after clear", async () => {
    let release: ((value: SubscriptionAuditSnapshot) => void) | undefined;
    const pending = new Promise<SubscriptionAuditSnapshot>((resolve) => {
      release = resolve;
    });
    const createId = vi.fn(() => LATE_EXPORT_ID);
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "subscription-owner-account",
    }));
    const readSnapshot = vi.fn(async (
      _input: Parameters<SubscriptionAuditSnapshotReader>[0],
    ) => pending);
    const owner = new SubscriptionAuditOwner({
      context,
      readSnapshot,
      createId,
    });

    const reading = owner.read(get("/api/sp-api/subscription-audit", {
      marketplaceId: US,
      months: "6",
    }));
    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledOnce());
    owner.clear();
    release?.(snapshot());

    const response = await reading;
    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(createId).not.toHaveBeenCalled();
  });

  it("aborts a direct semantic read on clear and gives the next lifecycle a fresh signal", async () => {
    let firstSignal: AbortSignal | undefined;
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope: "subscription-owner-account",
    }));
    const readSnapshot = vi.fn((
      input: Parameters<SubscriptionAuditSnapshotReader>[0],
    ): Promise<SubscriptionAuditSnapshot> => {
      firstSignal ??= input.signal;
      if (readSnapshot.mock.calls.length > 1) return Promise.resolve(snapshot());
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => {
          reject(input.signal?.reason);
        }, { once: true });
      });
    });
    const owner = new SubscriptionAuditOwner({
      context,
      readSnapshot,
      createId: () => DIRECT_EXPORT_ID,
    });

    const reading = owner.read(get("/api/sp-api/subscription-audit", {
      marketplaceId: US,
      months: "6",
    }));
    await vi.waitFor(() => expect(readSnapshot).toHaveBeenCalledOnce());

    expect(firstSignal).toBeInstanceOf(AbortSignal);
    owner.clear();
    expect(firstSignal?.aborted).toBe(true);
    expect(firstSignal?.reason).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    await expect(reading).resolves.toMatchObject({ status: 409 });

    const fresh = await owner.read(get("/api/sp-api/subscription-audit", {
      marketplaceId: US,
      months: "6",
    }));
    expect(fresh.status).toBe(200);
    expect(readSnapshot.mock.calls[1]?.[0].signal).not.toBe(firstSignal);
    expect(readSnapshot.mock.calls[1]?.[0].signal?.aborted).toBe(false);
  });

  it("preserves route validation and rejects account drift before workbook creation", async () => {
    let accountScope = "subscription-owner-account-one";
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: US,
      mode: "demo",
      accountScope,
    }));
    const createWorkbook = vi.fn(() => new Uint8Array([1]));
    const owner = new SubscriptionAuditOwner({
      context,
      readSnapshot: vi.fn(async (
        _input: Parameters<SubscriptionAuditSnapshotReader>[0],
      ) => snapshot()),
      createWorkbook,
      createId: () => ACCOUNT_EXPORT_ID,
    });

    const invalidMonths = await owner.read(get(
      "/api/sp-api/subscription-audit",
      { marketplaceId: US, months: "24" },
    ));
    expect(invalidMonths.status).toBe(400);

    await owner.read(get("/api/sp-api/subscription-audit", {
      marketplaceId: US,
      months: "6",
    }));
    accountScope = "subscription-owner-account-two";
    const drifted = await owner.download(get(
      "/api/sp-api/subscription-audit/export",
      { marketplaceId: US, exportId: ACCOUNT_EXPORT_ID },
    ));
    expect(drifted.status).toBe(409);
    expect(jsonValue(drifted)).toEqual({
      code: "ACCOUNT_SCOPE_CHANGED",
      message: "Amazon 帳號範圍已改變，舊健檢快照不可匯出。",
    });
    expect(createWorkbook).not.toHaveBeenCalled();
  });
});
