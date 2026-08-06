import { describe, expect, it } from "vitest";
import {
  findExactInventorySummary,
  inventorySummariesFromResponse,
} from "../src/main/amazon/sp-api";

describe("FBA Inventory response envelope", () => {
  it("reads inventory summaries from Amazon's nested payload", () => {
    const summaries = inventorySummariesFromResponse({
      payload: {
        granularity: {
          granularityType: "Marketplace",
          granularityId: "ATVPDKIKX0DER",
        },
        inventorySummaries: [
          {
            sellerSku: "SAFE-SKU-1",
            fnSku: "SAFE-FNSKU-1",
            inventoryDetails: {
              fulfillableQuantity: 8902,
              inboundWorkingQuantity: 100,
              inboundShippedQuantity: 14900,
              inboundReceivingQuantity: 0,
              reservedQuantity: { totalReservedQuantity: 5705 },
            },
          },
        ],
      },
      pagination: {},
    });

    expect(summaries).not.toBeNull();
    const summary = summaries!.find((item) => item.sellerSku === "SAFE-SKU-1");
    expect(summary?.inventoryDetails).toMatchObject({
      fulfillableQuantity: 8902,
      inboundWorkingQuantity: 100,
      inboundShippedQuantity: 14900,
      inboundReceivingQuantity: 0,
      reservedQuantity: { totalReservedQuantity: 5705 },
    });
  });

  it("treats a valid empty list differently from a malformed 200 response", () => {
    expect(
      inventorySummariesFromResponse({ payload: { inventorySummaries: [] } }),
    ).toEqual([]);
    expect(inventorySummariesFromResponse({ inventorySummaries: [] })).toBeNull();
    expect(inventorySummariesFromResponse({ payload: {} })).toBeNull();
  });

  it("keeps Seller SKU matching exact and case-sensitive", () => {
    const summaries = inventorySummariesFromResponse({
      payload: {
        inventorySummaries: [
          { sellerSku: "SAFE-SKU-1", inventoryDetails: {} },
        ],
      },
    });

    expect(findExactInventorySummary(summaries!, "SAFE-SKU-1")).not.toBeNull();
    expect(findExactInventorySummary(summaries!, "safe-sku-1")).toBeNull();
  });

  it("rejects malformed summaries instead of treating them as zero inventory", () => {
    expect(
      inventorySummariesFromResponse({ payload: { inventorySummaries: [null] } }),
    ).toBeNull();
    expect(
      inventorySummariesFromResponse({
        payload: { inventorySummaries: [{ sellerSku: "SAFE-SKU-1" }] },
      }),
    ).toBeNull();
    expect(
      inventorySummariesFromResponse({
        payload: {
          inventorySummaries: [
            {
              sellerSku: "SAFE-SKU-1",
              inventoryDetails: { fulfillableQuantity: "unknown" },
            },
          ],
        },
      }),
    ).toBeNull();
  });
});
