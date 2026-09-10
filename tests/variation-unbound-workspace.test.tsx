import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import VariationPlannerDrawer from "../src/renderer/src/components/variation-planner-drawer";
import type { UnboundVariationAuditCache } from "../src/renderer/src/components/unbound-variation-audit-panel";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";
import { readVariationFamily } from "../src/main/amazon/variation-family-reads";

const marketplaceId = "ATVPDKIKX0DER";
const targetSku = "SYNTHETIC-PARENT";
const cache: UnboundVariationAuditCache = {
  query: "",
  snapshot: {
    mode: "live",
    marketplaceId,
    fetchedAt: "2026-09-08T00:00:00Z",
    exportId: "synthetic-audit",
    rows: [
      {
        sellerSku: "GCBL06",
        asin: "B000000001",
        title: "Synthetic standalone",
        productType: "PET_FOOD",
        relationshipEvidence: "relationships",
        notice: "Verified standalone",
      },
    ],
    incompleteRows: [
      {
        sellerSku: "GCBL99",
        asin: "B000000009",
        title: "Incomplete",
        code: "UNKNOWN",
        message: "Unknown relationships",
        requestId: null,
      },
    ],
    allVariationRows: [
      {
        familySku: targetSku,
        sellerSku: targetSku,
        role: "parent",
        evidence: "parent-sku-from-verified-child",
        title: "",
        productType: "",
        variationTheme: null,
      },
      ...["GCBL01", "GCBL02", "GCBL03"].map((sellerSku) => ({
        familySku: targetSku,
        sellerSku,
        role: "child" as const,
        evidence: "verified-child" as const,
        title: "Synthetic sibling",
        productType: "PET_FOOD",
        variationTheme: "SIZE_NAME",
      })),
    ],
    summary: {
      totalFbaListings: 5,
      completed: 4,
      unbound: 1,
      boundChildren: 3,
      parentContainers: 0,
      incomplete: 1,
    },
    notice: "Read only",
    recommendations: [
      {
        sellerSku: "GCBL06",
        status: "ranked",
        notice: "需重新核對",
        candidates: [
          {
            parentSku: targetSku,
            parentTitle: "",
            productType: "PET_FOOD",
            variationTheme: "SIZE_NAME",
            matchingChildCount: 3,
            familyChildCount: 3,
            matchingChildSkus: ["GCBL01", "GCBL02", "GCBL03"],
            stars: 3,
            tied: false,
            reasons: ["SKU 系列 GCBL○○", "3 個同系列已綁 SKU"],
          },
        ],
      },
    ],
  },
};
function member(sellerSku: string, role: "standalone" | "parent" | "child") {
  return {
    sellerSku,
    asin: "B000000001",
    title: "Synthetic product",
    productType: "PET_FOOD",
    role,
    fba: role !== "parent",
    parentSku: role === "child" ? targetSku : null,
    childSkus: role === "parent" ? ["GCBL01"] : [],
    status: ["BUYABLE"],
    variationTheme: role === "standalone" ? null : "SIZE_NAME",
    dimensions: [{ name: "size_name", label: "Size", values: ["4 oz"] }],
    issues: [],
    relationshipSources: ["relationships"],
  };
}
function family(target = false, bound = false) {
  const queried = target
    ? member(targetSku, "parent")
    : member("GCBL06", bound ? "child" : "standalone");
  return {
    mode: "live",
    marketplaceId,
    queriedSku: queried.sellerSku,
    queriedRole: queried.role,
    queried,
    parent: target || bound ? member(targetSku, "parent") : null,
    children: target ? [member("GCBL01", "child")] : [],
    excludedChildren: [],
    variationTheme: target || bound ? "SIZE_NAME" : null,
    dimensionNames: target || bound ? ["size_name"] : [],
    familyComplete: true,
    fetchedAt: "2026-09-08T00:00:00Z",
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: "Read only",
  };
}
let renderer: ReactTestRenderer | null = null;
async function click(label: string) {
  await act(async () => {
    renderer!.root.findByProps({ "aria-label": label }).props.onClick();
  });
}
async function mount(
  options: {
    legacy?: boolean;
    mismatchedMode?: boolean;
    sourceRelationships?: unknown;
    sourceProfile?: "relationships" | "attributes";
  } = {},
) {
  const currentCache = structuredClone(cache);
  if (options.legacy) delete currentCache.snapshot.recommendations;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.includes("variation-move/recovery?")) return Response.json({
        mode: "live", marketplaceId, sellerSku: "GCBL06", status: "none",
        action: null, sourceParentSku: null, targetParentSku: null,
        observedParentSku: null, result: null, notice: "沒有既有操作",
      });
      if (input.includes("variation-family")) {
        if (input.includes(targetSku)) return Response.json(family(true));
        const adapter = createScriptedListingsReadAdapter([{
          operation: "item",
          result: {
            status: 200,
            envelope: {
              sku: "GCBL06",
              summaries: [{
                marketplaceId,
                asin: "B000000001",
                productType: "PET_FOOD",
                itemName: "Synthetic standalone",
                status: ["BUYABLE"],
              }],
              fulfillmentAvailability: [{ fulfillmentChannelCode: "AMAZON_NA" }],
              relationships: "sourceRelationships" in options
                ? options.sourceRelationships
                : [],
            },
            profile: options.sourceProfile ?? "relationships",
            requestId: null,
            rateLimit: null,
            retryAfter: null,
          },
        }]);
        return Response.json(await readVariationFamily(adapter, {
          marketplaceId,
          sellerSku: "GCBL06",
        }));
      }
      return Response.json({
        mode: "live",
        marketplaceId,
        action: "attach",
        sellerSku: "GCBL06",
        sourceParentSku: null,
        targetParentSku: targetSku,
        productType: "PET_FOOD",
        variationTheme: "SIZE_NAME",
        dimensionNames: ["size_name"],
        fields: [
          {
            name: "size_name",
            label: "Size",
            editable: false,
            values: [
              {
                value: "4 oz",
                marketplace_id: marketplaceId,
                language_tag: "en_US",
              },
            ],
            leaves: [
              {
                path: ["value"],
                label: "Value",
                type: "string",
                required: true,
                enumValues: [],
                currentValue: "4 oz",
              },
            ],
            jsonFallback: false,
          },
        ],
        requiredFields: [],
        writable: true,
        preparedAt: "2026-09-08T00:00:00Z",
        requestIds: [],
        blockers: [],
        warnings: [],
        notice: "Prepared",
      });
    }),
  );
  function ConnectedWorkspace() {
    const [sku, setSku] = useState("");
    return (
      <VariationPlannerDrawer
        initialSellerSku={sku}
        onContextResolved={(_marketplace, nextSku) => setSku(nextSku)}
        initialMarketplaceId={marketplaceId}
        presentation="workspace"
        auditMode={options.mismatchedMode ? "demo" : "live"}
        auditCache={currentCache}
        auditJob={{
          jobId: "synthetic-job",
          contextId: "synthetic-context",
          kind: "variation",
          marketplaceId,
          mode: "live",
          options: {},
          progress: {
            stage: "complete",
            message: "Done",
            completedUnits: 5,
            totalUnits: 5,
          },
          ready: true,
          status: "completed",
          snapshot: currentCache.snapshot,
        }}
        onClose={vi.fn()}
      />
    );
  }
  await act(async () => {
    renderer = create(<ConnectedWorkspace />);
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

it.each([
  { sourceRelationships: [] },
  { sourceRelationships: [{ marketplaceId, relationships: [] }] },
])("prepares a standalone from the production family parser's complete empty relationships %#", async ({ sourceRelationships }) => {
  await mount({ sourceRelationships });
  expect(fetch).not.toHaveBeenCalled();
  expect(
    renderer!.root.findAllByProps({ "aria-label": "準備綁定 GCBL99" }),
  ).toHaveLength(0);
  await click("準備綁定 GCBL06");
  expect(JSON.stringify(renderer!.toJSON())).toContain("來源原本即為獨立 SKU");
  const countRow = renderer!.root
    .findAllByType("tr")
    .find((row) =>
      row.findAllByType("th").some((th) => th.children.includes("FBA 商品數")),
    )!;
  expect(countRow.findAllByType("td")[0].children).toEqual(["1"]);
  expect(
    renderer!.root.findByProps({
      "aria-label": "選擇建議 family SYNTHETIC-PARENT",
    }),
  ).toBeTruthy();
  await click("選擇建議 family SYNTHETIC-PARENT");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url]) =>
          String(url).includes("variation-family") &&
          String(url).includes("sku=GCBL06"),
      ),
  ).toHaveLength(2);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes("sku=SYNTHETIC-PARENT")),
  ).toBe(true);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([url, options]) =>
          !String(url).includes("action=detach") && !options?.method,
      ),
  ).toBe(true);
  expect(
    renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled,
  ).toBe(false);
  expect(JSON.stringify(renderer!.toJSON())).toContain("保留 Amazon 現有值");
  expect(JSON.stringify(renderer!.toJSON())).not.toContain(
    "請先到 Seller Central 商品編輯補齊",
  );
});

it("stops automatic staging if fresh Amazon evidence no longer proves standalone", async () => {
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(family(false, true)));
  await click("準備綁定 GCBL06");
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    "目前已不是可確認的獨立 FBA 商品",
  );
  expect(
    renderer!.root.findAllByProps({ "aria-label": "檢查綁定內容" }),
  ).toHaveLength(0);
  expect(
    vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method),
  ).toBe(true);
});

it.each([
  { name: "missing dataset", sourceRelationships: undefined },
  { name: "null dataset", sourceRelationships: null },
  { name: "malformed dataset", sourceRelationships: {} },
  { name: "missing group entries", sourceRelationships: [{ marketplaceId }] },
  { name: "malformed entries", sourceRelationships: [{ marketplaceId, relationships: [null] }] },
  { name: "foreign marketplace", sourceRelationships: [{ marketplaceId: "A2EUQ1WTGCTBG2", relationships: [] }] },
  { name: "duplicate marketplace", sourceRelationships: [{ marketplaceId, relationships: [] }, { marketplaceId, relationships: [] }] },
  { name: "attributes fallback", sourceRelationships: [], sourceProfile: "attributes" as const },
])("keeps $name evidence out of the attach workflow through the production family parser", async (options) => {
  await mount(options);
  await click("準備綁定 GCBL06");
  expect(renderer!.root.findAllByProps({ role: "alert" }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ "aria-label": "檢查綁定內容" })).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("variation-family");
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBeUndefined();
});

it("keeps an incomplete fresh family out even when its standalone member has complete relationship evidence", async () => {
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    ...family(),
    familyComplete: false,
  }));
  await click("準備綁定 GCBL06");
  expect(renderer!.root.findAllByProps({ "aria-label": "檢查綁定內容" })).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
});

it("preserves the complete immutable attribute array in the explicit attach preview without a PATCH", async () => {
  await mount();
  await click("準備綁定 GCBL06");
  await click("選擇建議 family SYNTHETIC-PARENT");
  vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({
      ...body,
      sourceParentSku: null,
      mode: "live",
      status: "VALID",
      validatedAt: "2026-09-08T00:00:00Z",
      issues: [],
      notice: "Valid",
      changes: [
        {
          name: "parent_sku",
          label: "Parent SKU",
          before: null,
          after: targetSku,
        },
      ],
    });
  });
  await click("檢查綁定內容");
  const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body)).dimensionValues).toEqual({
    size_name: [
      { value: "4 oz", marketplace_id: marketplaceId, language_tag: "en_US" },
    ],
  });
  expect(
    renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.disabled,
  ).toBe(false);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(([, options]) => options?.method !== "PATCH"),
  ).toBe(true);
});

it("keeps old matching snapshots usable with an explicit rerun/upgrade explanation for missing suggestions", async () => {
  await mount({ legacy: true });
  await click("準備綁定 GCBL06");
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    "這份健檢快照尚未提供 family 建議",
  );
  expect(
    renderer!.root.findAllByProps({
      "aria-label": "選擇建議 family SYNTHETIC-PARENT",
    }),
  ).toHaveLength(0);
});

it("does not reuse a cached live job after the workspace mode changes", async () => {
  await mount({ mismatchedMode: true });
  expect(
    renderer!.root.findAllByProps({ "aria-label": "準備綁定 GCBL06" }),
  ).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
});
