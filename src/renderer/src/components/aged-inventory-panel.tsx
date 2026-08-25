"use client";

import { useEffect, useRef, useState } from "react";
import { auditExportFilename } from "../audit-export-filename";
import {
  pollStandaloneAuditJob,
  shouldResumeStandaloneAuditJob,
  startStandaloneAuditJob,
  standaloneAuditReconnectRevision,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";

type ReportReply = {
  ready: boolean;
  reportId: string | null;
  documentId: string | null;
  status: string | null;
  message: string;
};

type AgedInventoryRow = {
  sellerSku: string;
  fnSku: string;
  asin: string;
  title: string;
  condition: string;
  available: number | null;
  totalAgedUnits: number;
  agedOver180: number;
  ageBuckets: Array<{
    key: string;
    label: string;
    units: number;
    over180: boolean;
  }>;
  estimatedExcessQuantity: number | null;
  recommendedRemovalQuantity: number | null;
  daysOfSupply: number | null;
  currencyCode: string | null;
  estimatedStorageCostNextMonth: number | null;
  estimatedAgedSurcharge: number | null;
  agedSurchargeBuckets: Array<{
    key: string;
    label: string;
    quantity: number | null;
    estimatedCharge: number | null;
  }>;
  alert: string;
  recommendedAction: string;
  snapshotDate: string | null;
};

export type AgedInventoryAgeBucketOverview = {
  key: string;
  label: string;
  over180: boolean;
  units: number;
  reportedSkuCount: number;
  totalSkuCount: number;
};

export type AgedInventorySurchargeBucketOverview = {
  key: string;
  label: string;
  quantity: number | null;
  quantityReportedSkuCount: number;
  estimatedCharge: number | null;
  chargeReportedSkuCount: number;
  totalSkuCount: number;
};

type FeeAvailability = "complete" | "partial" | "unavailable";

type AgedInventorySnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  rows: AgedInventoryRow[];
  summary: {
    skuCount: number;
    agedOver180SkuCount: number;
    totalAgedUnits: number;
    agedOver180: number;
    excessAvailability: FeeAvailability;
    estimatedExcessQuantity: number | null;
    excessReportedSkuCount: number;
    currencyCode: string | null;
    storageCostAvailability: FeeAvailability;
    estimatedStorageCostNextMonth: number | null;
    storageCostReportedSkuCount: number;
    agedSurchargeAvailability: FeeAvailability;
    estimatedAgedSurcharge: number | null;
    agedSurchargeReportedSkuCount: number;
  };
  expiration: {
    currentFbaExpirationDatesAvailable: false;
    nearExpiryUnits: null;
    expiredUnits: null;
    inboundPlanExpirationDatesAvailable: true;
    notice: string;
  };
  notice: string;
};

type ApiProblem = { message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

function nullableNonNegativeNumber(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function safeIntegerTotal(values: number[], label: string): number {
  let total = 0;
  for (const value of values) {
    const next = total + value;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !Number.isSafeInteger(next)
    ) {
      throw new Error(`${label}加總超出安全範圍，已停止顯示。`);
    }
    total = next;
  }
  return total;
}

function moneyCents(value: number, label: string): number {
  const cents = Math.round(value * 100);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(cents) ||
    cents / 100 !== value
  ) {
    throw new Error(`${label}超出安全貨幣精度，已停止顯示。`);
  }
  return cents;
}

function moneyValueFromCents(cents: number, label: string): number {
  const value = cents / 100;
  if (Math.round(value * 100) !== cents) {
    throw new Error(`${label}加總超出安全範圍，已停止顯示。`);
  }
  return value;
}

function safeMoneyTotal(values: number[], label: string): number {
  const cents = safeIntegerTotal(
    values.map((value) => moneyCents(value, label)),
    label,
  );
  return moneyValueFromCents(cents, label);
}

function feeAvailabilityValue(value: unknown): value is FeeAvailability {
  return value === "complete" || value === "partial" || value === "unavailable";
}

export function aggregateAgeBuckets(
  rows: ReadonlyArray<Pick<AgedInventoryRow, "ageBuckets">>,
): AgedInventoryAgeBucketOverview[] {
  const template = rows[0]?.ageBuckets ?? [];
  return template.map((bucket, index) => {
    let units = 0;
    for (const row of rows) {
      const candidate = row.ageBuckets[index];
      if (
        row.ageBuckets.length !== template.length ||
        !candidate ||
        candidate.key !== bucket.key ||
        candidate.label !== bucket.label ||
        candidate.over180 !== bucket.over180
      ) {
        throw new Error("FBA 庫齡彙總使用不同區域欄位，已停止顯示。");
      }
      units = safeIntegerTotal(
        [units, candidate.units],
        `FBA ${bucket.label}庫齡數量`,
      );
    }
    return {
      key: bucket.key,
      label: bucket.label,
      over180: bucket.over180,
      units,
      reportedSkuCount: rows.length,
      totalSkuCount: rows.length,
    };
  });
}

export function aggregateAgedSurchargeBuckets(
  rows: ReadonlyArray<Pick<AgedInventoryRow, "agedSurchargeBuckets">>,
): AgedInventorySurchargeBucketOverview[] {
  const template = rows[0]?.agedSurchargeBuckets ?? [];
  return template.map((bucket, index) => {
    let quantity = 0;
    let quantityReportedSkuCount = 0;
    let estimatedChargeCents = 0;
    let chargeReportedSkuCount = 0;
    for (const row of rows) {
      const candidate = row.agedSurchargeBuckets[index];
      if (
        row.agedSurchargeBuckets.length !== template.length ||
        !candidate ||
        candidate.key !== bucket.key ||
        candidate.label !== bucket.label
      ) {
        throw new Error("FBA AIS 預估計費彙總使用不同區域欄位，已停止顯示。");
      }
      if (candidate.quantity !== null) {
        quantity = safeIntegerTotal(
          [quantity, candidate.quantity],
          `FBA ${bucket.label}計費數量`,
        );
        quantityReportedSkuCount += 1;
      }
      if (candidate.estimatedCharge !== null) {
        estimatedChargeCents = safeIntegerTotal(
          [
            estimatedChargeCents,
            moneyCents(
              candidate.estimatedCharge,
              `FBA ${bucket.label}預估附加費`,
            ),
          ],
          `FBA ${bucket.label}預估附加費`,
        );
        chargeReportedSkuCount += 1;
      }
    }
    return {
      key: bucket.key,
      label: bucket.label,
      quantity:
        quantityReportedSkuCount === rows.length ? quantity : null,
      quantityReportedSkuCount,
      estimatedCharge:
        chargeReportedSkuCount === rows.length
          ? moneyValueFromCents(
              estimatedChargeCents,
              `FBA ${bucket.label}預估附加費`,
            )
          : null,
      chargeReportedSkuCount,
      totalSkuCount: rows.length,
    };
  });
}

function reportReply(value: unknown): ReportReply {
  if (!isRecord(value)) throw new Error("FBA 庫齡報表回應格式無效。");
  return {
    ready: value.ready === true,
    reportId: typeof value.reportId === "string" ? value.reportId : null,
    documentId: typeof value.documentId === "string" ? value.documentId : null,
    status: typeof value.status === "string" ? value.status : null,
    message:
      typeof value.message === "string"
        ? value.message
        : typeof value.notice === "string"
          ? value.notice
          : "",
  };
}

export function parseAgedInventorySnapshot(
  value: unknown,
  marketplaceId: string,
): AgedInventorySnapshot {
  if (
    !isRecord(value) ||
    value.marketplaceId !== marketplaceId ||
    (value.mode !== "live" && value.mode !== "demo") ||
    typeof value.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(value.fetchedAt)) ||
    typeof value.notice !== "string" ||
    !Array.isArray(value.rows) ||
    value.rows.length > 20_000 ||
    !isRecord(value.summary) ||
    !isRecord(value.expiration) ||
    value.expiration.currentFbaExpirationDatesAvailable !== false ||
    value.expiration.nearExpiryUnits !== null ||
    value.expiration.expiredUnits !== null ||
    value.expiration.inboundPlanExpirationDatesAvailable !== true ||
    typeof value.expiration.notice !== "string"
  ) {
    throw new Error("FBA 庫齡資料不完整，已停止顯示。");
  }
  const seen = new Set<string>();
  let ageBucketSignature: string | null = null;
  let surchargeBucketSignature: string | null = null;
  const rows = value.rows.map((raw): AgedInventoryRow => {
    if (
      !isRecord(raw) ||
      typeof raw.sellerSku !== "string" ||
      !raw.sellerSku ||
      seen.has(raw.sellerSku) ||
      typeof raw.fnSku !== "string" ||
      typeof raw.asin !== "string" ||
      typeof raw.title !== "string" ||
      typeof raw.condition !== "string" ||
      !nullableNonNegativeInteger(raw.available) ||
      !nonNegativeInteger(raw.totalAgedUnits) ||
      !nonNegativeInteger(raw.agedOver180) ||
      !Array.isArray(raw.ageBuckets) ||
      raw.ageBuckets.length < 5 ||
      raw.ageBuckets.length > 8 ||
      !nullableNonNegativeInteger(raw.estimatedExcessQuantity) ||
      !nullableNonNegativeInteger(raw.recommendedRemovalQuantity) ||
      !nullableNonNegativeNumber(raw.daysOfSupply) ||
      !(raw.currencyCode === null ||
        (typeof raw.currencyCode === "string" && /^[A-Z]{3}$/.test(raw.currencyCode))) ||
      !nullableNonNegativeNumber(raw.estimatedStorageCostNextMonth) ||
      !nullableNonNegativeNumber(raw.estimatedAgedSurcharge) ||
      !Array.isArray(raw.agedSurchargeBuckets) ||
      raw.agedSurchargeBuckets.length > 8 ||
      typeof raw.alert !== "string" ||
      typeof raw.recommendedAction !== "string" ||
      !(raw.snapshotDate === null || typeof raw.snapshotDate === "string")
    ) {
      throw new Error("FBA 庫齡商品列格式無效，已停止顯示。");
    }
    if (raw.estimatedStorageCostNextMonth !== null) {
      moneyCents(raw.estimatedStorageCostNextMonth, "FBA 下月預估倉儲成本");
    }
    if (raw.estimatedAgedSurcharge !== null) {
      moneyCents(raw.estimatedAgedSurcharge, "FBA AIS 預估附加費");
    }
    const bucketKeys = new Set<string>();
    const ageBuckets = raw.ageBuckets.map((bucket) => {
      if (
        !isRecord(bucket) ||
        typeof bucket.key !== "string" ||
        !bucket.key ||
        bucketKeys.has(bucket.key) ||
        typeof bucket.label !== "string" ||
        !bucket.label ||
        !nonNegativeInteger(bucket.units) ||
        typeof bucket.over180 !== "boolean"
      ) {
        throw new Error("FBA 庫齡分層格式無效，已停止顯示。");
      }
      bucketKeys.add(bucket.key);
      return {
        key: bucket.key,
        label: bucket.label,
        units: bucket.units,
        over180: bucket.over180,
      };
    });
    const nextAgeSignature = ageBuckets
      .map((bucket) => `${bucket.key}:${bucket.label}:${bucket.over180}`)
      .join("|");
    if (ageBucketSignature !== null && ageBucketSignature !== nextAgeSignature) {
      throw new Error("FBA 庫齡商品列使用不同區域欄位，已停止顯示。");
    }
    ageBucketSignature = nextAgeSignature;
    if (
      safeIntegerTotal(
        ageBuckets.map((bucket) => bucket.units),
        "FBA 單一 SKU 庫齡數量",
      ) !== raw.totalAgedUnits ||
      safeIntegerTotal(
        ageBuckets.filter((bucket) => bucket.over180).map(
          (bucket) => bucket.units,
        ),
        "FBA 單一 SKU 超過 180 天庫齡數量",
      ) !== raw.agedOver180
    ) {
      throw new Error("FBA 庫齡分層與總數不一致，已停止顯示。");
    }
    const surchargeKeys = new Set<string>();
    const agedSurchargeBuckets = raw.agedSurchargeBuckets.map((bucket) => {
      if (
        !isRecord(bucket) ||
        typeof bucket.key !== "string" ||
        !bucket.key ||
        surchargeKeys.has(bucket.key) ||
        typeof bucket.label !== "string" ||
        !bucket.label ||
        !nullableNonNegativeInteger(bucket.quantity) ||
        !nullableNonNegativeNumber(bucket.estimatedCharge)
      ) {
        throw new Error("FBA AIS 預估附加費分層格式無效，已停止顯示。");
      }
      surchargeKeys.add(bucket.key);
      if (bucket.estimatedCharge !== null) {
        moneyCents(bucket.estimatedCharge, `FBA ${bucket.label}預估附加費`);
      }
      return {
        key: bucket.key,
        label: bucket.label,
        quantity: bucket.quantity,
        estimatedCharge: bucket.estimatedCharge,
      };
    });
    const surchargeCharges = agedSurchargeBuckets.map(
      (bucket) => bucket.estimatedCharge,
    );
    const completeSurchargeCharges = surchargeCharges.filter(
      (charge): charge is number => charge !== null,
    );
    const expectedRowSurcharge =
      surchargeCharges.length > 0 &&
      completeSurchargeCharges.length === surchargeCharges.length
        ? safeMoneyTotal(
            completeSurchargeCharges,
            "FBA 單一 SKU AIS 預估附加費",
          )
        : null;
    if (raw.estimatedAgedSurcharge !== expectedRowSurcharge) {
      throw new Error("FBA AIS 預估附加費分層與合計不一致，已停止顯示。");
    }
    const nextSurchargeSignature = agedSurchargeBuckets
      .map((bucket) => `${bucket.key}:${bucket.label}`)
      .join("|");
    if (
      surchargeBucketSignature !== null &&
      surchargeBucketSignature !== nextSurchargeSignature
    ) {
      throw new Error("FBA AIS 預估附加費使用不同區域欄位，已停止顯示。");
    }
    surchargeBucketSignature = nextSurchargeSignature;
    if (
      ((raw.estimatedStorageCostNextMonth ?? 0) > 0 ||
        (raw.estimatedAgedSurcharge ?? 0) > 0 ||
        agedSurchargeBuckets.some(
          (bucket) => (bucket.estimatedCharge ?? 0) > 0,
        )) &&
      raw.currencyCode === null
    ) {
      throw new Error("FBA 庫齡費用缺少幣別，已停止顯示。");
    }
    seen.add(raw.sellerSku);
    return {
      sellerSku: raw.sellerSku,
      fnSku: raw.fnSku,
      asin: raw.asin,
      title: raw.title,
      condition: raw.condition,
      available: raw.available,
      totalAgedUnits: raw.totalAgedUnits,
      agedOver180: raw.agedOver180,
      ageBuckets,
      estimatedExcessQuantity: raw.estimatedExcessQuantity,
      recommendedRemovalQuantity: raw.recommendedRemovalQuantity,
      daysOfSupply: raw.daysOfSupply,
      currencyCode: raw.currencyCode,
      estimatedStorageCostNextMonth: raw.estimatedStorageCostNextMonth,
      estimatedAgedSurcharge: raw.estimatedAgedSurcharge,
      agedSurchargeBuckets,
      alert: raw.alert,
      recommendedAction: raw.recommendedAction,
      snapshotDate: raw.snapshotDate,
    };
  });
  const totalAgedUnits = safeIntegerTotal(
    rows.map((row) => row.totalAgedUnits),
    "FBA 全站庫齡數量",
  );
  const agedOver180 = safeIntegerTotal(
    rows.map((row) => row.agedOver180),
    "FBA 全站超過 180 天庫齡數量",
  );
  const agedOver180SkuCount = rows.filter((row) => row.agedOver180 > 0).length;
  const excessValues = rows.map((row) => row.estimatedExcessQuantity);
  const currencies = new Set(
    rows
      .map((row) => row.currencyCode)
      .filter((item): item is string => item !== null),
  );
  if (currencies.size > 1) {
    throw new Error("FBA 庫齡摘要包含多種幣別，已停止顯示。");
  }
  const currencyCode = [...currencies][0] ?? null;
  const excessAvailability = value.summary.excessAvailability;
  const storageCostAvailability = value.summary.storageCostAvailability;
  const agedSurchargeAvailability = value.summary.agedSurchargeAvailability;
  if (
    !feeAvailabilityValue(excessAvailability) ||
    !feeAvailabilityValue(storageCostAvailability) ||
    !feeAvailabilityValue(agedSurchargeAvailability)
  ) {
    throw new Error("FBA 庫齡費用摘要格式無效，已停止顯示。");
  }
  const storageValues = rows.map((row) => row.estimatedStorageCostNextMonth);
  const surchargeValues = rows.map((row) => row.estimatedAgedSurcharge);
  const excessReportedSkuCount = excessValues.filter((item) => item !== null).length;
  const storageCostReportedSkuCount = storageValues.filter((item) => item !== null).length;
  const agedSurchargeReportedSkuCount = surchargeValues.filter((item) => item !== null).length;
  const completeExcessValues = excessValues.filter(
    (item): item is number => item !== null,
  );
  const completeStorageValues = storageValues.filter(
    (item): item is number => item !== null,
  );
  const completeSurchargeValues = surchargeValues.filter(
    (item): item is number => item !== null,
  );
  const expectedExcess = excessAvailability === "complete"
    ? safeIntegerTotal(
        completeExcessValues,
        "FBA 全站預估冗餘數量",
      )
    : null;
  const expectedStorageCost = storageCostAvailability === "complete"
    ? safeMoneyTotal(
        completeStorageValues,
        "FBA 全站下月預估倉儲成本",
      )
    : null;
  const expectedAgedSurcharge = agedSurchargeAvailability === "complete"
    ? safeMoneyTotal(
        completeSurchargeValues,
        "FBA 全站 AIS 預估附加費",
      )
    : null;
  const statusesConsistent =
    (excessAvailability !== "complete" || excessReportedSkuCount === rows.length) &&
    (excessAvailability !== "partial" || excessReportedSkuCount < rows.length) &&
    (excessAvailability !== "unavailable" || excessReportedSkuCount === 0) &&
    (storageCostAvailability !== "complete" || storageCostReportedSkuCount === rows.length) &&
    (storageCostAvailability !== "partial" || storageCostReportedSkuCount < rows.length) &&
    (storageCostAvailability !== "unavailable" || storageCostReportedSkuCount === 0) &&
    (agedSurchargeAvailability !== "complete" || agedSurchargeReportedSkuCount === rows.length) &&
    (agedSurchargeAvailability !== "partial" || agedSurchargeReportedSkuCount < rows.length) &&
    (agedSurchargeAvailability !== "unavailable" ||
      (agedSurchargeReportedSkuCount === 0 &&
        rows.every((row) => row.agedSurchargeBuckets.length === 0)));
  if (
    value.summary.skuCount !== rows.length ||
    value.summary.agedOver180SkuCount !== agedOver180SkuCount ||
    value.summary.totalAgedUnits !== totalAgedUnits ||
    value.summary.agedOver180 !== agedOver180 ||
    value.summary.estimatedExcessQuantity !== expectedExcess ||
    value.summary.excessReportedSkuCount !== excessReportedSkuCount ||
    value.summary.currencyCode !== currencyCode ||
    value.summary.estimatedStorageCostNextMonth !== expectedStorageCost ||
    value.summary.storageCostReportedSkuCount !== storageCostReportedSkuCount ||
    value.summary.estimatedAgedSurcharge !== expectedAgedSurcharge ||
    value.summary.agedSurchargeReportedSkuCount !== agedSurchargeReportedSkuCount ||
    !statusesConsistent
  ) {
    throw new Error("FBA 庫齡摘要與商品列不一致，已停止顯示。");
  }
  return {
    mode: value.mode,
    marketplaceId,
    fetchedAt: value.fetchedAt,
    rows,
    summary: {
      skuCount: rows.length,
      agedOver180SkuCount,
      totalAgedUnits,
      agedOver180,
      excessAvailability,
      estimatedExcessQuantity: expectedExcess,
      excessReportedSkuCount,
      currencyCode,
      storageCostAvailability,
      estimatedStorageCostNextMonth: expectedStorageCost,
      storageCostReportedSkuCount,
      agedSurchargeAvailability,
      estimatedAgedSurcharge: expectedAgedSurcharge,
      agedSurchargeReportedSkuCount,
    },
    expiration: {
      currentFbaExpirationDatesAvailable: false,
      nearExpiryUnits: null,
      expiredUnits: null,
      inboundPlanExpirationDatesAvailable: true,
      notice: value.expiration.notice,
    },
    notice: value.notice,
  };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-TW");
}

export function formatAgedInventoryMoney(
  value: number | null,
  currencyCode: string | null,
): string {
  if (value === null) return "—";
  if (value === 0 && currencyCode === null) return "0";
  if (currencyCode === null) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
    }).format(value);
  } catch {
    return `${currencyCode} ${value.toLocaleString("zh-TW")}`;
  }
}

function coverageText(reported: number, total: number): string {
  return `已回傳 ${reported.toLocaleString("zh-TW")}／${total.toLocaleString("zh-TW")} SKU`;
}

export function AgedInventoryTierOverview({
  rows,
  currencyCode,
}: {
  rows: ReadonlyArray<
    Pick<AgedInventoryRow, "ageBuckets" | "agedSurchargeBuckets">
  >;
  currencyCode: string | null;
}) {
  const ageBuckets = aggregateAgeBuckets(rows);
  const surchargeBuckets = aggregateAgedSurchargeBuckets(rows);
  return (
    <div className="aged-inventory-tier-overview">
      <section className="aged-inventory-tier-section aged-inventory-age-layer">
        <header>
          <div>
            <p className="eyebrow">ALL FBA INVENTORY AGE</p>
            <h4>全部 FBA 庫齡分層</h4>
            <p>
              這是 Amazon 報表依進倉庫齡回傳的非重疊庫存數量；181 天以上會另外標記，但不等於冗餘或附加費計費量。
            </p>
          </div>
          <small>{coverageText(rows.length, rows.length)}</small>
        </header>
        {ageBuckets.length > 0 ? (
          <div className="aged-inventory-tier-grid age-buckets">
            {ageBuckets.map((bucket) => (
              <article
                key={bucket.key}
                className={bucket.over180 ? "is-over-180" : undefined}
              >
                <span>{bucket.label}</span>
                <strong>{bucket.units.toLocaleString("zh-TW")} 件</strong>
                <small>
                  {coverageText(
                    bucket.reportedSkuCount,
                    bucket.totalSkuCount,
                  )}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="aged-inventory-tier-empty">
            Amazon 報表目前沒有可彙總的 FBA 庫齡商品。
          </p>
        )}
      </section>

      <section className="aged-inventory-tier-section aged-inventory-ais-layer">
        <header>
          <div>
            <p className="eyebrow">AMAZON AIS ESTIMATE</p>
            <h4>AIS 官方預估計費分層</h4>
            <p>
              這是 Amazon 另列的預估計費數量與附加費；不拿上方庫齡數量代填，也不反推或猜測每件費率。只有全部 SKU 都回傳同一欄位時才顯示區間合計；部分回傳只保留逐 SKU 證據與回傳筆數。尾段會依站點實際報表顯示。
            </p>
          </div>
          <small>
            {surchargeBuckets.length > 0
              ? `${surchargeBuckets.length.toLocaleString("zh-TW")} 個官方區間`
              : "報表未提供完整分層"}
          </small>
        </header>
        {surchargeBuckets.length > 0 ? (
          <div className="aged-inventory-tier-grid surcharge-buckets">
            {surchargeBuckets.map((bucket) => (
              <article key={bucket.key}>
                <span>{bucket.label}</span>
                <div>
                  <small>預估計費數量</small>
                  <strong>
                    {bucket.quantity === null
                      ? "—"
                      : `${bucket.quantity.toLocaleString("zh-TW")} 件`}
                  </strong>
                  <small>
                    {coverageText(
                      bucket.quantityReportedSkuCount,
                      bucket.totalSkuCount,
                    )}
                  </small>
                </div>
                <div>
                  <small>預估附加費</small>
                  <strong>
                    {formatAgedInventoryMoney(
                      bucket.estimatedCharge,
                      currencyCode,
                    )}
                  </strong>
                  <small>
                    {coverageText(
                      bucket.chargeReportedSkuCount,
                      bucket.totalSkuCount,
                    )}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="aged-inventory-tier-empty">
            Amazon 此站點報表沒有完整 AIS 預估分層欄位；數量與費用維持缺值，不猜費率。
          </p>
        )}
      </section>
    </div>
  );
}

export default function AgedInventoryPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  initialJob = null,
  onJobChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  initialJob?: StandaloneAuditJob | null;
  onJobChange?: (job: StandaloneAuditJob) => void;
}) {
  const [snapshot, setSnapshot] = useState<AgedInventorySnapshot | null>(null);
  const [status, setStatus] = useState("尚未同步");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<"aged" | "excess" | "all">("aged");
  const [error, setError] = useState<string | null>(null);
  const [reportReference, setReportReference] = useState<{
    reportId: string;
    documentId: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const initialJobReconnectRevision = standaloneAuditReconnectRevision(initialJob);

  useEffect(() => {
    abortRef.current?.abort();
    setSnapshot(null);
    setStatus("尚未同步");
    setLoading(false);
    setExporting(false);
    setView("aged");
    setReportReference(null);
    setError(null);
  }, [marketplaceId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadData = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "FBA 庫齡背景工作尚未完成。",
      );
    }
    setStatus("正在整理全部 FBA 庫齡與官方費用欄位…");
    const raw = completedJob.snapshot;
    const next = parseAgedInventorySnapshot(raw, marketplaceId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const reference = isRecord(raw) &&
        typeof raw.reportId === "string" &&
        typeof raw.documentId === "string"
      ? { reportId: raw.reportId, documentId: raw.documentId }
      : null;
    if (!reference) throw new Error("FBA 庫齡快照缺少可核對的 Excel 匯出 reference。");
    setSnapshot(next);
    setReportReference(reference);
    setStatus(`最後同步 ${next.fetchedAt.slice(0, 16).replace("T", " ")}`);
  };

  const downloadExcel = async () => {
    if (!reportReference || !snapshot || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        reportId: reportReference.reportId,
        documentId: reportReference.documentId,
        download: "1",
      });
      const response = await fetch(`/api/sp-api/aged-inventory?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let message = "FBA 庫齡 Excel 下載失敗，請重新同步。";
        try {
          const payload = (await response.json()) as ApiProblem;
          if (typeof payload.message === "string") message = payload.message;
        } catch {
          // A failed binary response is not guaranteed to contain JSON.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auditExportFilename({
        kind: "inventory",
        marketplaceShort,
        fetchedAt: snapshot.fetchedAt,
      });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "FBA 庫齡 Excel 下載失敗，請重新同步。",
      );
    } finally {
      setExporting(false);
    }
  };

  const synchronize = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setStatus("正在請 Amazon 建立 FBA 庫齡報表…");
    try {
      let current = await startStandaloneAuditJob({
        kind: "agedInventory",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      onJobChange?.(current);
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: (next) => {
          setStatus(next.progress.message);
          onJobChange?.(next);
        },
      });
      onJobChange?.(current);
      await loadData(current, controller.signal);
      observerJobIdRef.current = null;
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法讀取 FBA 庫齡資料。",
      );
      setStatus("同步未完成");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!shouldResumeStandaloneAuditJob({
      initialJob,
      expectedKind: "agedInventory",
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setLoading(true);
    setStatus(observedJob.progress.message);
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: (next) => {
                setStatus(next.progress.message);
                onJobChange?.(next);
              },
            });
        onJobChange?.(terminal);
        await loadData(terminal, controller.signal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續 FBA 庫齡健檢。");
        setStatus("同步未完成");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
          observerJobIdRef.current = null;
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobReconnectRevision, marketplaceId, mode]);

  const confirmedExcessRows = snapshot?.rows.filter(
    (row) => row.estimatedExcessQuantity !== null && row.estimatedExcessQuantity > 0,
  ) ?? [];
  const unresolvedExcessRows = snapshot?.rows.filter(
    (row) => row.estimatedExcessQuantity === null,
  ) ?? [];
  const agedOver180Rows = snapshot?.rows.filter(
    (row) => row.agedOver180 > 0,
  ) ?? [];
  const visibleRows = snapshot
    ? view === "aged"
      ? agedOver180Rows
      : view === "excess"
        ? [...confirmedExcessRows, ...unresolvedExcessRows]
        : snapshot.rows
    : [];

  return (
    <section className="aged-inventory-panel" aria-busy={loading}>
      <header>
        <div>
          <p className="eyebrow">FBA INVENTORY HEALTH</p>
          <h3>FBA 庫齡、冗餘與官方預估費用</h3>
          <small>{status}</small>
        </div>
        <div className="aged-inventory-actions">
          {snapshot && reportReference && (
            <button type="button" className="secondary" onClick={() => void downloadExcel()} disabled={loading || exporting}>
              {exporting ? "匯出中…" : "匯出 Excel"}
            </button>
          )}
          {snapshot && <button type="button" onClick={() => void synchronize()} disabled={loading || exporting}>
            {loading ? "同步中…" : "重新同步"}
          </button>}
        </div>
      </header>
      <p className="aged-inventory-explainer">
        冗餘健檢只依 Amazon FBA Manage Inventory Health report 的 estimated excess quantity；不會因庫齡高就判定冗餘。另彙總全部非重疊庫齡桶與 AIS 181 天起的官方預估計費層；任一 SKU 缺值時只保留逐列證據，不顯示部分全站合計，也不套費率或推算。
      </p>
      {error && <div className="price-error" role="alert">{error}</div>}
      {!snapshot && (
        <button
          type="button"
          className="content-audit-export-primary aged-inventory-start"
          onClick={() => void synchronize()}
          disabled={loading || exporting}
        >
          <span aria-hidden="true">⌛</span>
          <strong>{loading ? "Amazon 正在整理…" : "開始 FBA 180 天以上庫齡健檢"}</strong>
          <small>主清單只列已逾 180 天；上方另顯示全部庫齡與 AIS 官方計費區間。冗餘與費用分開，不會修改庫存或建立促銷。</small>
        </button>
      )}
      {snapshot && (
        <>
          <div className="aged-inventory-summary">
            <article><span>全部 FBA SKU</span><strong>{snapshot.summary.skuCount.toLocaleString()}</strong></article>
            <article><span>180 天以上</span><strong>{snapshot.summary.agedOver180.toLocaleString()}</strong><small>件 · {snapshot.summary.agedOver180SkuCount.toLocaleString()} SKU</small></article>
            <article><span>Amazon 預估冗餘</span><strong>{snapshot.summary.excessAvailability === "complete" ? count(snapshot.summary.estimatedExcessQuantity) : snapshot.summary.excessAvailability === "partial" ? "不顯示部分合計" : "報表未提供"}</strong><small>{snapshot.summary.excessAvailability === "unavailable" ? "不推算" : `${snapshot.summary.excessAvailability === "partial" ? "逐列保留 · " : "件 · "}${coverageText(snapshot.summary.excessReportedSkuCount, snapshot.summary.skuCount)}`}</small></article>
            <article><span>下月預估倉儲成本</span><strong>{snapshot.summary.storageCostAvailability === "complete" ? formatAgedInventoryMoney(snapshot.summary.estimatedStorageCostNextMonth, snapshot.summary.currencyCode) : snapshot.summary.storageCostAvailability === "partial" ? "不顯示部分合計" : "報表未提供"}</strong><small>{snapshot.summary.storageCostAvailability === "unavailable" ? "不猜費率" : `${snapshot.summary.storageCostAvailability === "partial" ? "逐列保留 · " : ""}${coverageText(snapshot.summary.storageCostReportedSkuCount, snapshot.summary.skuCount)}`}</small></article>
            <article><span>AIS 預估附加費</span><strong>{snapshot.summary.agedSurchargeAvailability === "complete" ? formatAgedInventoryMoney(snapshot.summary.estimatedAgedSurcharge, snapshot.summary.currencyCode) : snapshot.summary.agedSurchargeAvailability === "partial" ? "不顯示部分合計" : "報表未提供"}</strong><small>{snapshot.summary.agedSurchargeAvailability === "unavailable" ? "不猜費率" : `${snapshot.summary.agedSurchargeAvailability === "partial" ? "逐列保留 · " : ""}${coverageText(snapshot.summary.agedSurchargeReportedSkuCount, snapshot.summary.skuCount)}`}</small></article>
          </div>
          <AgedInventoryTierOverview
            rows={snapshot.rows}
            currencyCode={snapshot.summary.currencyCode}
          />
          <div className="aged-inventory-view-switch" role="group" aria-label="FBA 庫存健檢顯示範圍">
            <button type="button" className={view === "aged" ? "active" : ""} onClick={() => setView("aged")}>
              已逾 180 天
              <small>{agedOver180Rows.length.toLocaleString()} SKU · {snapshot.summary.agedOver180.toLocaleString()} 件</small>
            </button>
            <button type="button" className={view === "excess" ? "active" : ""} onClick={() => setView("excess")}>
              Amazon 預估冗餘（獨立）
              <small>{confirmedExcessRows.length.toLocaleString()} SKU{unresolvedExcessRows.length ? ` · ${unresolvedExcessRows.length.toLocaleString()} 未核對` : ""}</small>
            </button>
            <button type="button" className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
              全部 FBA 庫齡
              <small>{snapshot.rows.length.toLocaleString()} SKU</small>
            </button>
          </div>
          <aside className="aged-inventory-expiration-boundary">
            <strong>到期日／近效期：Amazon 現有 FBA 公開 API 無法提供目前庫存批次</strong>
            <p>{snapshot.expiration.notice}</p>
          </aside>
          {visibleRows.length ? (
            <div className="aged-inventory-list">
              {visibleRows.map((row) => (
                <article key={row.sellerSku}>
                  <div className="aged-inventory-product">
                    <strong>{row.title || row.sellerSku}</strong>
                    <small>{row.sellerSku}{row.asin ? ` · ${row.asin}` : ""}</small>
                  </div>
                  <div><span>180 天以上</span><strong>{row.agedOver180.toLocaleString()}</strong></div>
                  <div><span>預估冗餘</span><strong>{count(row.estimatedExcessQuantity)}</strong></div>
                  <div><span>可售天數</span><strong>{row.daysOfSupply === null ? "—" : row.daysOfSupply.toFixed(1)}</strong></div>
                  <details>
                    <summary>查看全部庫齡與官方欄位</summary>
                    <dl>
                      {row.ageBuckets.map((bucket) => (
                        <div key={bucket.key}><dt>{bucket.label}</dt><dd>{bucket.units.toLocaleString()} 件</dd></div>
                      ))}
                      <div><dt>目前可售</dt><dd>{row.available === null ? "—" : `${row.available.toLocaleString()} 件`}</dd></div>
                      <div><dt>庫齡桶總數</dt><dd>{row.totalAgedUnits.toLocaleString()} 件</dd></div>
                      <div><dt>下月預估倉儲成本</dt><dd>{formatAgedInventoryMoney(row.estimatedStorageCostNextMonth, row.currencyCode)}</dd></div>
                      <div><dt>AIS 預估附加費</dt><dd>{formatAgedInventoryMoney(row.estimatedAgedSurcharge, row.currencyCode)}</dd></div>
                      <div><dt>建議移除</dt><dd>{count(row.recommendedRemovalQuantity)} 件</dd></div>
                      {row.agedSurchargeBuckets.map((bucket) => (
                        <div key={`ais-${bucket.key}`}><dt>{bucket.label}</dt><dd>{count(bucket.quantity)} 件 · {formatAgedInventoryMoney(bucket.estimatedCharge, row.currencyCode)}</dd></div>
                      ))}
                    </dl>
                    {row.alert && <p>Amazon alert：{row.alert}</p>}
                    {row.recommendedAction && <p>Amazon 建議：{row.recommendedAction}</p>}
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="aged-inventory-empty">
              {view === "excess"
                ? "Amazon 目前沒有回傳 estimated excess quantity 大於 0 的 FBA SKU。"
                : view === "aged"
                  ? "目前報表沒有已逾 180 天的 FBA 庫存。"
                  : "目前報表沒有可顯示的 FBA 庫齡商品。"}
            </div>
          )}
          <p className="aged-inventory-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
