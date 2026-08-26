import { describe, expect, it } from "vitest";
import {
  createScriptedFbaInventoryReplenishmentAdapter,
  fbaInventoryReadIdentity,
  readCurrentFbaEvidence,
  type FbaInventoryReplenishmentAdapter,
} from "../src/main/amazon/fba-inventory-replenishment";

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

function inventoryAdapter(...envelopes: unknown[]) {
  return createScriptedFbaInventoryReplenishmentAdapter(
    envelopes.map((envelope, index) => ({
      operation: "inventory" as const,
      result: {
        envelope,
        requestId: `inventory-${index + 1}`,
        rateLimit: "2",
      },
    })),
  );
}

describe("Subscribe & Save current FBA evidence", () => {
  it("uses every FBA Inventory page, including zero-stock FBA SKUs", async () => {
    const adapter = inventoryAdapter(
      {
        payload: { inventorySummaries: [summary("FBA-ZERO")] },
        pagination: { nextToken: "page-2" },
      },
      {
        payload: { inventorySummaries: [summary("FBA-TWO")] },
        pagination: {},
      },
    );
    const result = await readCurrentFbaEvidence(
      { marketplaceId: "ATVPDKIKX0DER" },
      { adapter },
    );
    expect(adapter.requests.map((request) =>
      request.intent === "catalog-page" ? request.nextToken : "unexpected"
    )).toEqual([null, "page-2"]);
    expect([...result.knownFbaSkus]).toEqual(["FBA-ZERO", "FBA-TWO"]);
  });

  it("keeps exact valid SKUs while counting unrecognizable raw inventory rows as partial coverage", async () => {
    const altered = [
      summary("VALID-ONE"),
      summary(" NEEDS-TRIM"),
      summary("ZERO\u200bWIDTH"),
      { ...summary("MISSING"), sellerSku: undefined },
      summary("VALID-TWO"),
    ];
    const adapter = inventoryAdapter({
      payload: { inventorySummaries: altered },
      pagination: {},
    });
    const result = await readCurrentFbaEvidence(
      { marketplaceId: "ATVPDKIKX0DER" },
      { adapter },
    );

    expect([...result.knownFbaSkus]).toEqual(["VALID-ONE", "VALID-TWO"]);
    expect(result).toMatchObject({
      returnedInventoryRows: 5,
      unrecognizedSellerSkuRows: 3,
    });
    expect([...result.knownFbaSkus]).not.toContain("NEEDS-TRIM");
    expect([...result.knownFbaSkus]).not.toContain("ZERO\u200bWIDTH");
  });

  it("fails closed when pagination repeats a SKU or token", async () => {
    const duplicateSku = inventoryAdapter(
      {
        payload: { inventorySummaries: [summary("DUPLICATE")] },
        pagination: { nextToken: "second" },
      },
      {
        payload: { inventorySummaries: [summary("DUPLICATE")] },
        pagination: {},
      },
    );
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: "ATVPDKIKX0DER" },
        { adapter: duplicateSku },
      ),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });

    const repeatedToken = inventoryAdapter(
      {
        payload: { inventorySummaries: [summary(crypto.randomUUID())] },
        pagination: { nextToken: "same" },
      },
      {
        payload: { inventorySummaries: [summary(crypto.randomUUID())] },
        pagination: { nextToken: "same" },
      },
    );
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: "ATVPDKIKX0DER" },
        { adapter: repeatedToken },
      ),
    ).rejects.toMatchObject({ code: "PAGINATION_CHANGED" });
  });

  it("rejects malformed 2xx inventory envelopes instead of producing an empty FBA set", async () => {
    const adapter = inventoryAdapter({ payload: {} });
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: "ATVPDKIKX0DER" },
        { adapter },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("stops before requesting another inventory page after its run signal is aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const adapter: FbaInventoryReplenishmentAdapter = {
      async readInventory(plan) {
        calls += 1;
        controller.abort(new Error("lifecycle cleanup"));
        return {
          identity: fbaInventoryReadIdentity(plan),
          envelope: {
            payload: { inventorySummaries: [summary("FBA-ONE")] },
            pagination: { nextToken: "page-2" },
          },
          requestId: null,
          rateLimit: null,
        };
      },
      async readReplenishment() {
        throw new Error("Unexpected Replenishment request.");
      },
    };
    await expect(
      readCurrentFbaEvidence(
        { marketplaceId: "ATVPDKIKX0DER", signal: controller.signal },
        { adapter },
      ),
    ).rejects.toThrow(/lifecycle cleanup/u);
    expect(calls).toBe(1);
  });
});
