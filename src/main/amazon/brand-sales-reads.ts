import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { throwIfAborted } from "../abort-utils";
import {
  BRAND_SALES_DEFINITIONS,
  CATEGORY_SALES_DEFINITIONS,
  buildBrandSalesSnapshot,
  parseFbaShipmentSalesReport,
  type BrandSalesListing,
  type BrandSalesSnapshot,
} from "./brand-sales";
import type { FbaCatalogSeed } from "./catalog-report-reads";
import {
  assertFbaShipmentSalesWindow,
  fbaShipmentSalesDateKey,
  strictReportInstant,
  type FbaShipmentSalesWindow,
} from "./revenue-report-windows";
import { SpApiError } from "./sp-api-error";

export type BrandSalesReadInput = Readonly<
  FbaShipmentSalesWindow & {
    listings: readonly FbaCatalogSeed[];
    shipmentDocument: string;
    signal?: AbortSignal;
    fetchedAt?: string;
  }
>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validSegments(
  value: unknown,
  definitions: readonly Readonly<{ key: string; label: string; color: string }>[],
): boolean {
  if (!Array.isArray(value) || value.length !== definitions.length) return false;
  return value.every((candidate, index) => {
    const segment = record(candidate);
    const definition = definitions[index];
    return Boolean(
      segment &&
      segment.key === definition.key &&
      segment.label === definition.label &&
      segment.color === definition.color &&
      nonNegativeNumber(segment.amount) &&
      nonNegativeNumber(segment.percentage) &&
      (segment.percentage as number) <= 100 &&
      Number.isSafeInteger(segment.skuCount) &&
      (segment.skuCount as number) >= 0 &&
      Number.isSafeInteger(segment.unitCount) &&
      (segment.unitCount as number) >= 0
    );
  });
}

/**
 * Revalidates an injected demo/live reader result and returns only the public
 * snapshot allowlist. The coordinator may cache this projection only after
 * every immutable job/window identity field matches exactly.
 */
export function projectBrandSalesSnapshot(
  value: unknown,
  expected: Readonly<FbaShipmentSalesWindow & { mode: "live" | "demo" }>,
): BrandSalesSnapshot {
  const snapshot = record(value);
  const marketplace = marketplaceById(expected.marketplaceId);
  const summary = record(snapshot?.summary);
  const fetchedAt = strictReportInstant(snapshot?.fetchedAt);
  const dataThrough = strictReportInstant(expected.dataEndTime);
  const summaryCounts = [
    "currentFbaSkuCount",
    "soldFbaSkuCount",
    "soldCurrentFbaSkuCount",
    "unmatchedCurrentFbaRowCount",
  ];
  const validSummary = Boolean(
    summary &&
    [
      "amount",
      "classifiedAmount",
      "unclassifiedAmount",
    ].every((key) => nonNegativeNumber(summary[key])) &&
    [...summaryCounts, "unitCount"].every((key) =>
      Number.isSafeInteger(summary[key]) && (summary[key] as number) >= 0
    )
  );
  if (
    !snapshot ||
    !marketplace ||
    snapshot.schemaVersion !== 2 ||
    snapshot.source !== "FBA_CUSTOMER_SHIPMENT_SALES_REPORT" ||
    snapshot.mode !== expected.mode ||
    snapshot.marketplaceId !== expected.marketplaceId ||
    snapshot.startDate !== expected.startDate ||
    snapshot.endDate !== expected.endDate ||
    snapshot.dataThrough !== expected.dataEndTime ||
    snapshot.rangeFreshness !== expected.rangeFreshness ||
    snapshot.currencyCode !== marketplace.currency ||
    fetchedAt === null ||
    dataThrough === null ||
    fetchedAt < dataThrough ||
    typeof snapshot.notice !== "string" ||
    !validSegments(snapshot.segments, BRAND_SALES_DEFINITIONS) ||
    !validSegments(snapshot.categorySegments, CATEGORY_SALES_DEFINITIONS) ||
    !validSummary
  ) {
    throw new SpApiError("品牌營收讀取結果與固定報表工作不一致。", {
      status: 502,
      code: "REPORT_FORMAT_UNSUPPORTED",
    });
  }
  return {
    schemaVersion: 2,
    mode: snapshot.mode as "live" | "demo",
    marketplaceId: snapshot.marketplaceId as string,
    startDate: snapshot.startDate as string,
    endDate: snapshot.endDate as string,
    fetchedAt: snapshot.fetchedAt as string,
    dataThrough: snapshot.dataThrough as string,
    rangeFreshness: snapshot.rangeFreshness as BrandSalesSnapshot["rangeFreshness"],
    currencyCode: snapshot.currencyCode as string,
    segments: (snapshot.segments as unknown[]).map((value) => {
      const segment = record(value)!;
      return {
        key: segment.key,
        label: segment.label,
        color: segment.color,
        amount: segment.amount,
        percentage: segment.percentage,
        skuCount: segment.skuCount,
        unitCount: segment.unitCount,
      };
    }) as BrandSalesSnapshot["segments"],
    categorySegments: (snapshot.categorySegments as unknown[]).map((value) => {
      const segment = record(value)!;
      return {
        key: segment.key,
        label: segment.label,
        color: segment.color,
        amount: segment.amount,
        percentage: segment.percentage,
        skuCount: segment.skuCount,
        unitCount: segment.unitCount,
      };
    }) as BrandSalesSnapshot["categorySegments"],
    summary: {
      amount: summary!.amount as number,
      unitCount: summary!.unitCount as number,
      classifiedAmount: summary!.classifiedAmount as number,
      unclassifiedAmount: summary!.unclassifiedAmount as number,
      currentFbaSkuCount: summary!.currentFbaSkuCount as number,
      soldFbaSkuCount: summary!.soldFbaSkuCount as number,
      soldCurrentFbaSkuCount: summary!.soldCurrentFbaSkuCount as number,
      unmatchedCurrentFbaRowCount: summary!.unmatchedCurrentFbaRowCount as number,
    },
    source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    notice: snapshot.notice,
  };
}

/**
 * Projects canonical current-FBA catalog seeds plus one completed shipment
 * document into the shared brand/category snapshot. It has no lifecycle,
 * transport or download power.
 */
export function readBrandSalesShipmentDocument(
  input: BrandSalesReadInput,
): BrandSalesSnapshot {
  throwIfAborted(input.signal);
  const window = assertFbaShipmentSalesWindow(input);
  const marketplace = marketplaceById(input.marketplaceId);
  if (!marketplace) {
    throw new SpApiError("Amazon 品牌營收站點無法辨識。", {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  const listings: BrandSalesListing[] = input.listings.map(
    ({ sellerSku, title }) => ({ sellerSku, title }),
  );
  throwIfAborted(input.signal);
  const sales = parseFbaShipmentSalesReport(input.shipmentDocument).filter(
    (sale) => {
      const key = fbaShipmentSalesDateKey(
        sale.shipmentDate,
        input.marketplaceId,
      );
      return key >= input.startDate && key <= input.endDate;
    },
  );
  throwIfAborted(input.signal);
  return buildBrandSalesSnapshot({
    mode: "live",
    marketplaceId: input.marketplaceId,
    startDate: input.startDate,
    endDate: input.endDate,
    currencyCode: marketplace.currency,
    listings,
    sales,
    dataThrough: window.dataEndTime,
    rangeFreshness: window.rangeFreshness,
    fetchedAt: input.fetchedAt,
  });
}
