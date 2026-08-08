"use client";

import { useEffect, useRef, useState } from "react";

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
  available: number;
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
    currencyCode: string | null;
    storageCostAvailability: FeeAvailability;
    estimatedStorageCostNextMonth: number | null;
    agedSurchargeAvailability: FeeAvailability;
    estimatedAgedSurcharge: number | null;
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

function feeAvailabilityValue(value: unknown): value is FeeAvailability {
  return value === "complete" || value === "partial" || value === "unavailable";
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
      !nonNegativeInteger(raw.available) ||
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
      ageBuckets.reduce((sum, bucket) => sum + bucket.units, 0) !== raw.totalAgedUnits ||
      ageBuckets
        .filter((bucket) => bucket.over180)
        .reduce((sum, bucket) => sum + bucket.units, 0) !== raw.agedOver180
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
    const expectedRowSurcharge =
      surchargeCharges.length > 0 &&
      surchargeCharges.every((charge) => charge !== null)
        ? Number(
            surchargeCharges
              .reduce((sum, charge) => sum + charge!, 0)
              .toFixed(2),
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
      (raw.estimatedStorageCostNextMonth !== null ||
        raw.estimatedAgedSurcharge !== null ||
        agedSurchargeBuckets.some((bucket) => bucket.estimatedCharge !== null)) &&
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
  const totalAgedUnits = rows.reduce((sum, row) => sum + row.totalAgedUnits, 0);
  const agedOver180 = rows.reduce((sum, row) => sum + row.agedOver180, 0);
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
  const expectedExcess = excessAvailability === "complete" &&
    excessValues.every((item) => item !== null)
    ? excessValues.reduce((sum, item) => sum + item!, 0)
    : null;
  const expectedStorageCost = storageCostAvailability === "complete" &&
    storageValues.every((item) => item !== null)
    ? Number(storageValues.reduce((sum, item) => sum + item!, 0).toFixed(2))
    : null;
  const expectedAgedSurcharge = agedSurchargeAvailability === "complete" &&
    surchargeValues.every((item) => item !== null)
    ? Number(surchargeValues.reduce((sum, item) => sum + item!, 0).toFixed(2))
    : null;
  const statusesConsistent =
    (excessAvailability !== "complete" || expectedExcess !== null) &&
    (excessAvailability !== "unavailable" || excessValues.every((item) => item === null)) &&
    (storageCostAvailability !== "complete" || expectedStorageCost !== null) &&
    (storageCostAvailability !== "unavailable" || storageValues.every((item) => item === null)) &&
    (agedSurchargeAvailability !== "complete" || expectedAgedSurcharge !== null) &&
    (agedSurchargeAvailability !== "unavailable" ||
      (surchargeValues.every((item) => item === null) &&
        rows.every((row) => row.agedSurchargeBuckets.length === 0)));
  if (
    value.summary.skuCount !== rows.length ||
    value.summary.agedOver180SkuCount !== agedOver180SkuCount ||
    value.summary.totalAgedUnits !== totalAgedUnits ||
    value.summary.agedOver180 !== agedOver180 ||
    value.summary.estimatedExcessQuantity !== expectedExcess ||
    value.summary.currencyCode !== currencyCode ||
    value.summary.estimatedStorageCostNextMonth !== expectedStorageCost ||
    value.summary.estimatedAgedSurcharge !== expectedAgedSurcharge ||
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
      currencyCode,
      storageCostAvailability,
      estimatedStorageCostNextMonth: expectedStorageCost,
      agedSurchargeAvailability,
      estimatedAgedSurcharge: expectedAgedSurcharge,
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

function money(value: number | null, currencyCode: string | null): string {
  if (value === null || currencyCode === null) return "—";
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

function feeText(
  availability: FeeAvailability,
  value: number | null,
  currencyCode: string | null,
): string {
  if (availability === "unavailable") return "報表未提供";
  if (availability === "partial") return "欄位不完整";
  return money(value, currencyCode);
}

function quantityText(
  availability: FeeAvailability,
  value: number | null,
): string {
  if (availability === "unavailable") return "報表未提供";
  if (availability === "partial") return "欄位不完整";
  return count(value);
}

function safeFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return (match?.[1] ?? fallback).replace(/[\\/:*?"<>|]/g, "-");
}

export default function AgedInventoryPanel({
  marketplaceId,
}: {
  marketplaceId: string;
}) {
  const [snapshot, setSnapshot] = useState<AgedInventorySnapshot | null>(null);
  const [status, setStatus] = useState("尚未同步");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportReference, setReportReference] = useState<{
    reportId: string;
    documentId: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setSnapshot(null);
    setStatus("尚未同步");
    setLoading(false);
    setExporting(false);
    setReportReference(null);
    setError(null);
  }, [marketplaceId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadData = async (reply: ReportReply, signal: AbortSignal) => {
    if (!reply.reportId || !reply.documentId) {
      throw new Error("Amazon 沒有回傳可讀取的 FBA 庫齡文件。");
    }
    setStatus("正在整理全部 FBA 庫齡與官方費用欄位…");
    const params = new URLSearchParams({
      marketplaceId,
      reportId: reply.reportId,
      documentId: reply.documentId,
      data: "1",
    });
    const response = await fetch(`/api/sp-api/aged-inventory?${params}`, {
      cache: "no-store",
      signal,
    });
    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        isRecord(raw) && typeof raw.message === "string"
          ? raw.message
          : "目前無法讀取 FBA 庫齡資料。",
      );
    }
    const next = parseAgedInventorySnapshot(raw, marketplaceId);
    setSnapshot(next);
    setReportReference({
      reportId: reply.reportId,
      documentId: reply.documentId,
    });
    setStatus(`最後同步 ${next.fetchedAt.slice(0, 16).replace("T", " ")}`);
  };

  const downloadExcel = async () => {
    if (!reportReference || exporting) return;
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
      anchor.download = safeFilename(
        response,
        `amazon-fba-inventory-age-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
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
      const response = await fetch("/api/sp-api/aged-inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceId }),
        signal: controller.signal,
      });
      const raw = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          isRecord(raw) && typeof (raw as ApiProblem).message === "string"
            ? (raw as ApiProblem).message!
            : "無法開始 FBA 庫齡同步。",
        );
      }
      let reply = reportReply(raw);
      if (reply.ready) {
        await loadData(reply, controller.signal);
        return;
      }
      if (!reply.reportId) throw new Error("Amazon 沒有回傳可追蹤的報表 ID。");
      const reportId = reply.reportId;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        setStatus(reply.message || "Amazon 正在準備 FBA 庫齡資料…");
        await delay(2_000, controller.signal);
        const params = new URLSearchParams({ marketplaceId, reportId });
        const pollResponse = await fetch(`/api/sp-api/aged-inventory?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const pollRaw = (await pollResponse.json()) as unknown;
        if (!pollResponse.ok) {
          throw new Error(
            isRecord(pollRaw) && typeof pollRaw.message === "string"
              ? pollRaw.message
              : "FBA 庫齡報表狀態查詢失敗。",
          );
        }
        reply = reportReply({ ...(pollRaw as Record<string, unknown>), reportId });
        if (reply.ready) {
          await loadData(reply, controller.signal);
          return;
        }
      }
      throw new Error("FBA 庫齡報表超過三分鐘仍未完成，請稍後再同步。");
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "目前無法讀取 FBA 庫齡資料。",
      );
      setStatus("同步未完成");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

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
          <button type="button" onClick={() => void synchronize()} disabled={loading || exporting}>
            {loading ? "同步中…" : snapshot ? "重新同步" : "查看全部"}
          </button>
        </div>
      </header>
      <p className="aged-inventory-explainer">
        直接讀取 Amazon FBA Manage Inventory Health report，顯示報表可證明的全部非重疊庫齡桶；費用缺欄或缺值時不套費率、不推算。
      </p>
      {error && <div className="price-error" role="alert">{error}</div>}
      {snapshot && (
        <>
          <div className="aged-inventory-summary">
            <article><span>全部 FBA SKU</span><strong>{snapshot.summary.skuCount.toLocaleString()}</strong></article>
            <article><span>180 天以上</span><strong>{snapshot.summary.agedOver180.toLocaleString()}</strong><small>件 · {snapshot.summary.agedOver180SkuCount.toLocaleString()} SKU</small></article>
            <article><span>Amazon 預估冗餘</span><strong>{quantityText(snapshot.summary.excessAvailability, snapshot.summary.estimatedExcessQuantity)}</strong>{snapshot.summary.excessAvailability === "complete" && <small>件</small>}</article>
            <article><span>下月預估倉儲成本</span><strong>{feeText(snapshot.summary.storageCostAvailability, snapshot.summary.estimatedStorageCostNextMonth, snapshot.summary.currencyCode)}</strong></article>
            <article><span>AIS 預估附加費</span><strong>{feeText(snapshot.summary.agedSurchargeAvailability, snapshot.summary.estimatedAgedSurcharge, snapshot.summary.currencyCode)}</strong></article>
          </div>
          <aside className="aged-inventory-expiration-boundary">
            <strong>到期日／近效期：Amazon 現有 FBA 公開 API 無法提供目前庫存批次</strong>
            <p>{snapshot.expiration.notice}</p>
          </aside>
          {snapshot.rows.length ? (
            <div className="aged-inventory-list">
              {snapshot.rows.map((row) => (
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
                      <div><dt>目前可售</dt><dd>{row.available.toLocaleString()} 件</dd></div>
                      <div><dt>庫齡桶總數</dt><dd>{row.totalAgedUnits.toLocaleString()} 件</dd></div>
                      <div><dt>下月預估倉儲成本</dt><dd>{money(row.estimatedStorageCostNextMonth, row.currencyCode)}</dd></div>
                      <div><dt>AIS 預估附加費</dt><dd>{money(row.estimatedAgedSurcharge, row.currencyCode)}</dd></div>
                      <div><dt>建議移除</dt><dd>{count(row.recommendedRemovalQuantity)} 件</dd></div>
                      {row.agedSurchargeBuckets.map((bucket) => (
                        <div key={`ais-${bucket.key}`}><dt>{bucket.label}</dt><dd>{count(bucket.quantity)} 件 · {money(bucket.estimatedCharge, row.currencyCode)}</dd></div>
                      ))}
                    </dl>
                    {row.alert && <p>Amazon alert：{row.alert}</p>}
                    {row.recommendedAction && <p>Amazon 建議：{row.recommendedAction}</p>}
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="aged-inventory-empty">目前報表沒有可顯示的 FBA 庫齡商品。</div>
          )}
          <p className="aged-inventory-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
