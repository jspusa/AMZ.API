import { expect, it, vi } from "vitest";
import { InventoryHealthCoordinator } from "../src/main/inventory-health-coordinator";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { AgedInventorySnapshot } from "../src/main/amazon/aged-inventory-reads";

it("keeps the newer completed stock capture when an earlier expiry read returns late", async () => {
  const marketplaceId = "ATVPDKIKX0DER" as const;
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId, mode: "live", accountScope: "review-fixture" }));
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const expiry = { read: vi.fn().mockImplementationOnce(async () => { await pending; return { records: [], complete: true }; }).mockResolvedValue({ records: [], complete: true }) };
  const owner = new InventoryHealthCoordinator({ context, expiry, now: () => new Date("2026-07-01T12:02:00Z") });
  const stock = (fetchedAt: string, available: number) => ({ marketplaceId, mode: "live", fetchedAt, rows: [{ sellerSku: "FBA-ONE", asin: "B000000001", title: "Fixture", available, agedOver180: 0, estimatedExcessQuantity: null, currencyCode: null, estimatedStorageCostNextMonth: null, estimatedAgedSurcharge: null, snapshotDate: "2026-07-01", unitsShipped: { t7: 7, t30: 30, t60: 60, t90: 90 } }] }) as AgedInventorySnapshot;
  const captured = await context.capture(marketplaceId);
  const older = owner.refresh({ context: captured, snapshot: stock("2026-07-01T12:00:00Z", 100), signal: new AbortController().signal });
  await vi.waitFor(() => expect(expiry.read).toHaveBeenCalledTimes(1));
  await owner.refresh({ context: captured, snapshot: stock("2026-07-01T12:01:00Z", 90), signal: new AbortController().signal });
  release(); await older;
  const response = await owner.read({ requestId: "review", method: "GET", path: "/api/inventory-health", query: { marketplaceId }, headers: {} });
  expect(response.body.value).toMatchObject({ snapshot: { fetchedAt: "2026-07-01T12:01:00Z", rows: [{ available: 90 }] } });
});
