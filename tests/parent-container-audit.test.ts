import { afterEach, describe, expect, it, vi } from "vitest";
import {
  excludeProvenParentContainers,
  needsParentContainerProof,
} from "../src/renderer/src/parent-container-audit";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function incompleteRow(
  sellerSku = "GB Series",
  message = "報表已確認此 SKU 為 FBA，但 Listings Items API 未回傳可核對的 fulfillmentAvailability。",
) {
  return {
    sellerSku,
    asin: "B0F5WLY2VJ",
    readStatus: "incomplete" as const,
    readErrors: [{ code: "LISTING_CONTENT_NOT_RETURNED", message }],
  };
}

function parentFamily(sellerSku: string) {
  const queried = {
    sellerSku,
    asin: "B0F5WLY2VJ",
    title: "Gootoe Natural Buffalo Dog Treats",
    productType: "PET_FOOD",
    status: [],
    role: "parent",
    parentSku: null,
    childSkus: ["GB-CHILD-01"],
    variationTheme: "SIZE",
    dimensions: [],
    fba: false,
    issues: [],
    relationshipSources: ["relationships"],
  } as const;
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    queriedSku: sellerSku,
    queriedRole: "parent",
    queried,
    parent: queried,
    children: [],
    excludedChildren: [],
    variationTheme: "SIZE",
    dimensionNames: [],
    familyComplete: true,
    fetchedAt: "2026-08-12T00:00:00.000Z",
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: "Amazon relationships 已確認為 parent。",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("content and image audit parent-container exclusion", () => {
  it("checks only the exact missing-fulfillment incomplete condition", () => {
    expect(needsParentContainerProof(incompleteRow())).toBe(true);
    expect(needsParentContainerProof(incompleteRow("CHILD", "attributes missing"))).toBe(false);
    expect(needsParentContainerProof({
      sellerSku: "CHILD",
      readStatus: "complete",
      readErrors: [],
    })).toBe(false);
  });

  it("removes only a relationships-proven parent and keeps child or failed lookups visible", async () => {
    const rows = [incompleteRow(), incompleteRow("CHILD"), incompleteRow("UNKNOWN")];
    const controller = new AbortController();
    const result = await excludeProvenParentContainers({
      marketplaceId: MARKETPLACE_ID,
      rows,
      signal: controller.signal,
      lookup: async (row) => {
        if (row.sellerSku === "GB Series") return true;
        if (row.sellerSku === "CHILD") return false;
        throw new Error("secondary read failed");
      },
    });

    expect(result.excludedParentSkus).toEqual(["GB Series"]);
    expect(result.rows.map((row) => row.sellerSku)).toEqual(["CHILD", "UNKNOWN"]);
  });

  it("uses the existing read-only variation endpoint and exact marketplace/SKU parser", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(
      JSON.stringify(parentFamily("GB Series")),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const result = await excludeProvenParentContainers({
      marketplaceId: MARKETPLACE_ID,
      rows: [incompleteRow()],
      signal: new AbortController().signal,
    });

    expect(result.rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/sp-api/variation-family?marketplaceId=${MARKETPLACE_ID}&sku=GB+Series`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("retains the warning when the returned family identity is stale or mismatched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(parentFamily("ANOTHER-SKU")),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const row = incompleteRow();
    const result = await excludeProvenParentContainers({
      marketplaceId: MARKETPLACE_ID,
      rows: [row],
      signal: new AbortController().signal,
    });

    expect(result.excludedParentSkus).toEqual([]);
    expect(result.rows).toEqual([row]);
  });

  it.each([
    ["demo mode", { mode: "demo" }],
    ["attributes-only role", {
      queried: {
        ...parentFamily("GB Series").queried,
        relationshipSources: ["attributes"],
      },
    }],
    ["empty relationship children", {
      queried: {
        ...parentFamily("GB Series").queried,
        childSkus: [],
      },
    }],
    ["different ASIN", {
      queried: {
        ...parentFamily("GB Series").queried,
        asin: "B000000000",
      },
    }],
  ])("keeps the row for %s instead of overstating parent proof", async (_label, overrides) => {
    const family = parentFamily("GB Series");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ...family, ...overrides }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const row = incompleteRow();
    const result = await excludeProvenParentContainers({
      marketplaceId: MARKETPLACE_ID,
      rows: [row],
      signal: new AbortController().signal,
    });

    expect(result.excludedParentSkus).toEqual([]);
    expect(result.rows).toEqual([row]);
  });

  it.each([
    ["missing ASIN", undefined],
    ["empty ASIN", ""],
  ])("keeps the row when the audit identity has %s", async (_label, asin) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(parentFamily("GB Series")),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const row = { ...incompleteRow(), asin };
    const result = await excludeProvenParentContainers({
      marketplaceId: MARKETPLACE_ID,
      rows: [row],
      signal: new AbortController().signal,
    });

    expect(result.excludedParentSkus).toEqual([]);
    expect(result.rows).toEqual([row]);
  });
});
