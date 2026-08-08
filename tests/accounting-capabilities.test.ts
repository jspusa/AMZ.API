import { describe, expect, it } from "vitest";
import {
  ACCOUNTING_RENDERER_INTEGRATION_PLAN,
  PUBLIC_ACCOUNTING_CAPABILITIES,
  accountingCapability,
  buildAccountingAccessPlan,
} from "../src/main/amazon/accounting-capabilities";

const US = "ATVPDKIKX0DER";
const NOW = new Date("2026-08-08T12:00:00.000Z");

describe("public SP-API accounting capability allowlist", () => {
  it("labels transactions as JSON and does not misrepresent them as invoices", () => {
    const plan = buildAccountingAccessPlan({
      capabilityId: "FINANCES_TRANSACTIONS",
      marketplaceId: US,
      dataStartTime: "2026-01-01T00:00:00.000Z",
      dataEndTime: "2026-06-30T00:00:00.000Z",
      now: NOW,
    });
    expect(plan).toMatchObject({
      state: "MAIN_FBA_FILTER_REQUIRED",
      capability: {
        artifact: "JSON",
        fbaSafety: "REQUIRES_AFN_ITEM_FILTER",
        roles: ["Finance and Accounting"],
      },
      request: {
        method: "GET",
        path: "/finances/2024-06-19/transactions",
        query: { marketplaceId: US },
      },
    });
    expect(plan.capability.notice).toMatch(/不是 Amazon 發票或帳單/u);
  });

  it("enforces the official 180-day and two-minute Finances window", () => {
    expect(() =>
      buildAccountingAccessPlan({
        capabilityId: "FINANCES_TRANSACTIONS",
        marketplaceId: US,
        dataStartTime: "2025-01-01T00:00:00.000Z",
        dataEndTime: "2026-01-01T00:00:00.000Z",
        now: NOW,
      }),
    ).toThrow(/180 days/u);
    expect(() =>
      buildAccountingAccessPlan({
        capabilityId: "FINANCES_TRANSACTIONS",
        marketplaceId: US,
        dataStartTime: "2026-08-01T00:00:00.000Z",
        dataEndTime: "2026-08-08T11:59:00.000Z",
        now: NOW,
      }),
    ).toThrow(/two minutes/u);
  });

  it("only creates fixed allowlisted FBA report types", () => {
    const storage = buildAccountingAccessPlan({
      capabilityId: "FBA_STORAGE_FEES",
      marketplaceId: US,
    });
    expect(storage).toMatchObject({
      state: "READY_CREATE_REPORT",
      request: {
        method: "POST",
        path: "/reports/2021-06-30/reports",
        body: {
          reportType: "GET_FBA_STORAGE_FEE_CHARGES_DATA",
          marketplaceIds: [US],
        },
      },
    });
    const reimbursements = buildAccountingAccessPlan({
      capabilityId: "FBA_REIMBURSEMENTS",
      marketplaceId: US,
    });
    expect(reimbursements.request?.body).toMatchObject({
      reportType: "GET_FBA_REIMBURSEMENTS_DATA",
    });
  });

  it("pins fee-preview dataEndTime to request NOW and enforces the official 72-hour start", () => {
    const exact = buildAccountingAccessPlan({
      capabilityId: "FBA_FEE_PREVIEW",
      marketplaceId: US,
      dataStartTime: "2026-08-05T12:00:00.000Z",
      now: NOW,
    });
    expect(exact).toMatchObject({
      state: "READY_CREATE_REPORT",
      request: {
        body: {
          dataStartTime: "2026-08-05T12:00:00.000Z",
          dataEndTime: "2026-08-08T12:00:00.000Z",
        },
      },
    });
    expect(() =>
      buildAccountingAccessPlan({
        capabilityId: "FBA_FEE_PREVIEW",
        marketplaceId: US,
        dataStartTime: "2026-08-05T12:00:00.001Z",
        now: NOW,
      }),
    ).toThrow(/72 hours before the request NOW/u);
    expect(() =>
      buildAccountingAccessPlan({
        capabilityId: "FBA_FEE_PREVIEW",
        marketplaceId: US,
        dataStartTime: "2026-08-01T00:00:00.000Z",
        dataEndTime: "2026-08-03T00:00:00.000Z",
        now: NOW,
      }),
    ).toThrow(/dataEndTime must be omitted/u);
  });

  it("validates one-calendar-month storage ranges", () => {
    expect(() =>
      buildAccountingAccessPlan({
        capabilityId: "FBA_LONG_TERM_STORAGE_FEES",
        marketplaceId: US,
        dataStartTime: "2026-06-01T00:00:00.000Z",
        dataEndTime: "2026-06-30T00:00:00.000Z",
      }),
    ).toThrow(/one calendar month/u);
    expect(
      buildAccountingAccessPlan({
        capabilityId: "FBA_LONG_TERM_STORAGE_FEES",
        marketplaceId: US,
        dataStartTime: "2026-06-01T00:00:00.000Z",
        dataEndTime: "2026-07-01T00:00:00.000Z",
      }).state,
    ).toBe("READY_CREATE_REPORT");
  });

  it("blocks unfiltered account-wide settlement and keeps holds behind the manual prerequisite", () => {
    const settlement = buildAccountingAccessPlan({
      capabilityId: "SETTLEMENT_V2",
      marketplaceId: US,
    });
    expect(settlement).toMatchObject({
      state: "FBA_FILTER_NOT_IMPLEMENTED",
      request: null,
      capability: {
        reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
        fbaSafety: "ACCOUNT_WIDE_NOT_FBA_SAFE",
      },
    });
    expect(
      buildAccountingAccessPlan({
        capabilityId: "FINANCIAL_HOLDS",
        marketplaceId: US,
      }),
    ).toMatchObject({ state: "MANUAL_PREREQUISITE", request: null });
  });

  it("keeps Brazil-only invoices and generic invoices/bills unavailable", () => {
    for (const capabilityId of [
      "BRAZIL_FBA_INVOICES",
      "GENERIC_MARKETPLACE_INVOICES",
      "SELLER_ACCOUNT_BILLS",
    ] as const) {
      expect(
        buildAccountingAccessPlan({ capabilityId, marketplaceId: US }),
      ).toMatchObject({ state: "UNAVAILABLE", request: null });
    }
    expect(accountingCapability("BRAZIL_FBA_INVOICES")).toMatchObject({
      availability: "BRAZIL_ONLY",
      roles: ["Tax Invoicing (Restricted)"],
    });
  });

  it("contains no private Seller Central URL and gives renderer read/download boundaries", () => {
    const serialized = JSON.stringify({
      capabilities: PUBLIC_ACCOUNTING_CAPABILITIES,
      renderer: ACCOUNTING_RENDERER_INTEGRATION_PLAN,
    });
    expect(serialized).not.toMatch(/sellercentral\.amazon\./iu);
    expect(serialized).not.toMatch(/refresh.?token|client.?secret|seller.?id/iu);
    expect(ACCOUNTING_RENDERER_INTEGRATION_PLAN.boundaries).toHaveLength(5);
  });
});
