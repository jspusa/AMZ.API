import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { SpApiError, SpApiPreCommitError } from "./amazon/sp-api";

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
  | "GET_FBA_INVENTORY_PLANNING_DATA";

export type SharedReportOptionsKey =
  | "preferredReportDocumentLocale=en_US"
  | "marketplaceIds=selected";

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

type StoreData = {
  version: 2;
  profiles: Record<string, ProductMasterProfile>;
  ledger: Record<string, LedgerEntry>;
  brandSalesJobs: Record<string, StoredBrandSalesJobRecord>;
  // The persisted property name is intentionally retained for store-version-2
  // rollback compatibility. Current builds may also place other allowlisted
  // Reports API leases here; older builds ignore those optional entries.
  sharedAllListingsReports: Record<string, SharedReportLease>;
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

const OPERATION_TTL_MS = 24 * 60 * 60 * 1_000;
const VARIATION_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "variation_detach",
  "variation_attach",
]);
const OFFER_OPERATION_TYPES = new Set<LedgerEntry["operationType"]>([
  "price",
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
  return `${input.accountScope}:${input.marketplaceId}:${input.reportType}:${input.optionsKey}`;
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
    (raw.reportType === "GET_FBA_INVENTORY_PLANNING_DATA" &&
      raw.optionsKey === "marketplaceIds=selected");
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
    if (Object.values(data.brandSalesJobs).some(isBrandSalesIncompatibleJob)) {
      // Persist the rollback-readable sentinel immediately. Waiting for an
      // unrelated later mutation would leave the original missing-window row
      // vulnerable to being dropped if the user launches an older App build.
      await this.mutate(() => undefined);
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

  async findBrandSalesListingCandidate(input: {
    accountScope: string;
    marketplaceId: string;
    now?: number;
  }): Promise<BrandSalesJobRecord | null> {
    const now = input.now ?? Date.now();
    const data = await this.read();
    const value = Object.values(data.brandSalesJobs)
      .filter(
        (candidate): candidate is BrandSalesJobRecord =>
          !isBrandSalesIncompatibleJob(candidate),
      )
      .filter(
        (candidate) =>
          candidate.accountScope === input.accountScope &&
          candidate.marketplaceId === input.marketplaceId &&
          candidate.expiresAt > now &&
          candidate.listing.status !== "NOT_STARTED" &&
          candidate.listing.status !== "CREATE_FAILED",
      )
      .sort(
        (left, right) =>
          (right.listing.createdAt ?? right.createdAt) -
          (left.listing.createdAt ?? left.createdAt),
      )[0];
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
    _now = Date.now(),
  ): Promise<{ created: boolean; lease: SharedReportLease }> {
    let created = false;
    let selected!: SharedReportLease;
    await this.mutate((data) => {
      const key = sharedReportKey(input);
      const existing = data.sharedAllListingsReports[key];
      if (existing) {
        selected = existing;
        return;
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
                return sharedReportKey(parsed) === key
                  ? [[key, parsed]]
                  : [];
              } catch {
                return [];
              }
            },
          ),
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
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
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
