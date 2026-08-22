import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import InboundShipmentsPanel from "../src/renderer/src/components/inbound-shipments-panel";
import {
  INBOUND_ISSUE_RENDER_BATCH,
  INBOUND_ITEM_RENDER_BATCH,
  INBOUND_SHIPMENT_RENDER_BATCH,
  INBOUND_COVERAGE_ISSUE_RENDER_BATCH,
} from "../src/renderer/src/components/inbound-shipments-panel";
import {
  defaultInboundShipmentDateRange,
  filterInboundShipments,
  inboundShipmentDifferenceCopy,
  inboundShipmentFailureMessage,
  inboundShipmentStartBody,
  parseInboundShipmentJob,
  parseInboundShipmentSnapshot,
  pollInboundShipmentJob,
  replaceInboundShipmentCacheForMarketplace,
  type InboundShipmentCache,
} from "../src/renderer/src/inbound-shipments";
import {
  completedInboundShipmentJobFixture,
  inboundShipmentJobFixture,
  inboundShipmentSnapshotFixture,
  US_MARKETPLACE_ID,
} from "./inbound-shipments-fixture";

const RANGE = { startDate: "2026-05-24", endDate: "2026-08-21" };

afterEach(() => {
  vi.useRealTimers();
});

describe("FBA inbound shipment renderer contract", () => {
  it("accepts official nullable fields and mixed aggregate differences", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );

    expect(snapshot.shipments[0]).toMatchObject({
      shipmentName: null,
      destinationFulfillmentCenterId: null,
      labelPrepType: null,
      boxContentsSource: null,
    });
    expect(snapshot.items[0]).toMatchObject({
      fulfillmentNetworkSku: null,
      asin: null,
      title: null,
      quantityInCase: null,
    });
    expect(snapshot.summary.verifiedTotals).toEqual({
      expectedUnits: 448,
      receivedUnits: 430,
      pendingUnits: 20,
      overReceivedUnits: 2,
    });
  });

  it("treats a daily issue report gap as a legitimate partial terminal job", () => {
    const partial = parseInboundShipmentJob(
      inboundShipmentJobFixture(),
      US_MARKETPLACE_ID,
      RANGE,
    );
    expect(partial.state).toBe("partial");
    expect(partial.snapshot?.coverage.state).toBe("complete");
    expect(partial.snapshot?.issueReport.state).toBe("partial");

    expect(() => parseInboundShipmentJob(
      { ...inboundShipmentJobFixture(), state: "completed" },
      US_MARKETPLACE_ID,
      RANGE,
    )).toThrow(/工作狀態與快照不一致/u);

    expect(parseInboundShipmentJob(
      completedInboundShipmentJobFixture(),
      US_MARKETPLACE_ID,
      RANGE,
    ).state).toBe("completed");
  });

  it("keeps an active-status fallback partial even when every returned item is complete", () => {
    const rawSnapshot = inboundShipmentSnapshotFixture();
    rawSnapshot.shipmentListScope = "active-status-fallback";
    rawSnapshot.notice =
      "Amazon 拒絕舊版日期清單；已改讀活動中貨件，所選日期內已關閉貨件可能未列入。";
    const rawIssueReport = rawSnapshot.issueReport as Record<string, unknown>;
    rawIssueReport.state = "completed";
    rawIssueReport.notice = "Amazon 每日報表已完成讀取。";

    expect(() => parseInboundShipmentJob(
      inboundShipmentJobFixture({ state: "completed", snapshot: rawSnapshot }),
      US_MARKETPLACE_ID,
      RANGE,
    )).toThrow(/工作狀態與快照不一致/u);

    const job = parseInboundShipmentJob(
      inboundShipmentJobFixture({ state: "partial", snapshot: rawSnapshot }),
      US_MARKETPLACE_ID,
      RANGE,
    );
    const snapshot = parseInboundShipmentSnapshot(rawSnapshot, US_MARKETPLACE_ID);
    const markup = renderToStaticMarkup(
      <InboundShipmentsPanel
        marketplaceId={US_MARKETPLACE_ID}
        marketplaceShort="US"
        marketplaceTimeZone="America/Los_Angeles"
        cachedResult={{
          marketplaceId: US_MARKETPLACE_ID,
          dateRange: RANGE,
          job,
          snapshot,
          error: null,
        }}
      />,
    );
    expect(markup).toContain("活動中貨件已讀取；所選日期範圍不完整");
    expect(markup).toContain("已核對 · 貨件");
    expect(markup).not.toContain("所選日期內全部貨件商品明細已完成");
  });

  it("preserves only a safe failed-job diagnostic and formats it for support", () => {
    const failed = inboundShipmentJobFixture({ state: "failed" });
    failed.failure = {
      code: "FBA_INBOUND_FORMAT_UNSUPPORTED",
      requestId: "SAFE-REQUEST-ID",
    };
    const parsed = parseInboundShipmentJob(
      failed,
      US_MARKETPLACE_ID,
      RANGE,
    );
    expect(inboundShipmentFailureMessage(parsed)).toContain(
      "診斷代碼：FBA_INBOUND_FORMAT_UNSUPPORTED",
    );
    expect(inboundShipmentFailureMessage(parsed)).toContain(
      "Amazon Request ID：SAFE-REQUEST-ID",
    );

    const hostile = structuredClone(failed);
    (hostile.failure as Record<string, unknown>).code = "BAD\u200bCODE";
    expect(() => parseInboundShipmentJob(
      hostile,
      US_MARKETPLACE_ID,
      RANGE,
    )).toThrow(/診斷代碼無效/u);

    const contradictory = inboundShipmentJobFixture();
    contradictory.failure = {
      code: "FBA_INBOUND_FORMAT_UNSUPPORTED",
      requestId: null,
    };
    expect(() => parseInboundShipmentJob(
      contradictory,
      US_MARKETPLACE_ID,
      RANGE,
    )).toThrow(/狀態與診斷資訊不一致/u);
  });

  it("fails closed on contradictory coverage and issue-report availability", () => {
    const contradictoryCoverage = inboundShipmentSnapshotFixture();
    (contradictoryCoverage.coverage as Record<string, unknown>).state = "partial";
    (contradictoryCoverage.summary as Record<string, unknown>).totals = null;
    expect(() => parseInboundShipmentSnapshot(
      contradictoryCoverage,
      US_MARKETPLACE_ID,
    )).toThrow(/摘要、覆蓋或商品合計不一致/u);

    const unavailableWithRows = inboundShipmentSnapshotFixture();
    (unavailableWithRows.issueReport as Record<string, unknown>).state = "unavailable";
    expect(() => parseInboundShipmentSnapshot(
      unavailableWithRows,
      US_MARKETPLACE_ID,
    )).toThrow(/報表狀態、讀取時間或範圍資料不一致/u);

    const unavailable = inboundShipmentSnapshotFixture();
    const issueReport = unavailable.issueReport as Record<string, unknown>;
    issueReport.state = "unavailable";
    issueReport.fetchedAt = null;
    issueReport.excludedShipmentCount = null;
    issueReport.shipment = [];
    issueReport.carton = [];
    issueReport.product = [];
    expect(parseInboundShipmentSnapshot(unavailable, US_MARKETPLACE_ID).issueReport)
      .toMatchObject({ state: "unavailable", fetchedAt: null, excludedShipmentCount: null });
  });

  it("derives complete and partial coverage counts from the actual shipment rows", () => {
    const forged = inboundShipmentSnapshotFixture();
    const firstShipment = (forged.shipments as Array<Record<string, unknown>>)[0];
    firstShipment.itemCoverage = "partial";
    firstShipment.totals = null;

    expect(() => parseInboundShipmentSnapshot(forged, US_MARKETPLACE_ID))
      .toThrow(/摘要、覆蓋或商品合計不一致/u);
  });

  it("requires one bounded coverage issue for every actual partial shipment", () => {
    const partial = inboundShipmentSnapshotFixture();
    const firstShipment = (partial.shipments as Array<Record<string, unknown>>)[0];
    firstShipment.itemCoverage = "partial";
    firstShipment.totals = null;
    const coverage = partial.coverage as Record<string, unknown>;
    coverage.state = "partial";
    coverage.shipmentsWithCompleteItems = 1;
    coverage.shipmentsWithPartialItems = 1;
    coverage.incompleteShipmentCount = 1;
    coverage.issues = [{
      stage: "items",
      shipmentId: firstShipment.shipmentId,
      code: "ITEMS_PARTIAL",
      message: "Amazon 商品明細未完整。",
      requestId: null,
      completedItemPages: 0,
    }];
    const summary = partial.summary as Record<string, unknown>;
    summary.incompleteShipmentCount = 1;
    summary.totals = null;
    expect(() => parseInboundShipmentSnapshot(partial, US_MARKETPLACE_ID))
      .not.toThrow();

    const duplicate = structuredClone(partial);
    const duplicateCoverage = duplicate.coverage as Record<string, unknown>;
    duplicateCoverage.issues = [
      ...(duplicateCoverage.issues as unknown[]),
      ...(duplicateCoverage.issues as unknown[]),
    ];
    expect(() => parseInboundShipmentSnapshot(duplicate, US_MARKETPLACE_ID))
      .toThrow(/摘要、覆蓋或商品合計不一致/u);

    const oversized = inboundShipmentSnapshotFixture();
    (oversized.coverage as Record<string, unknown>).issues = Array.from(
      { length: 10_001 },
      () => ({
        stage: "items",
        shipmentId: "FBA15TEST0001",
        code: "ITEMS_PARTIAL",
        message: "Amazon 商品明細未完整。",
        requestId: null,
        completedItemPages: 0,
      }),
    );
    expect(() => parseInboundShipmentSnapshot(oversized, US_MARKETPLACE_ID))
      .toThrow(/超出安全列數/u);
  });

  it("rejects item math drift, out-of-range issue rows, account scope, and identity drift", () => {
    const badItem = inboundShipmentSnapshotFixture();
    ((badItem.items as Array<Record<string, unknown>>)[1]).pendingUnits = 19;
    expect(() => parseInboundShipmentSnapshot(badItem, US_MARKETPLACE_ID))
      .toThrow(/差異與原始預期／接收數量不一致/u);

    const outOfRangeIssue = inboundShipmentSnapshotFixture();
    const productIssues = (outOfRangeIssue.issueReport as Record<string, unknown>)
      .product as Array<Record<string, unknown>>;
    productIssues[0].shipmentId = "FBA19OUTSIDE";
    expect(() => parseInboundShipmentSnapshot(outOfRangeIssue, US_MARKETPLACE_ID))
      .toThrow(/快照範圍外/u);

    const leaked = inboundShipmentSnapshotFixture();
    leaked.accountScope = "must-stay-in-main";
    expect(() => parseInboundShipmentSnapshot(leaked, US_MARKETPLACE_ID))
      .toThrow(/不應送到前台/u);

    expect(() => parseInboundShipmentJob(
      inboundShipmentJobFixture(),
      US_MARKETPLACE_ID,
      { startDate: "2026-05-23", endDate: "2026-08-21" },
    )).toThrow(/日期範圍已改變/u);
    expect(() => parseInboundShipmentJob(
      inboundShipmentJobFixture(),
      "A1VC38T7YXB528",
      RANGE,
    )).toThrow(/站點或狀態無效/u);
  });

  it("uses the selected marketplace day for 30, 90, and 180 day ranges", () => {
    const instant = new Date("2026-08-21T02:00:00.000Z");
    expect(defaultInboundShipmentDateRange({
      timeZone: "America/Los_Angeles",
      now: instant,
      days: 90,
    })).toEqual({ startDate: "2026-05-23", endDate: "2026-08-20" });
    expect(defaultInboundShipmentDateRange({
      timeZone: "Asia/Taipei",
      now: instant,
      days: 90,
    })).toEqual({ startDate: "2026-05-24", endDate: "2026-08-21" });
    expect(defaultInboundShipmentDateRange({
      timeZone: "America/Los_Angeles",
      now: instant,
      days: 180,
    })).toEqual({ startDate: "2026-02-22", endDate: "2026-08-20" });
  });

  it("keeps receiving, closed, unknown, and mixed-difference wording honest", () => {
    const receiving = inboundShipmentDifferenceCopy({
      totals: { expectedUnits: 100, receivedUnits: 82, pendingUnits: 20, overReceivedUnits: 2 },
      status: "RECEIVING",
      complete: true,
    });
    expect(receiving.label).toContain("尚在接收 20");
    expect(receiving.label).toContain("暫時多接收");
    expect(receiving.label).not.toMatch(/短少|損失/u);

    expect(inboundShipmentDifferenceCopy({
      totals: { expectedUnits: 0, receivedUnits: 0, pendingUnits: 0, overReceivedUnits: 0 },
      status: "RECEIVING",
      complete: false,
    }).label).toContain("未完成明細的差異未知");

    const closed = inboundShipmentDifferenceCopy({
      totals: { expectedUnits: 100, receivedUnits: 82, pendingUnits: 20, overReceivedUnits: 2 },
      status: "CLOSED",
      complete: true,
    });
    expect(closed.label).toContain("尚有 20");
    expect(closed.label).toContain("多接收 2");
    expect(closed.label).toContain("Seller Central");

    expect(inboundShipmentDifferenceCopy({
      totals: { expectedUnits: 10, receivedUnits: 9, pendingUnits: 1, overReceivedUnits: 0 },
      status: null,
      complete: true,
    }).label).toContain("暫不判定原因");
  });

  it("filters by search and differences, then sorts differences before Shipment ID", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    snapshot.shipments[0].totals = {
      expectedUnits: 348,
      receivedUnits: 348,
      pendingUnits: 0,
      overReceivedUnits: 0,
    };
    snapshot.shipments[0].verifiedTotals = snapshot.shipments[0].totals;
    snapshot.shipments.reverse();

    expect(filterInboundShipments({
      snapshot,
      status: "all",
      search: "",
      differencesOnly: false,
    }).map(({ shipmentId }) => shipmentId)).toEqual([
      "FBA15TEST0002",
      "FBA15TEST0001",
    ]);
    expect(filterInboundShipments({
      snapshot,
      status: "all",
      search: "TEST-SKU-002",
      differencesOnly: false,
    }).map(({ shipmentId }) => shipmentId)).toEqual(["FBA15TEST0001"]);

    const partialShipment = snapshot.shipments.find(
      ({ shipmentId }) => shipmentId === "FBA15TEST0001",
    )!;
    partialShipment.itemCoverage = "partial";
    partialShipment.totals = null;
    partialShipment.verifiedTotals = {
      expectedUnits: 0,
      receivedUnits: 0,
      pendingUnits: 0,
      overReceivedUnits: 0,
    };
    expect(filterInboundShipments({
      snapshot,
      status: "all",
      search: "",
      differencesOnly: true,
    }).map(({ shipmentId }) => shipmentId)).toContain("FBA15TEST0001");
  });

  it("continues read-only observation beyond transient failures and preserves GET identity", async () => {
    vi.useFakeTimers();
    const initialJob = parseInboundShipmentJob(
      inboundShipmentJobFixture({ state: "running" }),
      US_MARKETPLACE_ID,
      RANGE,
    );
    let attempts = 0;
    const request = vi.fn(async (url: string) => {
      attempts += 1;
      if (attempts <= 7) throw new Error("temporary network failure");
      return {
        ok: true,
        status: 200,
        json: async () => completedInboundShipmentJobFixture(),
      };
    });
    const polling = pollInboundShipmentJob({
      marketplaceId: US_MARKETPLACE_ID,
      dateRange: RANGE,
      initialJob,
      signal: new AbortController().signal,
      request,
    });

    await vi.runAllTimersAsync();
    await expect(polling).resolves.toMatchObject({ state: "completed" });
    expect(request).toHaveBeenCalledTimes(8);
    const calledUrl = String(request.mock.calls.at(-1)?.[0]);
    expect(calledUrl).toContain(`marketplaceId=${US_MARKETPLACE_ID}`);
    expect(calledUrl).toContain("jobId=inbound-job-12345678");
    expect(calledUrl).toContain("startDate=2026-05-24");
    expect(calledUrl).toContain("endDate=2026-08-21");
  });

  it("renders one-click controls, QuantityReceived boundaries, and all three issue levels", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const job = parseInboundShipmentJob(
      inboundShipmentJobFixture(),
      US_MARKETPLACE_ID,
      RANGE,
    );
    const markup = renderToStaticMarkup(
      <InboundShipmentsPanel
        marketplaceId={US_MARKETPLACE_ID}
        marketplaceShort="US"
        marketplaceTimeZone="America/Los_Angeles"
        cachedResult={{
          marketplaceId: US_MARKETPLACE_ID,
          dateRange: RANGE,
          job,
          snapshot,
          error: null,
        }}
      />,
    );

    expect(markup).toContain("同步 US 貨件與全部商品");
    expect(markup).toContain("SP-API 的 QuantityReceived");
    expect(markup).toContain("Seller Central");
    expect(markup).toContain("貨件層級瑕疵");
    expect(markup).toContain("包裝箱層級瑕疵");
    expect(markup).toContain("產品層級瑕疵");
    expect(markup).toContain("Amazon 每日問題報表目前未回傳");
    expect(markup).toContain("另排除 2 個不在本次日期範圍");
    expect(markup).toContain("貨件數量快照時間");
    expect(markup).toContain("每日瑕疵報表讀取時間");
    expect(markup).toContain("未提供可證明的 dataThrough");
    expect(markup).not.toContain("Amazon 此 API 未提供商品名稱");
    expect(markup).not.toContain("重新嘗試每日瑕疵報表");
  });

  it("labels partial SKU counts as verified instead of complete totals", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    snapshot.coverage.state = "partial";
    snapshot.coverage.shipmentsWithCompleteItems = 1;
    snapshot.coverage.shipmentsWithPartialItems = 1;
    snapshot.coverage.incompleteShipmentCount = 1;
    snapshot.summary.incompleteShipmentCount = 1;
    snapshot.summary.totals = null;
    snapshot.shipments[0].itemCoverage = "partial";
    snapshot.shipments[0].totals = null;
    const markup = renderToStaticMarkup(
      <InboundShipmentsPanel
        marketplaceId={US_MARKETPLACE_ID}
        marketplaceShort="US"
        marketplaceTimeZone="America/Los_Angeles"
        cachedResult={{
          marketplaceId: US_MARKETPLACE_ID,
          dateRange: RANGE,
          job: null,
          snapshot,
          error: null,
        }}
      />,
    );
    expect(markup).toContain("已核對 · SKU 明細列");
    expect(markup).toContain("已核對 SKU");
  });

  it("renders large snapshots in deterministic batches without mounting collapsed items", () => {
    expect(INBOUND_SHIPMENT_RENDER_BATCH).toBe(50);
    expect(INBOUND_ITEM_RENDER_BATCH).toBe(100);
    expect(INBOUND_ISSUE_RENDER_BATCH).toBe(100);
    expect(INBOUND_COVERAGE_ISSUE_RENDER_BATCH).toBe(100);
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const shipmentTemplate = snapshot.shipments[0];
    snapshot.shipments = Array.from({ length: 55 }, (_, index) => ({
      ...shipmentTemplate,
      shipmentId: `FBA19BATCH${String(index).padStart(4, "0")}`,
      itemCount: index === 0 ? 150 : 0,
    }));
    const itemTemplate = snapshot.items[0];
    snapshot.items = Array.from({ length: 150 }, (_, index) => ({
      ...itemTemplate,
      shipmentId: snapshot.shipments[0].shipmentId,
      sellerSku: `BATCH-SKU-${String(index).padStart(4, "0")}`,
    }));
    const issueTemplate = snapshot.issueReport.product[0];
    snapshot.issueReport.product = Array.from({ length: 125 }, (_, index) => ({
      ...issueTemplate,
      problemType: `Problem ${String(index).padStart(4, "0")}`,
    }));
    snapshot.coverage.state = "partial";
    snapshot.coverage.issues = Array.from({ length: 125 }, (_, index) => ({
      stage: "items" as const,
      shipmentId: snapshot.shipments[index % snapshot.shipments.length].shipmentId,
      code: `PARTIAL_${index}`,
      message: `Coverage issue ${String(index).padStart(4, "0")}`,
      requestId: null,
      completedItemPages: 0,
    }));
    snapshot.summary.shipmentCount = 55;
    snapshot.summary.itemCount = 150;
    const markup = renderToStaticMarkup(
      <InboundShipmentsPanel
        marketplaceId={US_MARKETPLACE_ID}
        marketplaceShort="US"
        marketplaceTimeZone="America/Los_Angeles"
        cachedResult={{
          marketplaceId: US_MARKETPLACE_ID,
          dateRange: RANGE,
          job: null,
          snapshot,
          error: null,
        }}
      />,
    );
    expect(markup.match(/<details class="inbound-shipment"/gu)).toHaveLength(50);
    expect(markup.match(/<article class="inbound-issue-row"/gu)).toHaveLength(100);
    expect(markup).toContain("畫面 50 / 55 個符合貨件");
    expect(markup).toContain("顯示更多貨件（5）");
    expect(markup).toContain("畫面 100 / 125");
    expect(markup).toContain("顯示更多產品層級瑕疵（25）");
    expect(markup).toContain("查看未完成範圍（125）");
    expect(markup).not.toContain("Coverage issue 0000");
    expect(markup).not.toContain("BATCH-SKU-0000");
    expect(markup).toContain("Excel 含本次快照全部資料，不受畫面篩選");
  });

  it("adds explicit issue-report retry intent only for an unavailable terminal report", () => {
    expect(inboundShipmentStartBody({
      marketplaceId: US_MARKETPLACE_ID,
      dateRange: RANGE,
    })).toEqual({ marketplaceId: US_MARKETPLACE_ID, ...RANGE });
    expect(JSON.stringify(inboundShipmentStartBody({
      marketplaceId: US_MARKETPLACE_ID,
      dateRange: RANGE,
    }))).not.toContain("retryIssueReport");
    expect(inboundShipmentStartBody({
      marketplaceId: US_MARKETPLACE_ID,
      dateRange: RANGE,
      retryIssueReport: true,
    })).toEqual({ marketplaceId: US_MARKETPLACE_ID, ...RANGE, retryIssueReport: true });

    const rawSnapshot = inboundShipmentSnapshotFixture();
    const rawIssueReport = rawSnapshot.issueReport as Record<string, unknown>;
    rawIssueReport.state = "unavailable";
    rawIssueReport.fetchedAt = null;
    rawIssueReport.excludedShipmentCount = null;
    rawIssueReport.shipment = [];
    rawIssueReport.carton = [];
    rawIssueReport.product = [];
    const snapshot = parseInboundShipmentSnapshot(rawSnapshot, US_MARKETPLACE_ID);
    const job = parseInboundShipmentJob(
      inboundShipmentJobFixture({ state: "partial", snapshot: rawSnapshot }),
      US_MARKETPLACE_ID,
      RANGE,
    );
    const markup = renderToStaticMarkup(
      <InboundShipmentsPanel
        marketplaceId={US_MARKETPLACE_ID}
        marketplaceShort="US"
        marketplaceTimeZone="America/Los_Angeles"
        cachedResult={{
          marketplaceId: US_MARKETPLACE_ID,
          dateRange: RANGE,
          job,
          snapshot,
          error: null,
        }}
      />,
    );
    expect(markup).toContain(">重新嘗試每日瑕疵報表</button>");
    expect(markup).toContain("安全等待時間尚未到");
    expect(markup).toContain("一般同步與背景接回不會自動重試");
    expect(markup).toContain("每日瑕疵報表讀取時間：未取得");
  });

  it("keeps session observation in Dashboard and horizontal scrolling inside the table at 390px", async () => {
    const [dashboard, panel, css] = await Promise.all([
      readFile(new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/components/inbound-shipments-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/app.css", import.meta.url), "utf8"),
    ]);
    expect(dashboard).toContain('inbound: { label: "入庫貨件", symbol: "⇣", group: "reports" }');
    expect(dashboard).toContain('tools: ["inbound"]');
    expect(dashboard).toContain("backgroundInboundShipmentJobId");
    expect(dashboard).toContain("pollInboundShipmentJob({");
    expect(dashboard).toContain('openTool === "inbound"');
    expect(dashboard).toContain("latestInboundShipmentKey");
    expect(dashboard).toContain("replaceInboundShipmentCacheForMarketplace");
    expect(dashboard).not.toContain('className="inbound-home-card"');
    expect(dashboard).not.toContain("需要重新接回");
    expect(panel).toContain("items.push(item)");
    expect(panel).not.toContain("grouped.set(item.shipmentId, [...items, item])");
    expect(css).toMatch(/\.inbound-item-table-scroll\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/u);
    expect(css).toMatch(/@media \(max-width: 430px\)[\s\S]*?\.inbound-shipments-drawer\s*\{[\s\S]*?padding-inline:\s*13px;/u);
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*?\.inbound-shipments-drawer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/u);
  });

  it("retains only the latest inbound range per marketplace", () => {
    const cache = (
      marketplaceId: string,
      startDate: string,
      endDate: string,
    ): InboundShipmentCache => ({
      marketplaceId,
      dateRange: { startDate, endDate },
      job: null,
      snapshot: null,
      error: null,
    });
    let current: Record<string, InboundShipmentCache> = {};
    current = replaceInboundShipmentCacheForMarketplace(
      current,
      cache(US_MARKETPLACE_ID, "2026-01-01", "2026-01-30"),
    );
    current = replaceInboundShipmentCacheForMarketplace(
      current,
      cache("A1VC38T7YXB528", "2026-01-01", "2026-01-30"),
    );
    current = replaceInboundShipmentCacheForMarketplace(
      current,
      cache(US_MARKETPLACE_ID, "2026-02-01", "2026-02-28"),
    );

    expect(Object.values(current)).toHaveLength(2);
    expect(Object.values(current).filter(
      ({ marketplaceId }) => marketplaceId === US_MARKETPLACE_ID,
    )).toEqual([expect.objectContaining({
      dateRange: { startDate: "2026-02-01", endDate: "2026-02-28" },
    })]);
    expect(Object.values(current).some(
      ({ marketplaceId }) => marketplaceId === "A1VC38T7YXB528",
    )).toBe(true);
  });
});
