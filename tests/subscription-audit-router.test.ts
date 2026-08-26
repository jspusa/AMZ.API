import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { getFbaSubscriptionAudit } from "../src/main/amazon/sp-api";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { SubscriptionAuditOwner } from
  "../src/main/amazon/subscription-audit-owner";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const previousMode = process.env.SP_API_MODE;

function get(path: string, query: Record<string, string>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path,
    query,
    headers: {},
  };
}

describe("FBA Subscribe & Save audit routes", () => {
  const vault = {
    getAccountScope: async () => "test-account-scope",
  } as unknown as CredentialVault;
  let router: ApiRouter;

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    router = new ApiRouter({
      store: {} as LocalStore,
      vault,
      approveWrite: async () => undefined,
    });
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("preserves the single-SKU Subscribe & Save route and DTO contract", async () => {
    const response = await router.handle(
      get("/api/sp-api/subscribe-save", {
        marketplaceId: "ATVPDKIKX0DER",
        sku: "AFA-TRKY-4OZ",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON");
    expect(response.body.value).toMatchObject({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
      found: true,
      writable: false,
      requestId: null,
      rateLimit: "1 request/second",
    });
    expect(Object.keys(response.body.value as Record<string, unknown>).sort())
      .toEqual([
        "amazonFundedBaseDiscount",
        "amazonFundedTieredDiscount",
        "asin",
        "autoEnrollment",
        "deliveryConditions",
        "eligibility",
        "enrollmentMethod",
        "fetchedAt",
        "forecastDeliveries",
        "found",
        "inventory",
        "marketplaceId",
        "mode",
        "notice",
        "price",
        "rateLimit",
        "requestId",
        "sellerFundedBaseDiscount",
        "sellerFundedTieredDiscount",
        "sellerSku",
        "stockRisk",
        "subscriptions",
        "writable",
      ].sort());

    const unsupported = await router.handle(
      get("/api/sp-api/subscribe-save", {
        marketplaceId: "A19VAU5U5O7RUS",
        sku: "AFA-TRKY-4OZ",
      }),
    );
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.kind).toBe("json");
    if (unsupported.body.kind !== "json") throw new Error("Expected JSON");
    expect(unsupported.body.value).toMatchObject({
      code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED",
    });
  });

  it("returns a server snapshot with selected-month totals and omitted missing points", async () => {
    const response = await router.handle(
      get("/api/sp-api/subscription-audit", {
        marketplaceId: "ATVPDKIKX0DER",
        months: "6",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON");
    const value = response.body.value as Record<string, unknown>;
    expect(value).toMatchObject({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      requestedMonths: 6,
      exportId: expect.any(String),
      historyCapability: {
        supportsSinceEnrollmentMonthlySeries: false,
        maximumOfficialLookbackMonths: 23,
      },
      inventoryEvidence: {
        source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
        coverage: "complete",
        returnedInventoryRows: 5,
        provenSkuCount: 5,
        unrecognizedSellerSkuRows: 0,
        verifiableReplenishmentOfferCount: 5,
        unverifiedFbaSkuCount: 0,
      },
      upstreamCoverage: {
        status: "complete",
        rejectedSellerSkuRows: 0,
        minimumUnresolvedOfferMonths: 0,
      },
    });
    const intervals = value.intervals as Array<{ month: string }>;
    const offers = value.offers as Array<{
      currentActiveSubscriptions: number;
      monthlySeries: Array<{ month: string; subscriptionRevenue: number | null }>;
    }>;
    const summary = value.summary as {
      currentActiveSubscriptions: number;
      provenSubscriptionRevenue: number | null;
      revenueCurrencyCode: string | null;
      revenueCoverage: {
        status: string;
        expectedOfferMonths: number;
        reportedOfferMonths: number;
      };
    };
    expect(intervals).toHaveLength(6);
    expect(offers).toHaveLength(5);
    expect(offers[4]!.monthlySeries).toHaveLength(5);
    expect(offers[4]!.monthlySeries.some((point) => point.month === intervals[0]!.month)).toBe(false);
    expect(summary.currentActiveSubscriptions).toBe(
      offers.reduce((sum, offer) => sum + offer.currentActiveSubscriptions, 0),
    );
    expect(summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "partial",
        expectedOfferMonths: 30,
        reportedOfferMonths: 29,
      },
    });
  });

  it("downloads five normal discount sheets plus an isolated problem sheet by exportId", async () => {
    const audit = await router.handle(
      get("/api/sp-api/subscription-audit", {
        marketplaceId: "ATVPDKIKX0DER",
        months: "12",
      }),
    );
    if (audit.body.kind !== "json") throw new Error("Expected JSON");
    const exportId = (audit.body.value as { exportId: string }).exportId;
    const response = await router.handle(
      get("/api/sp-api/subscription-audit/export", {
        marketplaceId: "ATVPDKIKX0DER",
        exportId,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(response.headers["x-exported-fba-offer-count"]).toBe("5");
    expect(response.headers["x-subscription-audit-months"]).toBe("12");
    expect(response.body.kind).toBe("bytes");
    if (response.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    const archive = unzipSync(response.body.value);
    const workbook = strFromU8(archive["xl/workbook.xml"]!);
    expect(workbook.match(/<sheet /gu)).toHaveLength(6);
    for (const sheet of ["0%", "5%", "10%", "15%", "20%"] as const) {
      expect(workbook).toContain(`name="${sheet}"`);
    }
    expect(workbook).toContain('name="問題 SKU"');
    const intervals = (audit.body.value as { intervals: Array<{ month: string }> }).intervals;
    const twentyPercent = strFromU8(archive["xl/worksheets/sheet5.xml"]!);
    expect(twentyPercent.match(/DEMO-SNS-5/gu)).toHaveLength(12);
    for (const interval of intervals) {
      expect(twentyPercent).toContain(interval.month);
    }
    expect(twentyPercent).toContain("資料涵蓋不完整；未將部分加總冒充完整總額");
    expect(twentyPercent).toContain("已證明 FBA 5 個；可核對 offer 5 個；未取得可核對 offer 0 個");
    expect(twentyPercent).toContain("Amazon 未回傳此 SKU 月度列");
  });

  it("keeps a null Seller base discount out of 0% and visible once in the problem sheet", async () => {
    router.dispose();
    const spExecutionContext = createScriptedSpExecutionContextAdapter(
      (marketplaceId) => ({
        marketplaceId,
        mode: "demo",
        accountScope: "test-account-scope",
      }),
    );
    const subscriptionAudit = new SubscriptionAuditOwner({
      context: spExecutionContext,
      readSnapshot: async ({ marketplaceId, months, signal }) => {
        const snapshot = await getFbaSubscriptionAudit({
          marketplaceId,
          months,
          signal,
        });
        return {
          ...snapshot,
          offers: snapshot.offers.map((offer, index) => index === 0
            ? { ...offer, sellerFundedBaseDiscount: null }
            : offer),
        };
      },
    });
    router = new ApiRouter({
      store: {} as LocalStore,
      vault,
      approveWrite: async () => undefined,
      spExecutionContext,
      subscriptionAudit,
    });

    const audit = await router.handle(
      get("/api/sp-api/subscription-audit", {
        marketplaceId: "ATVPDKIKX0DER",
        months: "6",
      }),
    );
    if (audit.body.kind !== "json") throw new Error("Expected JSON");
    const exportId = (audit.body.value as { exportId: string }).exportId;

    const response = await router.handle(
      get("/api/sp-api/subscription-audit/export", {
        marketplaceId: "ATVPDKIKX0DER",
        exportId,
      }),
    );
    expect(response.status).toBe(200);
    if (response.body.kind !== "bytes") throw new Error("Expected XLSX bytes");
    const archive = unzipSync(response.body.value);
    const zeroPercent = strFromU8(archive["xl/worksheets/sheet1.xml"]!);
    const issue = strFromU8(archive["xl/worksheets/sheet6.xml"]!);
    expect(zeroPercent).not.toContain("DEMO-SNS-1");
    expect(issue).toContain("DEMO-SNS-1");
    expect(issue).toContain("不歸入 0% 工作表，也不代表 0%");
    expect(issue.match(/DEMO-SNS-1/gu)).toHaveLength(1);
  });

  it("rejects invalid months and unknown export IDs", async () => {
    const invalidMonths = await router.handle(
      get("/api/sp-api/subscription-audit", {
        marketplaceId: "ATVPDKIKX0DER",
        months: "24",
      }),
    );
    expect(invalidMonths.status).toBe(400);
    const nonContractMonths = await router.handle(
      get("/api/sp-api/subscription-audit", {
        marketplaceId: "ATVPDKIKX0DER",
        months: "1",
      }),
    );
    expect(nonContractMonths.status).toBe(400);
    const missing = await router.handle(
      get("/api/sp-api/subscription-audit/export", {
        marketplaceId: "ATVPDKIKX0DER",
        exportId: crypto.randomUUID(),
      }),
    );
    expect(missing.status).toBe(410);
  });
});
