import { describe, expect, it } from "vitest";
import { collectCurrentFbaSkuSet } from "../src/main/amazon/sp-api";

function summary(sellerSku: string) {
  return {
    sellerSku,
    asin: "B000000001",
    fnSku: `X-${sellerSku}`,
    inventoryDetails: {
      fulfillableQuantity: 0,
      inboundWorkingQuantity: 0,
      inboundShippedQuantity: 0,
      inboundReceivingQuantity: 0,
      reservedQuantity: { totalReservedQuantity: 0 },
      unfulfillableQuantity: { totalUnfulfillableQuantity: 0 },
      researchingQuantity: { totalResearchingQuantity: 0 },
    },
  };
}

describe("Subscribe & Save current FBA evidence", () => {
  it("uses every FBA Inventory page, including zero-stock FBA SKUs", async () => {
    const requestedTokens: Array<string | null> = [];
    const result = await collectCurrentFbaSkuSet(async (nextToken) => {
      requestedTokens.push(nextToken);
      return nextToken === null
        ? {
            payload: { inventorySummaries: [summary("FBA-ZERO")] },
            pagination: { nextToken: "page-2" },
          }
        : {
            payload: { inventorySummaries: [summary("FBA-TWO")] },
            pagination: {},
          };
    });
    expect(requestedTokens).toEqual([null, "page-2"]);
    expect([...result]).toEqual(["FBA-ZERO", "FBA-TWO"]);
  });

  it("fails closed when pagination repeats a SKU or token", async () => {
    await expect(
      collectCurrentFbaSkuSet(async (nextToken) => ({
        payload: { inventorySummaries: [summary("DUPLICATE")] },
        pagination: nextToken === null ? { nextToken: "second" } : {},
      })),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });

    await expect(
      collectCurrentFbaSkuSet(async () => ({
        payload: { inventorySummaries: [summary(crypto.randomUUID())] },
        pagination: { nextToken: "same" },
      })),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });
  });

  it("rejects malformed 2xx inventory envelopes instead of producing an empty FBA set", async () => {
    await expect(
      collectCurrentFbaSkuSet(async () => ({ payload: {} })),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
