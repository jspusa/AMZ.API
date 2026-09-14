import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryExpirySourceSummary from "../src/renderer/src/components/inventory-expiry-source-summary";
import { isInventoryExpirySourceDiagnostics, type InventoryExpirySourceDiagnostics } from "../src/shared/inventory-expiry-source-diagnostics";
import { isInventoryHealthSnapshot } from "../src/shared/inventory-health";

const available = (): Extract<InventoryExpirySourceDiagnostics, { status: "available" }> => ({
  status: "available", recordedAt: "2026-09-14T04:00:00.000Z", stale: false, traversal: "complete",
  listedPlanCount: 3, cachedPlanCount: 3, unavailablePlanCount: 0, pendingPlanCount: 0,
  statusCounts: { "400": 0, "404": 0, "422": 0 }, failures: [],
});
const snapshot = (expirySourceDiagnostics: unknown) => ({
  schemaVersion: 1, marketplaceId: "ATVPDKIKX0DER", mode: "live", fetchedAt: "2026-09-14T04:00:00.000Z",
  sourceComplete: true, stale: false, rows: [], notice: "Fixture source coverage", expirySourceDiagnostics,
});
let renderer: ReactTestRenderer | null = null;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
async function render(diagnostic: InventoryExpirySourceDiagnostics) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => { renderer = create(<InventoryExpirySourceSummary diagnostic={diagnostic} />); });
  return JSON.stringify(renderer!.toJSON());
}

describe("plan-item fallback source summary contract", () => {
  it("accepts the .75 source summary without the optional count", () => {
    expect(isInventoryExpirySourceDiagnostics(available())).toBe(true);
    expect(isInventoryHealthSnapshot(snapshot(available()))).toBe(true);
  });

  it.each([0, 1, 6000])("accepts %i completed plan-item fallbacks through the public snapshot", planItemFallbackCount => {
    const diagnostic = { ...available(), listedPlanCount: 6000, cachedPlanCount: 6000, planItemFallbackCount };
    expect(isInventoryExpirySourceDiagnostics(diagnostic)).toBe(true);
    expect(isInventoryHealthSnapshot(snapshot(diagnostic))).toBe(true);
  });

  it.each([
    { label: "negative", value: -1 }, { label: "fraction", value: 0.5 }, { label: "over limit", value: 6001 },
    { label: "unsafe integer", value: Number.MAX_SAFE_INTEGER + 1 }, { label: "NaN", value: NaN },
    { label: "infinity", value: Infinity }, { label: "string", value: "1" }, { label: "boolean", value: true },
    { label: "null", value: null }, { label: "undefined", value: undefined }, { label: "object", value: {} }, { label: "array", value: [] },
  ])(
    "rejects an invalid present fallback count ($label)", ({ value: planItemFallbackCount }) => {
      const diagnostic = { ...available(), listedPlanCount: 6000, cachedPlanCount: 6000, planItemFallbackCount };
      expect(isInventoryExpirySourceDiagnostics(diagnostic)).toBe(false);
      expect(isInventoryHealthSnapshot(snapshot(diagnostic))).toBe(false);
    },
  );

  it("does not count pending or unavailable plans as completed fallbacks", () => {
    const diagnostic = {
      ...available(), traversal: "partial", cachedPlanCount: 1, pendingPlanCount: 1, unavailablePlanCount: 1,
      statusCounts: { "400": 1, "404": 0, "422": 0 },
      failures: [{ operation: "plan-items", page: "first", status: 400, reason: "other-input", code: "BadRequest", responseState: "parsed", count: 1 }],
      planItemFallbackCount: 2,
    };
    expect(isInventoryExpirySourceDiagnostics(diagnostic)).toBe(false);
    expect(isInventoryHealthSnapshot(snapshot(diagnostic))).toBe(false);
    expect(isInventoryExpirySourceDiagnostics({ ...diagnostic, planItemFallbackCount: 1 })).toBe(true);
  });

  it("keeps the optional field limited to available summaries and rejects extra data", () => {
    expect(isInventoryExpirySourceDiagnostics({ status: "unknown", reason: "not-recorded", planItemFallbackCount: 0 })).toBe(false);
    expect(isInventoryExpirySourceDiagnostics({ ...available(), planItemFallbackCount: 1, rawMessage: "PRIVATE_SENTINEL" })).toBe(false);
    expect(isInventoryExpirySourceDiagnostics({ ...available(), rawMessage: "PRIVATE_SENTINEL" })).toBe(false);
    expect(isInventoryExpirySourceDiagnostics({ ...available(), planItemFallbackCount: 1, statusCounts: { "400": 0, "404": 0, "422": 0, rawBody: "PRIVATE_SENTINEL" } })).toBe(false);
  });

  it.each(["complete", "partial"] as const)("explains the declaration-only coverage in a %s traversal", async traversal => {
    const diagnostic = {
      ...available(), traversal, cachedPlanCount: 2, pendingPlanCount: traversal === "partial" ? 1 : 0,
      listedPlanCount: traversal === "partial" ? 3 : 2, planItemFallbackCount: 2,
    };
    const output = await render(diagnostic);
    expect(output).toContain("其中 2 個計畫已讀取計畫申報商品；尚未核對其貨件明細。");
    expect(output).toContain("本輪已讀完 2 個");
    expect(output).toContain("申報數量也不是現存批次餘量");
    expect(renderer!.root.findByType("details").props.open).not.toBe(true);
  });

  it.each(["absent", "zero"])("does not invent fallback coverage when the optional count is %s", async state => {
    const diagnostic = state === "absent" ? available() : { ...available(), planItemFallbackCount: 0 };
    const output = await render(diagnostic);
    expect(output).not.toContain("尚未核對其貨件明細");
    expect(output).toContain("本輪已讀完 3 個");
  });

  it("keeps fallback coverage historical when the saved summary is stale", async () => {
    const output = await render({ ...available(), stale: true, planItemFallbackCount: 1 });
    expect(output).toContain("其中 1 個計畫已讀取計畫申報商品；尚未核對其貨件明細。");
    expect(output).toContain("舊同步紀錄，只供查核當時的讀取結果，不代表目前來源可用");
  });
});
