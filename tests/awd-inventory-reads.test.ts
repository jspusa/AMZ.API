import { describe, expect, it } from "vitest";
import { AwdInventoryReads, type AwdInventoryReadAdapter } from "../src/main/amazon/awd-inventory-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;
const fba = [{ sellerSku: "FBA-EXAMPLE", asin: "B012345678" }];

async function harness(adapter: AwdInventoryReadAdapter) {
  const context = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId, mode: "live", accountScope: "opaque-awd-test-account",
  }));
  const owner = new AwdInventoryReads({ adapter, context });
  return { owner, context, input: { context: await context.capture(US), fba, signal: new AbortController().signal } };
}

describe("AWD inventory public read", () => {
  it("rejects a late completion after context invalidation even if the caller also cancels", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const { owner, input, context } = await harness({ listInventory: async () => pending,
      listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: async () => ({}),
    });
    const controller = new AbortController();
    const read = owner.read({ ...input, signal: controller.signal });
    context.invalidate("lock-screen");
    controller.abort();
    release({ inventory: [{ sku: "FBA-EXAMPLE", totalOnhandQuantity: 50 }] });
    await expect(read).rejects.toMatchObject({ status: 409, code: "SP_CONTEXT_INVALIDATED" });
  });

  it("stops repeated inventory pagination and removes conflicting repeated SKU evidence", async () => {
    let pages = 0;
    const { owner, input } = await harness({ listInventory: async () => {
      pages++;
      return { inventory: [{ sku: "FBA-EXAMPLE", totalOnhandQuantity: pages }], nextToken: "same-page" };
    }, listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: async () => ({}),
    });
    const result = await owner.read(input);
    expect(result.rows).toEqual([]);
    expect(result.inventoryCoverage).toBe("partial");
    expect(pages).toBe(2);
  });

  it("keeps permission failures distinct from empty inventory or complete shipment coverage", async () => {
    const permissionError = new SpApiError("AWD role unavailable.", { status: 403, code: "AWD_UNAUTHORIZED" });
    const { owner, input } = await harness({ listInventory: async () => ({ inventory: [] }),
      listInboundShipments: async () => { throw permissionError; }, getInboundShipment: async () => ({}),
    });
    expect(await owner.read(input)).toMatchObject({ coverage: "partial", shipmentCoverage: "partial", inventoryCoverage: "complete", shipments: [] });
    const denied = await harness({ listInventory: async () => { throw permissionError; },
      listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: async () => ({}),
    });
    await expect(denied.owner.read(denied.input)).rejects.toMatchObject({ status: 403, code: "AWD_UNAUTHORIZED" });
  });

  it("does not contact Amazon in demo mode or on an unsupported marketplace", async () => {
    let calls = 0;
    const { owner, input, context } = await harness({ listInventory: async () => { calls++; return {}; },
      listInboundShipments: async () => ({}), getInboundShipment: async () => ({}),
    });
    await expect(owner.read({ ...input, context: await context.capture("A2EUQ1WTGCTBG2") })).rejects.toMatchObject({ code: "AWD_MARKETPLACE_UNSUPPORTED" });
    const demoContext = createScriptedSpExecutionContextAdapter((marketplaceId) => ({ marketplaceId, mode: "demo", accountScope: "opaque-demo-awd" }));
    const demo = new AwdInventoryReads({ adapter: { listInventory: async () => { calls++; return {}; }, listInboundShipments: async () => ({}), getInboundShipment: async () => ({}) }, context: demoContext });
    await expect(demo.read({ ...input, context: await demoContext.capture(US) })).rejects.toMatchObject({ code: "AWD_DEMO_UNAVAILABLE" });
    expect(calls).toBe(0);
  });
  it("does not expose arbitrary transport errors through the public read boundary", async () => {
    const { owner, input } = await harness({ listInventory: async () => { throw new Error("private transport material"); },
      listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: async () => ({}),
    });
    const result = await owner.read(input).catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 502, code: "AWD_UPSTREAM_UNAVAILABLE" });
    expect(String(result)).not.toContain("private transport material");
  });
  it("does not normalize impossible expiry dates into real dates or expiry findings", async () => {
    const { owner, input } = await harness({
      listInventory: async () => ({ inventory: [{ sku: "FBA-EXAMPLE", expirationDetails: [{ expiration: "2001-02-30T10:00:00Z", onhandQuantity: 3 }] }] }),
      listInboundShipments: async () => ({ shipments: [] }), getInboundShipment: async () => ({}),
    });
    const result = await owner.read(input);
    expect(result.rows[0].expirationDetails).toEqual([{ expiration: null, onhandQuantity: 3 }]);
    expect(result.findings).toEqual([]);
  });
  it("emits stable evidence-backed expiry and closed-shipment reconciliation findings", async () => {
    const { owner, input } = await harness({
      listInventory: async () => ({ inventory: [{ sku: "FBA-EXAMPLE", expirationDetails: [{ expiration: "2001-01-12T10:00:00Z", onhandQuantity: 3 }] }] }),
      listInboundShipments: async () => ({ shipments: [{ shipmentId: "closed-example", shipmentStatus: "CLOSED" }] }),
      getInboundShipment: async () => ({ shipmentId: "closed-example", shipmentStatus: "CLOSED", shipmentSkuQuantities: [
        { sku: "FBA-EXAMPLE", expectedQuantity: { quantity: 4, unitOfMeasurement: "PALLETS" }, receivedQuantity: { quantity: 2, unitOfMeasurement: "PALLETS" } },
      ] }),
    });
    const first = await owner.read(input);
    const second = await owner.read(input);
    expect(first.findings).toEqual(second.findings);
    expect(first.findings).toMatchObject([
      { source: "awd", sellerSku: "FBA-EXAMPLE", severity: "warning", title: "AWD 有已到效期的在庫證據" },
      { source: "awd", sellerSku: "FBA-EXAMPLE", severity: "warning", title: "已關閉 AWD 貨件數量待核對" },
    ]);
    expect(first.shipments[0].rows[0].outstandingQuantity).toEqual({ quantity: 2, unitOfMeasurement: "PALLETS" });
    expect(JSON.stringify(first.findings)).not.toMatch(/closed-example|遺失/u);
  });
  it("reads shipment details without converting cases into units or exposing shipment identifiers", async () => {
    const { owner, input } = await harness({
      listInventory: async () => ({ inventory: [] }),
      listInboundShipments: async ({ nextToken }) => nextToken
        ? { shipments: [{ shipmentId: "private-shipment-reference", shipmentStatus: "DELIVERED" }] }
        : { shipments: [], nextToken: "shipment-page" },
      getInboundShipment: async () => ({ shipmentId: "private-shipment-reference", shipmentStatus: "DELIVERED", shipmentSkuQuantities: [
        { sku: "FBA-EXAMPLE", expectedQuantity: { quantity: 4, unitOfMeasurement: "CASES" }, receivedQuantity: { quantity: 24, unitOfMeasurement: "PRODUCT_UNITS" } },
        { sku: "PRIVATE-FBM", expectedQuantity: { quantity: 5, unitOfMeasurement: "PALLETS" } },
      ] }),
    });
    const result = await owner.read(input);
    expect(result.shipments).toMatchObject([{ id: expect.stringMatching(/^awd-shipment\.[a-f0-9]{24}$/u), status: "DELIVERED", coverage: "partial", rows: [{
      ...fba[0], expectedQuantity: { quantity: 4, unitOfMeasurement: "CASES" }, receivedQuantity: { quantity: 24, unitOfMeasurement: "PRODUCT_UNITS" }, outstandingQuantity: null,
    }] }]);
    expect(result.shipmentCoverage).toBe("partial");
    expect(JSON.stringify(result)).not.toMatch(/private-shipment-reference|PRIVATE-FBM|orderId|originAddress/u);
    expect(result.findings).toEqual([]);
  });
  it("continues empty pages and preserves unavailable quantities instead of inventing zero stock", async () => {
    const { owner, input } = await harness({
      listInventory: async ({ nextToken }) => nextToken === "second-page"
        ? { inventory: [{ sku: "FBA-EXAMPLE", totalInboundQuantity: 0 }] }
        : { inventory: [], nextToken: "second-page" },
      listInboundShipments: async () => ({ shipments: [] }),
      getInboundShipment: async () => { throw new Error("unused"); },
    });
    const result = await owner.read(input);
    expect(result.rows).toEqual([{ ...fba[0], totalOnhandQuantity: null, totalInboundQuantity: 0,
      availableDistributableQuantity: null, reservedDistributableQuantity: null, replenishmentQuantity: null, expirationDetails: null }]);
    expect(result.coverage).toBe("partial");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("keeps AWD supply stages separate and only exposes current-FBA identities", async () => {
    const { owner, input } = await harness({
      listInventory: async () => ({ inventory: [
        { sku: "FBA-EXAMPLE", totalOnhandQuantity: 120, totalInboundQuantity: 24,
          inventoryDetails: { availableDistributableQuantity: 90, reservedDistributableQuantity: 30, replenishmentQuantity: 12 },
          expirationDetails: [{ expiration: "2028-01-12T10:00:00.000Z", onhandQuantity: 120 }] },
        { sku: "UNPROVEN-PRIVATE-SKU", totalOnhandQuantity: 99 },
      ] }),
      listInboundShipments: async () => ({ shipments: [] }),
      getInboundShipment: async () => { throw new Error("unused"); },
    });
    const result = await owner.read(input);
    expect(result.rows).toEqual([{ ...fba[0], totalOnhandQuantity: 120, totalInboundQuantity: 24,
      availableDistributableQuantity: 90, reservedDistributableQuantity: 30, replenishmentQuantity: 12,
      expirationDetails: [{ expiration: "2028-01-12T10:00:00.000Z", onhandQuantity: 120 }] }]);
    expect(result.stockScope).toBe("AWD_SHARED_DOWNSTREAM");
    expect(result.excludedInventoryRows).toBe(1);
    expect(result.coverage).toBe("partial");
    expect(JSON.stringify(result)).not.toContain("UNPROVEN-PRIVATE-SKU");
  });
});
