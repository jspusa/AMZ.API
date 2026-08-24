import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { SpApiError, SpApiPreCommitError } from "./amazon/sp-api-error";

export type SupplyRoute = "DIRECT_FBA" | "AWD_TO_FBA";

export type ProductMasterProfile = {
  marketplaceId: string;
  sellerSku: string;
  displayName: string | null;
  asin: string | null;
  fnSku: string | null;
  casePack: number;
  cartonsPerPallet: number;
  leadTimeDays: number;
  safetyDays: number;
  targetDays: number;
  supplyRoute: SupplyRoute;
  awdBufferDays: number;
  shelfLifeDays: number | null;
  minimumRemainingDays: number | null;
  factory: string | null;
  notes: string | null;
  settingsConfigured: boolean;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProductMasterState = {
  profile: ProductMasterProfile;
  found: boolean;
  persistence: "durable";
};

type LedgerState = "pending" | "completed" | "unknown";

export type LedgerOperationType =
  | "price"
  | "business_price"
  | "content"
  | "images"
  | "sale_price"
  | "variation_detach"
  | "variation_attach";

type LedgerEntry = {
  operationType: LedgerOperationType;
  marketplaceId: string;
  sellerSku: string;
  accountScope: string;
  fingerprint: string;
  ownerToken: string;
  state: LedgerState;
  response: unknown | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type DurableReportLegStatus =
  | "NOT_STARTED"
  | "CREATING"
  | "CREATE_FAILED"
  | "CREATION_UNKNOWN"
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED"
  | "FATAL";

export type DurableReportLeg = {
  reportId: string | null;
  documentId: string | null;
  status: DurableReportLegStatus;
  createdAt: number | null;
  terminal: "CREATE_FAILED" | "CREATION_UNKNOWN" | "CANCELLED" | "FATAL" | null;
  terminalAt: number | null;
};

// Public compatibility aliases: brand jobs and generic Reports API leases use
// the same durable state machine. New generic code should use DurableReportLeg.
export type BrandSalesReportLegStatus = DurableReportLegStatus;
export type BrandSalesReportLeg = DurableReportLeg;

export type BrandSalesJobRecord = {
  jobId: string;
  accountScope: string;
  marketplaceId: string;
  startDate: string;
  endDate: string;
  mode: "live" | "demo";
  shipmentDataStartTime: string;
  shipmentDataEndTime: string;
  listing: BrandSalesReportLeg;
  shipment: BrandSalesReportLeg;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

const BRAND_SALES_MISSING_WINDOW_SENTINEL =
  "legacy-missing-immutable-window" as const;

/**
 * Durable fail-closed marker for a pre-window-contract brand report job.
 *
 * Older App builds could persist the account/selection and Amazon report IDs
 * without the immutable shipment timestamps required by the current status
 * contract. Dropping that otherwise coherent record would make an automatic
 * dashboard mount create a second report. Keep only the non-secret identity,
 * report legs and timing evidence until an explicit guarded retry replaces it.
 */
export type BrandSalesIncompatibleJobRecord = Omit<
  BrandSalesJobRecord,
  "shipmentDataStartTime" | "shipmentDataEndTime" | "expiresAt"
> & {
  windowCompatibility: "MISSING_IMMUTABLE_WINDOW";
  shipmentDataStartTime: typeof BRAND_SALES_MISSING_WINDOW_SENTINEL;
  shipmentDataEndTime: typeof BRAND_SALES_MISSING_WINDOW_SENTINEL;
  originalExpiresAt: number;
  expiresAt: typeof Number.MAX_SAFE_INTEGER;
};

export type StoredBrandSalesJobRecord =
  | BrandSalesJobRecord
  | BrandSalesIncompatibleJobRecord;

export function isBrandSalesIncompatibleJob(
  value: StoredBrandSalesJobRecord,
): value is BrandSalesIncompatibleJobRecord {
  return value.shipmentDataStartTime === BRAND_SALES_MISSING_WINDOW_SENTINEL ||
    value.shipmentDataEndTime === BRAND_SALES_MISSING_WINDOW_SENTINEL;
}

export type SharedReportType =
  | "GET_MERCHANT_LISTINGS_ALL_DATA"
  | "GET_MERCHANT_LISTINGS_DATA"
  | "GET_FBA_INVENTORY_PLANNING_DATA"
  | "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA"
  | "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA"
  | "GET_SALES_AND_TRAFFIC_REPORT"
  | "ADS_SP_ADVERTISED_PRODUCT";

export type SharedFbaShipmentSalesOptionsKey =
  `marketplaceIds=selected;shipment-sales;start=${string};end=${string};dataStartTime=${string};dataEndTime=${string};windowCreatedAt=${number}`;

export type SharedReportOptionsKey =
  | "preferredReportDocumentLocale=en_US"
  | "marketplaceIds=selected"
  | "marketplaceIds=selected;daily-inbound-noncompliance"
  | `dateGranularity=DAY;asinGranularity=SKU;start=${string};end=${string}`
  | SharedFbaShipmentSalesOptionsKey
  | `reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=${string};end=${string}`;

export type SharedReportLease = {
  leaseId: string;
  accountScope: string;
  marketplaceId: string;
  reportType: SharedReportType;
  optionsKey: SharedReportOptionsKey;
  mode: "live" | "demo";
  report: DurableReportLeg;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type SharedAllListingsReportLease = SharedReportLease & {
  reportType: "GET_MERCHANT_LISTINGS_ALL_DATA";
  optionsKey: "preferredReportDocumentLocale=en_US";
};

/**
 * Durable evidence for one exported content-audit workbook.
 *
 * The row digests bind the exact marketplace, SKU/ASIN/product type/family,
 * canonical source content, and read status without persisting the source
 * Seller SKUs or listing copy in the local store. The account scope is already
 * a one-way SHA-256 value produced by CredentialVault; it is not a Seller ID.
 */
export type ContentAuditSnapshotEvidence = {
  schemaVersion: 1;
  exportId: string;
  accountScope: string;
  marketplaceId: string;
  mode: "live" | "demo";
  fetchedAt: string;
  rowDigests: string[];
  createdAt: number;
  expiresAt: number;
};

export type ContentAuditSnapshotLookup =
  | { status: "available"; evidence: ContentAuditSnapshotEvidence }
  | {
      status:
        | "not-found"
        | "expired"
        | "marketplace-changed"
        | "mode-changed"
        | "account-scope-changed";
      evidence: null;
    };

export type ContentAuditSnapshotEvidenceInput = Pick<
  ContentAuditSnapshotEvidence,
  | "exportId"
  | "accountScope"
  | "marketplaceId"
  | "mode"
  | "fetchedAt"
  | "rowDigests"
>;

type StoreData = {
  version: 2;
  profiles: Record<string, ProductMasterProfile>;
  ledger: Record<string, LedgerEntry>;
  brandSalesJobs: Record<string, StoredBrandSalesJobRecord>;
  // The persisted property name is intentionally retained for store-version-2
  // rollback compatibility. Current builds may also place other allowlisted
  // Reports API leases here; older builds ignore those optional entries.
  sharedAllListingsReports: Record<string, SharedReportLease>;
  // Optional version-2 extension. Older App builds ignore and may drop this
  // cache on their next mutation, which only invalidates old workbooks safely.
  contentAuditSnapshots: Record<string, ContentAuditSnapshotEvidence>;
};

type ProductSettings = Pick<
  ProductMasterProfile,
  | "casePack"
  | "cartonsPerPallet"
  | "leadTimeDays"
  | "safetyDays"
  | "targetDays"
  | "supplyRoute"
  | "awdBufferDays"
  | "shelfLifeDays"
  | "minimumRemainingDays"
  | "factory"
  | "notes"
>;

type OperationInput<T> = {
  idempotencyKey: string;
  operationType: LedgerEntry["operationType"];
  marketplaceId: string;
  sellerSku: string;
  accountScope: string;
  fingerprint: string;
  execute: (control: Readonly<{
    recordAccepted(response: T): Promise<void>;
  }>) => Promise<T>;
};

export type IdempotentOperationAvailabilityInput = Pick<
  OperationInput<unknown>,
  | "idempotencyKey"
  | "operationType"
  | "marketplaceId"
  | "sellerSku"
  | "accountScope"
  | "fingerprint"
>;

const OPERATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const CONTENT_AUDIT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CONTENT_AUDIT_SNAPSHOT_ROWS = 25_000;
const MAX_CONTENT_AUDIT_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_ROWS = 50_000;
const MAX_CONTENT_AUDIT_SNAPSHOTS = 8;
const MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_BYTES = 8 * 1024 * 1024;
const VARIATION_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "variation_detach",
  "variation_attach",
]);
const OFFER_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "price",
  "business_price",
  "sale_price",
]);
const LISTING_ATTRIBUTE_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "content",
  "images",
]);

function emptyStore(): StoreData {
  return {
    version: 2,
    profiles: {},
    ledger: {},
    brandSalesJobs: {},
    sharedAllListingsReports: {},
    contentAuditSnapshots: {},
  };
}

function profileKey(accountScope: string, marketplaceId: string, sellerSku: string): string {
  return `${accountScope}:${marketplaceId}:${sellerSku}`;
}

function brandSalesSelectionKey(input: {
  accountScope: string;
  marketplaceId: string;
  startDate: string;
  endDate: string;
}): string {
  return `${input.accountScope}:${input.marketplaceId}:${input.startDate}:${input.endDate}`;
}

function sharedReportKey(input: {
  accountScope: string;
  marketplaceId: string;
  reportType: SharedReportType;
  optionsKey: SharedReportOptionsKey;
}): string {
  return JSON.stringify([
    input.accountScope,
    input.marketplaceId,
    input.reportType,
    input.optionsKey,
  ]);
}

function legacySharedReportKey(input: {
  accountScope: string;
  marketplaceId: string;
  reportType: SharedReportType;
  optionsKey: SharedReportOptionsKey;
}): string {
  return `${input.accountScope}:${input.marketplaceId}:${input.reportType}:${input.optionsKey}`;
}

function persistedSharedReports(
  reports: StoreData["sharedAllListingsReports"],
): StoreData["sharedAllListingsReports"] {
  const persisted: StoreData["sharedAllListingsReports"] = {};
  const legacyOwners = new Map<string, string>();
  for (const [key, report] of Object.entries(reports)) {
    const canonicalKey = sharedReportKey(report);
    if (key !== canonicalKey) {
      throw new Error("Non-canonical shared report identity");
    }
    persisted[canonicalKey] = report;
    const legacyKey = legacySharedReportKey(report);
    const owner = legacyOwners.get(legacyKey);
    if (owner && owner !== canonicalKey) {
      // A v2 reader cannot distinguish two identities that collapse to the
      // same colon-delimited key. Refuse the atomic write instead of choosing
      // one tombstone and making a rollback capable of replaying the other.
      throw new Error("Ambiguous legacy shared report identity");
    }
    legacyOwners.set(legacyKey, canonicalKey);
    persisted[legacyKey] = report;
  }
  return persisted;
}

function persistedStore(data: StoreData): StoreData {
  return {
    ...data,
    // Keep collision-safe tuple keys for current readers and a v2 alias for
    // the immediately previous App. Current read() collapses both copies back
    // to one canonical in-memory lease.
    sharedAllListingsReports: persistedSharedReports(
      data.sharedAllListingsReports,
    ),
  };
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function contentAuditSnapshotBytes(value: ContentAuditSnapshotEvidence): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function parseContentAuditSnapshotEvidence(
  value: unknown,
): ContentAuditSnapshotEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted content-audit snapshot");
  }
  const raw = value as Record<string, unknown>;
  const expectedKeys = [
    "accountScope",
    "createdAt",
    "expiresAt",
    "exportId",
    "fetchedAt",
    "marketplaceId",
    "mode",
    "rowDigests",
    "schemaVersion",
  ];
  const actualKeys = Object.keys(raw).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    raw.schemaVersion !== 1 ||
    typeof raw.exportId !== "string" ||
    !/^[A-Za-z0-9._-]{1,200}$/u.test(raw.exportId) ||
    typeof raw.accountScope !== "string" ||
    !/^[a-f0-9]{64}$/u.test(raw.accountScope) ||
    typeof raw.marketplaceId !== "string" ||
    !/^[A-Z0-9]{1,32}$/u.test(raw.marketplaceId) ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    !isCanonicalIsoTimestamp(raw.fetchedAt) ||
    !Number.isSafeInteger(raw.createdAt) ||
    Number(raw.createdAt) <= 0 ||
    !Number.isSafeInteger(raw.expiresAt) ||
    Number(raw.expiresAt) <= Number(raw.createdAt) ||
    Number(raw.expiresAt) >
      Number(raw.createdAt) + CONTENT_AUDIT_SNAPSHOT_TTL_MS ||
    !Array.isArray(raw.rowDigests) ||
    raw.rowDigests.length > MAX_CONTENT_AUDIT_SNAPSHOT_ROWS
  ) {
    throw new Error("Invalid persisted content-audit snapshot");
  }
  const rowDigests: string[] = [];
  const seen = new Set<string>();
  for (const value of raw.rowDigests) {
    if (
      typeof value !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value) ||
      seen.has(value)
    ) {
      throw new Error("Invalid persisted content-audit row evidence");
    }
    seen.add(value);
    rowDigests.push(value);
  }
  const parsed: ContentAuditSnapshotEvidence = {
    schemaVersion: 1,
    exportId: raw.exportId,
    accountScope: raw.accountScope,
    marketplaceId: raw.marketplaceId,
    mode: raw.mode,
    fetchedAt: raw.fetchedAt,
    rowDigests,
    createdAt: Number(raw.createdAt),
    expiresAt: Number(raw.expiresAt),
  };
  if (contentAuditSnapshotBytes(parsed) > MAX_CONTENT_AUDIT_SNAPSHOT_BYTES) {
    throw new Error("Persisted content-audit snapshot exceeds its safety budget");
  }
  return parsed;
}

function parseContentAuditSnapshotCollection(
  value: unknown,
): Record<string, ContentAuditSnapshotEvidence> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length > MAX_CONTENT_AUDIT_SNAPSHOTS ||
    Buffer.byteLength(JSON.stringify(value), "utf8") >
      MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_BYTES
  ) return {};

  const snapshots: Record<string, ContentAuditSnapshotEvidence> = {};
  let totalRows = 0;
  let totalBytes = 0;
  for (const [key, snapshot] of entries) {
    try {
      const parsed = parseContentAuditSnapshotEvidence(snapshot);
      if (parsed.exportId !== key) continue;
      totalRows += parsed.rowDigests.length;
      totalBytes += contentAuditSnapshotBytes(parsed);
      if (
        totalRows > MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_ROWS ||
        totalBytes > MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_BYTES
      ) {
        // The cache is optional. If its aggregate envelope is corrupt or was
        // created by an incompatible build, discard it as a unit so no
        // arbitrary subset of workbook evidence remains trusted.
        return {};
      }
      snapshots[key] = parsed;
    } catch {
      // One invalid optional cache entry must not hide the product profiles or
      // the no-blind-retry ledger stored in the same device-local file.
    }
  }
  return snapshots;
}

const DURABLE_REPORT_LEG_STATUSES = new Set<DurableReportLegStatus>([
  "NOT_STARTED",
  "CREATING",
  "CREATE_FAILED",
  "CREATION_UNKNOWN",
  "IN_QUEUE",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "FATAL",
]);

function isSafeIdentifier(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function parseDurableReportLeg(value: unknown): DurableReportLeg {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted report leg");
  }
  const raw = value as Record<string, unknown>;
  if (
    !DURABLE_REPORT_LEG_STATUSES.has(raw.status as DurableReportLegStatus) ||
    (raw.reportId !== null && !isSafeIdentifier(raw.reportId)) ||
    (raw.documentId !== null && !isSafeIdentifier(raw.documentId)) ||
    (raw.createdAt !== null && (!Number.isSafeInteger(raw.createdAt) || Number(raw.createdAt) <= 0)) ||
    ![null, "CREATE_FAILED", "CREATION_UNKNOWN", "CANCELLED", "FATAL"].includes(
      raw.terminal as never,
    ) ||
    (raw.terminalAt !== null &&
      (!Number.isSafeInteger(raw.terminalAt) || Number(raw.terminalAt) <= 0))
  ) {
    throw new Error("Invalid persisted report leg");
  }
  const status = raw.status as DurableReportLegStatus;
  const terminal = raw.terminal as DurableReportLeg["terminal"];
  const hasReportId = typeof raw.reportId === "string";
  const hasDocumentId = typeof raw.documentId === "string";
  const hasCreatedAt = typeof raw.createdAt === "number";
  const hasTerminalAt = typeof raw.terminalAt === "number";
  const activeStatus = status === "IN_QUEUE" || status === "IN_PROGRESS";
  const terminalStatus = status === "CANCELLED" || status === "FATAL";
  if (
    (status === "NOT_STARTED" &&
      (hasReportId || hasDocumentId || hasCreatedAt || terminal || hasTerminalAt)) ||
    (status === "CREATING" &&
      (hasReportId || hasDocumentId || !hasCreatedAt || terminal || hasTerminalAt)) ||
    (status === "CREATE_FAILED" &&
      (hasReportId || hasDocumentId || !hasCreatedAt || terminal !== status || !hasTerminalAt)) ||
    (status === "CREATION_UNKNOWN" &&
      (hasDocumentId || !hasCreatedAt || terminal !== status || !hasTerminalAt)) ||
    (activeStatus &&
      (!hasReportId || hasDocumentId || !hasCreatedAt || terminal || hasTerminalAt)) ||
    (status === "DONE" &&
      (!hasReportId || !hasDocumentId || !hasCreatedAt || terminal || hasTerminalAt)) ||
    (terminalStatus &&
      (!hasReportId || hasDocumentId || !hasCreatedAt || terminal !== status || !hasTerminalAt))
  ) {
    throw new Error("Incoherent persisted report leg");
  }
  return {
    reportId: raw.reportId as string | null,
    documentId: raw.documentId as string | null,
    status: raw.status as DurableReportLegStatus,
    createdAt: raw.createdAt as number | null,
    terminal: raw.terminal as DurableReportLeg["terminal"],
    terminalAt: raw.terminalAt as number | null,
  };
}

function parseBrandSalesJobBase(
  value: unknown,
): {
  base: Omit<BrandSalesJobRecord, "shipmentDataStartTime" | "shipmentDataEndTime">;
  raw: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted brand-sales job");
  }
  const raw = value as Record<string, unknown>;
  if (
    !isSafeIdentifier(raw.jobId, 120) ||
    !isSafeIdentifier(raw.accountScope, 128) ||
    !isSafeIdentifier(raw.marketplaceId, 32) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(String(raw.startDate)) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(String(raw.endDate)) ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    !Number.isSafeInteger(raw.createdAt) ||
    !Number.isSafeInteger(raw.updatedAt) ||
    !Number.isSafeInteger(raw.expiresAt) ||
    Number(raw.createdAt) <= 0 ||
    Number(raw.updatedAt) < Number(raw.createdAt) ||
    Number(raw.expiresAt) <= Number(raw.createdAt)
  ) {
    throw new Error("Invalid persisted brand-sales job");
  }
  return {
    raw,
    base: {
      jobId: raw.jobId,
      accountScope: raw.accountScope,
      marketplaceId: raw.marketplaceId,
      startDate: raw.startDate as string,
      endDate: raw.endDate as string,
      mode: raw.mode,
      listing: parseDurableReportLeg(raw.listing),
      shipment: parseDurableReportLeg(raw.shipment),
      createdAt: Number(raw.createdAt),
      updatedAt: Number(raw.updatedAt),
      expiresAt: Number(raw.expiresAt),
    },
  };
}

function parseBrandSalesJob(value: unknown): BrandSalesJobRecord {
  const { base, raw } = parseBrandSalesJobBase(value);
  if (
    !isSafeIdentifier(raw.shipmentDataStartTime, 64) ||
    !isSafeIdentifier(raw.shipmentDataEndTime, 64) ||
    raw.shipmentDataStartTime === BRAND_SALES_MISSING_WINDOW_SENTINEL ||
    raw.shipmentDataEndTime === BRAND_SALES_MISSING_WINDOW_SENTINEL
  ) {
    throw new Error("Persisted brand-sales job is missing its immutable window");
  }
  return {
    ...base,
    shipmentDataStartTime: raw.shipmentDataStartTime,
    shipmentDataEndTime: raw.shipmentDataEndTime,
  };
}

function parseStoredBrandSalesJob(value: unknown): StoredBrandSalesJobRecord {
  const { base, raw } = parseBrandSalesJobBase(value);
  if (
    raw.windowCompatibility === "MISSING_IMMUTABLE_WINDOW" ||
    raw.shipmentDataStartTime === BRAND_SALES_MISSING_WINDOW_SENTINEL ||
    raw.shipmentDataEndTime === BRAND_SALES_MISSING_WINDOW_SENTINEL ||
    !isSafeIdentifier(raw.shipmentDataStartTime, 64) ||
    !isSafeIdentifier(raw.shipmentDataEndTime, 64)
  ) {
    const originalExpiresAt = Number.isSafeInteger(raw.originalExpiresAt) &&
        Number(raw.originalExpiresAt) > base.createdAt
      ? Number(raw.originalExpiresAt)
      : base.expiresAt;
    return {
      ...base,
      windowCompatibility: "MISSING_IMMUTABLE_WINDOW",
      shipmentDataStartTime: BRAND_SALES_MISSING_WINDOW_SENTINEL,
      shipmentDataEndTime: BRAND_SALES_MISSING_WINDOW_SENTINEL,
      originalExpiresAt,
      // Keep the tombstone readable by v0.1.11's version-2 parser. Its normal
      // expiry path may otherwise delete a completed legacy job and POST a new
      // report automatically after rollback. The current App ignores this
      // retention value and only replaces the marker after a guarded retry.
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }
  return {
    ...base,
    shipmentDataStartTime: raw.shipmentDataStartTime,
    shipmentDataEndTime: raw.shipmentDataEndTime,
  };
}

function validReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDatedReportOptions(
  value: unknown,
  prefix: string,
): boolean {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  const range = value.slice(prefix.length).split(";end=");
  if (range.length !== 2) return false;
  const [startDate, endDate] = range;
  return validReportDate(startDate) && validReportDate(endDate) && startDate <= endDate;
}

function validFixedReportTimestamp(value: string): boolean {
  return value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function sharedFbaShipmentSalesOptionsKey(input: {
  startDate: string;
  endDate: string;
  dataStartTime: string;
  dataEndTime: string;
  windowCreatedAt: number;
}): SharedFbaShipmentSalesOptionsKey {
  if (
    !validReportDate(input.startDate) ||
    !validReportDate(input.endDate) ||
    input.startDate > input.endDate ||
    !validFixedReportTimestamp(input.dataStartTime) ||
    !validFixedReportTimestamp(input.dataEndTime) ||
    Date.parse(input.dataEndTime) <= Date.parse(input.dataStartTime) ||
    !Number.isSafeInteger(input.windowCreatedAt) ||
    input.windowCreatedAt < 0
  ) {
    throw new Error("Invalid fixed FBA shipment-sales report window");
  }
  return `marketplaceIds=selected;shipment-sales;start=${input.startDate};end=${input.endDate};dataStartTime=${encodeURIComponent(input.dataStartTime)};dataEndTime=${encodeURIComponent(input.dataEndTime)};windowCreatedAt=${input.windowCreatedAt}`;
}

function validFbaShipmentSalesOptions(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^marketplaceIds=selected;shipment-sales;start=(\d{4}-\d{2}-\d{2});end=(\d{4}-\d{2}-\d{2});dataStartTime=([^;]+);dataEndTime=([^;]+);windowCreatedAt=(\d+)$/u.exec(
    value,
  );
  if (!match) return false;
  try {
    return sharedFbaShipmentSalesOptionsKey({
      startDate: match[1],
      endDate: match[2],
      dataStartTime: decodeURIComponent(match[3]),
      dataEndTime: decodeURIComponent(match[4]),
      windowCreatedAt: Number(match[5]),
    }) === value;
  } catch {
    return false;
  }
}

function parseSharedReport(
  value: unknown,
): SharedReportLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted shared report");
  }
  const raw = value as Record<string, unknown>;
  const identityAllowed =
    (raw.reportType === "GET_MERCHANT_LISTINGS_ALL_DATA" &&
      raw.optionsKey === "preferredReportDocumentLocale=en_US") ||
    (raw.reportType === "GET_MERCHANT_LISTINGS_DATA" &&
      raw.optionsKey === "preferredReportDocumentLocale=en_US") ||
    (raw.reportType === "GET_FBA_INVENTORY_PLANNING_DATA" &&
      raw.optionsKey === "marketplaceIds=selected") ||
    (raw.reportType === "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA" &&
      raw.optionsKey === "marketplaceIds=selected;daily-inbound-noncompliance") ||
    (raw.reportType === "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA" &&
      validFbaShipmentSalesOptions(raw.optionsKey)) ||
    (raw.reportType === "GET_SALES_AND_TRAFFIC_REPORT" &&
      validDatedReportOptions(
        raw.optionsKey,
        "dateGranularity=DAY;asinGranularity=SKU;start=",
      )) ||
    (raw.reportType === "ADS_SP_ADVERTISED_PRODUCT" &&
      validDatedReportOptions(
        raw.optionsKey,
        "reportTypeId=spAdvertisedProduct;timeUnit=SUMMARY;version=1;start=",
      ));
  if (
    !isSafeIdentifier(raw.leaseId, 120) ||
    !isSafeIdentifier(raw.accountScope, 128) ||
    !isSafeIdentifier(raw.marketplaceId, 32) ||
    !identityAllowed ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    !Number.isSafeInteger(raw.createdAt) ||
    !Number.isSafeInteger(raw.updatedAt) ||
    !Number.isSafeInteger(raw.expiresAt) ||
    Number(raw.createdAt) <= 0 ||
    Number(raw.updatedAt) < Number(raw.createdAt) ||
    Number(raw.expiresAt) <= Number(raw.createdAt)
  ) {
    throw new Error("Invalid persisted shared report");
  }
  return {
    leaseId: raw.leaseId,
    accountScope: raw.accountScope,
    marketplaceId: raw.marketplaceId,
    reportType: raw.reportType as SharedReportType,
    optionsKey: raw.optionsKey as SharedReportOptionsKey,
    mode: raw.mode,
    report: parseDurableReportLeg(raw.report),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
    expiresAt: Number(raw.expiresAt),
  };
}

export function defaultProductMaster(
  marketplaceId: string,
  sellerSku: string,
): ProductMasterProfile {
  return {
    marketplaceId,
    sellerSku,
    displayName: null,
    asin: null,
    fnSku: null,
    casePack: 1,
    cartonsPerPallet: 1,
    leadTimeDays: 35,
    safetyDays: 14,
    targetDays: 60,
    supplyRoute: "DIRECT_FBA",
    awdBufferDays: 20,
    shelfLifeDays: null,
    minimumRemainingDays: null,
    factory: null,
    notes: null,
    settingsConfigured: false,
    lastSyncedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function operationError(state: LedgerState): SpApiError {
  return new SpApiError(
    state === "unknown"
      ? "前一次送出結果尚未確認。系統已禁止重送，請先回查 Amazon 狀態。"
      : "同一筆操作正在處理。系統已阻止重複送出，請稍後回查。",
    {
      status: 409,
      code: state === "unknown" ? "UPDATE_STATUS_UNKNOWN" : "OPERATION_IN_PROGRESS",
    },
  );
}

function resultMayBeUnknown(error: unknown): boolean {
  if (error instanceof SpApiPreCommitError) return false;
  if (!(error instanceof SpApiError)) return true;
  return (
    error.status >= 500 ||
    ["UPDATE_STATUS_UNKNOWN", "OPERATION_IN_PROGRESS"].includes(error.code)
  );
}

export class LocalStore {
  readonly filePath: string;
  private data: StoreData | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    const data = await this.read();
    const now = Date.now();
    const expiredContentAuditSnapshots = Object.entries(
      data.contentAuditSnapshots,
    ).filter(([, snapshot]) => snapshot.expiresAt <= now).map(([key]) => key);
    if (
      Object.values(data.brandSalesJobs).some(isBrandSalesIncompatibleJob) ||
      expiredContentAuditSnapshots.length
    ) {
      // Persist the rollback-readable sentinel immediately. Waiting for an
      // unrelated later mutation would leave the original missing-window row
      // vulnerable to being dropped if the user launches an older App build.
      await this.mutate((draft) => {
        for (const key of expiredContentAuditSnapshots) {
          delete draft.contentAuditSnapshots[key];
        }
      });
    }
  }

  async isolateCorruptedFile(): Promise<string | null> {
    this.data = null;
    this.mutationQueue = Promise.resolve();
    const backupPath = `${this.filePath}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.bak`;
    try {
      await rename(this.filePath, backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.initialize();
      return null;
    }
    await this.initialize();
    return backupPath;
  }

  async saveContentAuditSnapshotEvidence(
    input: ContentAuditSnapshotEvidenceInput,
    now = Date.now(),
  ): Promise<ContentAuditSnapshotEvidence> {
    if (!Number.isSafeInteger(now) || now <= 0) {
      throw new Error("Invalid content-audit snapshot time");
    }
    const evidence = parseContentAuditSnapshotEvidence({
      schemaVersion: 1,
      exportId: input.exportId,
      accountScope: input.accountScope,
      marketplaceId: input.marketplaceId,
      mode: input.mode,
      fetchedAt: input.fetchedAt,
      rowDigests: [...input.rowDigests].sort(),
      createdAt: now,
      expiresAt: now + CONTENT_AUDIT_SNAPSHOT_TTL_MS,
    });
    await this.mutate((data) => {
      for (const [key, candidate] of Object.entries(data.contentAuditSnapshots)) {
        if (candidate.expiresAt <= now) delete data.contentAuditSnapshots[key];
      }
      if (data.contentAuditSnapshots[evidence.exportId]) {
        throw new Error("Content-audit export ID already exists");
      }
      data.contentAuditSnapshots[evidence.exportId] = evidence;
      const overBudget = () => {
        const active = Object.values(data.contentAuditSnapshots);
        return active.length > MAX_CONTENT_AUDIT_SNAPSHOTS ||
          active.reduce(
            (sum, candidate) => sum + candidate.rowDigests.length,
            0,
          ) > MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_ROWS ||
          Buffer.byteLength(
            JSON.stringify(data.contentAuditSnapshots),
            "utf8",
          ) > MAX_CONTENT_AUDIT_SNAPSHOT_TOTAL_BYTES;
      };
      while (overBudget()) {
        const oldest = Object.values(data.contentAuditSnapshots)
          .filter((candidate) => candidate.exportId !== evidence.exportId)
          .sort((left, right) =>
            left.createdAt - right.createdAt ||
            (left.exportId < right.exportId
              ? -1
              : left.exportId > right.exportId
                ? 1
                : 0)
          )[0];
        // A single evidence record is validated against stricter per-record
        // limits above, so an existing candidate must always be removable.
        if (!oldest) throw new Error("Content-audit snapshot exceeds safety budget");
        delete data.contentAuditSnapshots[oldest.exportId];
      }
    });
    return structuredClone(evidence);
  }

  async getContentAuditSnapshotEvidence(input: {
    exportId: string;
    accountScope: string;
    marketplaceId: string;
    mode: "live" | "demo";
    now?: number;
  }): Promise<ContentAuditSnapshotLookup> {
    const now = input.now ?? Date.now();
    if (
      !/^[A-Za-z0-9._-]{1,200}$/u.test(input.exportId) ||
      !/^[a-f0-9]{64}$/u.test(input.accountScope) ||
      !/^[A-Z0-9]{1,32}$/u.test(input.marketplaceId) ||
      (input.mode !== "live" && input.mode !== "demo") ||
      !Number.isSafeInteger(now) ||
      now <= 0
    ) {
      throw new Error("Invalid content-audit snapshot lookup");
    }
    const data = await this.read();
    const evidence = data.contentAuditSnapshots[input.exportId];
    if (!evidence) return { status: "not-found", evidence: null };
    if (evidence.expiresAt <= now) {
      await this.mutate((draft) => {
        const current = draft.contentAuditSnapshots[input.exportId];
        if (current?.expiresAt && current.expiresAt <= now) {
          delete draft.contentAuditSnapshots[input.exportId];
        }
      });
      return { status: "expired", evidence: null };
    }
    if (evidence.accountScope !== input.accountScope) {
      return { status: "account-scope-changed", evidence: null };
    }
    if (evidence.marketplaceId !== input.marketplaceId) {
      return { status: "marketplace-changed", evidence: null };
    }
    if (evidence.mode !== input.mode) {
      return { status: "mode-changed", evidence: null };
    }
    return { status: "available", evidence: structuredClone(evidence) };
  }

  async getProductMaster(
    accountScope: string,
    marketplaceId: string,
    sellerSku: string,
  ): Promise<ProductMasterState> {
    await this.migrateLegacyProfiles(accountScope, marketplaceId);
    const data = await this.read();
    const profile = data.profiles[profileKey(accountScope, marketplaceId, sellerSku)];
    return {
      profile: profile
        ? structuredClone(profile)
        : defaultProductMaster(marketplaceId, sellerSku),
      found: Boolean(profile),
      persistence: "durable",
    };
  }

  async listProductMasters(input: {
    accountScope: string;
    marketplaceId: string;
    query?: string;
    limit?: number;
  }): Promise<{ items: ProductMasterProfile[]; persistence: "durable" }> {
    await this.migrateLegacyProfiles(input.accountScope, input.marketplaceId);
    const data = await this.read();
    const query = input.query?.trim().toLowerCase() ?? "";
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    return {
      items: Object.entries(data.profiles)
        .filter(([key, profile]) =>
          key.startsWith(`${input.accountScope}:`) &&
          profile.marketplaceId === input.marketplaceId,
        )
        .map(([, profile]) => profile)
        .filter(
          (profile) =>
            !query ||
            [profile.sellerSku, profile.displayName ?? "", profile.asin ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(query),
        )
        .sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        )
        .slice(0, limit)
        .map((profile) => structuredClone(profile)),
      persistence: "durable",
    };
  }

  async saveProductMaster(input: {
    accountScope: string;
    marketplaceId: string;
    sellerSku: string;
    settings: ProductSettings;
    displayName?: string | null;
    asin?: string | null;
    fnSku?: string | null;
  }): Promise<ProductMasterState> {
    let saved!: ProductMasterProfile;
    await this.mutate((data) => {
      const key = profileKey(input.accountScope, input.marketplaceId, input.sellerSku);
      const previous = data.profiles[key] ??
        defaultProductMaster(input.marketplaceId, input.sellerSku);
      const now = new Date().toISOString();
      saved = {
        ...previous,
        ...input.settings,
        displayName: input.displayName ?? previous.displayName,
        asin: input.asin ?? previous.asin,
        fnSku: input.fnSku ?? previous.fnSku,
        settingsConfigured: true,
        createdAt: previous.createdAt ?? now,
        updatedAt: now,
      };
      data.profiles[key] = saved;
    });
    return { profile: structuredClone(saved), found: true, persistence: "durable" };
  }

  async syncProductIdentity(input: {
    accountScope: string;
    marketplaceId: string;
    sellerSku: string;
    displayName?: string | null;
    asin?: string | null;
    fnSku?: string | null;
  }): Promise<ProductMasterState> {
    let saved!: ProductMasterProfile;
    await this.mutate((data) => {
      const key = profileKey(input.accountScope, input.marketplaceId, input.sellerSku);
      const previous = data.profiles[key] ??
        defaultProductMaster(input.marketplaceId, input.sellerSku);
      const now = new Date().toISOString();
      saved = {
        ...previous,
        displayName: input.displayName ?? previous.displayName,
        asin: input.asin ?? previous.asin,
        fnSku: input.fnSku ?? previous.fnSku,
        lastSyncedAt: now,
        createdAt: previous.createdAt ?? now,
        updatedAt: now,
      };
      data.profiles[key] = saved;
    });
    return { profile: structuredClone(saved), found: true, persistence: "durable" };
  }

  async getBrandSalesJob(input: {
    accountScope: string;
    marketplaceId: string;
    startDate: string;
    endDate: string;
  }): Promise<StoredBrandSalesJobRecord | null> {
    const data = await this.read();
    const value = data.brandSalesJobs[brandSalesSelectionKey(input)];
    return value ? structuredClone(value) : null;
  }

  async getBrandSalesJobById(jobId: string): Promise<StoredBrandSalesJobRecord | null> {
    const data = await this.read();
    const value = Object.values(data.brandSalesJobs).find(
      (candidate) => candidate.jobId === jobId,
    );
    return value ? structuredClone(value) : null;
  }

  async getSharedAllListingsReport(input: {
    accountScope: string;
    marketplaceId: string;
  }): Promise<SharedAllListingsReportLease | null> {
    const value = await this.getSharedReport({
      ...input,
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
    });
    return value as SharedAllListingsReportLease | null;
  }

  async getSharedAllListingsReportById(input: {
    accountScope: string;
    marketplaceId: string;
    reportId: string;
  }): Promise<SharedAllListingsReportLease | null> {
    const value = await this.getSharedReportById({
      ...input,
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      optionsKey: "preferredReportDocumentLocale=en_US",
    });
    return value as SharedAllListingsReportLease | null;
  }

  async getSharedReport(input: {
    accountScope: string;
    marketplaceId: string;
    reportType: SharedReportType;
    optionsKey: SharedReportOptionsKey;
  }): Promise<SharedReportLease | null> {
    const data = await this.read();
    const value = data.sharedAllListingsReports[sharedReportKey(input)];
    return value ? structuredClone(value) : null;
  }

  async getSharedReportById(input: {
    accountScope: string;
    marketplaceId: string;
    reportType: SharedReportType;
    optionsKey: SharedReportOptionsKey;
    reportId: string;
  }): Promise<SharedReportLease | null> {
    const data = await this.read();
    const value = Object.values(data.sharedAllListingsReports).find(
      (candidate) =>
        candidate.accountScope === input.accountScope &&
        candidate.marketplaceId === input.marketplaceId &&
        candidate.reportType === input.reportType &&
        candidate.optionsKey === input.optionsKey &&
        candidate.report.reportId === input.reportId,
    );
    return value ? structuredClone(value) : null;
  }

  async createSharedAllListingsReportIfAbsent(
    input: SharedAllListingsReportLease,
    now = Date.now(),
  ): Promise<{ created: boolean; lease: SharedAllListingsReportLease }> {
    const result = await this.createSharedReportIfAbsent(input, now);
    return {
      created: result.created,
      lease: result.lease as SharedAllListingsReportLease,
    };
  }

  async createSharedReportIfAbsent(
    input: SharedReportLease,
    now = Date.now(),
  ): Promise<{ created: boolean; lease: SharedReportLease }> {
    if (!Number.isSafeInteger(now) || now <= 0) {
      throw new Error("Invalid shared report prune time");
    }
    let created = false;
    let selected!: SharedReportLease;
    await this.mutate((data) => {
      for (const [candidateKey, candidate] of Object.entries(
        data.sharedAllListingsReports,
      )) {
        // Only evidence that is known to be safe to recreate may age out.
        // Ambiguous creates and terminal failures remain durable so a new date
        // range can never erase the no-blind-retry tombstone for an older one.
        if (
          candidate.expiresAt <= now &&
          (candidate.report.status === "DONE" ||
            candidate.report.status === "NOT_STARTED")
        ) {
          delete data.sharedAllListingsReports[candidateKey];
        }
      }
      const key = sharedReportKey(input);
      const existing = data.sharedAllListingsReports[key];
      if (existing) {
        selected = existing;
        return;
      }
      const legacyKey = legacySharedReportKey(input);
      const legacyCollision = Object.values(data.sharedAllListingsReports).find(
        (candidate) =>
          legacySharedReportKey(candidate) === legacyKey &&
          sharedReportKey(candidate) !== key,
      );
      if (legacyCollision) {
        throw new Error("Ambiguous legacy shared report identity");
      }
      selected = parseSharedReport(input);
      data.sharedAllListingsReports[key] = selected;
      created = true;
    });
    return { created, lease: structuredClone(selected) };
  }

  async updateSharedAllListingsReport(input: {
    leaseId: string;
    report: DurableReportLeg;
    updatedAt: number;
    expiresAt?: number;
    expectedUpdatedAt?: number;
  }): Promise<SharedAllListingsReportLease> {
    return this.updateSharedReport(input) as Promise<SharedAllListingsReportLease>;
  }

  async updateSharedReport(input: {
    leaseId: string;
    report: DurableReportLeg;
    updatedAt: number;
    expiresAt?: number;
    expectedUpdatedAt?: number;
  }): Promise<SharedReportLease> {
    let updated!: SharedReportLease;
    await this.mutate((data) => {
      const entry = Object.values(data.sharedAllListingsReports).find(
        (candidate) => candidate.leaseId === input.leaseId,
      );
      if (!entry) throw new Error("Persisted shared report not found");
      if (
        input.expectedUpdatedAt !== undefined &&
        entry.updatedAt !== input.expectedUpdatedAt
      ) {
        updated = entry;
        return;
      }
      entry.report = parseDurableReportLeg(input.report);
      entry.updatedAt = Math.max(input.updatedAt, entry.updatedAt + 1);
      if (input.expiresAt !== undefined) {
        if (
          !Number.isSafeInteger(input.expiresAt) ||
          input.expiresAt <= entry.createdAt
        ) {
          throw new Error("Invalid shared report expiry");
        }
        entry.expiresAt = input.expiresAt;
      }
      updated = entry;
    });
    return structuredClone(updated);
  }

  async deleteSharedAllListingsReport(leaseId: string): Promise<void> {
    return this.deleteSharedReport(leaseId);
  }

  async deleteSharedReport(leaseId: string): Promise<void> {
    await this.mutate((data) => {
      for (const [key, entry] of Object.entries(data.sharedAllListingsReports)) {
        if (entry.leaseId === leaseId) delete data.sharedAllListingsReports[key];
      }
    });
  }

  async createBrandSalesJobIfAbsent(
    input: BrandSalesJobRecord,
    _now = Date.now(),
  ): Promise<{ created: boolean; job: BrandSalesJobRecord }> {
    let created = false;
    let selected!: BrandSalesJobRecord;
    await this.mutate((data) => {
      const key = brandSalesSelectionKey(input);
      const existing = data.brandSalesJobs[key];
      if (existing) {
        if (isBrandSalesIncompatibleJob(existing)) {
          throw new Error("Persisted brand-sales job requires an explicit guarded retry");
        }
        selected = existing;
        return;
      }
      selected = parseBrandSalesJob(input);
      data.brandSalesJobs[key] = selected;
      created = true;
    });
    return { created, job: structuredClone(selected) };
  }

  async replaceIncompatibleBrandSalesJob(input: {
    expectedJobId: string;
    replacement: BrandSalesJobRecord;
  }): Promise<{ created: boolean; job: BrandSalesJobRecord }> {
    let created = false;
    let selected!: BrandSalesJobRecord;
    await this.mutate((data) => {
      const key = brandSalesSelectionKey(input.replacement);
      const existing = data.brandSalesJobs[key];
      if (!existing) {
        throw new Error("Persisted incompatible brand-sales job disappeared");
      }
      if (!isBrandSalesIncompatibleJob(existing)) {
        selected = existing;
        return;
      }
      if (existing.jobId !== input.expectedJobId) {
        throw new Error("Persisted incompatible brand-sales job changed");
      }
      selected = parseBrandSalesJob(input.replacement);
      data.brandSalesJobs[key] = selected;
      created = true;
    });
    return { created, job: structuredClone(selected) };
  }

  async updateBrandSalesJobLeg(input: {
    jobId: string;
    leg: "listing" | "shipment";
    value: BrandSalesReportLeg;
    updatedAt: number;
    expiresAt?: number;
  }): Promise<BrandSalesJobRecord> {
    let updated!: BrandSalesJobRecord;
    await this.mutate((data) => {
      const entry = Object.values(data.brandSalesJobs).find(
        (candidate): candidate is BrandSalesJobRecord =>
          candidate.jobId === input.jobId && !isBrandSalesIncompatibleJob(candidate),
      );
      if (!entry) throw new Error("Persisted brand-sales job not found");
      entry[input.leg] = parseDurableReportLeg(input.value);
      entry.updatedAt = Math.max(input.updatedAt, entry.updatedAt + 1);
      if (input.expiresAt !== undefined) {
        if (
          !Number.isSafeInteger(input.expiresAt) ||
          input.expiresAt <= entry.createdAt
        ) {
          throw new Error("Invalid persisted brand-sales expiry");
        }
        entry.expiresAt = input.expiresAt;
      }
      updated = entry;
    });
    return structuredClone(updated);
  }

  async deleteBrandSalesJob(jobId: string): Promise<void> {
    await this.mutate((data) => {
      for (const [key, entry] of Object.entries(data.brandSalesJobs)) {
        if (entry.jobId === jobId) delete data.brandSalesJobs[key];
      }
    });
  }

  async runIdempotentOperation<T>(input: OperationInput<T>): Promise<T> {
    const fingerprint = createHash("sha256")
      .update(input.fingerprint)
      .digest("hex");
    const ownerToken = randomUUID();
    let cachedResult: T | undefined;
    let claimed = false;
    await this.mutate((data) => {
      const now = Date.now();
      for (const [key, value] of Object.entries(data.ledger)) {
        // Only a canonically completed operation may age out. A pending or
        // unknown write can mean the App stopped after Amazon received the
        // PATCH; deleting that evidence would permit a blind duplicate write.
        if (value.state === "completed" && value.expiresAt < now) {
          delete data.ledger[key];
        }
      }
      const existing = data.ledger[input.idempotencyKey];
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new SpApiError("這個確認碼已用於另一筆操作。", {
            status: 409,
            code: "IDEMPOTENCY_CONFLICT",
          });
        }
        if (existing.state === "completed") {
          cachedResult = structuredClone(existing.response) as T;
          return;
        }
        throw operationError(existing.state);
      }
      if (VARIATION_OPERATION_TYPES.has(input.operationType)) {
        const activeVariationForSku = Object.values(data.ledger).find(
          (entry) =>
            VARIATION_OPERATION_TYPES.has(entry.operationType) &&
            entry.marketplaceId === input.marketplaceId &&
            entry.sellerSku === input.sellerSku &&
            entry.state !== "completed" &&
            (entry.accountScope === input.accountScope ||
              entry.accountScope === "legacy-unknown"),
        );
        if (activeVariationForSku) {
          throw operationError(activeVariationForSku.state);
        }
      }
      if (OFFER_OPERATION_TYPES.has(input.operationType)) {
        const activeOfferWrite = Object.values(data.ledger).find(
          (entry) =>
            OFFER_OPERATION_TYPES.has(entry.operationType) &&
            entry.marketplaceId === input.marketplaceId &&
            entry.sellerSku === input.sellerSku &&
            entry.state !== "completed" &&
            (entry.accountScope === input.accountScope ||
              entry.accountScope === "legacy-unknown"),
        );
        if (activeOfferWrite) throw operationError(activeOfferWrite.state);
      }
      if (LISTING_ATTRIBUTE_OPERATION_TYPES.has(input.operationType)) {
        const activeAttributeWrite = Object.values(data.ledger).find(
          (entry) =>
            LISTING_ATTRIBUTE_OPERATION_TYPES.has(entry.operationType) &&
            entry.marketplaceId === input.marketplaceId &&
            entry.sellerSku === input.sellerSku &&
            entry.state !== "completed" &&
            (entry.accountScope === input.accountScope ||
              entry.accountScope === "legacy-unknown"),
        );
        if (activeAttributeWrite) throw operationError(activeAttributeWrite.state);
      }
      const sequenceAt = Math.max(
        now,
        ...Object.values(data.ledger).map((entry) => entry.createdAt + 1),
      );
      data.ledger[input.idempotencyKey] = {
        operationType: input.operationType,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        accountScope: input.accountScope,
        fingerprint,
        ownerToken,
        state: "pending",
        response: null,
        createdAt: sequenceAt,
        updatedAt: sequenceAt,
        expiresAt: now + OPERATION_TTL_MS,
      };
      claimed = true;
    });
    if (!claimed) return cachedResult as T;

    try {
      const recordAccepted = async (response: T): Promise<void> => {
        await this.mutate((data) => {
          const entry = data.ledger[input.idempotencyKey];
          if (!entry || entry.ownerToken !== ownerToken) {
            throw new SpApiError(
              "Amazon 已接受寫入，但防重送帳本無法保存回查目標。請勿重送。",
              { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
            );
          }
          if (entry.state === "completed") return;
          entry.response = structuredClone(response);
          entry.updatedAt = Date.now();
        });
      };
      const result = await input.execute({ recordAccepted });
      await this.mutate((data) => {
        const entry = data.ledger[input.idempotencyKey];
        if (!entry || entry.ownerToken !== ownerToken) {
          throw new SpApiError(
            "Amazon 寫入可能已完成，但防重送帳本未能保存結果。請先回查 Amazon。",
            { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
          );
        }
        entry.state = "completed";
        entry.response = structuredClone(result);
        entry.updatedAt = Date.now();
      });
      return result;
    } catch (error) {
      await this.mutate((data) => {
        const entry = data.ledger[input.idempotencyKey];
        if (!entry || entry.ownerToken !== ownerToken) return;
        if (entry.state === "completed") return;
        if (resultMayBeUnknown(error)) {
          entry.state = "unknown";
          entry.updatedAt = Date.now();
        } else {
          delete data.ledger[input.idempotencyKey];
        }
      });
      if (error instanceof SpApiError) throw error;
      throw new SpApiError(
        "Amazon 寫入結果尚未確認。系統已禁止重送，請先回查 Amazon 狀態。",
        { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
      );
    }
  }

  /**
   * Checks a bounded group before its first Amazon write. The API router holds
   * the matching in-memory SKU reservations while this runs, so no other
   * renderer request can enter a conflicting listing-attribute write between
   * this check and the batch claims. This method deliberately does not create
   * durable pending entries: a pending ledger row must only exist once its
   * individual execute callback is ready to run.
   */
  async assertIdempotentOperationsAvailable(
    inputs: readonly IdempotentOperationAvailabilityInput[],
  ): Promise<void> {
    if (!inputs.length) return;
    const uniqueKeys = new Set<string>();
    const uniqueTargets = new Set<string>();
    for (const input of inputs) {
      if (uniqueKeys.has(input.idempotencyKey)) {
        throw new SpApiError("批次確認碼含有重複項目，已停止送出。", {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
        });
      }
      uniqueKeys.add(input.idempotencyKey);
      const target = [
        input.accountScope,
        input.marketplaceId,
        input.sellerSku,
        input.operationType,
      ].join("\u0000");
      if (uniqueTargets.has(target)) {
        throw new SpApiError("批次包含重複 SKU 操作，已停止送出。", {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
        });
      }
      uniqueTargets.add(target);
    }

    await this.mutate((data) => {
      const now = Date.now();
      for (const [key, value] of Object.entries(data.ledger)) {
        if (value.state === "completed" && value.expiresAt < now) {
          delete data.ledger[key];
        }
      }
      for (const input of inputs) {
        const fingerprint = createHash("sha256")
          .update(input.fingerprint)
          .digest("hex");
        const existing = data.ledger[input.idempotencyKey];
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new SpApiError("這個確認碼已用於另一筆操作。", {
              status: 409,
              code: "IDEMPOTENCY_CONFLICT",
            });
          }
          if (existing.state !== "completed") throw operationError(existing.state);
          continue;
        }
        if (LISTING_ATTRIBUTE_OPERATION_TYPES.has(input.operationType)) {
          const activeAttributeWrite = Object.values(data.ledger).find(
            (entry) =>
              LISTING_ATTRIBUTE_OPERATION_TYPES.has(entry.operationType) &&
              entry.marketplaceId === input.marketplaceId &&
              entry.sellerSku === input.sellerSku &&
              entry.state !== "completed" &&
              (entry.accountScope === input.accountScope ||
                entry.accountScope === "legacy-unknown"),
          );
          if (activeAttributeWrite) throw operationError(activeAttributeWrite.state);
        }
      }
    });
  }

  async reconcileIdempotentOperations(input: {
    operationTypes: readonly LedgerOperationType[];
    marketplaceId: string;
    sellerSku: string;
    accountScope: string;
    reconcile(response: unknown, operationType: LedgerOperationType): unknown | null;
  }): Promise<number> {
    let reconciled = 0;
    await this.mutate((data) => {
      const now = Date.now();
      for (const entry of Object.values(data.ledger)) {
        if (
          entry.marketplaceId !== input.marketplaceId ||
          entry.sellerSku !== input.sellerSku ||
          entry.accountScope !== input.accountScope ||
          !input.operationTypes.includes(entry.operationType) ||
          (entry.state !== "pending" && entry.state !== "unknown") ||
          entry.response === null
        ) {
          continue;
        }
        let result: unknown | null = null;
        try {
          result = input.reconcile(
            structuredClone(entry.response),
            entry.operationType,
          );
        } catch {
          result = null;
        }
        if (result === null) continue;
        entry.state = "completed";
        entry.response = structuredClone(result);
        entry.updatedAt = now;
        entry.expiresAt = now + OPERATION_TTL_MS;
        reconciled += 1;
      }
    });
    return reconciled;
  }

  private async read(): Promise<StoreData> {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as {
        version?: unknown;
        profiles?: Record<string, ProductMasterProfile>;
        ledger?: Record<
          string,
          Omit<LedgerEntry, "accountScope"> & { accountScope?: string }
        >;
        brandSalesJobs?: Record<string, unknown>;
        sharedAllListingsReports?: Record<string, unknown>;
        contentAuditSnapshots?: Record<string, unknown>;
      };
      if (
        (raw.version !== 1 && raw.version !== 2) ||
        !raw.profiles ||
        !raw.ledger ||
        typeof raw.profiles !== "object" ||
        typeof raw.ledger !== "object"
      ) {
        throw new Error("Unsupported local store version");
      }
      this.data = {
        version: 2,
        profiles: raw.profiles,
        ledger: Object.fromEntries(
          Object.entries(raw.ledger).map(([key, entry]) => [
            key,
            {
              ...entry,
              accountScope:
                typeof entry.accountScope === "string" && entry.accountScope
                  ? entry.accountScope
                  : "legacy-unknown",
            },
          ]),
        ),
        brandSalesJobs: Object.fromEntries(
          Object.entries(raw.brandSalesJobs ?? {}).flatMap(([key, job]) => {
            try {
              const parsed = parseStoredBrandSalesJob(job);
              return brandSalesSelectionKey(parsed) === key
                ? [[key, parsed]]
                : [];
            } catch {
              return [];
            }
          }),
        ),
        sharedAllListingsReports: Object.fromEntries(
          Object.entries(raw.sharedAllListingsReports ?? {}).flatMap(
            ([key, report]) => {
              try {
                const parsed = parseSharedReport(report);
                const canonicalKey = sharedReportKey(parsed);
                return canonicalKey === key || legacySharedReportKey(parsed) === key
                  ? [[canonicalKey, parsed]]
                  : [];
              } catch {
                return [];
              }
            },
          ),
        ),
        contentAuditSnapshots: parseContentAuditSnapshotCollection(
          raw.contentAuditSnapshots,
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = emptyStore();
    }
    return this.data;
  }

  private async migrateLegacyProfiles(
    accountScope: string,
    marketplaceId: string,
  ): Promise<void> {
    const data = await this.read();
    const legacyPrefix = `${marketplaceId}:`;
    if (!Object.keys(data.profiles).some((key) => key.startsWith(legacyPrefix))) return;
    await this.mutate((draft) => {
      for (const [key, profile] of Object.entries(draft.profiles)) {
        if (!key.startsWith(legacyPrefix)) continue;
        const scopedKey = profileKey(accountScope, profile.marketplaceId, profile.sellerSku);
        if (!draft.profiles[scopedKey]) draft.profiles[scopedKey] = profile;
        delete draft.profiles[key];
      }
    });
  }

  private async mutate(mutator: (data: StoreData) => void): Promise<void> {
    const task = this.mutationQueue.then(async () => {
      const data = await this.read();
      mutator(data);
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      const serialized = persistedStore(data);
      await writeFile(temporaryPath, `${JSON.stringify(serialized, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    });
    this.mutationQueue = task.catch(() => undefined);
    return task;
  }
}
