import { describe, expect, it } from "vitest";
import {
  createScriptedFbaInventoryReplenishmentAdapter,
  fbaInventoryReadIdentity,
  readCurrentFbaEvidence,
  readFbaInventoryItem,
  readFbaSubscriptionAuditInputs,
  readReplenishmentInventoryInputs,
  readSubscribeAndSaveOffer,
} from "../src/main/amazon/fba-inventory-replenishment";

const US = "ATVPDKIKX0DER" as const;
const SG = "A19VAU5U5O7RUS" as const;
const AU = "A39IBJ37TRP1C6" as const;

function inventorySummary(
  sellerSku: string | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    sellerSku,
    asin: "B000000001",
    fnSku: "X000000001",
    inventoryDetails: {
      fulfillableQuantity: 0,
      inboundWorkingQuantity: 0,
      inboundShippedQuantity: 0,
      inboundReceivingQuantity: 0,
      reservedQuantity: { totalReservedQuantity: 0 },
      unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
      researchingQuantity: { totalResearchingQuantity: 0 },
    },
    ...overrides,
  };
}

function inventoryStep(
  envelope: unknown,
  requestId = "inventory-request",
) {
  return {
    operation: "inventory" as const,
    result: { envelope, requestId, rateLimit: "2" },
  };
}

function replenishmentStep(
  envelope: unknown,
  requestId = "replenishment-request",
) {
  return {
    operation: "replenishment" as const,
    result: { envelope, requestId, rateLimit: "1" },
  };
}

describe("FBA Inventory and Replenishment reads", () => {
  it("requires same-run exact current-FBA evidence before exposing a single-SKU subscription offer", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      {
        operation: "inventory",
        result: {
          envelope: { payload: { inventorySummaries: [] }, pagination: {} },
          requestId: "inventory-empty",
          rateLimit: "2",
        },
      },
    ]);

    await expect(
      readSubscribeAndSaveOffer(
        { marketplaceId: US, sellerSku: "EXACT-FBA-SKU" },
        { adapter, clock: () => new Date("2026-08-24T00:00:00.000Z") },
      ),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 404,
      code: "FBA_SKU_NOT_FOUND",
      requestId: "inventory-empty",
    });
    expect(adapter.requests).toEqual([
      {
        operation: "inventory",
        intent: "item",
        marketplaceId: US,
        sellerSku: "EXACT-FBA-SKU",
      },
    ]);
  });

  it("preserves the existing single-offer DTO normalization after current-FBA proof", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [inventorySummary("EXACT-FBA-SKU")],
        },
        pagination: {},
      }),
      replenishmentStep({
        offers: [
          {
            marketplaceId: US,
            programType: "SUBSCRIBE_AND_SAVE",
            sku: "EXACT-FBA-SKU",
            asin: " B000000001 ",
            eligibility: " ELIGIBLE ",
            price: "17.99",
            subscriptions: "not-reported",
            offerProgramConfiguration: {
              enrollmentMethod: " MANUAL ",
              preferences: { autoEnrollment: " OPTED_IN " },
              promotions: {
                sellingPartnerFundedBaseDiscount: { percentage: "5" },
              },
            },
            deliveriesConditions: [
              { condition: " VALID ", next30DaysDeliveries: "4" },
              { condition: " ", next30DaysDeliveries: 9 },
            ],
          },
        ],
        pagination: { totalResults: 1 },
      }),
    ]);

    const snapshot = await readSubscribeAndSaveOffer(
      { marketplaceId: US, sellerSku: "EXACT-FBA-SKU" },
      { adapter, clock: () => new Date("2026-08-24T00:00:00.000Z") },
    );

    expect(snapshot).toMatchObject({
      mode: "live",
      marketplaceId: US,
      sellerSku: "EXACT-FBA-SKU",
      found: true,
      asin: "B000000001",
      eligibility: "ELIGIBLE",
      enrollmentMethod: "MANUAL",
      autoEnrollment: "OPTED_IN",
      sellerFundedBaseDiscount: 5,
      price: { amount: 17.99, currencyCode: "USD" },
      subscriptions: null,
      fetchedAt: "2026-08-24T00:00:00.000Z",
      requestId: "replenishment-request",
      rateLimit: "1",
      writable: false,
      deliveryConditions: [
        { condition: "VALID", next30DaysDeliveries: 4 },
      ],
    });
    expect(adapter.requests.map(({ intent }) => intent)).toEqual([
      "item",
      "single-offer",
    ]);
  });

  it("fails through the controlled error seam when current-FBA ASIN identity is malformed", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [
            inventorySummary("EXACT-FBA-SKU", { asin: 123 }),
          ],
        },
      }, "malformed-inventory-identity"),
      replenishmentStep({
        offers: [
          {
            marketplaceId: US,
            programType: "SUBSCRIBE_AND_SAVE",
            sku: "EXACT-FBA-SKU",
            asin: "B000000001",
          },
        ],
      }),
    ]);

    await expect(
      readSubscribeAndSaveOffer(
        { marketplaceId: US, sellerSku: "EXACT-FBA-SKU" },
        { adapter },
      ),
    ).rejects.toMatchObject({
      name: "SpApiError",
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: "malformed-inventory-identity",
    });
    expect(adapter.requests).toEqual([
      {
        operation: "inventory",
        intent: "item",
        marketplaceId: US,
        sellerSku: "EXACT-FBA-SKU",
      },
    ]);
  });

  it("fails closed instead of choosing the first duplicate exact offer", async () => {
    const duplicate = {
      marketplaceId: US,
      programType: "SUBSCRIBE_AND_SAVE",
      sku: "EXACT-FBA-SKU",
      asin: "B000000001",
    };
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [inventorySummary("EXACT-FBA-SKU")],
        },
      }),
      replenishmentStep({ offers: [duplicate, { ...duplicate }] }),
    ]);

    await expect(
      readSubscribeAndSaveOffer(
        { marketplaceId: US, sellerSku: "EXACT-FBA-SKU" },
        { adapter },
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "PAGINATION_CHANGED",
      requestId: "replenishment-request",
    });
  });

  it("reads every Inventory page while keeping zero-stock exact SKUs and counting unknown rows", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [
            inventorySummary("FBA-ZERO"),
            inventorySummary(" NEEDS-TRIM"),
          ],
        },
        pagination: { nextToken: "page-2" },
      }, "inventory-page-1"),
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("FBA-TWO")] },
        pagination: {},
      }, "inventory-page-2"),
    ]);

    const evidence = await readCurrentFbaEvidence(
      { marketplaceId: US },
      { adapter },
    );

    expect([...evidence.knownFbaSkus]).toEqual(["FBA-ZERO", "FBA-TWO"]);
    expect(evidence).toMatchObject({
      returnedInventoryRows: 3,
      unrecognizedSellerSkuRows: 1,
    });
    expect(adapter.requests).toEqual([
      {
        operation: "inventory",
        intent: "catalog-page",
        marketplaceId: US,
        nextToken: null,
      },
      {
        operation: "inventory",
        intent: "catalog-page",
        marketplaceId: US,
        nextToken: "page-2",
      },
    ]);
  });

  it("fails closed on duplicate Inventory SKU or repeated nextToken", async () => {
    const duplicateSku = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("DUPLICATE")] },
        pagination: { nextToken: "page-2" },
      }),
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("DUPLICATE")] },
        pagination: {},
      }),
    ]);
    await expect(
      readCurrentFbaEvidence({ marketplaceId: US }, { adapter: duplicateSku }),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });

    const repeatedToken = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("PAGE-ONE")] },
        pagination: { nextToken: "same" },
      }),
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("PAGE-TWO")] },
        pagination: { nextToken: "same" },
      }),
    ]);
    await expect(
      readCurrentFbaEvidence({ marketplaceId: US }, { adapter: repeatedToken }),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });
  });

  it("rejects an empty nonterminal Inventory page, invalid token, and the 200-page ceiling", async () => {
    const emptyPage = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: { inventorySummaries: [] },
        pagination: { nextToken: "unexpected-next" },
      }),
    ]);
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: US },
        { adapter: emptyPage },
      ),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });

    const invalidToken = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("FBA-ONE")] },
        pagination: { nextToken: `bad\u0000token` },
      }),
    ]);
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: US },
        { adapter: invalidToken },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    const pageLimit = createScriptedFbaInventoryReplenishmentAdapter(
      Array.from({ length: 200 }, (_, index) =>
        inventoryStep({
          payload: {
            inventorySummaries: [
              inventorySummary(`FBA-${String(index).padStart(3, "0")}`),
            ],
          },
          pagination: { nextToken: `page-${index + 1}` },
        })
      ),
    );
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: US },
        { adapter: pageLimit },
      ),
    ).rejects.toMatchObject({ code: "PAGINATION_LIMIT_EXCEEDED" });
    expect(pageLimit.requests).toHaveLength(200);
  });

  it("normalizes the exact FBA Inventory quantities used by replenishment", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [
            inventorySummary("RESTOCK-SKU", {
              fnSku: " X000000009 ",
              inventoryDetails: {
                fulfillableQuantity: 7,
                inboundWorkingQuantity: 2,
                inboundShippedQuantity: 3,
                inboundReceivingQuantity: 4,
                reservedQuantity: { totalReservedQuantity: 1 },
                unfulfillableQuantity: { totalUnfulfillableQuantity: 5 },
                researchingQuantity: { totalResearchingQuantity: 6 },
              },
            }),
          ],
        },
      }, "restock-inventory"),
    ]);

    await expect(
      readReplenishmentInventoryInputs(
        { marketplaceId: US, sellerSku: "RESTOCK-SKU" },
        { adapter },
      ),
    ).resolves.toEqual({
      sellerSku: "RESTOCK-SKU",
      fnSku: "X000000009",
      inventory: {
        fulfillable: 7,
        reserved: 1,
        inboundWorking: 2,
        inboundShipped: 3,
        inboundReceiving: 4,
        unfulfillable: 5,
        researching: 6,
      },
      requestId: "restock-inventory",
      rateLimit: "2",
    });
  });

  it("uses same-run Inventory proof for the whole audit and never surfaces FBM or missing months as zero", async () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const fbaOffer = {
      marketplaceId: US,
      programType: "SUBSCRIBE_AND_SAVE",
      sku: "FBA-ONE",
      asin: "B000000001",
      eligibility: "ELIGIBLE",
      price: 17.99,
      priceCurrencyCode: "USD",
      subscriptions: 4,
      offerProgramConfiguration: {},
    };
    const fbmOffer = {
      ...fbaOffer,
      sku: "FBM-ONLY",
      asin: "B000000099",
    };
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: {
          inventorySummaries: [
            inventorySummary("FBA-ONE"),
            inventorySummary("FBA-NO-OFFER", { asin: "B000000002" }),
          ],
        },
        pagination: {},
      }),
      replenishmentStep({
        offers: [fbaOffer, fbmOffer],
        pagination: { totalResults: 2 },
      }),
      replenishmentStep({ offers: [], pagination: { totalResults: 0 } }),
    ]);

    const result = await readFbaSubscriptionAuditInputs(
      { marketplaceId: US, months: 1, now },
      { adapter },
    );

    expect(result.audit.offers).toHaveLength(1);
    expect(result.audit.offers[0]).toMatchObject({
      sellerSku: "FBA-ONE",
      fbaEvidence: "CURRENT_FBA_SKU_SET",
      monthlySeries: [],
    });
    expect(JSON.stringify(result.audit)).not.toContain("FBM-ONLY");
    expect(result.audit.summary).toMatchObject({
      provenSubscriptionRevenue: null,
      revenueCurrencyCode: null,
      revenueCoverage: {
        status: "unavailable",
        expectedOfferMonths: 1,
        reportedOfferMonths: 0,
      },
      monthly: [
        {
          provenSubscriptionRevenue: null,
          shippedSubscriptionUnits: null,
          activeSubscriptionsAtPeriodEnd: null,
        },
      ],
    });
    expect(result.inventoryEvidence).toEqual({
      source: "FBA_INVENTORY_API_COMPLETE_PAGINATION",
      coverage: "complete",
      returnedInventoryRows: 2,
      provenSkuCount: 2,
      unrecognizedSellerSkuRows: 0,
      verifiableReplenishmentOfferCount: 1,
      unverifiedFbaSkuCount: 1,
    });
    expect(adapter.requests.map(({ intent }) => intent)).toEqual([
      "catalog-page",
      "offers-page",
      "metrics-page",
    ]);
  });

  it("keeps the positive audit ceiling at exactly 23 completed months", async () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const currentOffer = {
      marketplaceId: US,
      programType: "SUBSCRIBE_AND_SAVE",
      sku: "FBA-ONE",
      asin: "B000000001",
      eligibility: "ELIGIBLE",
      price: 17.99,
      priceCurrencyCode: "USD",
      subscriptions: 4,
      offerProgramConfiguration: {},
    };
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      inventoryStep({
        payload: { inventorySummaries: [inventorySummary("FBA-ONE")] },
        pagination: {},
      }),
      replenishmentStep({
        offers: [currentOffer],
        pagination: { totalResults: 1 },
      }),
      ...Array.from({ length: 23 }, () =>
        replenishmentStep({ offers: [], pagination: { totalResults: 0 } })
      ),
    ]);

    const result = await readFbaSubscriptionAuditInputs(
      { marketplaceId: US, months: 23, now },
      { adapter },
    );

    expect(result.intervals).toHaveLength(23);
    expect(result.audit.historyCapability.maximumOfficialLookbackMonths).toBe(23);
    expect(adapter.requests.filter(({ intent }) => intent === "offers-page"))
      .toHaveLength(1);
    expect(adapter.requests.filter(({ intent }) => intent === "metrics-page"))
      .toHaveLength(23);
    expect(result.audit.summary.provenSubscriptionRevenue).toBeNull();
  });

  it.each([SG, AU])(
    "rejects unsupported marketplace %s before issuing any Inventory or Replenishment request",
    async (marketplaceId) => {
      const adapter = createScriptedFbaInventoryReplenishmentAdapter([]);
      await expect(
        readSubscribeAndSaveOffer(
          { marketplaceId, sellerSku: "EXACT-SKU" },
          { adapter },
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED",
      });
      await expect(
        readFbaSubscriptionAuditInputs(
          {
            marketplaceId,
            months: 23,
            now: new Date("2026-08-24T00:00:00.000Z"),
          },
          { adapter },
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: "REPLENISHMENT_MARKETPLACE_UNSUPPORTED",
      });
      expect(adapter.requests).toEqual([]);
    },
  );

  it("rejects semantic result identity drift and unknown runtime intents", async () => {
    const adapter = createScriptedFbaInventoryReplenishmentAdapter([
      {
        operation: "inventory",
        result: {
          identity: {
            operation: "inventory",
            intent: "item",
            marketplaceId: US,
            sellerSku: "OTHER-SKU",
          },
          envelope: {
            payload: {
              inventorySummaries: [inventorySummary("EXACT-SKU")],
            },
          },
          requestId: null,
          rateLimit: null,
        },
      },
    ]);
    await expect(
      readFbaInventoryItem(
        { marketplaceId: US, sellerSku: "EXACT-SKU" },
        { adapter },
      ),
    ).rejects.toMatchObject({ status: 502, code: "UPSTREAM_UNAVAILABLE" });

    expect(() =>
      fbaInventoryReadIdentity({
        intent: "arbitrary-http",
        marketplaceId: US,
      } as never),
    ).toThrow(/意圖不在允許清單/u);
  });
});
