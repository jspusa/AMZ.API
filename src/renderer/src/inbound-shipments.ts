export type InboundUnitTotals = {
  expectedUnits: number;
  receivedUnits: number;
  pendingUnits: number;
  overReceivedUnits: number;
};

export type InboundShipmentCoverageIssue = {
  stage: "shipments" | "items";
  shipmentId: string | null;
  code: string;
  message: string;
  requestId: string | null;
  completedItemPages: number;
};

export type InboundShipmentCoverage = {
  state: "complete" | "partial";
  shipmentsWithCompleteItems: number;
  shipmentsWithPartialItems: number;
  incompleteShipmentCount: number;
  issues: InboundShipmentCoverageIssue[];
};

export type InboundShipmentView = {
  shipmentId: string;
  shipmentName: string | null;
  status: string | null;
  destinationFulfillmentCenterId: string | null;
  labelPrepType: string | null;
  boxContentsSource: string | null;
  itemCoverage: "complete" | "partial";
  itemCount: number;
  totals: InboundUnitTotals | null;
  verifiedTotals: InboundUnitTotals;
};

export type InboundShipmentItemView = InboundUnitTotals & {
  shipmentId: string;
  sellerSku: string;
  fulfillmentNetworkSku: string | null;
  asin: string | null;
  title: string | null;
  quantityInCase: number | null;
};

export type InboundShipmentIssueLevel = "shipment" | "carton" | "product";

export type InboundShipmentReportIssue = {
  level: InboundShipmentIssueLevel;
  shipmentId: string;
  sellerSku: string | null;
  fnsku: string | null;
  asin: string | null;
  productName: string | null;
  cartonId: string | null;
  problemType: string;
  problemQuantity: number | null;
  expectedUnits: number | null;
  receivedUnits: number | null;
  reportedAt: string | null;
  alertStatus: string | null;
  notice: string;
};

export type InboundShipmentIssueReport = {
  state: "completed" | "partial" | "unavailable";
  fetchedAt: string | null;
  dataThrough: null;
  excludedShipmentCount: number | null;
  notice: string;
  shipment: InboundShipmentReportIssue[];
  carton: InboundShipmentReportIssue[];
  product: InboundShipmentReportIssue[];
};

export type InboundShipmentSnapshot = {
  schemaVersion: 1;
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  dateRange: {
    startDate: string;
    endDate: string;
    lastUpdatedAfter: string;
    lastUpdatedBefore: string;
  };
  coverage: InboundShipmentCoverage;
  summary: {
    shipmentCount: number;
    itemCount: number;
    incompleteShipmentCount: number;
    totals: InboundUnitTotals | null;
    verifiedTotals: InboundUnitTotals;
  };
  shipments: InboundShipmentView[];
  items: InboundShipmentItemView[];
  issueReport: InboundShipmentIssueReport;
  notice: string;
};

export type InboundShipmentJob = {
  jobId: string;
  marketplaceId: string;
  dateRange: InboundShipmentDateRange;
  state: "running" | "completed" | "partial" | "failed";
  progress: {
    phase: "shipments" | "items" | "issues";
    completed: number;
    total: number | null;
  };
  snapshot: InboundShipmentSnapshot | null;
  notice: string;
  failure: {
    code: string;
    requestId: string | null;
  } | null;
};

export function inboundShipmentFailureMessage(job: InboundShipmentJob): string {
  if (!job.failure) return job.notice;
  return `${job.notice}（診斷代碼：${job.failure.code}${
    job.failure.requestId ? `；Amazon Request ID：${job.failure.requestId}` : ""
  }）`;
}

export type InboundShipmentCache = {
  marketplaceId: string;
  dateRange: InboundShipmentDateRange;
  job: InboundShipmentJob | null;
  snapshot: InboundShipmentSnapshot | null;
  error: string | null;
};

export function inboundShipmentCacheKey(
  marketplaceId: string,
  dateRange: InboundShipmentDateRange,
): string {
  return `${marketplaceId}:${dateRange.startDate}:${dateRange.endDate}`;
}

export function replaceInboundShipmentCacheForMarketplace(
  current: Readonly<Record<string, InboundShipmentCache>>,
  cache: InboundShipmentCache,
): Record<string, InboundShipmentCache> {
  const next: Record<string, InboundShipmentCache> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value.marketplaceId !== cache.marketplaceId) next[key] = value;
  }
  next[inboundShipmentCacheKey(cache.marketplaceId, cache.dateRange)] = cache;
  return next;
}

export type InboundShipmentStatusFilter =
  | "all"
  | "receiving"
  | "completed"
  | "cancelled"
  | "unknown";

export type InboundShipmentDateRange = {
  startDate: string;
  endDate: string;
};

export function inboundShipmentStartBody(input: {
  marketplaceId: string;
  dateRange: InboundShipmentDateRange;
  retryIssueReport?: boolean;
}): {
  marketplaceId: string;
  startDate: string;
  endDate: string;
  retryIssueReport?: true;
} {
  const marketplaceId = identifier(input.marketplaceId, "FBA 入庫貨件站點", 40);
  const dateRange = validateInboundShipmentDateRange(input.dateRange);
  const body = { marketplaceId, ...dateRange };
  return input.retryIssueReport
    ? { ...body, retryIssueReport: true }
    : body;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}格式無效。`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  maximum = 5_000,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    (!allowEmpty && !value) ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    throw new Error(`${label}無效。`);
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  maximum = 5_000,
): string | null {
  return value === null ? null : text(value, label, maximum);
}

function identifier(value: unknown, label: string, maximum = 200): string {
  const result = text(value, label, maximum);
  if (!/^[A-Za-z0-9._-]+$/u.test(result)) throw new Error(`${label}無效。`);
  return result;
}

function nullableIdentifier(
  value: unknown,
  label: string,
  maximum = 200,
): string | null {
  return value === null ? null : identifier(value, label, maximum);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}無效。`);
  }
  return value;
}

function nullableNonNegativeInteger(value: unknown, label: string): number | null {
  return value === null ? null : nonNegativeInteger(value, label);
}

function dateKey(value: unknown, label: string): string {
  const result = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) throw new Error(`${label}無效。`);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new Error(`${label}無效。`);
  }
  return result;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label}無效。`);
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function totals(
  value: unknown,
  label: string,
  requireSingleRowDifference = false,
): InboundUnitTotals {
  const raw = record(value, label);
  const parsed = {
    expectedUnits: nonNegativeInteger(raw.expectedUnits, `${label}預期單位數量`),
    receivedUnits: nonNegativeInteger(raw.receivedUnits, `${label}Amazon 已接收數量`),
    pendingUnits: nonNegativeInteger(raw.pendingUnits, `${label}尚未接收數量`),
    overReceivedUnits: nonNegativeInteger(
      raw.overReceivedUnits,
      `${label}多接收數量`,
    ),
  };
  const difference = parsed.expectedUnits - parsed.receivedUnits;
  if (
    requireSingleRowDifference &&
    parsed.pendingUnits !== Math.max(difference, 0) ||
    requireSingleRowDifference &&
      parsed.overReceivedUnits !== Math.max(-difference, 0)
  ) {
    throw new Error(`${label}差異與原始預期／接收數量不一致。`);
  }
  return parsed;
}

function nullableTotals(value: unknown, label: string): InboundUnitTotals | null {
  return value === null ? null : totals(value, label);
}

function totalsEqual(left: InboundUnitTotals, right: InboundUnitTotals): boolean {
  return (
    left.expectedUnits === right.expectedUnits &&
    left.receivedUnits === right.receivedUnits &&
    left.pendingUnits === right.pendingUnits &&
    left.overReceivedUnits === right.overReceivedUnits
  );
}

function addTotals(
  values: readonly InboundUnitTotals[],
): InboundUnitTotals {
  return values.reduce<InboundUnitTotals>(
    (sum, value) => ({
      expectedUnits: sum.expectedUnits + value.expectedUnits,
      receivedUnits: sum.receivedUnits + value.receivedUnits,
      pendingUnits: sum.pendingUnits + value.pendingUnits,
      overReceivedUnits: sum.overReceivedUnits + value.overReceivedUnits,
    }),
    { expectedUnits: 0, receivedUnits: 0, pendingUnits: 0, overReceivedUnits: 0 },
  );
}

function coverageIssue(value: unknown): InboundShipmentCoverageIssue {
  const raw = record(value, "貨件讀取未完成項目");
  if (raw.stage !== "shipments" && raw.stage !== "items") {
    throw new Error("貨件讀取未完成階段無效。");
  }
  return {
    stage: raw.stage,
    shipmentId: nullableIdentifier(raw.shipmentId, "未完成貨件 ID"),
    code: identifier(raw.code, "未完成代碼", 100),
    message: text(raw.message, "未完成說明", 2_000),
    requestId: nullableIdentifier(raw.requestId, "Amazon Request ID", 200),
    completedItemPages: nonNegativeInteger(raw.completedItemPages, "已完成商品頁數"),
  };
}

function reportIssue(
  value: unknown,
  expectedLevel: InboundShipmentIssueLevel,
): InboundShipmentReportIssue {
  const raw = record(value, "入庫瑕疵列");
  if (raw.level !== expectedLevel) throw new Error("入庫瑕疵層級不一致。");
  return {
    level: expectedLevel,
    shipmentId: identifier(raw.shipmentId, "瑕疵貨件 ID"),
    sellerSku: raw.sellerSku === null ? null : text(raw.sellerSku, "瑕疵 Seller SKU", 100),
    fnsku: nullableIdentifier(raw.fnsku, "瑕疵 FNSKU", 100),
    asin: nullableIdentifier(raw.asin, "瑕疵 ASIN", 20),
    productName: nullableText(raw.productName, "瑕疵商品名稱", 5_000),
    cartonId: nullableIdentifier(raw.cartonId, "瑕疵包裝箱 ID", 200),
    problemType: text(raw.problemType, "瑕疵類型", 300),
    problemQuantity: nullableNonNegativeInteger(raw.problemQuantity, "瑕疵數量"),
    expectedUnits: nullableNonNegativeInteger(raw.expectedUnits, "瑕疵預期數量"),
    receivedUnits: nullableNonNegativeInteger(raw.receivedUnits, "瑕疵接收數量"),
    reportedAt: nullableTimestamp(raw.reportedAt, "瑕疵回報時間"),
    alertStatus: nullableText(raw.alertStatus, "瑕疵警示狀態", 200),
    notice: text(raw.notice, "瑕疵說明", 2_000, true),
  };
}

function issueReport(value: unknown): InboundShipmentIssueReport {
  const raw = record(value, "入庫每日瑕疵報表");
  if (
    raw.state !== "completed" &&
    raw.state !== "partial" &&
    raw.state !== "unavailable"
  ) {
    throw new Error("入庫每日瑕疵報表狀態無效。");
  }
  if (!Array.isArray(raw.shipment) || !Array.isArray(raw.carton) || !Array.isArray(raw.product)) {
    throw new Error("入庫每日瑕疵報表層級資料缺失。");
  }
  if (raw.shipment.length + raw.carton.length + raw.product.length > 250_000) {
    throw new Error("入庫每日瑕疵報表列數超出安全範圍。");
  }
  if (raw.dataThrough !== null) {
    throw new Error("入庫每日瑕疵報表不可冒充已證明的即時資料截止日。");
  }
  const fetchedAt = nullableTimestamp(raw.fetchedAt, "瑕疵報表讀取時間");
  const excludedShipmentCount = nullableNonNegativeInteger(
    raw.excludedShipmentCount,
    "範圍外瑕疵貨件數",
  );
  const issueCount = raw.shipment.length + raw.carton.length + raw.product.length;
  if (
    (raw.state === "unavailable" &&
      (fetchedAt !== null || excludedShipmentCount !== null || issueCount !== 0)) ||
    (raw.state !== "unavailable" &&
      (fetchedAt === null || excludedShipmentCount === null))
  ) {
    throw new Error("入庫每日瑕疵報表狀態、讀取時間或範圍資料不一致。");
  }
  return {
    state: raw.state,
    fetchedAt,
    dataThrough: null,
    excludedShipmentCount,
    notice: text(raw.notice, "瑕疵報表說明", 3_000),
    shipment: raw.shipment.map((item) => reportIssue(item, "shipment")),
    carton: raw.carton.map((item) => reportIssue(item, "carton")),
    product: raw.product.map((item) => reportIssue(item, "product")),
  };
}

export function parseInboundShipmentSnapshot(
  value: unknown,
  expectedMarketplaceId: string,
): InboundShipmentSnapshot {
  const raw = record(value, "FBA 入庫貨件快照");
  if (Object.hasOwn(raw, "accountScope")) {
    throw new Error("FBA 入庫貨件快照含有不應送到前台的帳號範圍。");
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.marketplaceId !== expectedMarketplaceId ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    !Array.isArray(raw.shipments) ||
    !Array.isArray(raw.items) ||
    raw.shipments.length > 10_000 ||
    raw.items.length > 250_000
  ) {
    throw new Error("FBA 入庫貨件快照版本、站點或範圍無效。");
  }
  const parsedDateRange = record(raw.dateRange, "貨件日期範圍");
  const startDate = dateKey(parsedDateRange.startDate, "貨件開始日期");
  const endDate = dateKey(parsedDateRange.endDate, "貨件結束日期");
  if (startDate > endDate) throw new Error("貨件日期範圍前後顛倒。");

  const parsedCoverage = record(raw.coverage, "貨件明細覆蓋");
  if (parsedCoverage.state !== "complete" && parsedCoverage.state !== "partial") {
    throw new Error("貨件明細覆蓋狀態無效。");
  }
  if (
    !Array.isArray(parsedCoverage.issues) ||
    parsedCoverage.issues.length > 10_000
  ) {
    throw new Error("貨件未完成範圍無效或超出安全列數。");
  }
  const coverage: InboundShipmentCoverage = {
    state: parsedCoverage.state,
    shipmentsWithCompleteItems: nonNegativeInteger(
      parsedCoverage.shipmentsWithCompleteItems,
      "完整貨件數",
    ),
    shipmentsWithPartialItems: nonNegativeInteger(
      parsedCoverage.shipmentsWithPartialItems,
      "部分貨件數",
    ),
    incompleteShipmentCount: nonNegativeInteger(
      parsedCoverage.incompleteShipmentCount,
      "未完成貨件數",
    ),
    issues: parsedCoverage.issues.map(coverageIssue),
  };

  const shipmentIds = new Set<string>();
  const shipments: InboundShipmentView[] = raw.shipments.map((value) => {
    const row = record(value, "FBA 入庫貨件列");
    const shipmentId = identifier(row.shipmentId, "FBA 貨件 ID");
    if (shipmentIds.has(shipmentId)) throw new Error("FBA 貨件 ID 重複。");
    shipmentIds.add(shipmentId);
    if (row.itemCoverage !== "complete" && row.itemCoverage !== "partial") {
      throw new Error("FBA 貨件商品覆蓋狀態無效。");
    }
    const verifiedTotals = totals(row.verifiedTotals, "FBA 貨件已核對合計");
    const completeTotals = nullableTotals(row.totals, "FBA 貨件完整合計");
    if (
      (row.itemCoverage === "complete" && completeTotals === null) ||
      (row.itemCoverage === "partial" && completeTotals !== null) ||
      (completeTotals !== null && !totalsEqual(completeTotals, verifiedTotals))
    ) {
      throw new Error("FBA 貨件覆蓋與合計狀態不一致。");
    }
    return {
      shipmentId,
      shipmentName: nullableText(row.shipmentName, "FBA 貨件名稱", 500),
      status: row.status === null ? null : identifier(row.status, "FBA 貨件狀態", 80),
      destinationFulfillmentCenterId: nullableIdentifier(
        row.destinationFulfillmentCenterId,
        "目的地 FC",
        100,
      ),
      labelPrepType: nullableIdentifier(row.labelPrepType, "標籤準備類型", 100),
      boxContentsSource: nullableIdentifier(row.boxContentsSource, "箱內物來源", 100),
      itemCoverage: row.itemCoverage,
      itemCount: nonNegativeInteger(row.itemCount, "FBA 貨件商品列數"),
      totals: completeTotals,
      verifiedTotals,
    };
  });

  const itemKeys = new Set<string>();
  if (
    coverage.issues.some(
      (issue) => issue.shipmentId !== null && !shipmentIds.has(issue.shipmentId),
    )
  ) {
    throw new Error("貨件讀取未完成項目指向本次快照範圍外的貨件。");
  }
  const items: InboundShipmentItemView[] = raw.items.map((value) => {
    const row = record(value, "FBA 入庫貨件商品列");
    const shipmentId = identifier(row.shipmentId, "商品貨件 ID");
    if (!shipmentIds.has(shipmentId)) throw new Error("商品列指向未知貨件。");
    const sellerSku = text(row.sellerSku, "Seller SKU", 100);
    const fulfillmentNetworkSku = nullableIdentifier(
      row.fulfillmentNetworkSku,
      "FNSKU",
      100,
    );
    const key = `${shipmentId}\u0000${sellerSku}\u0000${fulfillmentNetworkSku ?? ""}`;
    if (itemKeys.has(key)) throw new Error("同一貨件的 SKU／FNSKU 商品列重複。");
    itemKeys.add(key);
    const parsedTotals = totals(row, "FBA 貨件商品列", true);
    return {
      shipmentId,
      sellerSku,
      fulfillmentNetworkSku,
      asin: nullableIdentifier(row.asin, "商品 ASIN", 20),
      title: nullableText(row.title, "商品名稱", 5_000),
      quantityInCase: nullableNonNegativeInteger(row.quantityInCase, "每箱數量"),
      ...parsedTotals,
    };
  });

  const itemSummaryByShipment = new Map<
    string,
    { count: number; totals: InboundUnitTotals }
  >();
  for (const item of items) {
    const current = itemSummaryByShipment.get(item.shipmentId) ?? {
      count: 0,
      totals: { expectedUnits: 0, receivedUnits: 0, pendingUnits: 0, overReceivedUnits: 0 },
    };
    current.count += 1;
    current.totals.expectedUnits += item.expectedUnits;
    current.totals.receivedUnits += item.receivedUnits;
    current.totals.pendingUnits += item.pendingUnits;
    current.totals.overReceivedUnits += item.overReceivedUnits;
    itemSummaryByShipment.set(item.shipmentId, current);
  }
  for (const shipment of shipments) {
    const itemSummary = itemSummaryByShipment.get(shipment.shipmentId) ?? {
      count: 0,
      totals: { expectedUnits: 0, receivedUnits: 0, pendingUnits: 0, overReceivedUnits: 0 },
    };
    if (
      shipment.itemCount !== itemSummary.count ||
      !totalsEqual(itemSummary.totals, shipment.verifiedTotals)
    ) {
      throw new Error("FBA 貨件商品列與貨件合計不一致。");
    }
  }

  const parsedSummary = record(raw.summary, "FBA 入庫貨件摘要");
  const summary = {
    shipmentCount: nonNegativeInteger(parsedSummary.shipmentCount, "貨件數"),
    itemCount: nonNegativeInteger(parsedSummary.itemCount, "商品列數"),
    incompleteShipmentCount: nonNegativeInteger(
      parsedSummary.incompleteShipmentCount,
      "未完成貨件數",
    ),
    totals: nullableTotals(parsedSummary.totals, "貨件完整總計"),
    verifiedTotals: totals(parsedSummary.verifiedTotals, "貨件已核對總計"),
  };
  const calculatedVerifiedTotals = addTotals(shipments.map((shipment) => shipment.verifiedTotals));
  const actualCompleteShipmentCount = shipments.filter(
    (shipment) => shipment.itemCoverage === "complete",
  ).length;
  const actualPartialShipmentCount = shipments.length - actualCompleteShipmentCount;
  const actualPartialShipmentIds = new Set(
    shipments
      .filter((shipment) => shipment.itemCoverage === "partial")
      .map((shipment) => shipment.shipmentId),
  );
  const coverageIssueShipmentIds = coverage.issues.map((issue) => issue.shipmentId);
  const uniqueCoverageIssueShipmentIds = new Set(coverageIssueShipmentIds);
  if (
    summary.shipmentCount !== shipments.length ||
    summary.itemCount !== items.length ||
    summary.incompleteShipmentCount !== coverage.incompleteShipmentCount ||
    coverage.shipmentsWithCompleteItems + coverage.shipmentsWithPartialItems !== shipments.length ||
    coverage.incompleteShipmentCount !== coverage.shipmentsWithPartialItems ||
    coverage.shipmentsWithCompleteItems !== actualCompleteShipmentCount ||
    coverage.shipmentsWithPartialItems !== actualPartialShipmentCount ||
    coverageIssueShipmentIds.some((shipmentId) => shipmentId === null) ||
    uniqueCoverageIssueShipmentIds.size !== coverageIssueShipmentIds.length ||
    uniqueCoverageIssueShipmentIds.size !== actualPartialShipmentIds.size ||
    [...actualPartialShipmentIds].some(
      (shipmentId) => !uniqueCoverageIssueShipmentIds.has(shipmentId),
    ) ||
    (coverage.state === "complete" && coverage.incompleteShipmentCount !== 0) ||
    (coverage.state === "partial" && coverage.incompleteShipmentCount === 0) ||
    (coverage.state === "complete" && coverage.issues.length !== 0) ||
    !totalsEqual(summary.verifiedTotals, calculatedVerifiedTotals) ||
    (coverage.state === "complete" && summary.totals === null) ||
    (coverage.state === "partial" && summary.totals !== null) ||
    (summary.totals !== null && !totalsEqual(summary.totals, summary.verifiedTotals))
  ) {
    throw new Error("FBA 入庫貨件摘要、覆蓋或商品合計不一致。");
  }

  const parsedIssueReport = issueReport(raw.issueReport);
  const reportIssues = [
    ...parsedIssueReport.shipment,
    ...parsedIssueReport.carton,
    ...parsedIssueReport.product,
  ];
  if (reportIssues.some((issue) => !shipmentIds.has(issue.shipmentId))) {
    throw new Error("入庫每日瑕疵報表含有本次快照範圍外的貨件。");
  }

  return {
    schemaVersion: 1,
    mode: raw.mode,
    marketplaceId: expectedMarketplaceId,
    fetchedAt: timestamp(raw.fetchedAt, "貨件快照時間"),
    dateRange: {
      startDate,
      endDate,
      lastUpdatedAfter: timestamp(
        parsedDateRange.lastUpdatedAfter,
        "Amazon 最後更新開始時間",
      ),
      lastUpdatedBefore: timestamp(
        parsedDateRange.lastUpdatedBefore,
        "Amazon 最後更新結束時間",
      ),
    },
    coverage,
    summary,
    shipments,
    items,
    issueReport: parsedIssueReport,
    notice: text(raw.notice, "貨件快照說明", 3_000),
  };
}

export function parseInboundShipmentJob(
  value: unknown,
  expectedMarketplaceId: string,
  expectedDateRange: InboundShipmentDateRange,
): InboundShipmentJob {
  const raw = record(value, "FBA 入庫貨件工作");
  if (Object.hasOwn(raw, "accountScope")) {
    throw new Error("FBA 入庫貨件工作含有不應送到前台的帳號範圍。");
  }
  if (
    raw.marketplaceId !== expectedMarketplaceId ||
    (raw.state !== "running" &&
      raw.state !== "completed" &&
      raw.state !== "partial" &&
      raw.state !== "failed")
  ) {
    throw new Error("FBA 入庫貨件工作站點或狀態無效。");
  }
  const progress = record(raw.progress, "FBA 入庫貨件進度");
  const rawDateRange = record(raw.dateRange, "FBA 入庫貨件工作日期範圍");
  const dateRange = {
    startDate: dateKey(rawDateRange.startDate, "工作開始日期"),
    endDate: dateKey(rawDateRange.endDate, "工作結束日期"),
  };
  if (
    dateRange.startDate !== expectedDateRange.startDate ||
    dateRange.endDate !== expectedDateRange.endDate
  ) {
    throw new Error("FBA 入庫貨件工作日期範圍已改變。" );
  }
  if (
    progress.phase !== "shipments" &&
    progress.phase !== "items" &&
    progress.phase !== "issues"
  ) {
    throw new Error("FBA 入庫貨件進度階段無效。");
  }
  const completed = nonNegativeInteger(progress.completed, "已完成進度");
  const total = nullableNonNegativeInteger(progress.total, "總進度");
  if (total !== null && completed > total) throw new Error("FBA 入庫貨件進度超出總數。");
  const snapshot = raw.snapshot === null
    ? null
    : parseInboundShipmentSnapshot(raw.snapshot, expectedMarketplaceId);
  const snapshotIsComplete =
    snapshot?.coverage.state === "complete" &&
    snapshot.issueReport.state === "completed";
  if (
    (raw.state === "running" && snapshot !== null) ||
    ((raw.state === "completed" || raw.state === "partial") && snapshot === null) ||
    (raw.state === "failed" && snapshot !== null) ||
    (raw.state === "completed" && !snapshotIsComplete) ||
    (raw.state === "partial" && snapshotIsComplete) ||
    (snapshot !== null &&
      (snapshot.dateRange.startDate !== dateRange.startDate ||
        snapshot.dateRange.endDate !== dateRange.endDate))
  ) {
    throw new Error("FBA 入庫貨件工作狀態與快照不一致。");
  }
  const failure = raw.failure === undefined || raw.failure === null
    ? null
    : (() => {
        const parsed = record(raw.failure, "FBA 入庫貨件診斷資訊");
        return {
          code: identifier(parsed.code, "FBA 入庫貨件診斷代碼", 128),
          requestId: nullableIdentifier(
            parsed.requestId,
            "Amazon Request ID",
            200,
          ),
        };
      })();
  if (raw.state !== "failed" && failure !== null) {
    throw new Error("FBA 入庫貨件工作狀態與診斷資訊不一致。");
  }
  return {
    jobId: identifier(raw.jobId, "FBA 入庫貨件工作 ID", 200),
    marketplaceId: expectedMarketplaceId,
    dateRange,
    state: raw.state,
    progress: { phase: progress.phase, completed, total },
    snapshot,
    notice: text(raw.notice, "FBA 入庫貨件工作說明", 3_000),
    failure,
  };
}

const INBOUND_POLL_INTERVAL_MS = 900;
const INBOUND_MAX_TRANSIENT_DELAY_MS = 30_000;

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class InboundShipmentPollingError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "InboundShipmentPollingError";
    this.status = status;
  }
}

export async function pollInboundShipmentJob(input: {
  marketplaceId: string;
  dateRange: InboundShipmentDateRange;
  initialJob: InboundShipmentJob;
  signal: AbortSignal;
  request: (url: string, signal: AbortSignal) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  onJob?: (job: InboundShipmentJob) => void;
}): Promise<InboundShipmentJob> {
  let current = input.initialJob;
  if (
    current.marketplaceId !== input.marketplaceId ||
    current.dateRange.startDate !== input.dateRange.startDate ||
    current.dateRange.endDate !== input.dateRange.endDate
  ) {
    throw new Error("FBA 入庫貨件背景工作與目前站點或日期不一致。" );
  }
  let transientFailures = 0;
  while (current.state === "running") {
    await abortableDelay(INBOUND_POLL_INTERVAL_MS, input.signal);
    const params = new URLSearchParams({
      marketplaceId: input.marketplaceId,
      jobId: current.jobId,
      startDate: input.dateRange.startDate,
      endDate: input.dateRange.endDate,
    });
    let response: Awaited<ReturnType<typeof input.request>>;
    try {
      response = await input.request(
        `/api/sp-api/inbound-shipments?${params}`,
        input.signal,
      );
    } catch (error) {
      if (input.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw abortError();
      }
      transientFailures += 1;
      await abortableDelay(
        Math.min(
          INBOUND_MAX_TRANSIENT_DELAY_MS,
          INBOUND_POLL_INTERVAL_MS * (2 ** Math.min(transientFailures - 1, 6)),
        ),
        input.signal,
      );
      continue;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        transientFailures += 1;
        await abortableDelay(
          Math.min(
            INBOUND_MAX_TRANSIENT_DELAY_MS,
            INBOUND_POLL_INTERVAL_MS * (2 ** Math.min(transientFailures - 1, 6)),
          ),
          input.signal,
        );
        continue;
      }
      throw new Error("FBA 入庫貨件背景回應不是可驗證的 JSON。" );
    }
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      transientFailures += 1;
      await abortableDelay(
        Math.min(
          INBOUND_MAX_TRANSIENT_DELAY_MS,
          INBOUND_POLL_INTERVAL_MS * (2 ** Math.min(transientFailures - 1, 6)),
        ),
        input.signal,
      );
      continue;
    }
    if (!response.ok) {
      const raw = record(payload, "FBA 入庫貨件錯誤");
      throw new InboundShipmentPollingError(
        response.status,
        typeof raw.message === "string" && raw.message.trim()
          ? raw.message
          : "FBA 入庫貨件背景工作已停止。",
      );
    }
    transientFailures = 0;
    const next = parseInboundShipmentJob(
      payload,
      input.marketplaceId,
      input.dateRange,
    );
    if (next.jobId !== current.jobId) {
      throw new Error("FBA 入庫貨件背景工作識別已改變。" );
    }
    current = next;
    input.onJob?.(next);
  }
  return current;
}

export function defaultInboundShipmentDateRange(input: {
  timeZone: string;
  now?: Date;
  days?: number;
}): InboundShipmentDateRange {
  const now = input.now ?? new Date();
  const days = input.days ?? 90;
  if (!Number.isSafeInteger(days) || days < 1 || days > 180) {
    throw new Error("貨件日期快捷範圍必須介於 1 到 180 天。" );
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: input.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    throw new Error("Amazon 站點時區無效，已停止建立貨件日期範圍。" );
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const endDate = `${part("year")}-${part("month")}-${part("day")}`;
  dateKey(endDate, "Amazon 站點今天日期");
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  };
}

export function validateInboundShipmentDateRange(
  range: InboundShipmentDateRange,
): InboundShipmentDateRange {
  const startDate = dateKey(range.startDate, "貨件開始日期");
  const endDate = dateKey(range.endDate, "貨件結束日期");
  if (startDate > endDate) throw new Error("貨件開始日期不可晚於結束日期。" );
  const days = Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1;
  if (days > 180) throw new Error("單次最多同步 180 天；請縮小日期範圍。" );
  return { startDate, endDate };
}

export function inboundShipmentStatusLabel(status: string | null): string {
  if (status === null) return "Amazon 未提供";
  const labels: Readonly<Record<string, string>> = {
    WORKING: "規劃中",
    READY_TO_SHIP: "準備出貨",
    SHIPPED: "已出貨",
    IN_TRANSIT: "運送中",
    DELIVERED: "已送達",
    CHECKED_IN: "已報到",
    RECEIVING: "接收中",
    CLOSED: "已關閉",
    CANCELLED: "已取消",
    DELETED: "已刪除",
    ERROR: "Amazon 狀態異常",
  };
  return labels[status] ?? status;
}

export function inboundShipmentStatusGroup(
  status: string | null,
): Exclude<InboundShipmentStatusFilter, "all"> {
  if (status === null) return "unknown";
  if (status === "CLOSED") return "completed";
  if (status === "CANCELLED" || status === "DELETED") return "cancelled";
  return "receiving";
}

export function inboundShipmentDifferenceCopy(input: {
  totals: InboundUnitTotals;
  status: string | null;
  complete: boolean;
}): { tone: "neutral" | "attention" | "over" | "matched"; label: string } {
  const prefix = input.complete ? "" : "已核對範圍：";
  if (input.totals.pendingUnits === 0 && input.totals.overReceivedUnits === 0) {
    if (!input.complete) {
      return {
        tone: "neutral",
        label: "已核對範圍數量一致；未完成明細的差異未知",
      };
    }
    return { tone: "matched", label: `${prefix}數量一致` };
  }
  if (input.status === null) {
    const difference = [
      input.totals.pendingUnits > 0
        ? `尚有 ${input.totals.pendingUnits.toLocaleString("zh-TW")} 單位差異`
        : "",
      input.totals.overReceivedUnits > 0
        ? `多接收 ${input.totals.overReceivedUnits.toLocaleString("zh-TW")} 單位`
        : "",
    ].filter(Boolean).join("；");
    return {
      tone: "neutral",
      label: `${prefix}Amazon 未提供貨件狀態；${difference}，暫不判定原因`,
    };
  }
  if (input.status === "CLOSED") {
    const difference = [
      input.totals.pendingUnits > 0
        ? `尚有 ${input.totals.pendingUnits.toLocaleString("zh-TW")} 單位未對上`
        : "",
      input.totals.overReceivedUnits > 0
        ? `多接收 ${input.totals.overReceivedUnits.toLocaleString("zh-TW")} 單位`
        : "",
    ].filter(Boolean).join("；");
    return {
      tone: input.totals.pendingUnits > 0 ? "attention" : "over",
      label: `${prefix}貨件已關閉，${difference}；建議到 Seller Central 核對`,
    };
  }
  if (input.totals.pendingUnits > 0) {
    return {
      tone: "neutral",
      label: `${prefix}尚在接收 ${input.totals.pendingUnits.toLocaleString("zh-TW")} 單位／暫時差異${input.totals.overReceivedUnits > 0 ? `；另有 ${input.totals.overReceivedUnits.toLocaleString("zh-TW")} 單位暫時多接收` : ""}`,
    };
  }
  return {
    tone: "over",
    label: `${prefix}暫時多接收 ${input.totals.overReceivedUnits.toLocaleString("zh-TW")} 單位`,
  };
}

export function filterInboundShipments(input: {
  snapshot: InboundShipmentSnapshot;
  status: InboundShipmentStatusFilter;
  search: string;
  differencesOnly: boolean;
}): InboundShipmentView[] {
  const search = input.search.trim().toLocaleLowerCase("en-US");
  const itemsByShipment = new Map<string, InboundShipmentItemView[]>();
  for (const item of input.snapshot.items) {
    const items = itemsByShipment.get(item.shipmentId) ?? [];
    items.push(item);
    itemsByShipment.set(item.shipmentId, items);
  }
  return input.snapshot.shipments.filter((shipment) => {
    if (
      input.status !== "all" &&
      inboundShipmentStatusGroup(shipment.status) !== input.status
    ) {
      return false;
    }
    const differenceTotals = shipment.totals ?? shipment.verifiedTotals;
    if (
      input.differencesOnly &&
      shipment.itemCoverage === "complete" &&
      differenceTotals.pendingUnits === 0 &&
      differenceTotals.overReceivedUnits === 0
    ) {
      return false;
    }
    if (!search) return true;
    return [
      shipment.shipmentId,
      shipment.shipmentName ?? "",
      shipment.destinationFulfillmentCenterId ?? "",
      ...(itemsByShipment.get(shipment.shipmentId) ?? []).flatMap((item) => [
        item.sellerSku,
        item.fulfillmentNetworkSku ?? "",
        item.asin ?? "",
        item.title ?? "",
      ]),
    ].some((value) => value.toLocaleLowerCase("en-US").includes(search));
  }).sort((left, right) => {
    const leftTotals = left.totals ?? left.verifiedTotals;
    const rightTotals = right.totals ?? right.verifiedTotals;
    const leftHasDifference = leftTotals.pendingUnits > 0 || leftTotals.overReceivedUnits > 0;
    const rightHasDifference = rightTotals.pendingUnits > 0 || rightTotals.overReceivedUnits > 0;
    if (leftHasDifference !== rightHasDifference) return leftHasDifference ? -1 : 1;
    return left.shipmentId.localeCompare(right.shipmentId, "en-US");
  });
}
