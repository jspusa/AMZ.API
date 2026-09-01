import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBusinessPriceWriteStatusToAuditSnapshot,
  applyVerifiedBusinessPricingListingToAuditSnapshot,
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingWorkflowProgress,
  businessPricingRowMatchesFilter,
  businessPricingEditorProposal,
  createSubmittedBusinessPricePreview,
  defaultBusinessPricingProposal,
  parseBusinessPriceProcessing,
  parseBusinessPriceUpdate,
  parseBusinessPriceWriteStatus,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  retainBusinessPricingWorkflowActivities,
  type BusinessPriceUpdate,
  type BusinessPriceWriteStatus,
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

function workflowWriteStatus(
  overrides: Partial<BusinessPriceWriteStatus> = {},
): BusinessPriceWriteStatus {
  return parseBusinessPriceWriteStatus({
    mode: "live",
    status: "PROCESSING",
    stage: "minimum_price",
    marketplaceId: "ATVPDKIKX0DER",
    sellerSku: "FBA-CONFIGURED",
    asin: "B000000002",
    productType: "PET_FOOD",
    acceptedAt: "2026-09-01T03:10:19.000Z",
    verifiedAt: null,
    requestId: "request-workflow",
    submissionId: "submission-workflow",
    verified: false,
    authoritative: false,
    canResend: false,
    businessPriceSubmitted: false,
    previousBusinessPrice: { amount: 22.49, currencyCode: "USD" },
    requestedBusinessPrice: { amount: 23.99, currencyCode: "USD" },
    previousMinimumPrice: { amount: 23.49, currencyCode: "USD" },
    requestedMinimumPrice: { amount: 18.19, currencyCode: "USD" },
    lowestTierUnitPrice: { amount: 19.19, currencyCode: "USD" },
    previousQuantityDiscountPlan: {
      discountType: "percent",
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
      ],
    },
    requestedQuantityDiscountPlan: {
      discountType: "percent",
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
        { lowerBound: 15, value: 15 },
        { lowerBound: 20, value: 20 },
      ],
    },
    quantityDiscountPlanChange: "replace",
    notice: "Amazon 正在同步。",
    ...overrides,
  });
}

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

  it("keeps an accepted B2B write visible and manually reconciles it without another PATCH", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const processingStatus = {
      mode: "live",
      status: "PROCESSING",
      stage: "business_price",
      marketplaceId: interactiveListing.marketplaceId,
      sellerSku: interactiveListing.sellerSku,
      asin: interactiveListing.asin,
      productType: interactiveListing.productType,
      acceptedAt: "2026-08-31T12:02:00.000Z",
      verifiedAt: null,
      requestId: "request-delayed-business-price",
      submissionId: "submission-delayed-business-price",
      verified: false,
      authoritative: false,
      canResend: false,
      businessPriceSubmitted: true,
      previousBusinessPrice: { amount: 18.99, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousMinimumPrice: interactiveListing.minimumPrice,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      previousQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
      requestedQuantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
        ],
      },
      quantityDiscountPlanChange: "replace",
      notice:
        "Amazon 已接受 B2B 價格更新，正在同步。這不是失敗，也尚未代表前台已生效；系統不會自動重送。",
    } as const;
    const processingListing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      writeStatus: processingStatus,
    });
    const verifiedListing = {
      ...interactiveListing,
      businessPrice: { amount: 17.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: processingStatus.requestedQuantityDiscountPlan,
      fetchedAt: "2026-08-31T12:12:00.000Z",
      writeStatus: {
        ...processingStatus,
        status: "VERIFIED",
        verifiedAt: "2026-08-31T12:12:00.000Z",
        verified: true,
        authoritative: true,
        notice:
          "Amazon Business 價格已由 Notebook Key 唯讀回查確認；沒有重新送出 PATCH。",
      },
    } as const;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PATCH") {
        throw new Error("Manual reconciliation must never send another PATCH");
      }
      return new Response(JSON.stringify(verifiedListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onVerified = vi.fn();
    const onWriteStatusChange = vi.fn(() => {
      throw new Error("outer progress cache rejected the status");
    });
    const onCanonicalListingVerified = vi.fn(() => {
      throw new Error("outer audit cache rejected the canonical listing");
    });
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing: processingListing,
        onClose: () => undefined,
        onVerified,
        onCanonicalListingVerified,
        onWriteStatusChange,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });

    const root = renderer!.root;
    const processingCard = root.findByProps({
      className: "business-pricing-write-status is-processing",
    });
    expect(processingCard).toBeDefined();
    const processingText = JSON.stringify(renderer!.toJSON());
    expect(processingText).toContain("Amazon 已接受，正在同步");
    expect(processingText).toContain("送出時間");
    expect(processingText).toContain("request-delayed-business-price");
    expect(processingText).toContain("18.99");
    expect(processingText).toContain("17.99");
    expect(processingText).toContain("本次送出的數量折扣");
    expect(processingText).toContain("5 件");
    expect(processingText).toContain("3%");
    expect(processingText).toContain("5%");
    expect(processingText).toContain("10 件");
    expect(processingText).toContain("6%");
    expect(processingText).toContain("10%");
    expect(root.findByProps({ id: "business-price-input" }).props.disabled)
      .toBe(true);
    expect(root.findByType("fieldset").props.disabled).toBe(true);
    expect(root.findAllByType("button").filter((button) =>
      button.children.join("") === "只改價格並保留原數量折扣" ||
      button.children.join("") === "一併更新預填階梯折扣"
    ).every((button) => button.props.disabled)).toBe(true);

    await act(async () => {
      root.findAllByType("button").find((button) =>
        button.children.join("") === "重新確認 Amazon 狀態"
      )!.props.onClick();
    });

    const verifiedCard = root.findByProps({
      className: "business-pricing-write-status is-verified",
    });
    expect(verifiedCard).toBeDefined();
    expect(JSON.stringify(renderer!.toJSON()))
      .toContain("Amazon 已完成同步並確認");
    expect(JSON.stringify(renderer!.toJSON()))
      .not.toContain("outer progress cache rejected");
    expect(onWriteStatusChange).toHaveBeenCalledTimes(1);
    expect(root.findAllByType("button").some((button) =>
      button.children.join("") === "重新確認 Amazon 狀態"
    )).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toContain("/api/sp-api/business-pricing?");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"))
      .toBe(false);
    expect(onVerified).not.toHaveBeenCalled();
    expect(onCanonicalListingVerified).toHaveBeenCalledOnce();
    expect(onCanonicalListingVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerSku: interactiveListing.sellerSku,
        businessPrice: { amount: 17.99, currencyCode: "USD" },
        writeStatus: expect.objectContaining({ status: "VERIFIED" }),
      }),
    );

    const css = await readRendererStylesheet();
    expect(css).toMatch(
      /\.business-pricing-write-status\.is-verified\s*\{[^}]*color:\s*#28583d/su,
    );
    await act(async () => renderer!.unmount());
  });

  it("rejects stale ASIN or product-type audit rows before opening the editor", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ...interactiveListing,
        sellerSku: "FBA-CONFIGURED",
        asin: "B000000099",
        title: "Identity changed",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
      }));
    });
    const configuredRow = renderer!.root.findAllByType("article").find(
      (article) => article.findAllByType("small").some((small) =>
        small.children.join("") === "FBA-CONFIGURED · B000000002"
      ),
    )!;
    await act(async () => {
      configuredRow.findAllByType("button").find((button) =>
        button.children.join("") === "調整 B2B 價格"
      )!.props.onClick();
    });
    expect(renderer!.root.findAllByType(BusinessPricingEditor)).toHaveLength(0);
    expect(renderer!.root.findByProps({ role: "alert" }).children.join(""))
      .toContain("商品身分已變更，請重新健檢");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => renderer!.unmount());
  });

  it("states that B2B was not sent while an accepted minimum-price change is processing", () => {
    const minimumPriceProcessing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      writeStatus: {
        mode: "live",
        status: "PROCESSING",
        stage: "minimum_price",
        marketplaceId: interactiveListing.marketplaceId,
        sellerSku: interactiveListing.sellerSku,
        asin: interactiveListing.asin,
        productType: interactiveListing.productType,
        acceptedAt: "2026-08-31T12:02:00.000Z",
        verifiedAt: null,
        requestId: "request-delayed-minimum-price",
        submissionId: "submission-delayed-minimum-price",
        verified: false,
        authoritative: false,
        canResend: false,
        businessPriceSubmitted: false,
        previousBusinessPrice: { amount: 18.99, currencyCode: "USD" },
        requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
        previousMinimumPrice: { amount: 18, currencyCode: "USD" },
        requestedMinimumPrice: { amount: 13.39, currencyCode: "USD" },
        lowestTierUnitPrice: { amount: 14.39, currencyCode: "USD" },
        previousQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
        requestedQuantityDiscountPlan: {
          discountType: "percent",
          levels: [
            { lowerBound: 5, value: 5 },
            { lowerBound: 10, value: 10 },
          ],
        },
        quantityDiscountPlanChange: "replace",
        notice:
          "Amazon 已接受最低價更新，正在同步；B2B 價格與階梯尚未送出。最低價確認後請重新預檢，系統不會背景續送或重送。",
      },
    });

    const markup = renderToStaticMarkup(createElement(BusinessPricingEditor, {
      listing: minimumPriceProcessing,
      onClose: () => undefined,
      onVerified: () => undefined,
      onError: () => undefined,
      onBusyChange: () => undefined,
    }));
    expect(markup).toContain("Amazon 已接受最低價，正在同步");
    expect(markup).toContain("B2B 價格與階梯尚未送出");
    expect(markup).toContain("最低價限制");
    expect(markup).toContain("13.39");
    expect(markup).not.toContain("17.99");
    expect(markup).toContain("request-delayed-minimum-price");
    expect(markup).toContain("disabled");
  });

  it("unlocks the same editor after a manual GET verifies the minimum price", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const fixedPlan = {
      discountType: "fixed" as const,
      levels: [{ lowerBound: 3, value: 16.14 }],
    };
    const processing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      sellerSku: "1GCRD004A0",
      businessPrice: { amount: 16.15, currencyCode: "USD" },
      businessOfferPresence: "present",
      minimumPrice: { amount: 16.14, currencyCode: "USD" },
      quantityDiscountPlan: fixedPlan,
      quantityDiscountPlanHash: "1".repeat(64),
      writeStatus: {
        mode: "live",
        status: "PROCESSING",
        stage: "minimum_price",
        marketplaceId: interactiveListing.marketplaceId,
        sellerSku: "1GCRD004A0",
        asin: interactiveListing.asin,
        productType: interactiveListing.productType,
        acceptedAt: "2026-09-01T00:01:55.000Z",
        verifiedAt: null,
        requestId: "45d0afd0-999b-47a4-a9f5-e248edf4fc40",
        submissionId: "submission-minimum-price",
        verified: false,
        authoritative: false,
        canResend: false,
        businessPriceSubmitted: false,
        previousBusinessPrice: { amount: 16.15, currencyCode: "USD" },
        requestedBusinessPrice: { amount: 15.99, currencyCode: "USD" },
        previousMinimumPrice: { amount: 16.14, currencyCode: "USD" },
        requestedMinimumPrice: { amount: 14.19, currencyCode: "USD" },
        lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
        previousQuantityDiscountPlan: fixedPlan,
        requestedQuantityDiscountPlan: {
          discountType: "percent",
          levels: [
            { lowerBound: 5, value: 5 },
            { lowerBound: 10, value: 10 },
            { lowerBound: 15, value: 15 },
            { lowerBound: 20, value: 20 },
          ],
        },
        quantityDiscountPlanChange: "replace",
        notice:
          "Amazon 已接受最低價更新，正在同步；B2B 價格與階梯尚未送出。",
      },
    });
    const verified = {
      ...processing,
      minimumPrice: { amount: 14.19, currencyCode: "USD" },
      minimumPriceProtectedHash: "9".repeat(64),
      writeStatus: {
        ...processing.writeStatus,
        status: "VERIFIED",
        verifiedAt: "2026-09-01T00:12:00.000Z",
        verified: true,
        authoritative: true,
        notice:
          "最低價已由 Notebook Key 唯讀回查確認；B2B 價格與階梯尚未送出，請重新預檢後再確認。",
      },
    };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PATCH") {
        throw new Error("Manual minimum-price reconciliation must not PATCH");
      }
      return new Response(JSON.stringify(verified), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingEditor, {
        listing: processing,
        onClose: () => undefined,
        onVerified: () => undefined,
        onError: () => undefined,
        onBusyChange: () => undefined,
      }));
    });

    const root = renderer!.root;
    expect(root.findByProps({ id: "business-price-input" }).props.disabled)
      .toBe(true);
    await act(async () => {
      root.findAllByType("button").find((button) =>
        button.children.join("") === "重新確認 Amazon 狀態"
      )!.props.onClick();
    });

    expect(JSON.stringify(renderer!.toJSON()))
      .toContain("最低價已確認；B2B 尚未送出");
    expect(root.findByProps({ id: "business-price-input" }).props.disabled)
      .toBe(false);
    const preview = root.findAllByType("button").find((button) =>
      button.children.join("") === "重新預檢 B2B 價格與階梯（不寫入）"
    );
    expect(preview).toBeDefined();
    expect(preview!.props.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"))
      .toBe(false);
    await act(async () => renderer!.unmount());
  });

  it("keeps adjusted SKUs at the top with an outside four-stage workflow", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const targetListing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      sellerSku: "FBA-CONFIGURED",
      asin: "B000000002",
      title: "Configured business price",
      standardPrice: { amount: 24.99, currencyCode: "USD" },
      businessPrice: { amount: 22.49, currencyCode: "USD" },
      businessOfferPresence: "present",
      minimumPrice: { amount: 23.49, currencyCode: "USD" },
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
        ],
      },
      writeStatus: {
        mode: "live",
        status: "PROCESSING",
        stage: "minimum_price",
        marketplaceId: interactiveListing.marketplaceId,
        sellerSku: "FBA-CONFIGURED",
        asin: "B000000002",
        productType: interactiveListing.productType,
        acceptedAt: "2026-09-01T03:10:19.000Z",
        verifiedAt: null,
        requestId: "request-minimum-progress",
        submissionId: "submission-minimum-progress",
        verified: false,
        authoritative: false,
        canResend: false,
        businessPriceSubmitted: false,
        previousBusinessPrice: { amount: 22.49, currencyCode: "USD" },
        requestedBusinessPrice: { amount: 23.99, currencyCode: "USD" },
        previousMinimumPrice: { amount: 23.49, currencyCode: "USD" },
        requestedMinimumPrice: { amount: 18.19, currencyCode: "USD" },
        lowestTierUnitPrice: { amount: 19.19, currencyCode: "USD" },
        previousQuantityDiscountPlan: {
          discountType: "percent",
          levels: [
            { lowerBound: 5, value: 5 },
            { lowerBound: 10, value: 10 },
          ],
        },
        requestedQuantityDiscountPlan: {
          discountType: "percent",
          levels: [
            { lowerBound: 5, value: 5 },
            { lowerBound: 10, value: 10 },
            { lowerBound: 15, value: 15 },
            { lowerBound: 20, value: 20 },
          ],
        },
        quantityDiscountPlanChange: "replace",
        notice:
          "Amazon 已接受最低價更新，正在同步；B2B 價格與階梯尚未送出。",
      },
    });
    const verifiedListing = parseBusinessPricingListingSnapshot({
      ...targetListing,
      minimumPrice: { amount: 18.19, currencyCode: "USD" },
      writeStatus: {
        ...targetListing.writeStatus!,
        status: "VERIFIED",
        verifiedAt: "2026-09-01T03:18:00.000Z",
        verified: true,
        authoritative: true,
        notice:
          "最低價已由 Notebook Key 唯讀回查確認；B2B 價格與階梯尚未送出，請重新預檢後再確認。",
      },
    });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(targetListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(verifiedListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onSnapshotChange = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
        onSnapshotChange,
      }));
    });
    const root = renderer!.root;
    const configuredRow = root.findAllByType("article").find((article) =>
      article.findAllByType("small").some((small) =>
        small.children.join("").includes("FBA-CONFIGURED")
      )
    )!;
    await act(async () => {
      configuredRow.findAllByType("button").find((button) =>
        button.children.join("") === "調整 B2B 價格"
      )!.props.onClick();
    });
    await act(async () => {
      root.findAllByType("button").find((button) =>
        button.children.join("") === "重新確認 Amazon 狀態"
      )!.props.onClick();
    });
    await act(async () => {
      root.findByProps({
        "aria-label": "返回全站 B2B 價格健檢",
      }).props.onClick();
    });

    const markup = JSON.stringify(renderer!.toJSON());
    expect(markup).toContain("已調整商品進度");
    expect(root.findByProps({
      className: "business-pricing-activity-summary",
    }).findAllByType("span").some((span) =>
      span.children.join("") === "本次 App 使用期間 · 1 個已調整 SKU 已置頂"
    )).toBe(true);
    expect(markup).toContain("最低價已確認，待預檢 B2B");
    expect(markup).toContain("送出最低價格");
    expect(markup).toContain("已回查最低價格");
    expect(markup).toContain("送出 B2B 價格");
    expect(markup).toContain("已回查 B2B 價格");
    expect(markup).toContain("等待 Amazon");
    expect(markup).toContain("待送 B2B");
    expect(markup).toContain("已完成");
    expect(root.findAllByType("article")[0]!.findAllByType("small").some(
      (small) => small.children.join("").includes("FBA-CONFIGURED"),
    )).toBe(true);
    expect(onSnapshotChange).toHaveBeenLastCalledWith(expect.objectContaining({
      workflowActivities: [expect.objectContaining({
        sellerSku: "FBA-CONFIGURED",
        writeStatus: expect.objectContaining({
          status: "VERIFIED",
          stage: "minimum_price",
        }),
      })],
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) =>
      !init?.method || init.method === "GET"
    )).toBe(true);
    await act(async () => renderer!.unmount());
  });

  it("preserves completed minimum-price steps through the full B2B lifecycle", () => {
    let snapshot = parseBusinessPricingAuditSnapshot(payload());
    const minimumProcessing = workflowWriteStatus();
    snapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      minimumProcessing,
    );
    expect(businessPricingWorkflowProgress(
      snapshot.workflowActivities![0]!,
    ).steps.map((step) => step.state)).toEqual([
      "complete",
      "current",
      "pending",
      "pending",
    ]);

    const minimumVerified = workflowWriteStatus({
      status: "VERIFIED",
      verifiedAt: "2026-09-01T03:18:00.000Z",
      verified: true,
      authoritative: true,
    });
    snapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      minimumVerified,
    );
    expect(businessPricingWorkflowProgress(
      snapshot.workflowActivities![0]!,
    ).steps.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "current",
      "pending",
    ]);

    const businessProcessing = workflowWriteStatus({
      stage: "business_price",
      acceptedAt: "2026-09-01T03:20:00.000Z",
      businessPriceSubmitted: true,
      previousMinimumPrice: { amount: 18.19, currencyCode: "USD" },
      requestedMinimumPrice: { amount: 18.19, currencyCode: "USD" },
    });
    snapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      businessProcessing,
    );
    expect(snapshot.workflowActivities![0]!.minimumPriceProgress).toBe(
      "verified",
    );
    expect(businessPricingWorkflowProgress(
      snapshot.workflowActivities![0]!,
    ).steps.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
    ]);

    const businessVerified = workflowWriteStatus({
      ...businessProcessing,
      status: "VERIFIED",
      verifiedAt: "2026-09-01T03:28:00.000Z",
      verified: true,
      authoritative: true,
    });
    snapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      businessVerified,
    );
    expect(businessPricingWorkflowProgress(
      snapshot.workflowActivities![0]!,
    ).steps.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
  });

  it("binds progress to the exact SKU, ASIN and product type", () => {
    const snapshot = parseBusinessPricingAuditSnapshot(payload());
    expect(() => applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      workflowWriteStatus({ asin: "B000000099" }),
    )).toThrow("B2B 價格處理進度與目前健檢快照不一致");
    expect(() => applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      workflowWriteStatus({ productType: "OTHER" }),
    )).toThrow("B2B 價格處理進度與目前健檢快照不一致");

    const withActivity = applyBusinessPriceWriteStatusToAuditSnapshot(
      snapshot,
      workflowWriteStatus(),
    );
    const driftedSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row) => row.sellerSku === "FBA-CONFIGURED"
        ? { ...row, asin: "B000000099" }
        : row),
    };
    expect(retainBusinessPricingWorkflowActivities(
      driftedSnapshot,
      withActivity.workflowActivities ?? [],
    )).toEqual([]);
  });

  it("keeps a completed adjusted SKU visible under the default problem filter", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const original = parseBusinessPricingAuditSnapshot(payload());
    const corrected = {
      ...original,
      rows: original.rows.map((row) => row.sellerSku === "FBA-CONFIGURED"
        ? {
            ...row,
            businessPrice: { amount: 23.99, currencyCode: "USD" },
            quantityDiscountPlan: {
              discountType: "percent" as const,
              levels: [
                { lowerBound: 5, value: 5 },
                { lowerBound: 10, value: 10 },
                { lowerBound: 15, value: 15 },
                { lowerBound: 20, value: 20 },
              ],
            },
            recommendedPriceMismatch: false,
            recommendedQuantityDiscountMismatch: false,
          }
        : row),
    };
    const completed = applyBusinessPriceWriteStatusToAuditSnapshot(
      corrected,
      workflowWriteStatus({
        status: "VERIFIED",
        stage: "business_price",
        acceptedAt: "2026-09-01T03:20:00.000Z",
        verifiedAt: "2026-09-01T03:28:00.000Z",
        verified: true,
        authoritative: true,
        businessPriceSubmitted: true,
        previousMinimumPrice: { amount: 18.19, currencyCode: "USD" },
        requestedMinimumPrice: { amount: 18.19, currencyCode: "USD" },
      }),
    );
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: completed,
      }));
    });
    const adjustedRow = renderer!.root.findAllByType("article").find(
      (article) => article.findAllByType("small").some((small) =>
        small.children.join("") === "FBA-CONFIGURED · B000000002"
      ),
    );
    expect(adjustedRow).toBeDefined();
    expect(adjustedRow!.findAllByType("button").some((button) =>
      button.children.join("") === "查看完成結果"
    )).toBe(true);
    expect(adjustedRow!.findAllByProps({
      "aria-label": "B2B 調整進度：B2B 價格已回查確認",
    })).toHaveLength(1);
    await act(async () => renderer!.unmount());
  });

  it("replaces the audit list with one in-drawer editor view and returns to the audit", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(interactiveListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      })));
    const onEditorOpenChange = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
        onEditorOpenChange,
      }));
    });
    const root = renderer!.root;
    expect(root.findByProps({
      "data-business-pricing-view": "audit",
    })).toBeDefined();
    expect(root.findAllByProps({
      "aria-label": "FBA B2B 價格商品",
    })).toHaveLength(1);

    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "設定 B2B 價格",
      )!.props.onClick();
    });

    expect(root.findByProps({
      "data-business-pricing-view": "editor",
    })).toBeDefined();
    expect(root.findAllByProps({
      "aria-label": "FBA B2B 價格商品",
    })).toHaveLength(0);
    expect(root.findAllByType("form")).toHaveLength(1);
    expect(root.findByProps({
      "aria-label": "返回全站 B2B 價格健檢",
    }).children.join("")).toBe("← 返回健檢結果");
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      root.findByProps({
        "aria-label": "返回全站 B2B 價格健檢",
      }).props.onClick();
    });

    expect(root.findByProps({
      "data-business-pricing-view": "audit",
    })).toBeDefined();
    expect(root.findAllByProps({
      "aria-label": "FBA B2B 價格商品",
    })).toHaveLength(1);
    expect(root.findAllByType("form")).toHaveLength(0);
    expect(onEditorOpenChange).toHaveBeenLastCalledWith(false);
    await act(async () => renderer!.unmount());
  });

  it("uses the dialog panel as the B2B list and editor scroll owner", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method && init.method !== "GET") {
        throw new Error(`Unexpected B2B write request: ${init.method}`);
      }
      return new Response(JSON.stringify(interactiveListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const panelNode = { scrollTop: 760 };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        presentation: "dialog",
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
      }), {
        createNodeMock: (element) =>
          element.props["data-business-pricing-view"] ? panelNode : null,
      });
    });
    const root = renderer!.root;
    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "設定 B2B 價格",
      )!.props.onClick();
    });
    expect(panelNode.scrollTop).toBe(0);

    panelNode.scrollTop = 280;
    await act(async () => {
      root.findByProps({
        "aria-label": "返回全站 B2B 價格健檢",
      }).props.onClick();
    });
    expect(panelNode.scrollTop).toBe(760);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method && init.method !== "GET"
    )).toBe(false);
    await act(async () => renderer!.unmount());
  });

  it("uses the window as the workspace B2B list and editor scroll owner", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method && init.method !== "GET") {
        throw new Error(`Unexpected B2B write request: ${init.method}`);
      }
      return new Response(JSON.stringify(interactiveListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const scrollTo = vi.fn();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const rootElement = { style: { scrollBehavior: "smooth" } };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      fbaOS: undefined,
      scrollY: 1_640,
      scrollTo,
      requestAnimationFrame,
      cancelAnimationFrame: vi.fn(),
    });
    vi.stubGlobal("document", { documentElement: rootElement });
    const panelNode = { scrollTop: 760 };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        presentation: "workspace",
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
      }), {
        createNodeMock: (element) =>
          element.props["data-business-pricing-view"] ? panelNode : null,
      });
    });
    const root = renderer!.root;
    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "設定 B2B 價格",
      )!.props.onClick();
    });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(panelNode.scrollTop).toBe(760);
    expect(rootElement.style.scrollBehavior).toBe("smooth");

    await act(async () => {
      root.findByProps({
        "aria-label": "返回全站 B2B 價格健檢",
      }).props.onClick();
    });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1_640);
    expect(panelNode.scrollTop).toBe(760);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) =>
      init?.method && init.method !== "GET"
    )).toBe(false);
    await act(async () => renderer!.unmount());
  });

  it("keeps a manually verified canonical value in the audit row after returning", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(interactiveListing), {
        status: 200,
        headers: { "content-type": "application/json" },
      })));
    const verifiedListing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      fetchedAt: "2026-08-31T12:12:00.000Z",
      writeStatus: {
        mode: "live",
        status: "VERIFIED",
        stage: "business_price",
        marketplaceId: interactiveListing.marketplaceId,
        sellerSku: interactiveListing.sellerSku,
        asin: interactiveListing.asin,
        productType: interactiveListing.productType,
        acceptedAt: "2026-08-31T12:02:00.000Z",
        verifiedAt: "2026-08-31T12:12:00.000Z",
        requestId: "request-manual-price-only",
        submissionId: "submission-manual-price-only",
        verified: true,
        authoritative: true,
        canResend: false,
        businessPriceSubmitted: true,
        previousBusinessPrice: null,
        requestedBusinessPrice: { amount: 18.99, currencyCode: "USD" },
        previousMinimumPrice: interactiveListing.minimumPrice,
        requestedMinimumPrice: interactiveListing.minimumPrice,
        lowestTierUnitPrice: null,
        previousQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
        requestedQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
        quantityDiscountPlanChange: "preserve",
        notice: "Amazon Business 價格已由 Notebook Key 唯讀回查確認。",
      },
    });
    const onSnapshotChange = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditPanel, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
        onSnapshotChange,
      }));
    });
    const root = renderer!.root;
    await act(async () => {
      root.findAllByType("button").find(
        (button) => button.children.join("") === "設定 B2B 價格",
      )!.props.onClick();
    });
    await act(async () => {
      root.findByType(BusinessPricingEditor).props
        .onCanonicalListingVerified(verifiedListing);
    });

    expect(onSnapshotChange).toHaveBeenLastCalledWith(expect.objectContaining({
      rows: expect.arrayContaining([
        expect.objectContaining({
          sellerSku: "FBA-MISSING",
          businessPrice: { amount: 18.99, currencyCode: "USD" },
          status: "configured",
        }),
      ]),
      summary: expect.objectContaining({ configured: 3, missing: 1 }),
    }));

    await act(async () => {
      root.findByProps({
        "aria-label": "返回全站 B2B 價格健檢",
      }).props.onClick();
    });
    const updatedRow = root.findAllByType("article").find((article) =>
      article.findAllByType("small").some((small) =>
        small.children.join("").includes("FBA-MISSING")
      )
    )!;
    expect(updatedRow.findByType("dl").findAllByType("dd")[1]
      ?.children.join("")).toContain("18.99");
    const summary = root.findByProps({
      "aria-label": "B2B 價格健檢摘要與篩選",
    });
    const configured = summary.findAllByType("button").find((button) =>
      button.findByType("span").children.join("") === "已設定"
    )!;
    expect(configured.findByType("strong").children.join("")).toBe("3");
    await act(async () => renderer!.unmount());
  });

  it("uses one B2B drawer scroller and a non-overlay editor surface", () => {
    const css = readFileSync(
      new URL("../src/renderer/src/styles/business-pricing.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.order-drawer\.business-pricing-audit-drawer\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/su,
    );
    expect(css).toMatch(
      /\.business-pricing-audit-panel\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/su,
    );
    expect(css).toMatch(
      /\.business-pricing-detail-toolbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/su,
    );
    expect(css).toMatch(
      /\.business-pricing-editor\s*\{[^}]*position:\s*static[^}]*box-shadow:\s*none/su,
    );
    expect(css).not.toMatch(
      /\.business-pricing-editor\s*\{[^}]*position:\s*sticky/su,
    );
  });

  it("keeps the short B2B intro visible and collapses the detailed rules by default", () => {
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: parseBusinessPricingAuditSnapshot(payload()),
    }));
    const details = markup.match(
      /<details class="health-advanced-details audit-details-disclosure"[^>]*>[\s\S]*?<\/details>/u,
    )?.[0];

    expect(markup).toContain(
      "同時核對 Business Price 與數量折扣；商品列可直接安全預檢，或前往 Amazon 後台。",
    );
    expect(details).toBeDefined();
    expect(details).toContain("查看詳細規則");
    expect(details).toContain("Jasper US 建議規則");
    expect(details).toContain("Amazon Validation Preview");
    expect(details).not.toMatch(/^<details[^>]*\sopen(?:=|>)/u);
    expect(markup.indexOf("同時核對 Business Price"))
      .toBeLessThan(markup.indexOf("<details"));
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
    expect(rendered).toContain("本次只送出最低價");
    expect(rendered).toContain("手動重新確認 Amazon 狀態");
    expect(rendered).toContain("第二次使用 Touch ID／Windows Hello");
    expect(rendered).not.toContain("先寫入並回查最低價");
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

  it("applies a manually verified canonical listing to the audit row and summary", () => {
    const snapshot = parseBusinessPricingAuditSnapshot(payload());
    const requestedPlan = {
      discountType: "percent" as const,
      levels: [
        { lowerBound: 5, value: 5 },
        { lowerBound: 10, value: 10 },
        { lowerBound: 15, value: 15 },
        { lowerBound: 20, value: 20 },
      ],
    };
    const listing = parseBusinessPricingListingSnapshot({
      ...interactiveListing,
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      minimumPrice: { amount: 14.19, currencyCode: "USD" },
      quantityDiscountPlan: requestedPlan,
      quantityDiscountPlanHash: "2".repeat(64),
      fetchedAt: "2026-08-31T12:12:00.000Z",
      writeStatus: {
        mode: "live",
        status: "VERIFIED",
        stage: "business_price",
        marketplaceId: interactiveListing.marketplaceId,
        sellerSku: interactiveListing.sellerSku,
        asin: interactiveListing.asin,
        productType: interactiveListing.productType,
        acceptedAt: "2026-08-31T12:02:00.000Z",
        verifiedAt: "2026-08-31T12:12:00.000Z",
        requestId: "request-manual-canonical",
        submissionId: "submission-manual-canonical",
        verified: true,
        authoritative: true,
        canResend: false,
        businessPriceSubmitted: true,
        previousBusinessPrice: null,
        requestedBusinessPrice: { amount: 18.99, currencyCode: "USD" },
        previousMinimumPrice: interactiveListing.minimumPrice,
        requestedMinimumPrice: { amount: 14.19, currencyCode: "USD" },
        lowestTierUnitPrice: { amount: 15.19, currencyCode: "USD" },
        previousQuantityDiscountPlan: interactiveListing.quantityDiscountPlan,
        requestedQuantityDiscountPlan: requestedPlan,
        quantityDiscountPlanChange: "replace",
        notice: "Amazon Business 價格已由 Notebook Key 唯讀回查確認。",
      },
    });

    const next = applyVerifiedBusinessPricingListingToAuditSnapshot(
      snapshot,
      listing,
    );

    expect(next.rows[0]).toMatchObject({
      sellerSku: "FBA-MISSING",
      status: "configured",
      businessPrice: { amount: 18.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: requestedPlan,
      quantityDiscountPlanPresence: "canonical",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: false,
    });
    expect(next.summary).toEqual({
      totalFbaSkuCount: 4,
      configured: 3,
      aboveStandard: 0,
      missing: 1,
      unsupported: 0,
      incomplete: 0,
      recommendedPriceMismatch: 2,
      recommendedQuantityDiscountMismatch: 2,
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
    expect(panelSource).toContain(
      "applyVerifiedBusinessPricingListingToAuditSnapshot",
    );
    expect(panelSource).toContain(
      "onCanonicalListingVerified={applyVerifiedListing}",
    );
    expect(panelSource).toContain("BusinessPricingEditor");
    expect(editorSource).toContain("SubmittedBusinessPricePreview");
    expect(editorSource).toContain("createSubmittedBusinessPricePreview");
    expect(editorSource).toContain("parseBusinessPriceUpdate");
    expect(editorSource).toContain("送出中，等待 Amazon 接受…");
    expect(editorSource).not.toContain("送出並回查中…");
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

    const workspace = renderToStaticMarkup(createElement(BusinessPricingAuditDrawer, {
      presentation: "workspace",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      onClose: () => undefined,
    }));
    expect(workspace).toContain('data-audit-workspace="true"');
    expect(workspace).not.toContain('role="dialog"');
    expect(workspace).not.toContain("drawer-backdrop");
  });

  it("keeps the B2B drawer open while the editor is processing a request", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
    vi.stubGlobal("window", {
      fbaOS: undefined,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "keydown") {
          keydownHandler = listener as (event: KeyboardEvent) => void;
        }
      }),
      removeEventListener: vi.fn(),
    });
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditDrawer, {
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        cachedSnapshot: parseBusinessPricingAuditSnapshot(payload()),
        onClose,
      }));
    });
    const root = renderer!.root;
    const panel = root.findByType(BusinessPricingAuditPanel);
    await act(async () => {
      panel.props.onEditorOpenChange(true);
      panel.props.onEditorBusyChange(true);
    });

    expect(root.findByProps({ role: "dialog" }).props["aria-busy"]).toBe(true);
    expect(root.findByProps({
      "aria-label": "關閉全站 B2B 價格健檢",
    }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "Notebook Key 正在處理這次要求",
    );
    const backdrop = root.findByProps({ role: "presentation" });
    const backdropNode = {};
    backdrop.props.onMouseDown({
      target: backdropNode,
      currentTarget: backdropNode,
    });
    keydownHandler?.({ key: "Escape" } as KeyboardEvent);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      panel.props.onEditorBusyChange(false);
    });
    keydownHandler?.({ key: "Escape" } as KeyboardEvent);
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer!.unmount());
  });

  it("keeps the B2B workspace back action locked while the editor is busy", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(BusinessPricingAuditDrawer, {
        presentation: "workspace",
        marketplaceId: "ATVPDKIKX0DER",
        marketplaceShort: "US",
        cachedSnapshot: parseBusinessPricingAuditSnapshot(payload()),
        onClose,
      }));
    });
    const root = renderer!.root;
    const panel = root.findByType(BusinessPricingAuditPanel);
    await act(async () => panel.props.onEditorBusyChange(true));

    const back = root.findByProps({ className: "audit-workspace-back" });
    expect(back.props.disabled).toBe(true);
    back.props.onClick();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => panel.props.onEditorBusyChange(false));
    root.findByProps({ className: "audit-workspace-back" }).props.onClick();
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer!.unmount());
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

    const processing = {
      mode: "live",
      status: "PROCESSING",
      stage: "business_price",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "FBA-MISSING",
      asin: "B000000001",
      productType: "PET_FOOD",
      acceptedAt: "2026-08-22T12:02:00.000Z",
      verifiedAt: null,
      requestId: "request-1",
      submissionId: "submission-1",
      verified: false,
      authoritative: false,
      canResend: false,
      businessPriceSubmitted: true,
      previousBusinessPrice: null,
      requestedBusinessPrice: { amount: 17.99, currencyCode: "USD" },
      previousMinimumPrice: null,
      requestedMinimumPrice: null,
      lowestTierUnitPrice: null,
      previousQuantityDiscountPlan: null,
      requestedQuantityDiscountPlan: null,
      quantityDiscountPlanChange: "preserve",
      notice: "Amazon 已接受，正在同步；不會自動重送。",
    };
    expect(parseBusinessPriceProcessing(processing, submitted)).toMatchObject({
      status: "PROCESSING",
      verified: false,
      canResend: false,
      requestId: "request-1",
    });
    expect(() => parseBusinessPriceWriteStatus({
      ...processing,
      verified: true,
    })).toThrow(/回查證據/u);
    expect(() => parseBusinessPriceProcessing({
      ...processing,
      requestedBusinessPrice: { amount: 18.99, currencyCode: "USD" },
    }, submitted)).toThrow(/送出快照/u);
  });
});
