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
  agedOver180: number;
  ageBuckets: Array<{ label: string; units: number }>;
  estimatedExcessQuantity: number | null;
  recommendedRemovalQuantity: number | null;
  daysOfSupply: number | null;
  recommendedAction: string;
  snapshotDate: string | null;
};

type AgedInventorySnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  rows: AgedInventoryRow[];
  summary: {
    skuCount: number;
    agedOver180: number;
    estimatedExcessQuantity: number | null;
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
    !isRecord(value.summary)
  ) {
    throw new Error("FBA 庫齡資料不完整，已停止顯示。");
  }
  const seen = new Set<string>();
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
      !nonNegativeInteger(raw.agedOver180) ||
      raw.agedOver180 < 1 ||
      !Array.isArray(raw.ageBuckets) ||
      raw.ageBuckets.length < 1 ||
      raw.ageBuckets.length > 6 ||
      !nullableNonNegativeInteger(raw.estimatedExcessQuantity) ||
      !nullableNonNegativeInteger(raw.recommendedRemovalQuantity) ||
      !(
        raw.daysOfSupply === null ||
        (typeof raw.daysOfSupply === "number" &&
          Number.isFinite(raw.daysOfSupply) &&
          raw.daysOfSupply >= 0)
      ) ||
      typeof raw.recommendedAction !== "string" ||
      !(raw.snapshotDate === null || typeof raw.snapshotDate === "string")
    ) {
      throw new Error("FBA 庫齡商品列格式無效，已停止顯示。");
    }
    const ageBuckets = raw.ageBuckets.map((bucket) => {
      if (
        !isRecord(bucket) ||
        typeof bucket.label !== "string" ||
        !bucket.label ||
        !nonNegativeInteger(bucket.units)
      ) {
        throw new Error("FBA 庫齡分層格式無效，已停止顯示。");
      }
      return { label: bucket.label, units: bucket.units };
    });
    if (
      ageBuckets.reduce((sum, bucket) => sum + bucket.units, 0) !==
      raw.agedOver180
    ) {
      throw new Error("FBA 庫齡分層與總數不一致，已停止顯示。");
    }
    seen.add(raw.sellerSku);
    return {
      sellerSku: raw.sellerSku,
      fnSku: raw.fnSku,
      asin: raw.asin,
      title: raw.title,
      condition: raw.condition,
      available: raw.available,
      agedOver180: raw.agedOver180,
      ageBuckets,
      estimatedExcessQuantity: raw.estimatedExcessQuantity,
      recommendedRemovalQuantity: raw.recommendedRemovalQuantity,
      daysOfSupply: raw.daysOfSupply,
      recommendedAction: raw.recommendedAction,
      snapshotDate: raw.snapshotDate,
    };
  });
  const agedOver180 = rows.reduce((sum, row) => sum + row.agedOver180, 0);
  const excessValues = rows
    .map((row) => row.estimatedExcessQuantity)
    .filter((item): item is number => item !== null);
  const expectedExcess = excessValues.length
    ? excessValues.reduce((sum, item) => sum + item, 0)
    : null;
  if (
    value.summary.skuCount !== rows.length ||
    value.summary.agedOver180 !== agedOver180 ||
    value.summary.estimatedExcessQuantity !== expectedExcess
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
      agedOver180,
      estimatedExcessQuantity: expectedExcess,
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

export default function AgedInventoryPanel({
  marketplaceId,
}: {
  marketplaceId: string;
}) {
  const [snapshot, setSnapshot] = useState<AgedInventorySnapshot | null>(null);
  const [status, setStatus] = useState("尚未同步");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setSnapshot(null);
    setStatus("尚未同步");
    setLoading(false);
    setError(null);
  }, [marketplaceId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadData = async (reply: ReportReply, signal: AbortSignal) => {
    if (!reply.reportId || !reply.documentId) {
      throw new Error("Amazon 沒有回傳可讀取的 FBA 庫齡文件。");
    }
    setStatus("正在整理 180 天以上庫存…");
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
    setStatus(`最後同步 ${next.fetchedAt.slice(0, 16).replace("T", " ")}`);
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
          <h3>180 天以上庫存</h3>
          <small>{status}</small>
        </div>
        <button type="button" onClick={() => void synchronize()} disabled={loading}>
          {loading ? "同步中…" : snapshot ? "重新同步" : "查看全部"}
        </button>
      </header>
      <p className="aged-inventory-explainer">
        直接讀取 Amazon FBA 庫齡報表；庫齡數量與「Amazon 預估冗餘」分開顯示，不會自動促銷或移除。
      </p>
      {error && <div className="price-error" role="alert">{error}</div>}
      {snapshot && (
        <>
          <div className="aged-inventory-summary">
            <article><span>SKU</span><strong>{snapshot.summary.skuCount.toLocaleString()}</strong></article>
            <article><span>180 天以上</span><strong>{snapshot.summary.agedOver180.toLocaleString()}</strong><small>件</small></article>
            <article><span>Amazon 預估冗餘</span><strong>{count(snapshot.summary.estimatedExcessQuantity)}</strong><small>件</small></article>
          </div>
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
                    <summary>查看庫齡分層</summary>
                    <dl>
                      {row.ageBuckets.map((bucket) => (
                        <div key={bucket.label}><dt>{bucket.label}</dt><dd>{bucket.units.toLocaleString()} 件</dd></div>
                      ))}
                      <div><dt>目前可售</dt><dd>{row.available.toLocaleString()} 件</dd></div>
                      <div><dt>建議移除</dt><dd>{count(row.recommendedRemovalQuantity)} 件</dd></div>
                    </dl>
                    {row.recommendedAction && <p>Amazon 建議：{row.recommendedAction}</p>}
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="aged-inventory-empty">目前報表沒有 180 天以上的 FBA 庫存。</div>
          )}
          <p className="aged-inventory-notice">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
