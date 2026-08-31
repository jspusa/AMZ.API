import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingRowMatchesFilter,
  businessPricingEditorProposal,
  createSubmittedBusinessPricePreview,
  defaultBusinessPricingProposal,
  parseBusinessPriceUpdate,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  type BusinessPriceUpdate,
} from "../src/renderer/src/business-pricing-audit";
import BusinessPricingAuditPanel, {
  shouldResumeBusinessPricingAuditJob,
} from "../src/renderer/src/components/business-pricing-audit-panel";
import BusinessPricingAuditDrawer from "../src/renderer/src/components/business-pricing-audit-drawer";
import BusinessPricingEditor from "../src/renderer/src/components/business-pricing-editor";
import { parseStandaloneAuditJob } from "../src/renderer/src/standalone-audit";
import {
  openSellerCentralInventoryHandoff,
} from "../src/renderer/src/seller-central-handoff";
import { readRendererStylesheet } from "./renderer-stylesheet";

function payload(): Record<string, unknown> {
  return {
    mode: "live",
    marketplaceId: "ATVPDKIKX0DER",
    fetchedAt: "2026-08-22T12:00:00.000Z",
    rows: [
      {
        sellerSku: "FBA-MISSING",
        asin: "B000000001",
        title: "Missing business price",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        businessPrice: null,
        businessOfferPresence: "absent",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
        status: "missing",
        editable: true,
        reason: "尚未設定 Amazon Business 價格；seller-specific PTD 允許建立。",
      },
      {
        sellerSku: "FBA-CONFIGURED",
        asin: "B000000002",
        title: "Configured business price",
        productType: "PET_FOOD",
        standardPrice: { amount: 24.99, currencyCode: "USD" },
        businessPrice: { amount: 22.49, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: {
          discountType: "percent",
          levels: [
            { lowerBound: 5, value: 5 },
            { lowerBound: 10, value: 10 },
          ],
        },
        quantityDiscountPlanPresence: "canonical",
        status: "configured",
        editable: true,
        reason: "已設定 Amazon Business 價格；seller-specific PTD 允許編輯。",
      },
      {
        sellerSku: "FBA-MISSING-READONLY",
        asin: "B000000003",
        title: "Missing read-only business price",
        productType: "OTHER",
        standardPrice: { amount: 17.99, currencyCode: "USD" },
        businessPrice: null,
        businessOfferPresence: "absent",
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "ambiguous",
        status: "missing",
        editable: false,
        reason: "尚未設定 Amazon Business 價格；seller-specific PTD 不支援，因此只提供唯讀。",
      },
      {
        sellerSku: "FBA-CONFIGURED-READONLY",
        asin: "B000000004",
        title: "Configured read-only business price",
        productType: "OTHER",
        standardPrice: { amount: 29.99, currencyCode: "USD" },
        businessPrice: { amount: 27.99, currencyCode: "USD" },
        businessOfferPresence: "present",
        quantityDiscountPlan: {
          discountType: "fixed",
          levels: [{ lowerBound: 5, value: 25.99 }],
        },
        quantityDiscountPlanPresence: "canonical",
        status: "configured",
        editable: false,
        reason: "已設定 Amazon Business 價格；seller-specific PTD 唯讀，因此只提供唯讀。",
      },
    ],
    summary: {
      totalFbaSkuCount: 4,
      configured: 2,
      aboveStandard: 0,
      missing: 2,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 2,
      recommendedQuantityDiscountMismatch: 3,
    },
    notice: "只納入 Amazon 報表與 Listings Items API 共同確認的 FBA SKU。",
  };
}

const interactiveListing = {
  mode: "live",
  marketplaceId: "ATVPDKIKX0DER",
  sellerSku: "FBA-MISSING",
  asin: "B000000001",
  title: "Missing business price",
  productType: "PET_FOOD",
  standardPrice: { amount: 19.99, currencyCode: "USD" },
  minimumPrice: { amount: 18, currencyCode: "USD" },
  minimumPricePresence: "canonical",
  businessPrice: null,
  businessOfferPresence: "absent",
  businessPricingManagedByAutomation: false,
  quantityDiscountPlan: {
    discountType: "percent",
    levels: [
      { lowerBound: 5, value: 3 },
      { lowerBound: 10, value: 6 },
    ],
  },
  quantityDiscountPlanPresence: "canonical",
  quantityDiscountPlanHash: "f".repeat(64),
  businessOfferGuardHash: "a".repeat(64),
  businessOfferProtectedHash: "e".repeat(64),
  businessPricingCapability: {
    supported: true,
    editable: true,
    reason: null,
    schemaChecksum: "seller-schema-checksum",
    quantityDiscountsSupported: true,
    quantityDiscountsEditable: true,
    quantityDiscountsReason: null,
  },
  fetchedAt: "2026-08-22T12:00:00.000Z",
  notice: null,
} as const;

async function previewBodyFromRowInteraction(
  mode: "price_only" | "combined",
): Promise<Record<string, unknown>> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  let submittedBody: Record<string, unknown> | null = null;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return new Response(JSON.stringify(interactiveListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method !== "POST") {
      throw new Error(`Unexpected B2B interaction request: ${method}`);
    }
    submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const tiers = Array.isArray(submittedBody.quantityDiscountTiers)
      ? submittedBody.quantityDiscountTiers as Array<{
          lowerBound: number;
          percent: number;
        }>
      : null;
    return new Response(JSON.stringify({
      mode: "live",
      status: "VALID",
      marketplaceId: interactiveListing.marketplaceId,
      sellerSku: interactiveListing.sellerSku,
      asin: interactiveListing.asin,
      productType: interactiveListing.productType,
      standardPrice: interactiveListing.standardPrice,
      previousBusinessPrice: null,
      requestedBusinessPrice: {
        amount: submittedBody.newBusinessPrice,
        currencyCode: "USD",
      },
      previousMinimumPrice: interactiveListing.minimumPrice,
      requestedMinimumPrice: tiers
        ? { amount: 14.19, currencyCode: "USD" }
        : interactiveListing.minimumPrice,
      lowestTierUnitPrice: tiers
        ? { amount: 15.19, currencyCode: "USD" }
        : null,
      minimumPriceChange: tiers ? "lower" : "preserve",
      minimumPriceProtectedHash: tiers ? "7".repeat(64) : null,
      minimumPriceCanonicalPatchHash: tiers ? "8".repeat(64) : null,
      businessPriceValidation: tiers
        ? "final-state-validated"
        : "validated",
      previousQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
      previousQuantityDiscountPlanHash:
        interactiveListing.quantityDiscountPlanHash,
      requestedQuantityDiscountPlan: tiers
        ? {
            discountType: "percent",
            levels: tiers.map((tier) => ({
              lowerBound: tier.lowerBound,
              value: tier.percent,
            })),
          }
        : interactiveListing.quantityDiscountPlan,
      quantityDiscountPlanChange: tiers ? "replace" : "preserve",
      businessOfferGuardHash: interactiveListing.businessOfferGuardHash,
      businessOfferProtectedHash:
        interactiveListing.businessOfferProtectedHash,
      schemaChecksum:
        interactiveListing.businessPricingCapability.schemaChecksum,
      fbaEvidenceHash: "b".repeat(64),
      canonicalPatchHash: "c".repeat(64),
      validationIssuesHash: "d".repeat(64),
      validatedAt: "2026-08-22T12:01:00.000Z",
      issues: [],
      notice: "Amazon Validation Preview 已通過。",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
    }));
  });
  const root = renderer!.root;
  const buttonNamed = (name: string) => root.findAllByType("button").find(
    (button) => button.children.join("") === name,
  );
  await act(async () => {
    buttonNamed("設定 B2B 價格")!.props.onClick();
  });
  if (mode === "price_only") {
    await act(async () => {
      buttonNamed("只改價格並保留原數量折扣")!.props.onClick();
    });
  }
  await act(async () => {
    root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
  });
  await act(async () => renderer!.unmount());
  if (!submittedBody) throw new Error("Expected one B2B preview body");
  return submittedBody;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("Seller Central SKU Pages-first handoff", () => {
  it("does not silently open the Seller Central root in a legacy Notebook Key", async () => {
    const destinations: string[] = [];
    const result = await openSellerCentralInventoryHandoff({
      version: async () => "0.1.25",
      platform: async () => "darwin",
      openExternal: async (destination) => {
        destinations.push(destination);
      },
    }, "FBA-SKU-01");

    expect(result).toBe("upgrade-required");
    expect(destinations).toEqual([]);
  });

  it("passes only the exact Seller SKU to the fixed new bridge", async () => {
    const sellerSkus: string[] = [];
    const result = await openSellerCentralInventoryHandoff({
      version: async () => "0.1.26",
      platform: async () => "darwin",
      openExternal: async () => undefined,
      openSellerCentralInventory: async (sellerSku) => {
        sellerSkus.push(sellerSku);
      },
    }, "FBA SKU/&?=1");

    expect(result).toBe("opened");
    expect(sellerSkus).toEqual(["FBA SKU/&?=1"]);
  });
});

describe("FBA business pricing audit renderer", () => {
  it("defaults to the combined suggested tiers and hides them entirely in price-only mode", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing: parseBusinessPricingListingSnapshot(interactiveListing),
        onClose: () => undefined,
        onVerified: () => undefined,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });
    const root = renderer!.root;
    expect(root.findByProps({ id: "business-price-input" }).props.value)
      .toBe("18.99");
    expect(root.findByProps({ id: "business-tier-bound-0" }).props.value)
      .toBe("5");
    expect(root.findByProps({ id: "business-tier-percent-0" }).props.value)
      .toBe("5");
    expect(root.findByProps({ id: "business-tier-bound-3" }).props.value)
      .toBe("20");
    expect(root.findByProps({ id: "business-tier-percent-3" }).props.value)
      .toBe("20");
    expect(root.findByType("fieldset").props.disabled).toBe(false);
    expect(root.findAllByType("button").find(
      (button) => button.children.join("") === "一併更新預填階梯折扣",
    )?.props["aria-pressed"]).toBe(true);

    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "只改價格並保留原數量折扣",
      )!.props.onClick();
    });
    expect(root.findAllByType("fieldset")).toHaveLength(0);
    expect(root.findAllByProps({ id: "business-tier-bound-0" }))
      .toHaveLength(0);
    expect(root.findAll((node) => node.children.join("") ===
      "預填建議數量折扣（1–5 階 percent）")).toHaveLength(0);

    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "一併更新預填階梯折扣",
      )!.props.onClick();
    });
    expect(root.findByProps({ id: "business-tier-percent-0" }).props.value)
      .toBe("5");
    await act(async () => renderer!.unmount());
  });

  it("keeps a failed Amazon preview and Request ID visible inside the open editor", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        code: "VALIDATION_STATUS_UNKNOWN",
        message:
          "Amazon B2B 價格預檢沒有回傳 exact SKU／ASIN／站點的 VALID 證據。",
        requestId: "94de6604-0b85-446c-960b-df46a737f27c",
      }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })));
    let renderer: ReactTestRenderer | null = null;
    const onError = vi.fn();
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing: parseBusinessPricingListingSnapshot(interactiveListing),
        onClose: () => undefined,
        onVerified: () => undefined,
        onError,
        onBusyChange: () => undefined,
      }));
    });

    const root = renderer!.root;
    await act(async () => {
      root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
    });

    expect(root.findAllByType("form")).toHaveLength(1);
    expect(root.findAllByProps({
      className: "price-error business-pricing-editor-error",
    })).toHaveLength(1);
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain("Amazon B2B 價格預檢沒有回傳 exact SKU");
    expect(rendered).toContain("94de6604-0b85-446c-960b-df46a737f27c");
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining(
      "94de6604-0b85-446c-960b-df46a737f27c",
    ));
    expect(root.findAllByType("button").some((button) =>
      button.children.join("").includes("先預檢 B2B 價格與階梯折扣")
    )).toBe(true);
    await act(async () => renderer!.unmount());
  });

  it("sends percent tiers by default and omits them only after explicitly choosing price-only", async () => {
    const priceOnlyBody = await previewBodyFromRowInteraction("price_only");
    expect(priceOnlyBody).toMatchObject({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      expectedBusinessPrice: null,
      newBusinessPrice: 18.99,
    });
    expect(priceOnlyBody).not.toHaveProperty("quantityDiscountTiers");
    expect(priceOnlyBody).not.toHaveProperty(
      "expectedQuantityDiscountPlanHash",
    );
    expect(priceOnlyBody).not.toHaveProperty("expectedMinimumPrice");

    const combinedBody = await previewBodyFromRowInteraction("combined");
    expect(combinedBody).toMatchObject({
      expectedMinimumPrice: 18,
      expectedQuantityDiscountPlanHash: "f".repeat(64),
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 10, percent: 10 },
        { lowerBound: 15, percent: 15 },
        { lowerBound: 20, percent: 20 },
      ],
    });
  });

  it("shows canonical, absent and ambiguous minimum-price evidence distinctly", () => {
    const canonical = parseBusinessPricingListingSnapshot(interactiveListing);
    const absent = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      minimumPrice: null,
      minimumPricePresence: "absent",
    });
    const ambiguous = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      minimumPrice: null,
      minimumPricePresence: "ambiguous",
    });
    const legacyUnknown = { ...interactiveListing } as Record<string, unknown>;
    delete legacyUnknown.minimumPrice;
    delete legacyUnknown.minimumPricePresence;

    expect(canonical.minimumPrice).toEqual({
      amount: 18,
      currencyCode: "USD",
    });
    expect(canonical.minimumPricePresence).toBe("canonical");
    expect(absent.minimumPrice).toBeNull();
    expect(absent.minimumPricePresence).toBe("absent");
    expect(ambiguous.minimumPrice).toBeNull();
    expect(ambiguous.minimumPricePresence).toBe("ambiguous");
    expect(parseBusinessPricingListingSnapshot(legacyUnknown))
      .toMatchObject({ minimumPrice: null, minimumPricePresence: "ambiguous" });

    const editorMarkup = (listing: typeof canonical) =>
      renderToStaticMarkup(createElement(BusinessPricingEditor, {
        listing,
        onClose: () => undefined,
        onVerified: () => undefined,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    expect(editorMarkup(canonical)).toContain("目前最低價");
    expect(editorMarkup(canonical)).toMatch(/目前最低價[\s\S]*?18\.00/u);
    expect(editorMarkup(absent)).toMatch(/目前最低價[\s\S]*?未設定/u);
    expect(editorMarkup(ambiguous)).toMatch(
      /目前最低價[\s\S]*?Amazon 無法確認/u,
    );
  });

  it("shows the Amazon-validated price and tier changes as red old values to green new values", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const listing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      standardPrice: { amount: 18.99, currencyCode: "USD" },
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      minimumPrice: { amount: 18, currencyCode: "USD" },
      minimumPricePresence: "canonical",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [{ lowerBound: 3, value: 2 }],
      },
      quantityDiscountPlanPresence: "canonical",
      quantityDiscountPlanHash: "1".repeat(64),
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({
          code: "BUSINESS_PRICE_PARTIAL_UPDATE",
          message:
            "最低價已從 18 降至 13.39 USD 並完成回查，但 B2B 價格與階梯折扣尚未寫入。請重新讀取 Amazon 後再預檢；系統不會自動重送。",
          requestId: "REQ-PARTIAL-B2B",
          minimumPriceUpdate: {
            status: "verified",
            previousMinimumPrice: { amount: 18, currencyCode: "USD" },
            requestedMinimumPrice: { amount: 13.39, currencyCode: "USD" },
            lowestTierUnitPrice: { amount: 14.39, currencyCode: "USD" },
          },
        }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        mode: "live",
        status: "VALID",
        marketplaceId: listing.marketplaceId,
        sellerSku: listing.sellerSku,
        asin: listing.asin,
        productType: listing.productType,
        standardPrice: listing.standardPrice,
        previousBusinessPrice: listing.businessPrice,
        requestedBusinessPrice: {
          amount: body.newBusinessPrice,
          currencyCode: "USD",
        },
        previousMinimumPrice: listing.minimumPrice,
        requestedMinimumPrice: { amount: 13.39, currencyCode: "USD" },
        lowestTierUnitPrice: { amount: 14.39, currencyCode: "USD" },
        minimumPriceChange: "lower",
        minimumPriceProtectedHash: "7".repeat(64),
        minimumPriceCanonicalPatchHash: "8".repeat(64),
        businessPriceValidation: "final-state-validated",
        previousQuantityDiscountPlan: listing.quantityDiscountPlan,
        previousQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
        requestedQuantityDiscountPlan: {
          discountType: "percent",
          levels: (body.quantityDiscountTiers as Array<{
            lowerBound: number;
            percent: number;
          }>).map((tier) => ({
            lowerBound: tier.lowerBound,
            value: tier.percent,
          })),
        },
        quantityDiscountPlanChange: "replace",
        businessOfferGuardHash: listing.businessOfferGuardHash,
        businessOfferProtectedHash: listing.businessOfferProtectedHash,
        schemaChecksum: listing.businessPricingCapability.schemaChecksum,
        fbaEvidenceHash: "b".repeat(64),
        canonicalPatchHash: "c".repeat(64),
        validationIssuesHash: "d".repeat(64),
        validatedAt: "2026-08-31T12:01:00.000Z",
        issues: [],
        notice: "Amazon Validation Preview 已通過。",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    let renderer: ReactTestRenderer | null = null;
    const onVerified = vi.fn();
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing,
        onClose: () => undefined,
        onVerified,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });
    const root = renderer!.root;
    await act(async () => {
      root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
    });

    const oldValues = root.findAllByProps({
      className: "business-pricing-diff-old",
    }).map((node) => node.children.join(""));
    const newValues = root.findAllByProps({
      className: "business-pricing-diff-new",
    }).map((node) => node.children.join(""));
    expect(oldValues.some((value) => value.includes("18.99"))).toBe(true);
    expect(newValues.some((value) => value.includes("17.99"))).toBe(true);
    expect(oldValues.some((value) => value.includes("18.00"))).toBe(true);
    expect(newValues.some((value) => value.includes("13.39"))).toBe(true);
    expect(oldValues).toContain("0%");
    expect(newValues).toContain("5%");
    expect(oldValues).toContain("2%");
    expect(newValues).toContain("0%");
    expect(root.findAllByProps({
      className: "business-pricing-diff-arrow",
    }).length).toBeGreaterThanOrEqual(2);
    expect(root.findByProps({
      className: "business-pricing-validation",
    }).props).toMatchObject({ role: "status", "aria-live": "polite" });
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain("最低階梯實際單價");
    expect(rendered).toContain("14.39");
    expect(rendered).toContain("ALL audience");
    expect(rendered).toContain("一般售價／自動定價");
    await act(async () => {
      root.findAllByType("button").find((button) =>
        button.children.join("") === "Touch ID／Windows Hello 確認並送出"
      )!.props.onClick();
    });
    const partialRendered = JSON.stringify(renderer!.toJSON());
    expect(partialRendered).toContain("最低價已從 18 降至 13.39 USD");
    expect(partialRendered).toContain("REQ-PARTIAL-B2B");
    expect(root.findAllByType("dd").map((node) => node.children.join("")))
      .toEqual(expect.arrayContaining([expect.stringContaining("13.39")]));
    const retryButton = root.findAllByType("button").find((button) =>
      button.children.join("") === "請重新讀取 Amazon 後再預檢"
    );
    expect(retryButton?.props.disabled).toBe(true);
    expect(onVerified).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount());

    const css = await readRendererStylesheet();
    expect(css).toMatch(
      /\.business-pricing-diff-old\s*\{[^}]*color:\s*#b12e3b/su,
    );
    expect(css).toMatch(
      /\.business-pricing-diff-new\s*\{[^}]*color:\s*#187244/su,
    );
  });

  it("accepts post-minimum offer hashes and shows the verified minimum as current", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const listing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      standardPrice: { amount: 18.99, currencyCode: "USD" },
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      minimumPrice: { amount: 18, currencyCode: "USD" },
      minimumPricePresence: "canonical",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [{ lowerBound: 3, value: 2 }],
      },
      quantityDiscountPlanPresence: "canonical",
      quantityDiscountPlanHash: "1".repeat(64),
    });
    const requestedPlan = {
      discountType: "percent" as const,
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
        { lowerBound: 15, value: 15 },
        { lowerBound: 20, value: 20 },
      ],
    };
    const validation = {
      mode: "live",
      status: "VALID",
      marketplaceId: listing.marketplaceId,
      sellerSku: listing.sellerSku,
      asin: listing.asin,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      previousBusinessPrice: listing.businessPrice,
      requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousMinimumPrice: listing.minimumPrice,
      requestedMinimumPrice: { amount: 13.39, currencyCode: "USD" },
      lowestTierUnitPrice: { amount: 14.39, currencyCode: "USD" },
      minimumPriceChange: "lower",
      minimumPriceProtectedHash: "7".repeat(64),
      minimumPriceCanonicalPatchHash: "8".repeat(64),
      businessPriceValidation: "final-state-validated",
      previousQuantityDiscountPlan: listing.quantityDiscountPlan,
      previousQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
      requestedQuantityDiscountPlan: requestedPlan,
      quantityDiscountPlanChange: "replace",
      businessOfferGuardHash: listing.businessOfferGuardHash,
      businessOfferProtectedHash: listing.businessOfferProtectedHash,
      schemaChecksum: listing.businessPricingCapability.schemaChecksum,
      fbaEvidenceHash: "b".repeat(64),
      canonicalPatchHash: "c".repeat(64),
      validationIssuesHash: "d".repeat(64),
      validatedAt: "2026-08-31T12:01:00.000Z",
      issues: [],
      notice: "Amazon Validation Preview 已通過。",
    };
    const update = {
      ...validation,
      status: "ACCEPTED",
      businessPriceValidation: "validated",
      businessOfferGuardHash: "9".repeat(64),
      businessOfferProtectedHash: "6".repeat(64),
      acceptedAt: "2026-08-31T12:02:00.000Z",
      submissionId: "submission-post-minimum",
      requestId: "request-post-minimum",
      notice: "最低價與 B2B 階梯已完成回查。",
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
        acceptedAt: "2026-08-31T12:02:00.000Z",
        verifiedAt: "2026-08-31T12:02:05.000Z",
        attempts: 2,
      },
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) =>
      new Response(JSON.stringify(init?.method === "PATCH"
        ? update
        : validation), {
        status: 200,
        headers: { "content-type": "application/json" },
      })));
    const onVerified = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing,
        onClose: () => undefined,
        onVerified,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });
    const root = renderer!.root;
    await act(async () => {
      root.findByType("form").props.onSubmit({ preventDefault: () => undefined });
    });
    await act(async () => {
      root.findAllByType("button").find((button) =>
        button.children.join("") === "Touch ID／Windows Hello 確認並送出"
      )!.props.onClick();
    });

    expect(onVerified).toHaveBeenCalledOnce();
    expect(root.findAllByType("dd").map((node) => node.children.join("")))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("17.99"),
        expect.stringContaining("13.39"),
      ]));
    expect(JSON.stringify(renderer!.toJSON())).toContain("已完成並回查");
    await act(async () => renderer!.unmount());
  });

  it("resumes a newer completed job over an older cache without duplicating an active observer", () => {
    const cachedSnapshot = parseBusinessPricingAuditSnapshot(payload());
    const newerPayload = payload();
    newerPayload.fetchedAt = "2026-08-23T12:00:00.000Z";
    const completedJob = parseStandaloneAuditJob({
      jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
      contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
      kind: "businessPricing",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      options: {},
      ready: true,
      status: "completed",
      progress: {
        stage: "complete",
        message: "B2B 價格健檢完成",
        completedUnits: 4,
        totalUnits: 4,
      },
      snapshot: newerPayload,
    }, {
      kind: "businessPricing",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
    });

    expect(shouldResumeBusinessPricingAuditJob({
      initialJob: completedJob,
      snapshot: cachedSnapshot,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      observerJobId: null,
    })).toBe(true);

    const currentSnapshot = parseBusinessPricingAuditSnapshot(newerPayload);
    expect(shouldResumeBusinessPricingAuditJob({
      initialJob: completedJob,
      snapshot: currentSnapshot,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      observerJobId: null,
    })).toBe(false);
    expect(shouldResumeBusinessPricingAuditJob({
      initialJob: completedJob,
      snapshot: cachedSnapshot,
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      observerJobId: completedJob.jobId,
    })).toBe(true);
  });

  it("shows a current failed job without rendering an older cached B2B result", () => {
    const failedJob = parseStandaloneAuditJob({
      jobId: "74ec9cda-e878-4e87-984e-65c8c5652cee",
      contextId: "64ec9cda-e878-4e87-984e-65c8c5652cef",
      kind: "businessPricing",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
      options: {},
      ready: true,
      status: "failed",
      progress: {
        stage: "failed",
        message: "B2B 價格健檢未完成",
        completedUnits: 2,
        totalUnits: 4,
      },
      error: {
        code: "BUSINESS_PRICING_AUDIT_FAILED",
        message: "本次 B2B 價格健檢未完成。",
      },
    }, {
      kind: "businessPricing",
      marketplaceId: "ATVPDKIKX0DER",
      mode: "live",
    });
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      mode: "live",
      initialJob: failedJob,
      cachedSnapshot: parseBusinessPricingAuditSnapshot(payload()),
    }));

    expect(markup).toContain("本次 B2B 價格健檢未完成。");
    expect(markup).not.toContain("B2B 價格健檢摘要與篩選");
  });

  it("keeps the live Pages rollout readable with a v0.1.25 audit payload", () => {
    const legacy = payload();
    for (const row of legacy.rows as Array<Record<string, unknown>>) {
      delete row.quantityDiscountPlan;
      delete row.quantityDiscountPlanPresence;
    }
    delete (legacy.summary as Record<string, unknown>).recommendedPriceMismatch;
    delete (legacy.summary as Record<string, unknown>)
      .recommendedQuantityDiscountMismatch;

    const snapshot = parseBusinessPricingAuditSnapshot(legacy);

    expect(snapshot.rows).toHaveLength(4);
    expect(snapshot.rows.every((row) =>
      row.quantityDiscountPlan === null &&
      row.quantityDiscountPlanPresence === "ambiguous"
    )).toBe(true);
  });

  it("strictly parses exact FBA SKU identities and money evidence", () => {
    const source = payload();
    (source.rows as Array<Record<string, unknown>>)[0]!.title =
      "Title with Amazon source\u2028line and zero-width\u200bcharacter";
    const snapshot = parseBusinessPricingAuditSnapshot(source);
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: 4,
      configured: 2,
      aboveStandard: 0,
      missing: 2,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 2,
      recommendedQuantityDiscountMismatch: 3,
    });
    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "FBA-MISSING",
      status: "missing",
      editable: false,
      businessPrice: null,
      title: "Title with Amazon source\u2028line and zero-width\u200bcharacter",
    });
    expect(snapshot.rows[1]?.businessPrice).toEqual({
      amount: 22.49,
      currencyCode: "USD",
    });
  });

  it("rejects duplicate or normalized SKU identities and inconsistent summaries", () => {
    const duplicate = payload();
    const duplicateRows = duplicate.rows as Array<Record<string, unknown>>;
    duplicateRows[1]!.sellerSku = "FBA-MISSING";
    expect(() => parseBusinessPricingAuditSnapshot(duplicate)).toThrow(/重複/u);

    const normalized = payload();
    const normalizedRows = normalized.rows as Array<Record<string, unknown>>;
    normalizedRows[0]!.sellerSku = " FBA-MISSING ";
    expect(() => parseBusinessPricingAuditSnapshot(normalized)).toThrow(/Seller SKU/u);

    const inconsistent = payload();
    (inconsistent.summary as Record<string, unknown>).missing = 0;
    expect(() => parseBusinessPricingAuditSnapshot(inconsistent)).toThrow(/摘要/u);
  });

  it("rejects a configured row whose B2B price is still above standard", () => {
    const inconsistent = payload();
    const rows = inconsistent.rows as Array<Record<string, unknown>>;
    rows[1]!.businessPrice = { amount: 25.99, currencyCode: "USD" };

    expect(() => parseBusinessPricingAuditSnapshot(inconsistent)).toThrow(
      /價格、狀態與能力/u,
    );
  });

  it("normalizes legacy editable audit rows to read-only, including a configured price without standard-price evidence", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    rows[1] = {
      ...rows[1],
      standardPrice: null,
      businessPrice: { amount: 17.45, currencyCode: "USD" },
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [{ lowerBound: 5, value: 5 }],
      },
      quantityDiscountPlanPresence: "canonical",
      status: "configured",
      editable: true,
    };
    (source.summary as Record<string, unknown>).recommendedPriceMismatch = 1;

    const snapshot = parseBusinessPricingAuditSnapshot(source);
    expect(snapshot.rows[1]).toMatchObject({
      standardPrice: null,
      businessPrice: { amount: 17.45, currencyCode: "USD" },
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [{ lowerBound: 5, value: 5 }],
      },
      quantityDiscountPlanPresence: "canonical",
      status: "configured",
      editable: false,
    });

    rows[1]!.editable = false;
    expect(parseBusinessPricingAuditSnapshot(source).rows[1]?.editable)
      .toBe(false);
  });

  it("filters missing, configured and problem rows without hiding incomplete evidence", () => {
    const rows = parseBusinessPricingAuditSnapshot(payload()).rows;
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "missing")))
      .toHaveLength(2);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "configured")))
      .toHaveLength(2);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "problem")))
      .toHaveLength(4);
    expect(rows.filter((row) =>
      businessPricingRowMatchesFilter(row, "recommended_price_mismatch")
    )).toHaveLength(2);
    expect(rows.filter((row) =>
      businessPricingRowMatchesFilter(
        row,
        "recommended_quantity_discount_mismatch",
      )
    )).toHaveLength(3);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "all")))
      .toHaveLength(4);
  });

  it("treats a B2B price above standard as a read-only problem", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    rows[1] = {
      ...rows[1],
      standardPrice: { amount: 24.99, currencyCode: "USD" },
      businessPrice: { amount: 25.99, currencyCode: "USD" },
      status: "above_standard",
      reason: "Amazon Business 價格高於一般售價。",
    };
    const summary = source.summary as Record<string, unknown>;
    summary.configured = 1;
    summary.aboveStandard = 1;

    const snapshot = parseBusinessPricingAuditSnapshot(source);
    const row = snapshot.rows[1]!;

    expect(row.status).toBe("above_standard");
    expect(row.editable).toBe(false);
    expect(businessPricingRowMatchesFilter(row, "problem")).toBe(true);
    expect(snapshot.summary.aboveStandard).toBe(1);
  });

  it("keeps a verified price above standard flagged until it is actually fixed", () => {
    const snapshot = parseBusinessPricingAuditSnapshot(payload());
    const update = (amount: number): BusinessPriceUpdate => ({
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      previousBusinessPrice: null,
      requestedBusinessPrice: { amount, currencyCode: "USD" },
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      schemaChecksum: "seller-schema-checksum",
      acceptedAt: "2026-08-22T12:01:00.000Z",
      issues: [],
      notice: "Amazon write verified.",
    });

    const stillHigh = applyVerifiedBusinessPriceToAuditSnapshot(
      snapshot,
      update(20.99),
    );
    expect(stillHigh.rows[0]).toMatchObject({
      status: "above_standard",
      businessPrice: { amount: 20.99, currencyCode: "USD" },
    });
    expect(stillHigh.summary).toEqual({
      totalFbaSkuCount: 4,
      configured: 2,
      aboveStandard: 1,
      missing: 1,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 3,
      recommendedQuantityDiscountMismatch: 3,
    });

    const fixed = applyVerifiedBusinessPriceToAuditSnapshot(
      stillHigh,
      update(18.99),
    );
    expect(fixed.rows[0]?.status).toBe("configured");
    expect(fixed.summary).toEqual({
      totalFbaSkuCount: 4,
      configured: 3,
      aboveStandard: 0,
      missing: 1,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 2,
      recommendedQuantityDiscountMismatch: 3,
    });
  });

  it("renders actionable recommendations, quantity-discount evidence and Seller Central handoff", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    rows[1] = {
      ...rows[1],
      businessPrice: { amount: 25.99, currencyCode: "USD" },
      status: "above_standard",
    };
    const summary = source.summary as Record<string, unknown>;
    summary.configured = 1;
    summary.aboveStandard = 1;
    const snapshot = parseBusinessPricingAuditSnapshot(source);
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: snapshot,
    }));
    expect(markup).toContain("未設定 B2B 價格");
    expect(markup).toContain("高於一般售價");
    expect(markup).toContain("百分比折扣");
    expect(markup).toContain("Amazon Business 可用，但尚未設定 B2B 價格。");
    expect(markup.match(/>設定 B2B 價格<\/button>/gu)).toHaveLength(2);
    expect(markup.match(/>調整 B2B 價格<\/button>/gu)).toHaveLength(2);
    expect(markup).not.toContain("唯讀／不支援");
    expect(markup).not.toContain("seller-specific PTD");
    expect(markup).not.toContain("因此只提供唯讀");
    expect(markup).toContain("Amazon Validation Preview");
    expect(markup).toContain("預設一併帶入 Business Price");
    expect(markup).toContain("你仍可明確切換為只改 Business Price");
    expect(markup).toContain("完整保留現有階梯折扣");
    expect(markup).not.toContain("預設只改 Business Price");
    expect(markup).not.toContain("不可直接修改");
    expect(markup).toContain("建議 B2B 價格");
    expect(markup).toContain("US 一般售價 – USD 1.00");
    expect(markup).toContain("5 件 5%・10 件 10%・15 件 15%・20 件 20%");
    expect(markup).toContain("目前數量折扣");
    expect(markup).not.toContain("百分比：5 件＝5%、10 件＝10%");
    expect(markup).toContain('class="business-pricing-quantity-plan"');
    expect(markup).toContain("5 件以上");
    expect(markup).toContain("省 5%");
    expect(markup).toContain("10 件以上");
    expect(markup).toContain("省 10%");
    expect(markup).toContain("Amazon 未能確認，請到後台核對");
    expect(markup).toContain("Notebook Key 需更新後才能安全開啟指定 SKU");
    expect(markup).toContain("舊版不會改開 Seller Central 首頁");
    expect(markup.match(/>前往 Amazon 後台 ↗<\/button>/g)).toHaveLength(4);
    const panelSource = readFileSync(
      new URL("../src/renderer/src/components/business-pricing-audit-panel.tsx", import.meta.url),
      "utf8",
    );
    const editorSource = readFileSync(
      new URL("../src/renderer/src/components/business-pricing-editor.tsx", import.meta.url),
      "utf8",
    );
    expect(panelSource).toContain("openSellerCentralInventoryHandoff");
    expect(panelSource).not.toContain('window.fbaOS.app.openExternal("seller-central")');
    expect(panelSource).toContain('kind: "businessPricing"');
    expect(panelSource).toContain("pollStandaloneAuditJob");
    expect(panelSource).toContain("onJobChange?.(current)");
    expect(panelSource).not.toContain('fetch("/api/sp-api/business-pricing-audit"');
    expect(panelSource).toContain("business-pricing-editor");
    expect(panelSource).toContain("openEditor");
    expect(panelSource).toContain("/api/sp-api/business-pricing?");
    expect(editorSource).toContain('method: "POST"');
    expect(editorSource).toContain('method: "PATCH"');
  });

  it("shows exact incomplete reasons for AFA135AM and TRPL03 without exposing PTD capability prose", () => {
    const source = payload();
    const rows = source.rows as Array<Record<string, unknown>>;
    rows[0] = {
      ...rows[0],
      sellerSku: "AFA135AM",
      asin: "B000000031",
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: true,
      reason: "AFA135AM 的 Active Listings Business Price 與 Listings 身分證據不一致。",
    };
    rows[1] = {
      ...rows[1],
      sellerSku: "TRPL03",
      asin: "B000000032",
      standardPrice: null,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      status: "incomplete",
      editable: true,
      reason: "TRPL03 的一般售價證據未完整回傳，無法安全判定 Business Price 狀態。",
    };
    Object.assign(source.summary as Record<string, unknown>, {
      configured: 1,
      missing: 1,
      incomplete: 2,
      recommendedPriceMismatch: 1,
      recommendedQuantityDiscountMismatch: 1,
    });

    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: parseBusinessPricingAuditSnapshot(source),
    }));

    expect(markup).toContain(
      "AFA135AM 的 Active Listings Business Price 與 Listings 身分證據不一致。",
    );
    expect(markup).toContain(
      "TRPL03 的一般售價證據未完整回傳，無法安全判定 Business Price 狀態。",
    );
    expect(markup).not.toContain("seller-specific PTD");
    expect(markup).not.toContain("因此只提供唯讀");
  });

  it("uses one clickable B2B summary as the filter instead of repeating the counts", async () => {
    const snapshot = parseBusinessPricingAuditSnapshot(payload());
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: snapshot,
    }));
    const summary = markup.match(
      /<div class="business-pricing-summary is-interactive" role="group" aria-label="B2B 價格健檢摘要與篩選">[\s\S]*?<\/div>/u,
    )?.[0];

    expect(summary).toBeDefined();
    expect(summary?.match(/<button\b/gu)).toHaveLength(8);
    expect(summary).not.toContain("唯讀／不支援");
    expect(summary).toContain("不符建議 B2B 價格");
    expect(summary).toContain("未正確設定階梯折扣");
    expect(summary).toContain('aria-pressed="true"');
    expect(markup).not.toContain("business-pricing-filters");
    expect(markup.match(/B2B 價格健檢摘要與篩選/gu)).toHaveLength(1);
    expect(markup).toContain("business-pricing-export-button");
    expect(markup).not.toContain(
      'class="content-audit-export-primary">匯出 B2B 價格 Excel',
    );
    const css = await readRendererStylesheet();
    expect(css).toMatch(
      /\.business-pricing-summary\s*\{[^}]*minmax\(104px,\s*1fr\)/su,
    );
  });

  it("lays out current quantity discounts as readable desktop tiers", async () => {
    const css = await readRendererStylesheet();

    expect(css).toMatch(
      /\.business-pricing-quantity-cell\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/su,
    );
    expect(css).toMatch(
      /\.business-pricing-quantity-tiers\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(96px,\s*1fr\)\)/su,
    );
    expect(css).toMatch(/\.business-pricing-quantity-tier\s*\{/u);
  });

  it("keeps audit evidence read-only while wiring rows to the isolated write helpers", () => {
    const panelSource = readFileSync(
      new URL("../src/renderer/src/components/business-pricing-audit-panel.tsx", import.meta.url),
      "utf8",
    );
    const editorSource = readFileSync(
      new URL("../src/renderer/src/components/business-pricing-editor.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain("BusinessPricingListingSnapshot");
    expect(panelSource).toContain("applyVerifiedBusinessPriceToAuditSnapshot");
    expect(panelSource).toContain("BusinessPricingEditor");
    expect(editorSource).toContain("SubmittedBusinessPricePreview");
    expect(editorSource).toContain("createSubmittedBusinessPricePreview");
    expect(editorSource).toContain("parseBusinessPriceUpdate");
    expect(typeof parseBusinessPricingListingSnapshot).toBe("function");
    expect(typeof createSubmittedBusinessPricePreview).toBe("function");
    expect(typeof parseBusinessPriceUpdate).toBe("function");
  });

  it("wraps the audit in an accessible Amazon Business drawer", () => {
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditDrawer, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      onClose: () => undefined,
    }));
    expect(markup).toContain("全站 B2B 價格健檢");
    expect(markup).toContain("AMAZON BUSINESS · FBA ONLY");
    expect(markup).toContain('role="dialog"');
  });

  it("freezes the exact submitted body and rejects a mismatched preview", () => {
    const listing = parseBusinessPricingListingSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      title: "Missing business price",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      minimumPrice: null,
      minimumPricePresence: "absent",
      businessPrice: null,
      businessOfferPresence: "absent",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      quantityDiscountPlanHash: null,
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
      },
      fetchedAt: "2026-08-22T12:00:00.000Z",
      notice: null,
    });
    const validation = {
      mode: "live",
      status: "VALID",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      previousBusinessPrice: null,
      requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve",
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated",
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      schemaChecksum: "seller-schema-checksum",
      fbaEvidenceHash: "b".repeat(64),
      canonicalPatchHash: "c".repeat(64),
      validationIssuesHash: "d".repeat(64),
      validatedAt: "2026-08-22T12:01:00.000Z",
      issues: [],
      notice: "Amazon Validation Preview 已通過。",
    };

    const submitted = createSubmittedBusinessPricePreview({
      listing,
      newBusinessPrice: 17.99,
      idempotencyKey: "business-price-test-001",
      response: validation,
    });
    expect(Object.isFrozen(submitted)).toBe(true);
    expect(Object.isFrozen(submitted.body)).toBe(true);
    expect(submitted.body.newBusinessPrice).toBe(17.99);
    expect("quantityDiscountTiers" in submitted.body).toBe(false);
    expect("expectedQuantityDiscountPlanHash" in submitted.body).toBe(false);
    expect(() => createSubmittedBusinessPricePreview({
      listing,
      newBusinessPrice: 17.99,
      idempotencyKey: "business-price-test-002",
      response: {
        ...validation,
        requestedBusinessPrice: { amount: 16.99, currencyCode: "USD" },
      },
    })).toThrow(/預檢/u);
  });

  it("proposes USD standard-minus-one with the four explicit percent tiers", () => {
    const proposal = defaultBusinessPricingProposal(
      parseBusinessPricingListingSnapshot({
        mode: "live",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "FBA-MISSING",
        asin: "B000000001",
        title: "Missing business price",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        minimumPrice: null,
        minimumPricePresence: "absent",
        businessPrice: null,
        businessOfferPresence: "absent",
        businessPricingManagedByAutomation: false,
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
        quantityDiscountPlanHash: null,
        businessOfferGuardHash: "a".repeat(64),
        businessOfferProtectedHash: "e".repeat(64),
        businessPricingCapability: {
          supported: true,
          editable: true,
          reason: null,
          schemaChecksum: "seller-schema-checksum",
          quantityDiscountsSupported: true,
          quantityDiscountsEditable: true,
          quantityDiscountsReason: null,
        },
        fetchedAt: "2026-08-22T12:00:00.000Z",
        notice: null,
      }),
    );

    expect(proposal).toEqual({
      businessPrice: 18.99,
      tiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 10, percent: 10 },
        { lowerBound: 15, percent: 15 },
        { lowerBound: 20, percent: 20 },
      ],
    });
  });

  it("parses identical duplicate tiers and prefills their exact values for repair", () => {
    const listing = parseBusinessPricingListingSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-DUPLICATE-TIERS",
      asin: "B000000004",
      title: "Duplicate quantity tiers",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      minimumPrice: null,
      minimumPricePresence: "absent",
      businessPrice: { amount: 17.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 3, value: 4 },
          { lowerBound: 9, value: 8 },
        ],
      },
      quantityDiscountPlanPresence: "duplicate",
      quantityDiscountPlanHash: "f".repeat(64),
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
      },
      fetchedAt: "2026-08-31T05:00:00.000Z",
      notice: null,
    });

    expect(defaultBusinessPricingProposal(listing)).toEqual({
      businessPrice: 17.99,
      tiers: [
        { lowerBound: 3, percent: 4 },
        { lowerBound: 9, percent: 8 },
      ],
    });
  });

  it("locks duplicate percent tiers to the combined repair UI", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const listing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      businessPrice: { amount: 17.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 3, value: 4 },
          { lowerBound: 9, value: 8 },
        ],
      },
      quantityDiscountPlanPresence: "duplicate",
      quantityDiscountPlanHash: "f".repeat(64),
    });
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing,
        onClose: () => undefined,
        onVerified: () => undefined,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });
    const root = renderer!.root;
    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain("將修復重複數量折扣");
    expect(rendered).toContain("目前數量折扣（將去除重複）");
    expect(root.findByProps({ id: "business-price-input" }).props.value)
      .toBe("17.99");
    expect(root.findByProps({ id: "business-price-input" }).props.disabled)
      .toBe(true);
    expect(root.findByProps({ id: "business-tier-bound-0" }).props.value)
      .toBe("3");
    expect(root.findByProps({ id: "business-tier-bound-0" }).props.disabled)
      .toBe(true);
    expect(root.findByProps({ id: "business-tier-percent-0" }).props.value)
      .toBe("4");
    expect(root.findAllByType("button").some((button) =>
      button.children.join("") === "只改價格並保留原數量折扣"
    )).toBe(false);
    expect(root.findAllByType("button").some((button) =>
      button.children.join("") === "修復重複數量折扣"
    )).toBe(true);
    expect(rendered).toContain("本次不會變更售價或折扣內容");
    expect(rendered).not.toContain("刪除此階");
    expect(rendered).not.toContain("＋ 新增一階");
    await act(async () => renderer!.unmount());
  });

  it("keeps the USD standard-minus-one default available for price-only edits", () => {
    const proposal = defaultBusinessPricingProposal(
      parseBusinessPricingListingSnapshot({
        mode: "live",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "FBA-PRICE-ONLY",
        asin: "B000000002",
        title: "Price-only business listing",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        minimumPrice: null,
        minimumPricePresence: "absent",
        businessPrice: null,
        businessOfferPresence: "absent",
        businessPricingManagedByAutomation: false,
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent",
        quantityDiscountPlanHash: null,
        businessOfferGuardHash: "a".repeat(64),
        businessOfferProtectedHash: "e".repeat(64),
        businessPricingCapability: {
          supported: true,
          editable: true,
          reason: null,
          schemaChecksum: "seller-schema-checksum",
          quantityDiscountsSupported: false,
          quantityDiscountsEditable: false,
          quantityDiscountsReason: "QDP is read-only.",
        },
        fetchedAt: "2026-08-22T12:00:00.000Z",
        notice: null,
      }),
    );

    expect(proposal).toEqual({ businessPrice: 18.99, tiers: [] });
  });

  it("requires an explicit combined choice before proposing quantity tiers", () => {
    const listing = parseBusinessPricingListingSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-EXPLICIT-TIERS",
      asin: "B000000003",
      title: "Explicit quantity tiers",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      minimumPrice: null,
      minimumPricePresence: "absent",
      businessPrice: { amount: 19.5, currencyCode: "USD" },
      businessOfferPresence: "present",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: {
        discountType: "fixed",
        levels: [{ lowerBound: 5, value: 18 }],
      },
      quantityDiscountPlanPresence: "canonical",
      quantityDiscountPlanHash: "f".repeat(64),
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
      },
      fetchedAt: "2026-08-22T12:00:00.000Z",
      notice: null,
    });

    expect(businessPricingEditorProposal(listing, "price_only")).toEqual({
      businessPrice: 18.99,
    });
    expect(businessPricingEditorProposal(listing, "combined")).toEqual({
      businessPrice: 18.99,
      quantityDiscountTiers: [
        { lowerBound: 5, percent: 5 },
        { lowerBound: 10, percent: 10 },
        { lowerBound: 15, percent: 15 },
        { lowerBound: 20, percent: 20 },
      ],
    });
    expect(businessPricingEditorProposal(listing, "price_only")).toEqual({
      businessPrice: 18.99,
    });
  });

  it("freezes an explicit combined Business Price and quantity-tier proposal", () => {
    const tiers = [
      { lowerBound: 5, percent: 5 },
      { lowerBound: 10, percent: 10 },
      { lowerBound: 15, percent: 15 },
      { lowerBound: 20, percent: 20 },
    ] as const;
    const listing = parseBusinessPricingListingSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      title: "Missing business price",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      minimumPrice: null,
      minimumPricePresence: "absent",
      businessPrice: null,
      businessOfferPresence: "absent",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      quantityDiscountPlanHash: null,
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
      },
      fetchedAt: "2026-08-22T12:00:00.000Z",
      notice: null,
    });
    const submitted = createSubmittedBusinessPricePreview({
      listing,
      newBusinessPrice: 18.99,
      quantityDiscountTiers: tiers,
      idempotencyKey: "business-price-tiers-001",
      response: {
        mode: "live",
        status: "VALID",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "FBA-MISSING",
        asin: "B000000001",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        previousBusinessPrice: null,
        requestedBusinessPrice: { amount: 18.99, currencyCode: "USD" },
        previousMinimumPrice: null,
        requestedMinimumPrice: null,
        lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
        minimumPriceChange: "preserve",
        minimumPriceProtectedHash: null,
        minimumPriceCanonicalPatchHash: null,
        businessPriceValidation: "validated",
        previousQuantityDiscountPlan: null,
        previousQuantityDiscountPlanHash: null,
        requestedQuantityDiscountPlan: {
          discountType: "percent",
          levels: tiers.map((tier) => ({
            lowerBound: tier.lowerBound,
            value: tier.percent,
          })),
        },
        quantityDiscountPlanChange: "replace",
        businessOfferGuardHash: "a".repeat(64),
        businessOfferProtectedHash: "e".repeat(64),
        schemaChecksum: "seller-schema-checksum",
        fbaEvidenceHash: "b".repeat(64),
        canonicalPatchHash: "c".repeat(64),
        validationIssuesHash: "d".repeat(64),
        validatedAt: "2026-08-22T12:01:00.000Z",
        issues: [],
        notice: "Amazon Validation Preview 已通過。",
      },
    });

    expect(submitted.body).toMatchObject({
      expectedQuantityDiscountPlanHash: null,
      quantityDiscountTiers: tiers,
    });
    expect(submitted.validation.requestedQuantityDiscountPlan).toEqual({
      discountType: "percent",
      levels: tiers.map((tier) => ({
        lowerBound: tier.lowerBound,
        value: tier.percent,
      })),
    });
    const update = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      previousBusinessPrice: null,
      requestedBusinessPrice: { amount: 18.99, currencyCode: "USD" },
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
      minimumPriceChange: "preserve",
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated",
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: submitted.validation.requestedQuantityDiscountPlan,
      quantityDiscountPlanChange: "replace",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      schemaChecksum: "seller-schema-checksum",
      acceptedAt: "2026-08-22T12:02:00.000Z",
      submissionId: "submission-tiers-1",
      requestId: "request-tiers-1",
      issues: [],
      notice: "已接受並回查。",
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
        acceptedAt: "2026-08-22T12:02:00.000Z",
        verifiedAt: "2026-08-22T12:02:05.000Z",
        attempts: 2,
      },
    };
    expect(parseBusinessPriceUpdate(update, submitted).quantityDiscountPlanChange)
      .toBe("replace");
    expect(() => parseBusinessPriceUpdate({
      ...update,
      requestedQuantityDiscountPlan: {
        discountType: "percent",
        levels: [{ lowerBound: 5, value: 6 }],
      },
    }, submitted)).toThrow(/數量折扣|快照/u);
  });

  it("accepts only a verified update for the immutable submitted preview", () => {
    const listing = parseBusinessPricingListingSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      title: "Missing business price",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      minimumPrice: null,
      minimumPricePresence: "absent",
      businessPrice: null,
      businessOfferPresence: "absent",
      businessPricingManagedByAutomation: false,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      quantityDiscountPlanHash: null,
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
        quantityDiscountsSupported: true,
        quantityDiscountsEditable: true,
        quantityDiscountsReason: null,
      },
      fetchedAt: "2026-08-22T12:00:00.000Z",
      notice: null,
    });
    const submitted = createSubmittedBusinessPricePreview({
      listing,
      newBusinessPrice: 17.99,
      idempotencyKey: "business-price-test-003",
      response: {
        mode: "live",
        status: "VALID",
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: "FBA-MISSING",
        asin: "B000000001",
        productType: "PET_FOOD",
        standardPrice: { amount: 19.99, currencyCode: "USD" },
        previousBusinessPrice: null,
        requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
        previousMinimumPrice: null,
        requestedMinimumPrice: null,
        lowestTierUnitPrice: null,
        minimumPriceChange: "preserve",
        minimumPriceProtectedHash: null,
        minimumPriceCanonicalPatchHash: null,
        businessPriceValidation: "validated",
        previousQuantityDiscountPlan: null,
        previousQuantityDiscountPlanHash: null,
        requestedQuantityDiscountPlan: null,
        quantityDiscountPlanChange: "preserve",
        businessOfferGuardHash: "a".repeat(64),
        businessOfferProtectedHash: "e".repeat(64),
        schemaChecksum: "seller-schema-checksum",
        fbaEvidenceHash: "b".repeat(64),
        canonicalPatchHash: "c".repeat(64),
        validationIssuesHash: "d".repeat(64),
        validatedAt: "2026-08-22T12:01:00.000Z",
        issues: [],
        notice: "預檢通過。",
      },
    });
    const update = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      productType: "PET_FOOD",
      standardPrice: { amount: 19.99, currencyCode: "USD" },
      previousBusinessPrice: null,
      requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      minimumPriceChange: "preserve",
      minimumPriceProtectedHash: null,
      minimumPriceCanonicalPatchHash: null,
      businessPriceValidation: "validated",
      previousQuantityDiscountPlan: null,
      previousQuantityDiscountPlanHash: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      businessOfferGuardHash: "a".repeat(64),
      businessOfferProtectedHash: "e".repeat(64),
      schemaChecksum: "seller-schema-checksum",
      acceptedAt: "2026-08-22T12:02:00.000Z",
      submissionId: "submission-1",
      requestId: "request-1",
      issues: [],
      notice: "已接受並回查。",
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
        acceptedAt: "2026-08-22T12:02:00.000Z",
        verifiedAt: "2026-08-22T12:02:05.000Z",
        attempts: 2,
      },
    };
    expect(parseBusinessPriceUpdate(update, submitted).requestedBusinessPrice.amount)
      .toBe(17.99);
    expect(() => parseBusinessPriceUpdate({
      ...update,
      writeLifecycle: { ...update.writeLifecycle, verified: false },
    }, submitted)).toThrow(/回查/u);
    expect(() => parseBusinessPriceUpdate({
      ...update,
      sellerSku: "ANOTHER-SKU",
    }, submitted)).toThrow(/識別/u);
  });
});
