import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  businessPricingRowMatchesFilter,
  createSubmittedBusinessPricePreview,
  parseBusinessPriceUpdate,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
} from "../src/renderer/src/business-pricing-audit";
import BusinessPricingAuditPanel from "../src/renderer/src/components/business-pricing-audit-panel";
import BusinessPricingAuditDrawer from "../src/renderer/src/components/business-pricing-audit-drawer";

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
        status: "configured",
        editable: true,
        reason: "已設定 Amazon Business 價格。",
      },
    ],
    summary: {
      totalFbaSkuCount: 2,
      configured: 1,
      missing: 1,
      unsupported: 0,
      incomplete: 0,
    },
    notice: "只納入 Amazon 報表與 Listings Items API 共同確認的 FBA SKU。",
  };
}

describe("FBA business pricing audit renderer", () => {
  it("strictly parses exact FBA SKU identities and money evidence", () => {
    const source = payload();
    (source.rows as Array<Record<string, unknown>>)[0]!.title =
      "Title with Amazon source\u2028line and zero-width\u200bcharacter";
    const snapshot = parseBusinessPricingAuditSnapshot(source);
    expect(snapshot.summary).toEqual({
      totalFbaSkuCount: 2,
      configured: 1,
      missing: 1,
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

  it("filters missing, configured and problem rows without hiding incomplete evidence", () => {
    const rows = parseBusinessPricingAuditSnapshot(payload()).rows;
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "missing")))
      .toHaveLength(1);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "configured")))
      .toHaveLength(1);
    expect(rows.filter((row) => businessPricingRowMatchesFilter(row, "problem")))
      .toHaveLength(1);
  });

  it("renders the audit summary, exact reason and in-place adjustment action", () => {
    const snapshot = parseBusinessPricingAuditSnapshot(payload());
    const markup = renderToStaticMarkup(createElement(BusinessPricingAuditPanel, {
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceShort: "US",
      initialSnapshot: snapshot,
    }));
    expect(markup).toContain("未設定 B2B 價格");
    expect(markup).toContain("Amazon Business 可用，但尚未設定 B2B 價格。");
    expect(markup).toContain("設定 B2B 價格");
    expect(markup).toContain("先由 Amazon Validation Preview 核對");
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
      businessOfferGuardHash: "a".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
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
      businessOfferGuardHash: "a".repeat(64),
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
      businessOfferGuardHash: "a".repeat(64),
      businessPricingCapability: {
        supported: true,
        editable: true,
        reason: null,
        schemaChecksum: "seller-schema-checksum",
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
        businessOfferGuardHash: "a".repeat(64),
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
      businessOfferGuardHash: "a".repeat(64),
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
