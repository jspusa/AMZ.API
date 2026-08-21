import { describe, expect, it } from "vitest";
import {
  buildInboundIssueReportSnapshot,
  InboundNoncomplianceFormatError,
  parseInboundNoncomplianceReport,
} from "../src/main/amazon/inbound-noncompliance";

const HEADERS = [
  "issue-reported-date",
  "shipment-creation-date",
  "fba-shipment-id",
  "fba-carton-id",
  "fulfillment-center-id",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "problem-type",
  "problem-quantity",
  "expected-quantity",
  "received-quantity",
  "performance-measurement-unit",
  "coaching-level",
  "fee-type",
  "currency",
  "fee-total",
  "problem-level",
  "alert-status",
];

function report(...rows: string[][]): string {
  return [HEADERS, ...rows].map((row) => row.join("\t")).join("\r\n");
}

function issueRow(overrides: Partial<Record<(typeof HEADERS)[number], string>> = {}): string[] {
  const values: Record<(typeof HEADERS)[number], string> = {
    "issue-reported-date": "2026-08-20",
    "shipment-creation-date": "2026-08-10",
    "fba-shipment-id": "FBA15TEST0001",
    "fba-carton-id": "FBA15TEST0001U000001",
    "fulfillment-center-id": "ONT8",
    sku: "TEST-SKU-003",
    fnsku: "B000TEST03",
    asin: "B000TEST03",
    "product-name": "Example Dog Treats",
    "problem-type": "Unexpected item found",
    "problem-quantity": "1",
    "expected-quantity": "2400",
    "received-quantity": "2401",
    "performance-measurement-unit": "Units",
    "coaching-level": "Product",
    "fee-type": "",
    currency: "",
    "fee-total": "",
    "problem-level": "Product",
    "alert-status": "Resolved",
    ...overrides,
  };
  return HEADERS.map((header) => values[header]);
}

describe("FBA inbound noncompliance report parser", () => {
  it("parses the exact public report fields without hiding over-receipts", () => {
    const parsed = parseInboundNoncomplianceReport(report(issueRow()));

    expect(parsed.incompleteRowCount).toBe(0);
    expect(parsed.latestIssueReportedDate).toBe("2026-08-20");
    expect(parsed.issues).toEqual([
      {
        level: "product",
        shipmentId: "FBA15TEST0001",
        sellerSku: "TEST-SKU-003",
        fnsku: "B000TEST03",
        asin: "B000TEST03",
        productName: "Example Dog Treats",
        cartonId: "FBA15TEST0001U000001",
        problemType: "Unexpected item found",
        problemQuantity: 1,
        expectedUnits: 2400,
        receivedUnits: 2401,
        reportedAt: "2026-08-20",
        alertStatus: "Resolved",
        notice: "Amazon 每日入庫瑕疵報表狀態：Resolved",
      },
    ]);
  });

  it("maps shipment, carton/box and product levels into separate fixed buckets", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow({ "problem-level": "Shipment" }),
      issueRow({ "problem-level": "Box Level", "fba-carton-id": "BOX-2" }),
      issueRow({ "problem-level": "product-level", sku: "TEST-SKU-002" }),
    ));

    expect(parsed.issues.map((issue) => issue.level)).toEqual([
      "shipment",
      "carton",
      "product",
    ]);
  });

  it("keeps documented optional cells null instead of inventing zero", () => {
    const parsed = parseInboundNoncomplianceReport(report(issueRow({
      sku: "",
      fnsku: "",
      asin: "",
      "fba-carton-id": "",
      "problem-quantity": "",
      "expected-quantity": "",
      "received-quantity": "",
      "issue-reported-date": "",
      "alert-status": "",
    })));

    expect(parsed.issues[0]).toMatchObject({
      sellerSku: null,
      fnsku: null,
      asin: null,
      cartonId: null,
      problemQuantity: null,
      expectedUnits: null,
      receivedUnits: null,
      reportedAt: null,
      alertStatus: null,
    });
    expect(parsed.issues[0]?.notice).toContain("未提供 alert-status");
  });

  it("isolates malformed rows while retaining valid problem evidence", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow(),
      issueRow({ "problem-level": "AmazonNewUnknownLevel" }),
      issueRow({ "problem-quantity": "1.5" }),
      issueRow({ asin: "bad" }),
    ));

    expect(parsed.issues).toHaveLength(1);
    expect(parsed.incompleteRowCount).toBe(3);
    expect(parsed.incompleteRows).toEqual([
      { shipmentId: "FBA15TEST0001" },
      { shipmentId: "FBA15TEST0001" },
      { shipmentId: "FBA15TEST0001" },
    ]);
  });

  it("fails closed when the root report schema is missing or ambiguous", () => {
    const missing = HEADERS.filter((header) => header !== "problem-level");
    expect(() => parseInboundNoncomplianceReport(missing.join("\t")))
      .toThrowError(InboundNoncomplianceFormatError);
    expect(() => parseInboundNoncomplianceReport(
      `${HEADERS.join("\t")}\tproblem_type\n`,
    )).toThrow("重複欄位");
  });

  it("supports quoted tab-delimited cells and rejects unterminated quotes", () => {
    const row = issueRow({ "problem-type": '"Wrong ""label"""' });
    const parsed = parseInboundNoncomplianceReport(report(row));
    expect(parsed.issues[0]?.problemType).toBe('Wrong "label"');
    const inchMark = parseInboundNoncomplianceReport(report(issueRow({
      "product-name": 'AFreschi 3" Turkey Tendon',
    })));
    expect(inchMark.issues[0]?.productName).toBe('AFreschi 3" Turkey Tendon');
    expect(() => parseInboundNoncomplianceReport(`${HEADERS.join("\t")}\n"broken`))
      .toThrow("未結束");
  });

  it("groups the three levels and keeps daily coverage distinct from event dates", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow({ "problem-level": "Shipment" }),
      issueRow({ "problem-level": "Box" }),
      issueRow({ "problem-level": "Product" }),
      issueRow({ "problem-level": "unknown" }),
    ));
    const snapshot = buildInboundIssueReportSnapshot({
      parsed,
      fetchedAt: "2026-08-21T01:02:03.000Z",
      allowedShipmentIds: new Set(["FBA15TEST0001"]),
    });

    expect(snapshot.state).toBe("partial");
    expect(snapshot.fetchedAt).toBe("2026-08-21T01:02:03.000Z");
    expect(snapshot.dataThrough).toBeNull();
    expect(snapshot.excludedShipmentCount).toBe(0);
    expect(snapshot.shipment).toHaveLength(1);
    expect(snapshot.carton).toHaveLength(1);
    expect(snapshot.product).toHaveLength(1);
    expect(snapshot.notice).toContain("每日更新");
    expect(snapshot.notice).toContain("1 筆欄位無法安全辨識");
  });

  it("filters daily report rows to selected shipments without exposing outside IDs", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow(),
      issueRow({ "fba-shipment-id": "FBA-OUTSIDE-1", sku: "OUTSIDE-SKU" }),
      issueRow({ "fba-shipment-id": "FBA-OUTSIDE-1", sku: "OUTSIDE-SKU-2" }),
    ));
    const snapshot = buildInboundIssueReportSnapshot({
      parsed,
      fetchedAt: "2026-08-21T01:02:03.000Z",
      allowedShipmentIds: new Set(["FBA15TEST0001"]),
    });

    expect(snapshot.product).toHaveLength(1);
    expect(snapshot.excludedShipmentCount).toBe(1);
    expect(snapshot.notice).toContain("1 個不在所選更新區間的貨件");
    expect(JSON.stringify(snapshot)).not.toContain("FBA-OUTSIDE-1");
    expect(JSON.stringify(snapshot)).not.toContain("OUTSIDE-SKU");
  });

  it("does not make selected coverage partial for a malformed row proven outside its shipment scope", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow(),
      issueRow({
        "fba-shipment-id": "FBA-OUTSIDE-BROKEN",
        "problem-level": "AmazonNewUnknownLevel",
      }),
    ));
    const snapshot = buildInboundIssueReportSnapshot({
      parsed,
      fetchedAt: "2026-08-21T01:02:03.000Z",
      allowedShipmentIds: new Set(["FBA15TEST0001"]),
    });

    expect(snapshot.state).toBe("completed");
    expect(snapshot.excludedShipmentCount).toBe(1);
    expect(snapshot.notice).not.toContain("無法確定所屬貨件");
    expect(JSON.stringify(snapshot)).not.toContain("FBA-OUTSIDE-BROKEN");
  });

  it("keeps coverage partial when a malformed row cannot be assigned to any shipment", () => {
    const parsed = parseInboundNoncomplianceReport(report(
      issueRow({ "fba-shipment-id": "", "problem-level": "unknown" }),
    ));
    const snapshot = buildInboundIssueReportSnapshot({
      parsed,
      fetchedAt: "2026-08-21T01:02:03.000Z",
      allowedShipmentIds: new Set(["FBA15TEST0001"]),
    });

    expect(snapshot.state).toBe("partial");
    expect(snapshot.excludedShipmentCount).toBe(0);
    expect(snapshot.notice).toContain("無法確定所屬貨件");
  });
});
