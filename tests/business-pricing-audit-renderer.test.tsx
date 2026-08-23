import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
import { parseStandaloneAuditJob } from "../src/renderer/src/standalone-audit";
import {
  openSellerCentralInventoryHandoff,
} from "../src/renderer/src/seller-central-handoff";

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
        reason: "Amazon Business 可用，但尚未設定 B2B 價格。",
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
        reason: "已設定 Amazon Business 價格。",
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
    },
    notice: "只納入 Amazon 報表與 Listings Items API 共同確認的 FBA SKU。",
  };
}

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

  it("keeps the live Pages rollout readable with a v0.1.25 audit payload", () => {
    const legacy = payload();
    for (const row of legacy.rows as Array<Record<string, unknown>>) {
      delete row.quantityDiscountPlan;
      delete row.quantityDiscountPlanPresence;
    }

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
    });
    expect(snapshot.rows[0]).toMatchObject({
      sellerSku: "FBA-MISSING",
      status: "missing",
      editable: true,
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

  it("filters missing, configured and problem rows without hiding incomplete evidence", () => {
    const rows = parseBusinessPricingAuditSnapshot(payload()).rows;
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "missing")))
      .toHaveLength(2);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "configured")))
      .toHaveLength(2);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "problem")))
      .toHaveLength(2);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "unsupported")))
      .toHaveLength(2);
  });

  it("treats a B2B price above standard as an editable problem", () => {
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
    expect(markup).toContain("完整數量折扣");
    expect(markup).toContain("Amazon Business 可用，但尚未設定 B2B 價格。");
    expect(markup).toContain("設定 B2B 價格");
    expect(markup).toContain("唯讀／不支援");
    expect(markup).toContain("請到 Amazon 後台編輯");
    expect(markup).not.toContain("不可直接修改");
    expect(markup).toContain("建議 B2B 價格");
    expect(markup).toContain("US 一般售價 – USD 1.00");
    expect(markup).toContain("5 件 5%・10 件 10%・15 件 15%・20 件 20%");
    expect(markup).toContain("目前數量折扣");
    expect(markup).toContain("百分比：5 件＝5%、10 件＝10%");
    expect(markup).toContain("Amazon 未能確認，請到後台核對");
    expect(markup).toContain("Notebook Key 需更新後才能安全開啟指定 SKU");
    expect(markup).toContain("舊版不會改開 Seller Central 首頁");
    expect(markup.match(/前往編輯/g)).toHaveLength(3);
    expect(markup).toContain("先由 Amazon Validation Preview 核對");
    const panelSource = readFileSync(
      new URL("../src/renderer/src/components/business-pricing-audit-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(panelSource).toContain("openSellerCentralInventoryHandoff");
    expect(panelSource).not.toContain('window.fbaOS.app.openExternal("seller-central")');
    expect(panelSource).toContain('kind: "businessPricing"');
    expect(panelSource).toContain("pollStandaloneAuditJob");
    expect(panelSource).toContain("onJobChange?.(current)");
    expect(panelSource).not.toContain('fetch("/api/sp-api/business-pricing-audit"');
  });

  it("uses compact styled desktop controls for the explicit quantity-tier editor", () => {
    const css = readFileSync(
      new URL("../src/renderer/src/app.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.business-pricing-tier-mode\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su,
    );
    expect(css).toMatch(
      /\.business-pricing-tier-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/su,
    );
    expect(css).toMatch(/\.business-pricing-tier-card\s*\{/u);
    expect(css).toMatch(/\.business-pricing-tier-mode button\[aria-pressed="true"\]/u);
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
