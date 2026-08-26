import { randomUUID } from "node:crypto";
import type { ApiResponse } from "../../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { forwardAbort, throwIfAborted } from "../abort-utils";
import type {
  AuditSuiteRunControl,
  AuditSuiteSectionRunners,
} from "./audit-suite-coordinator";
import type { AuditSuiteContext } from "./audit-suite-context";
import type { AuditSuiteListingsResource } from "./audit-suite-resources";
import type {
  CatalogExportRow,
  FbaCatalogExport,
} from "./catalog-report-reads";
import { ContextBoundAuditSnapshotStore } from
  "./context-bound-audit-snapshot";
import {
  auditListingImageRows,
  IMAGE_AUDIT_MINIMUM_IMAGES,
} from "./image-audit";
import { SpApiError } from "./sp-api-error";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "./sp-execution-context";
import type { FbaVariationGroupingData } from
  "./variation-catalog-reads";
import {
  createImageAuditWorkbook,
  type CreateImageAuditWorkbookInput,
} from "./xlsx";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const IMAGE_AUDIT_FULL_SNAPSHOT_TTL_MS = 10 * 60 * 1_000;
export const IMAGE_AUDIT_STANDALONE_TTL_MS = 30 * 60 * 1_000;

type ImageAuditCoreSnapshot = ReturnType<typeof auditListingImageRows>;

export type ImageAuditSnapshot = Omit<
  ImageAuditCoreSnapshot,
  "marketplaceId"
> & Readonly<{
  marketplaceId: MarketplaceId;
  exportId: string;
}>;

type ImageAuditProjectionInput = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  listings: FbaCatalogExport;
  grouping: FbaVariationGroupingData<CatalogExportRow>;
  signal?: AbortSignal;
}>;

export type ImageAuditListingsInput = Readonly<{
  context: SpExecutionContext;
  marketplaceId: MarketplaceId;
  listings: FbaCatalogExport;
  signal?: AbortSignal;
  onGroupingProgress?: (progress: Readonly<{
    completedBatches: number;
    totalBatches: number;
  }>) => void | Promise<void>;
}>;

export type ImageAuditGroupingReader = (input: Readonly<{
  marketplaceId: MarketplaceId;
  rows: readonly CatalogExportRow[];
  signal: AbortSignal;
  onProgress?: ImageAuditListingsInput["onGroupingProgress"];
}>) => Promise<FbaVariationGroupingData<CatalogExportRow>>;

export interface ImageAuditOwnerPort {
  runAuditSuite(input: Readonly<{
    context: AuditSuiteContext;
    control: AuditSuiteRunControl;
    listings: AuditSuiteListingsResource;
  }>): ReturnType<AuditSuiteSectionRunners["image"]>;
  captureFromListings(
    input: ImageAuditListingsInput,
  ): Promise<ImageAuditSnapshot>;
  captureStandaloneFromListings(
    input: ImageAuditListingsInput,
  ): Promise<ImageAuditSnapshot>;
  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ImageAuditSnapshot>;
  download(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ApiResponse>;
  clear(): void;
}

export type ImageAuditOwnerInput = Readonly<{
  context: SpExecutionContextAdapter;
  createWorkbook?: (input: CreateImageAuditWorkbookInput) => Uint8Array;
  ttlMs?: number;
  standaloneTtlMs?: number;
  readGrouping: ImageAuditGroupingReader;
  now?: () => number;
  createId?: () => string;
}>;

function bytes(
  value: Uint8Array,
  headers: Record<string, string>,
): ApiResponse {
  return {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": XLSX_CONTENT_TYPE,
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: { kind: "bytes", value },
  };
}

function snapshotDate(fetchedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/u.exec(fetchedAt);
  if (!match || !Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("Image audit snapshot time is invalid.");
  }
  const normalized = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ));
  if (
    normalized.getUTCFullYear() !== Number(match[1]) ||
    normalized.getUTCMonth() !== Number(match[2]) - 1 ||
    normalized.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("Image audit snapshot time is invalid.");
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Complete owner of the image-audit projection, opaque export capability,
 * short-lived context-bound snapshot, workbook, filename, and HTTP headers.
 */
export class ImageAuditOwner implements ImageAuditOwnerPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly createWorkbook: (
    input: CreateImageAuditWorkbookInput,
  ) => Uint8Array;
  private readonly createId: () => string;
  private readonly standaloneTtlMs: number;
  private readonly readGrouping: ImageAuditGroupingReader;
  private readonly snapshots: ContextBoundAuditSnapshotStore<ImageAuditSnapshot>;
  private readonly controls = new Set<AbortController>();
  private lifecycleRevision = 0;

  constructor(input: ImageAuditOwnerInput) {
    this.context = input.context;
    this.createWorkbook = input.createWorkbook ?? createImageAuditWorkbook;
    this.createId = input.createId ?? randomUUID;
    this.readGrouping = input.readGrouping;
    this.standaloneTtlMs = input.standaloneTtlMs ??
      IMAGE_AUDIT_STANDALONE_TTL_MS;
    if (!Number.isSafeInteger(this.standaloneTtlMs) || this.standaloneTtlMs < 1) {
      throw new Error("Image audit retention must be a positive integer.");
    }
    this.snapshots = new ContextBoundAuditSnapshotStore({
      context: input.context,
      ttlMs: input.ttlMs ?? IMAGE_AUDIT_FULL_SNAPSHOT_TTL_MS,
      now: input.now,
      expiredMessage:
        "圖片健檢 Excel 快照已過期或站點不符，請重新掃描。",
    });
  }

  async runAuditSuite(
    input: Parameters<ImageAuditOwnerPort["runAuditSuite"]>[0],
  ): ReturnType<AuditSuiteSectionRunners["image"]> {
    const revision = this.lifecycleRevision;
    const operation = new AbortController();
    const unlinkCaller = forwardAbort(operation, input.control.signal);
    this.controls.add(operation);
    try {
      throwIfAborted(operation.signal);
      this.assertLifecycleCurrent(revision);
      const audit = auditListingImageRows({
        marketplaceId: input.context.marketplaceId,
        fetchedAt: input.listings.data.fetchedAt,
        rows: input.listings.data.rows,
        minimumImages: IMAGE_AUDIT_MINIMUM_IMAGES,
      });
      const rows = audit.rows
        .filter((row) =>
          row.readStatus === "incomplete" || row.imageCount < audit.minimumImages
        )
        .map((row) => ({
          sellerSku: row.sellerSku,
          title: row.title,
          asin: row.asin,
          imageCount: row.readStatus === "complete" ? row.imageCount : null,
          finding: row.readStatus === "complete"
            ? `少於 ${audit.minimumImages} 張`
            : "讀取未完成",
          notice: row.readErrors.map((error) => error.message).join("；") ||
            `已核對圖片 ${row.imageCount} 張。`,
        }));
      throwIfAborted(operation.signal);
      this.assertLifecycleCurrent(revision);
      return {
        ...input.context,
        status: audit.summary.incomplete ? "partial" : "completed",
        fetchedAt: audit.fetchedAt,
        notice: audit.summary.incomplete
          ? `${audit.summary.incomplete} 個 SKU 圖片讀取未完成；圖片數保持未知。`
          : `已核對 ${audit.summary.total} 個 FBA SKU 的圖片數。`,
        payload: rows,
      };
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      this.assertLifecycleCurrent(revision);
      throwIfAborted(operation.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(operation);
    }
  }

  async captureFromListings(
    input: ImageAuditListingsInput,
  ): Promise<ImageAuditSnapshot> {
    return this.captureFromListingsWithRetention(input);
  }

  async captureStandaloneFromListings(
    input: ImageAuditListingsInput,
  ): Promise<ImageAuditSnapshot> {
    return this.captureFromListingsWithRetention(
      input,
      this.standaloneTtlMs,
    );
  }

  private async captureFromListingsWithRetention(
    input: ImageAuditListingsInput,
    retentionMs?: number,
  ): Promise<ImageAuditSnapshot> {
    const revision = this.lifecycleRevision;
    const control = new AbortController();
    const unlinkCaller = forwardAbort(control, input.signal);
    this.controls.add(control);
    try {
      throwIfAborted(control.signal);
      if (input.context.marketplaceId !== input.marketplaceId) {
        throw this.contextInvalidated();
      }
      await this.context.assertCurrent(input.context);
      this.assertLifecycleCurrent(revision);
      const grouping = await this.readGrouping({
        marketplaceId: input.marketplaceId,
        rows: input.listings.rows,
        signal: control.signal,
        onProgress: input.onGroupingProgress,
      });
      throwIfAborted(control.signal);
      this.assertLifecycleCurrent(revision);
      return await this.captureWithRetention({
        context: input.context,
        marketplaceId: input.marketplaceId,
        listings: input.listings,
        grouping,
        signal: control.signal,
      }, retentionMs, revision);
    } catch (error) {
      if (error instanceof SpExecutionContextError) throw error;
      await this.context.assertCurrent(input.context);
      this.assertLifecycleCurrent(revision);
      throwIfAborted(control.signal);
      throw error;
    } finally {
      unlinkCaller();
      this.controls.delete(control);
    }
  }

  private async captureWithRetention(
    input: ImageAuditProjectionInput,
    retentionMs?: number,
    expectedRevision = this.lifecycleRevision,
  ): Promise<ImageAuditSnapshot> {
    const revision = expectedRevision;
    throwIfAborted(input.signal);
    this.assertSourceIdentity(input);
    await this.context.assertCurrent(input.context);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(input.signal);

    const auditableSellerSkus = new Set(
      input.grouping.rows
        .filter((row) => row.role !== "parent")
        .map((row) => row.sellerSku),
    );
    const audit = auditListingImageRows({
      marketplaceId: input.marketplaceId,
      fetchedAt: input.listings.fetchedAt,
      rows: input.listings.rows
        .filter((row) => auditableSellerSkus.has(row.sellerSku))
        .map((row) => ({
          sellerSku: row.sellerSku,
          asin: row.asin,
          productType: row.productType,
          title: row.title,
          imageUrls: row.imageUrls,
          readStatus: row.readStatus,
          readErrors: row.readErrors,
        })),
      minimumImages: IMAGE_AUDIT_MINIMUM_IMAGES,
    });
    const exportId = this.createId();
    const snapshot: ImageAuditSnapshot = {
      ...audit,
      marketplaceId: input.marketplaceId,
      exportId,
    };
    await this.context.assertCurrent(input.context);
    this.assertLifecycleCurrent(revision);
    throwIfAborted(input.signal);
    this.snapshots.publish({
      context: input.context,
      marketplaceId: input.marketplaceId,
      snapshotId: exportId,
      snapshot,
      ttlMs: retentionMs,
    });
    return structuredClone(snapshot);
  }

  read(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ImageAuditSnapshot> {
    return this.snapshots.read({
      marketplaceId: input.marketplaceId,
      snapshotId: input.exportId,
    });
  }

  async download(input: Readonly<{
    marketplaceId: MarketplaceId;
    exportId: string;
  }>): Promise<ApiResponse> {
    const snapshot = await this.read(input);
    const marketplace = marketplaceById(input.marketplaceId);
    if (!marketplace) throw new Error("Amazon marketplace is unsupported.");
    const workbook = this.createWorkbook({
      marketplaceId: input.marketplaceId,
      marketplaceLabel: `${marketplace.shortLabel} · ${marketplace.name}`,
      fetchedAt: snapshot.fetchedAt,
      minimumImages: snapshot.minimumImages,
      rows: snapshot.rows,
    });
    const date = snapshotDate(snapshot.fetchedAt);
    const filename =
      `amazon-fba-image-audit-${marketplace.shortLabel.toLowerCase()}-${date}.xlsx`;
    const localizedFilename =
      `FBA-圖片健檢-${marketplace.shortLabel}-${date}.xlsx`;
    return bytes(workbook, {
      "content-disposition":
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(localizedFilename)}`,
      "x-exported-fba-sku-count": String(snapshot.summary.total),
      "x-image-audit-under-minimum-count": String(snapshot.summary.underMinimum),
      "x-image-audit-incomplete-count": String(snapshot.summary.incomplete),
    });
  }

  clear(): void {
    this.lifecycleRevision += 1;
    const reason = this.contextInvalidated();
    for (const control of this.controls) control.abort(reason);
    this.controls.clear();
    this.snapshots.clear();
  }

  private contextInvalidated(): SpExecutionContextError {
    return new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }

  private assertSourceIdentity(input: ImageAuditProjectionInput): void {
    if (
      input.context.marketplaceId !== input.marketplaceId ||
      input.grouping.marketplaceId !== input.marketplaceId
    ) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      );
    }
    const listingSellerSkus = new Set(
      input.listings.rows.map((row) => row.sellerSku),
    );
    const groupingSellerSkus = new Set(
      input.grouping.rows.map((row) => row.sellerSku),
    );
    if (
      listingSellerSkus.size !== input.listings.rows.length ||
      groupingSellerSkus.size !== input.grouping.rows.length ||
      listingSellerSkus.size !== groupingSellerSkus.size ||
      ![...listingSellerSkus].every((sellerSku) =>
        groupingSellerSkus.has(sellerSku))
    ) {
      throw new SpApiError("FBA Listing 與 relationships SKU 範圍不一致。", {
        status: 409,
        code: "SNAPSHOT_INVALID",
      });
    }
  }

  private assertLifecycleCurrent(expected: number): void {
    if (this.lifecycleRevision === expected) return;
    throw new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon 執行環境已更新；請重新開始這次操作。",
    );
  }
}
