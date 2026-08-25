export type InboundNoncomplianceLevel = "shipment" | "carton" | "product";

export type InboundNoncomplianceIssue = Readonly<{
  level: InboundNoncomplianceLevel;
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
}>;

export type ParsedInboundNoncomplianceReport = Readonly<{
  issues: readonly InboundNoncomplianceIssue[];
  incompleteRowCount: number;
  incompleteRows: readonly Readonly<{ shipmentId: string | null }>[];
  latestIssueReportedDate: string | null;
}>;

export type InboundIssueReportSnapshot = Readonly<{
  state: "completed" | "partial" | "unavailable";
  fetchedAt: string | null;
  dataThrough: string | null;
  excludedShipmentCount: number | null;
  notice: string;
  shipment: readonly InboundNoncomplianceIssue[];
  carton: readonly InboundNoncomplianceIssue[];
  product: readonly InboundNoncomplianceIssue[];
}>;

export class InboundNoncomplianceFormatError extends Error {
  readonly code = "INBOUND_NONCOMPLIANCE_FORMAT_UNSUPPORTED";

  constructor(message: string) {
    super(message);
    this.name = "InboundNoncomplianceFormatError";
  }
}

export const DEMO_INBOUND_NONCOMPLIANCE_DOCUMENT = [
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
].join("\t");

const MAX_REPORT_CHARACTERS = 64 * 1024 * 1024;
const MAX_REPORT_ROWS = 250_000;
const MAX_REPORT_COLUMNS = 256;

const REQUIRED_HEADERS = [
  "issue-reported-date",
  "fba-shipment-id",
  "fba-carton-id",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "problem-type",
  "problem-quantity",
  "expected-quantity",
  "received-quantity",
  "problem-level",
  "alert-status",
] as const;

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let closedQuotedField = false;
  const source = text.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
        closedQuotedField = true;
      } else if (value.length === 0 && !closedQuotedField) {
        quoted = true;
      } else if (closedQuotedField) {
        throw new InboundNoncomplianceFormatError(
          "Amazon FBA 入庫瑕疵報表引用欄位結尾後仍有無法辨識的文字。",
        );
      } else {
        // Amazon product names may contain an ordinary inch mark inside an
        // otherwise unquoted TSV cell. Only a quote at the start of a cell
        // opens CSV-style quoting.
        value += '"';
      }
    } else if (character === "\t" && !quoted) {
      if (row.length >= MAX_REPORT_COLUMNS) {
        throw new InboundNoncomplianceFormatError(
          "Amazon FBA 入庫瑕疵報表欄位數超過安全上限。",
        );
      }
      row.push(value);
      value = "";
      closedQuotedField = false;
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      if (row.length >= MAX_REPORT_COLUMNS) {
        throw new InboundNoncomplianceFormatError(
          "Amazon FBA 入庫瑕疵報表欄位數超過安全上限。",
        );
      }
      row.push(value);
      if (row.some((cell) => cell.length > 0)) {
        if (rows.length >= MAX_REPORT_ROWS) {
          throw new InboundNoncomplianceFormatError(
            "Amazon FBA 入庫瑕疵報表資料列數超過安全上限。",
          );
        }
        rows.push(row);
      }
      row = [];
      value = "";
      closedQuotedField = false;
    } else {
      if (closedQuotedField) {
        throw new InboundNoncomplianceFormatError(
          "Amazon FBA 入庫瑕疵報表引用欄位結尾後仍有無法辨識的文字。",
        );
      }
      value += character;
    }
  }
  if (quoted) {
    throw new InboundNoncomplianceFormatError(
      "Amazon FBA 入庫瑕疵報表含有未結束的引用欄位。",
    );
  }
  if (value.length > 0 || row.length > 0) {
    if (row.length >= MAX_REPORT_COLUMNS) {
      throw new InboundNoncomplianceFormatError(
        "Amazon FBA 入庫瑕疵報表欄位數超過安全上限。",
      );
    }
    row.push(value);
    if (row.some((cell) => cell.length > 0)) {
      if (rows.length >= MAX_REPORT_ROWS) {
        throw new InboundNoncomplianceFormatError(
          "Amazon FBA 入庫瑕疵報表資料列數超過安全上限。",
        );
      }
      rows.push(row);
    }
  }
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

function safeText(
  value: string | undefined,
  maximum: number,
  options: { required?: boolean; exact?: boolean } = {},
): string | null | undefined {
  const raw = value ?? "";
  const result = options.exact ? raw : raw.trim();
  if (!result) return options.required ? undefined : null;
  if (
    result.length > maximum ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(result) ||
    (options.exact && result !== raw.trim())
  ) {
    return undefined;
  }
  return result;
}

function optionalUnits(value: string | undefined): number | null | undefined {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (!/^\d+$/u.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function optionalReportedAt(value: string | undefined): string | null | undefined {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (
    raw.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.test(raw)
  ) {
    return undefined;
  }
  const day = raw.slice(0, 10);
  const parsedDay = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsedDay.getTime()) && parsedDay.toISOString().slice(0, 10) === day
    ? raw
    : undefined;
}

function problemLevel(value: string | undefined): InboundNoncomplianceLevel | null {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
  if (normalized === "shipment" || normalized === "shipmentlevel") return "shipment";
  if (
    normalized === "carton" ||
    normalized === "cartonlevel" ||
    normalized === "box" ||
    normalized === "boxlevel"
  ) {
    return "carton";
  }
  return normalized === "product" || normalized === "productlevel"
    ? "product"
    : null;
}

function rowNotice(alertStatus: string | null): string {
  return alertStatus
    ? `Amazon 每日入庫瑕疵報表狀態：${alertStatus}`
    : "Amazon 每日入庫瑕疵報表未提供 alert-status；請依 Seller Central 最新狀態核對。";
}

/**
 * Parses the public daily FBA Inbound Performance report. A malformed row is
 * isolated instead of hiding other valid issues, while a missing/ambiguous
 * root schema fails closed so columns can never be silently mislabelled.
 */
export function parseInboundNoncomplianceReport(
  text: string,
): ParsedInboundNoncomplianceReport {
  if (typeof text !== "string" || text.length > MAX_REPORT_CHARACTERS) {
    throw new InboundNoncomplianceFormatError(
      "Amazon FBA 入庫瑕疵報表內容無效或超過安全大小上限。",
    );
  }
  const rows = parseTsv(text);
  const headers = (rows[0] ?? []).map(normalizedHeader);
  const duplicateHeaders = headers.filter(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new InboundNoncomplianceFormatError(
      "Amazon FBA 入庫瑕疵報表包含重複欄位，已停止錯位合併。",
    );
  }
  const indexes = Object.fromEntries(
    REQUIRED_HEADERS.map((header) => [header, headers.indexOf(header)]),
  ) as Record<(typeof REQUIRED_HEADERS)[number], number>;
  const missing = REQUIRED_HEADERS.filter((header) => indexes[header] < 0);
  if (missing.length > 0) {
    throw new InboundNoncomplianceFormatError(
      `Amazon FBA 入庫瑕疵報表缺少必要欄位：${missing.join("、")}。`,
    );
  }

  const issues: InboundNoncomplianceIssue[] = [];
  const incompleteRows: Array<Readonly<{ shipmentId: string | null }>> = [];
  let latestIssueReportedDate: string | null = null;
  for (const row of rows.slice(1)) {
    const level = problemLevel(row[indexes["problem-level"]]);
    const shipmentId = safeText(row[indexes["fba-shipment-id"]], 80, {
      required: true,
      exact: true,
    });
    const sellerSku = safeText(row[indexes.sku], 40, { exact: true });
    const fnsku = safeText(row[indexes.fnsku], 80);
    const asin = safeText(row[indexes.asin], 10);
    const productName = safeText(row[indexes["product-name"]], 2_000);
    const cartonId = safeText(row[indexes["fba-carton-id"]], 120);
    const problemType = safeText(row[indexes["problem-type"]], 256, {
      required: true,
    });
    const problemQuantity = optionalUnits(row[indexes["problem-quantity"]]);
    const expectedUnits = optionalUnits(row[indexes["expected-quantity"]]);
    const receivedUnits = optionalUnits(row[indexes["received-quantity"]]);
    const reportedAt = optionalReportedAt(row[indexes["issue-reported-date"]]);
    const alertStatus = safeText(row[indexes["alert-status"]], 200);
    if (
      !level ||
      typeof shipmentId !== "string" ||
      sellerSku === undefined ||
      fnsku === undefined ||
      asin === undefined ||
      (asin !== null && !/^[A-Z0-9]{10}$/u.test(asin)) ||
      productName === undefined ||
      cartonId === undefined ||
      typeof problemType !== "string" ||
      problemQuantity === undefined ||
      expectedUnits === undefined ||
      receivedUnits === undefined ||
      reportedAt === undefined ||
      alertStatus === undefined
    ) {
      incompleteRows.push({
        shipmentId: typeof shipmentId === "string" ? shipmentId : null,
      });
      continue;
    }
    if (reportedAt) {
      const day = reportedAt.slice(0, 10);
      if (!latestIssueReportedDate || day > latestIssueReportedDate) {
        latestIssueReportedDate = day;
      }
    }
    issues.push({
      level,
      shipmentId,
      sellerSku,
      fnsku,
      asin,
      productName,
      cartonId,
      problemType,
      problemQuantity,
      expectedUnits,
      receivedUnits,
      reportedAt,
      alertStatus,
      notice: rowNotice(alertStatus),
    });
  }
  return {
    issues,
    incompleteRowCount: incompleteRows.length,
    incompleteRows,
    latestIssueReportedDate,
  };
}

export function buildInboundIssueReportSnapshot(input: {
  parsed: ParsedInboundNoncomplianceReport;
  fetchedAt: string;
  allowedShipmentIds: ReadonlySet<string>;
}): InboundIssueReportSnapshot {
  const { parsed } = input;
  const includedIssues = parsed.issues.filter((issue) =>
    input.allowedShipmentIds.has(issue.shipmentId));
  const excludedShipmentIds = new Set(parsed.issues
    .filter((issue) => !input.allowedShipmentIds.has(issue.shipmentId))
    .map((issue) => issue.shipmentId));
  const relevantIncompleteRows = parsed.incompleteRows.filter((row) => {
    if (row.shipmentId === null) return true;
    if (input.allowedShipmentIds.has(row.shipmentId)) return true;
    excludedShipmentIds.add(row.shipmentId);
    return false;
  });
  const excludedShipmentCount = excludedShipmentIds.size;
  const grouped = (level: InboundNoncomplianceLevel) =>
    includedIssues.filter((issue) => issue.level === level);
  const rowNotice = includedIssues.length === 0
    ? "Amazon 每日入庫瑕疵報表目前沒有回傳屬於所選貨件的問題列；這不是 Seller Central 即時三層瑕疵頁面的同義保證。"
    : `Amazon 每日入庫瑕疵報表回傳 ${includedIssues.length} 筆屬於所選貨件的可核對問題列。`;
  const incompleteNotice = relevantIncompleteRows.length > 0
    ? `另有 ${relevantIncompleteRows.length} 筆欄位無法安全辨識；它屬於所選貨件或無法確定所屬貨件，未分類也未補值。`
    : "";
  const excludedNotice = excludedShipmentCount > 0
    ? `每日報表另含 ${excludedShipmentCount} 個不在所選更新區間的貨件，已排除且未回傳其識別值。`
    : "";
  return {
    state: relevantIncompleteRows.length > 0 ? "partial" : "completed",
    fetchedAt: input.fetchedAt,
    // The maximum issue-reported-date is an event date, not proof that the
    // daily report covers all activity through that date.
    dataThrough: null,
    excludedShipmentCount,
    notice: `${rowNotice}${incompleteNotice}${excludedNotice}此資料每日更新，可能落後 Seller Central 即時畫面。`,
    shipment: grouped("shipment"),
    carton: grouped("carton"),
    product: grouped("product"),
  };
}
