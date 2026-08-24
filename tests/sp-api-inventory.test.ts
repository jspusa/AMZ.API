import { describe, expect, it } from "vitest";
import {
  createScriptedFbaInventoryReplenishmentAdapter,
  readFbaInventoryItem,
} from "../src/main/amazon/fba-inventory-replenishment";

const US = "ATVPDKIKX0DER" as const;

function inventoryAdapter(envelope: unknown) {
  return createScriptedFbaInventoryReplenishmentAdapter([
    {
      operation: "inventory",
      result: {
        envelope,
        requestId: "inventory-request",
        rateLimit: "2",
      },
    },
  ]);
}

describe("FBA Inventory response envelope", () => {
  it("reads the exact inventory summary from Amazon's nested payload", async () => {
    const adapter = inventoryAdapter({
      payload: {
        granularity: {
          granularityType: "Marketplace",
          granularityId: US,
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

    const result = await readFbaInventoryItem(
      { marketplaceId: US, sellerSku: "SAFE-SKU-1" },
      { adapter },
    );
    expect(result.summary.inventoryDetails).toMatchObject({
      fulfillableQuantity: 8902,
      inboundWorkingQuantity: 100,
      inboundShippedQuantity: 14900,
      inboundReceivingQuantity: 0,
      reservedQuantity: { totalReservedQuantity: 5705 },
    });
  });

  it("treats a valid empty list differently from a malformed 200 response", async () => {
    await expect(
      readFbaInventoryItem(
        { marketplaceId: US, sellerSku: "SAFE-SKU-1" },
        {
          adapter: inventoryAdapter({
            payload: { inventorySummaries: [] },
          }),
        },
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "FBA_SKU_NOT_FOUND",
      requestId: "inventory-request",
    });
    for (const envelope of [{ inventorySummaries: [] }, { payload: {} }]) {
      await expect(
        readFbaInventoryItem(
          { marketplaceId: US, sellerSku: "SAFE-SKU-1" },
          { adapter: inventoryAdapter(envelope) },
        ),
      ).rejects.toMatchObject({
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: "inventory-request",
      });
    }
  });

  it("keeps Seller SKU matching exact and case-sensitive", async () => {
    const envelope = {
      payload: {
        inventorySummaries: [
          { sellerSku: "SAFE-SKU-1", inventoryDetails: {} },
        ],
      },
    };

    await expect(
      readFbaInventoryItem(
        { marketplaceId: US, sellerSku: "SAFE-SKU-1" },
        { adapter: inventoryAdapter(envelope) },
      ),
    ).resolves.toMatchObject({
      summary: { sellerSku: "SAFE-SKU-1" },
    });
    await expect(
      readFbaInventoryItem(
        { marketplaceId: US, sellerSku: "safe-sku-1" },
        { adapter: inventoryAdapter(envelope) },
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "FBA_SKU_NOT_FOUND",
    });
  });

  it("rejects malformed summaries instead of treating them as zero inventory", async () => {
    const malformed = [
      { payload: { inventorySummaries: [null] } },
      { payload: { inventorySummaries: [{ sellerSku: "SAFE-SKU-1" }] } },
      {
        payload: {
          inventorySummaries: [
            {
              sellerSku: "SAFE-SKU-1",
              inventoryDetails: { fulfillableQuantity: "unknown" },
            },
          ],
        },
      },
    ];
    for (const envelope of malformed) {
      await expect(
        readFbaInventoryItem(
          { marketplaceId: US, sellerSku: "SAFE-SKU-1" },
          { adapter: inventoryAdapter(envelope) },
        ),
      ).rejects.toMatchObject({
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
  });
});
