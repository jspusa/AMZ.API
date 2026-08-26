import { describe, expect, it, vi } from "vitest";
import {
  listingPricePatchBody,
  type ListingPriceGateway,
} from "../src/main/amazon/listing-price-gateway";
import type {
  ListingPriceSnapshot,
  UpdateListingSalePriceInput,
} from "../src/main/amazon/listing-price-types";
import { createListingPriceMutationOperations } from
  "../src/main/listing-price-mutations";
import { SpExecutionContextError } from
  "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const IDENTITY = {
  marketplaceId: US,
  sellerSku: "AFA-TRKY-4OZ",
} as const;
const CURRENT_FENCE = { assertCurrent: async () => undefined } as const;

function priceSnapshot(amount: number): ListingPriceSnapshot {
  return {
    mode: "live",
    ...IDENTITY,
    asin: "B09S5VY2JS",
    title: "Turkey Tendon",
    productType: "PET_FOOD",
    status: ["BUYABLE"],
    createdAt: null,
    updatedAt: null,
    standardPrice: { amount, currencyCode: "USD" },
    effectivePrice: { amount, currencyCode: "USD" },
    minimumPrice: null,
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-08-26T06:30:00.000Z",
    requestId: "w02-operation-read",
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 12,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
  };
}

function liveGateway(input: Readonly<{
  read: ListingPriceGateway["read"];
  validationPreview?: ListingPriceGateway["validationPreview"];
  commitOnce?: ListingPriceGateway["commitOnce"];
}>): ListingPriceGateway {
  return {
    mode: () => "live",
    read: input.read,
    setDemoStandardPrice: () => undefined,
    setDemoSalePrice: () => undefined,
    validationPreview: input.validationPreview ?? vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "w02-preview-request",
      retryAfter: null,
      payload: { status: "VALID", issues: [] },
    })),
    commitOnce: input.commitOnce ?? vi.fn(async () => ({
      ok: true,
      status: 200,
      requestId: "w02-commit-request",
      retryAfter: null,
      payload: { status: "ACCEPTED", submissionId: "w02-submission", issues: [] },
    })),
  };
}

describe("Listing Price mutation operations", () => {
  it("performs one Standard Price fresh read, Validation Preview, fenced PATCH, and exact canonical patch", async () => {
    const events: string[] = [];
    const validationPreview = vi.fn<ListingPriceGateway["validationPreview"]>(
      async () => {
        events.push("validation-preview");
        return {
          ok: true,
          status: 200,
          requestId: "w02-preview-request",
          retryAfter: null,
          payload: { status: "VALID", issues: [] },
        };
      },
    );
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>(
      async (_input, fence) => {
        await fence?.assertCurrent();
        events.push("commit-patch");
        return {
          ok: true,
          status: 200,
          requestId: "w02-commit-request",
          retryAfter: null,
          payload: {
            status: "ACCEPTED",
            submissionId: "w02-submission",
            issues: [],
          },
        };
      },
    );
    const gateway = liveGateway({
      read: vi.fn(async () => {
        events.push("fresh-read");
        return priceSnapshot(13.99);
      }),
      validationPreview,
      commitOnce,
    });
    const operations = createListingPriceMutationOperations(gateway);

    const result = await operations.commitStandard({
      ...IDENTITY,
      expectedPrice: 13.99,
      newPrice: 14.99,
    }, {
      assertCurrent: async () => {
        events.push("pre-send-fence");
      },
    });

    const expectedPatch = {
      kind: "standard-price" as const,
      ...IDENTITY,
      productType: "PET_FOOD",
      currencyCode: "USD",
      amount: 14.99,
    };
    expect(events).toEqual([
      "fresh-read",
      "validation-preview",
      "pre-send-fence",
      "commit-patch",
    ]);
    expect(validationPreview).toHaveBeenCalledOnce();
    expect(validationPreview).toHaveBeenCalledWith(expectedPatch);
    expect(commitOnce).toHaveBeenCalledOnce();
    expect(commitOnce.mock.calls[0]?.[0]).toEqual(expectedPatch);
    expect(listingPricePatchBody(expectedPatch)).toEqual({
      productType: "PET_FOOD",
      patches: [{
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [{
          marketplace_id: US,
          currency: "USD",
          audience: "ALL",
          our_price: [{ schedule: [{ value_with_tax: 14.99 }] }],
        }],
      }],
    });
    expect(result).toMatchObject({
      status: "ACCEPTED",
      previousPrice: { amount: 13.99, currencyCode: "USD" },
      requestedPrice: { amount: 14.99, currencyCode: "USD" },
    });
  });

  it("proves zero PATCHes when the Standard Price expected-old value is stale", async () => {
    const validationPreview = vi.fn<ListingPriceGateway["validationPreview"]>();
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>();
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => priceSnapshot(13.99)),
      validationPreview,
      commitOnce,
    }));

    await expect(operations.commitStandard({
      ...IDENTITY,
      expectedPrice: 12.99,
      newPrice: 14.99,
    }, CURRENT_FENCE)).rejects.toMatchObject({
      code: "PRICE_CHANGED",
      status: 409,
    });
    expect(validationPreview).not.toHaveBeenCalled();
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("preserves an ACCEPTED response with contradictory issues for canonical resolution", async () => {
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => priceSnapshot(13.99)),
      commitOnce: vi.fn(async (_input, fence) => {
        await fence.assertCurrent();
        return {
          ok: true,
          status: 200,
          requestId: "w02-accepted-with-issue",
          retryAfter: null,
          payload: {
            status: "ACCEPTED",
            submissionId: "w02-accepted-with-issue-submission",
            issues: [{
              code: "CONTRADICTORY_UPSTREAM_ISSUE",
              severity: "ERROR",
              message: "scripted contradictory issue",
            }],
          },
        };
      }),
    }));

    const result = await operations.commitStandard({
      ...IDENTITY,
      expectedPrice: 13.99,
      newPrice: 14.99,
    }, CURRENT_FENCE);

    expect(result.status).toBe("ACCEPTED");
    expect(result.issues).toEqual([expect.objectContaining({
      code: "CONTRADICTORY_UPSTREAM_ISSUE",
      severity: "ERROR",
    })]);
  });

  it("classifies an unrecognized successful Sale Price response as unknown", async () => {
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => priceSnapshot(20)),
      commitOnce: vi.fn(async (_input, fence) => {
        await fence.assertCurrent();
        return {
          ok: true,
          status: 200,
          requestId: "w02-sale-processing",
          retryAfter: null,
          payload: { status: "PROCESSING", issues: [] },
        };
      }),
    }));

    await expect(operations.commitSale({
      ...IDENTITY,
      action: "set",
      expectedPrice: 20,
      expectedDiscountedPrice: null,
      expectedStartAt: null,
      expectedEndAt: null,
      salePrice: 15.99,
      startAt: "2026-09-01",
      endAt: "2026-09-30",
    }, CURRENT_FENCE)).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
  });

  it("rechecks the execution fence after the demo read and before mutating demo state", async () => {
    const setDemoStandardPrice = vi.fn();
    const gateway: ListingPriceGateway = {
      mode: () => "demo",
      read: vi.fn(async () => ({
        ...priceSnapshot(13.99),
        mode: "demo" as const,
      })),
      setDemoStandardPrice,
      setDemoSalePrice: vi.fn(),
      validationPreview: vi.fn(),
      commitOnce: vi.fn(),
    };
    const operations = createListingPriceMutationOperations(gateway);

    await expect(operations.commitStandard({
      ...IDENTITY,
      expectedPrice: 13.99,
      newPrice: 14.99,
    }, {
      assertCurrent: async () => {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "scripted post-read invalidation",
        );
      },
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(setDemoStandardPrice).not.toHaveBeenCalled();
  });

  it("rechecks the execution fence before mutating demo Sale Price state", async () => {
    const setDemoSalePrice = vi.fn();
    const gateway: ListingPriceGateway = {
      mode: () => "demo",
      read: vi.fn(async () => ({
        ...priceSnapshot(20),
        mode: "demo" as const,
      })),
      setDemoStandardPrice: vi.fn(),
      setDemoSalePrice,
      validationPreview: vi.fn(),
      commitOnce: vi.fn(),
    };
    const operations = createListingPriceMutationOperations(gateway);

    await expect(operations.commitSale({
      ...IDENTITY,
      action: "set",
      expectedPrice: 20,
      expectedDiscountedPrice: null,
      expectedStartAt: null,
      expectedEndAt: null,
      salePrice: 15.99,
      startAt: "2026-09-01",
      endAt: "2026-09-30",
    }, {
      assertCurrent: async () => {
        throw new SpExecutionContextError(
          "SP_CONTEXT_INVALIDATED",
          "scripted post-read invalidation",
        );
      },
    })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(setDemoSalePrice).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "mismatched identity",
      snapshot: { ...priceSnapshot(13.99), sellerSku: "OTHER-SKU" },
      code: "LISTING_IDENTITY_MISMATCH",
    },
    {
      label: "non-FBA evidence",
      snapshot: {
        ...priceSnapshot(13.99),
        fulfillmentAvailability: [{
          channelCode: "DEFAULT",
          quantity: 12,
          fulfillment: "OTHER" as const,
          editable: false,
        }],
      },
      code: "FBA_ONLY",
    },
    {
      label: "missing exact ASIN",
      snapshot: { ...priceSnapshot(13.99), asin: null },
      code: "LISTING_IDENTITY_MISMATCH",
    },
    {
      label: "generic product type",
      snapshot: { ...priceSnapshot(13.99), productType: "PRODUCT" },
      code: "LISTING_IDENTITY_MISMATCH",
    },
  ])("rejects $label before price Validation Preview", async ({
    snapshot,
    code,
  }) => {
    const validationPreview = vi.fn<ListingPriceGateway["validationPreview"]>();
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>();
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => snapshot),
      validationPreview,
      commitOnce,
    }));

    await expect(operations.commitStandard({
      ...IDENTITY,
      expectedPrice: 13.99,
      newPrice: 14.99,
    }, CURRENT_FENCE)).rejects.toMatchObject({ code });
    expect(validationPreview).not.toHaveBeenCalled();
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("proves zero PATCHes when the expected Sale Price schedule is stale", async () => {
    const validationPreview = vi.fn<ListingPriceGateway["validationPreview"]>();
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>();
    const snapshot = {
      ...priceSnapshot(20),
      effectivePrice: { amount: 15.99, currencyCode: "USD" },
      discountedPrice: {
        price: { amount: 15.99, currencyCode: "USD" },
        startAt: "2026-09-01",
        endAt: "2026-09-30",
      },
      discountedPricePresence: "valid" as const,
      hasDiscountedPrice: true,
    } satisfies ListingPriceSnapshot;
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => snapshot),
      validationPreview,
      commitOnce,
    }));

    await expect(operations.commitSale({
      ...IDENTITY,
      action: "set",
      expectedPrice: 20,
      expectedDiscountedPrice: 14.99,
      expectedStartAt: "2026-09-01",
      expectedEndAt: "2026-09-30",
      salePrice: 15.49,
      startAt: "2026-10-01",
      endAt: "2026-10-31",
    }, CURRENT_FENCE)).rejects.toMatchObject({
      status: 409,
      code: "SALE_PRICE_CHANGED",
    });
    expect(validationPreview).not.toHaveBeenCalled();
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "sets",
      snapshot: priceSnapshot(20),
      input: {
        ...IDENTITY,
        action: "set",
        expectedPrice: 20,
        expectedDiscountedPrice: null,
        expectedStartAt: null,
        expectedEndAt: null,
        salePrice: 15.99,
        startAt: "2026-09-01",
        endAt: "2026-09-30",
      } satisfies UpdateListingSalePriceInput,
      discountedPrice: [{
        schedule: [{
          start_at: "2026-09-01",
          end_at: "2026-09-30",
          value_with_tax: 15.99,
        }],
      }],
    },
    {
      label: "cancels",
      snapshot: {
        ...priceSnapshot(20),
        effectivePrice: { amount: 15.99, currencyCode: "USD" },
        discountedPrice: {
          price: { amount: 15.99, currencyCode: "USD" },
          startAt: "2026-09-01",
          endAt: "2026-09-30",
        },
        discountedPricePresence: "valid",
        hasDiscountedPrice: true,
      } satisfies ListingPriceSnapshot,
      input: {
        ...IDENTITY,
        action: "cancel",
        expectedPrice: 20,
        expectedDiscountedPrice: 15.99,
        expectedStartAt: "2026-09-01",
        expectedEndAt: "2026-09-30",
        salePrice: null,
        startAt: null,
        endAt: null,
      } satisfies UpdateListingSalePriceInput,
      discountedPrice: null,
    },
  ])("$label Sale Price with one exact canonical PATCH", async ({
    snapshot,
    input,
    discountedPrice,
  }) => {
    const validationPreview = vi.fn<ListingPriceGateway["validationPreview"]>(
      async () => ({
        ok: true,
        status: 200,
        requestId: "w02-sale-preview",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      }),
    );
    const commitOnce = vi.fn<ListingPriceGateway["commitOnce"]>(async () => ({
      ok: true,
      status: 200,
      requestId: "w02-sale-commit",
      retryAfter: null,
      payload: { status: "ACCEPTED", issues: [] },
    }));
    const operations = createListingPriceMutationOperations(liveGateway({
      read: vi.fn(async () => snapshot),
      validationPreview,
      commitOnce,
    }));

    await operations.commitSale(input, CURRENT_FENCE);

    const expectedPatch = {
      kind: "sale-price" as const,
      ...IDENTITY,
      productType: "PET_FOOD",
      currencyCode: "USD",
      discountedPrice: discountedPrice
        ? {
            amount: input.salePrice!,
            startAt: input.startAt!,
            endAt: input.endAt!,
          }
        : null,
    };
    expect(validationPreview).toHaveBeenCalledWith(expectedPatch);
    expect(commitOnce).toHaveBeenCalledOnce();
    expect(commitOnce.mock.calls[0]?.[0]).toEqual(expectedPatch);
    expect(listingPricePatchBody(expectedPatch)).toEqual({
      productType: "PET_FOOD",
      patches: [{
        op: "merge",
        path: "/attributes/purchasable_offer",
        value: [{
          marketplace_id: US,
          currency: "USD",
          audience: "ALL",
          discounted_price: discountedPrice,
        }],
      }],
    });
  });
});
