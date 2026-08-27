import { describe, expect, it, vi } from "vitest";
import { DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT } from
  "../src/main/amazon/inbound-noncompliance";
import {
  createDemoReportsAdapter,
  type BusinessPricingActiveListingsReportGateway,
  type DemoAllListingsReportGateway,
  type InboundNoncomplianceDemoReportGateway,
} from "../src/main/amazon/reports-runtime-demo";
import type {
  ReportsCreateRequest,
  ReportsDocumentRequest,
  ReportsIntentPlan,
  ReportsStatusRequest,
} from "../src/main/amazon/reports-runtime";

const US = "ATVPDKIKX0DER" as const;

const PLANS = [
  {
    plan: { intent: "all-listings", marketplaceId: US },
    reportId: `demo-${US}`,
    notice: "展示報表已準備完成。",
  },
  {
    plan: { intent: "active-business-listings", marketplaceId: US },
    reportId: `demo-b2b-active-${US}`,
    notice: "展示 Active Listings 報表已準備完成。",
  },
  {
    plan: { intent: "aged-inventory", marketplaceId: US },
    reportId: `demo-aged-${US}`,
    notice: "展示用 FBA 庫齡報表已準備完成。",
  },
  {
    plan: { intent: "inbound-noncompliance", marketplaceId: US },
    reportId: `demo-inbound-noncompliance-${US}`,
    notice: "展示用 FBA 入庫瑕疵報表已準備完成。",
  },
  {
    plan: {
      intent: "sales-and-traffic-daily-sku",
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    },
    reportId: `demo-sales-traffic-${US}-2026-08-01-2026-08-20`,
    notice: "展示用銷售與流量報表已準備完成。",
  },
  {
    plan: {
      intent: "fba-shipment-sales",
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
      dataStartTime: "2026-08-01T00:00:00-07:00",
      dataEndTime: "2026-08-21T00:00:00-07:00",
      windowCreatedAt: Date.parse("2026-08-20T12:00:00.000Z"),
    },
    reportId: `demo-brand-${US}-2026-08-01-2026-08-20`,
    notice: "展示用 FBA 品牌出貨報表已準備完成。",
  },
] as const satisfies readonly Readonly<{
  plan: ReportsIntentPlan;
  reportId: string;
  notice: string;
}>[];

function createRequest(
  plan: ReportsIntentPlan,
  mode: "live" | "demo" = "demo",
): ReportsCreateRequest {
  return {
    ...plan,
    operation: "create",
    mode,
    signal: new AbortController().signal,
  } as ReportsCreateRequest;
}

function statusRequest(
  plan: ReportsIntentPlan,
  reportId: string,
  mode: "live" | "demo" = "demo",
): ReportsStatusRequest {
  return {
    ...plan,
    operation: "status",
    mode,
    reportId,
    signal: new AbortController().signal,
  } as ReportsStatusRequest;
}

function documentRequest(
  plan: ReportsIntentPlan,
  reportId: string,
  documentId: string,
  mode: "live" | "demo" = "demo",
): ReportsDocumentRequest {
  return {
    ...plan,
    operation: "document",
    mode,
    reportId,
    documentId,
    signal: new AbortController().signal,
  } as ReportsDocumentRequest;
}

describe("demo Reports runtime adapter", () => {
  it.each(PLANS)(
    "creates the fixed $plan.intent identity without losing its intent fields",
    async ({ plan, reportId, notice }) => {
      const result = await createDemoReportsAdapter().create(
        createRequest(plan),
      );

      expect(result).toMatchObject({
        mode: "demo",
        ready: true,
        reportId,
        documentId: reportId,
        status: "DONE",
        notice,
        identity: { ...plan, mode: "demo" },
      });
    },
  );

  it.each(PLANS)(
    "polls the fixed $plan.intent identity without changing its receipt",
    async ({ plan, reportId, notice }) => {
      const result = await createDemoReportsAdapter().status(
        statusRequest(plan, reportId),
      );

      expect(result).toMatchObject({
        mode: "demo",
        ready: true,
        reportId,
        documentId: reportId,
        status: "DONE",
        notice,
        identity: { ...plan, mode: "demo" },
      });
    },
  );

  it("preserves fixed status IDs and rejects date or marketplace mismatches where the legacy adapter did", async () => {
    const adapter = createDemoReportsAdapter();
    const allListings = PLANS[0];
    const allListingsStatus = await adapter.status(statusRequest(
      allListings.plan,
      "legacy-caller-report-id",
    ));
    expect(allListingsStatus).toMatchObject({
      reportId: "legacy-caller-report-id",
      documentId: allListings.reportId,
      identity: { ...allListings.plan, mode: "demo" },
    });

    const sales = PLANS[4];
    await expect(adapter.status(statusRequest(
      sales.plan,
      "demo-sales-traffic-wrong-window",
    ))).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MISMATCH",
      message: "展示營收報表與目前站點或日期不一致。",
    });

    const inbound = PLANS[3];
    await expect(adapter.status(statusRequest(
      inbound.plan,
      "demo-inbound-noncompliance-wrong-marketplace",
    ))).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MISMATCH",
      message: "展示報表編號與目前站點不一致。",
    });
  });

  it("keeps the inbound document exact and preserves the legacy empty document for other intents", async () => {
    const adapter = createDemoReportsAdapter();
    const inbound = PLANS[3];
    await expect(adapter.readDocument(documentRequest(
      inbound.plan,
      inbound.reportId,
      inbound.reportId,
    ))).resolves.toEqual({
      identity: { ...inbound.plan, mode: "demo" },
      reportId: inbound.reportId,
      documentId: inbound.reportId,
      text: DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT,
    });

    await expect(adapter.readDocument(documentRequest(
      PLANS[0].plan,
      "legacy-unchecked-report",
      "legacy-unchecked-document",
    ))).resolves.toEqual({
      identity: { ...PLANS[0].plan, mode: "demo" },
      reportId: "legacy-unchecked-report",
      documentId: "legacy-unchecked-document",
      text: "",
    });

    await expect(adapter.readDocument(documentRequest(
      inbound.plan,
      inbound.reportId,
      "wrong-document",
    ))).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MISMATCH",
      message: "展示報表文件與目前站點不一致。",
    });
  });

  it("rejects every live operation before a demo gateway can run", async () => {
    const start = vi.fn();
    const adapter = createDemoReportsAdapter({
      allListingsDemoReports: { start },
    });
    const plan = PLANS[0].plan;
    const assertions = [
      adapter.create(createRequest(plan, "live")),
      adapter.status(statusRequest(plan, PLANS[0].reportId, "live")),
      adapter.readDocument(documentRequest(
        plan,
        PLANS[0].reportId,
        PLANS[0].reportId,
        "live",
      )),
    ];

    for (const assertion of assertions) {
      await expect(assertion).rejects.toMatchObject({
        status: 409,
        code: "REPORT_MODE_CHANGED",
        message: "展示 Reports adapter 不接受正式 Amazon 請求。",
      });
    }
    expect(start).not.toHaveBeenCalled();
  });

  it("merges focused gateway overrides without disabling each gateway's defaults", async () => {
    const allListingsStart = vi.fn<
      DemoAllListingsReportGateway["start"]
    >(async ({ marketplaceId }) => ({
      mode: "demo",
      ready: false,
      reportId: `custom-all-${marketplaceId}`,
      documentId: null,
      status: "IN_PROGRESS",
      notice: "custom all listings",
    }));
    const activeBusinessStatus = vi.fn<
      BusinessPricingActiveListingsReportGateway["status"]
    >(async ({ marketplaceId, reportId }) => ({
      mode: "demo",
      ready: true,
      reportId,
      documentId: `custom-active-document-${marketplaceId}`,
      status: "DONE",
      notice: "custom active business",
    }));
    const inboundDocument = vi.fn<
      InboundNoncomplianceDemoReportGateway["document"]
    >(async () => "custom inbound document");
    const adapter = createDemoReportsAdapter({
      allListingsDemoReports: { start: allListingsStart },
      businessPricingActiveListingsReports: {
        status: activeBusinessStatus,
      },
      inboundNoncomplianceDemoReports: { document: inboundDocument },
    });

    await expect(adapter.create(createRequest(PLANS[0].plan)))
      .resolves.toMatchObject({
        reportId: `custom-all-${US}`,
        documentId: null,
        status: "IN_PROGRESS",
        notice: "custom all listings",
        identity: { ...PLANS[0].plan, mode: "demo" },
      });
    await expect(adapter.status(statusRequest(
      PLANS[0].plan,
      "default-status-remains",
    ))).resolves.toMatchObject({
      reportId: "default-status-remains",
      documentId: PLANS[0].reportId,
      notice: PLANS[0].notice,
    });
    await expect(adapter.status(statusRequest(
      PLANS[1].plan,
      "custom-active-report",
    ))).resolves.toMatchObject({
      reportId: "custom-active-report",
      documentId: `custom-active-document-${US}`,
      notice: "custom active business",
    });
    await expect(adapter.readDocument(documentRequest(
      PLANS[3].plan,
      PLANS[3].reportId,
      PLANS[3].reportId,
    ))).resolves.toMatchObject({ text: "custom inbound document" });

    expect(allListingsStart).toHaveBeenCalledTimes(1);
    expect(activeBusinessStatus).toHaveBeenCalledTimes(1);
    expect(inboundDocument).toHaveBeenCalledTimes(1);
  });
});
