"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadInboundShipmentWorkbook } from "../inbound-shipments-excel";
import {
  defaultInboundShipmentDateRange,
  filterInboundShipments,
  inboundShipmentDifferenceCopy,
  inboundShipmentStartBody,
  inboundShipmentStatusLabel,
  parseInboundShipmentJob,
  pollInboundShipmentJob,
  validateInboundShipmentDateRange,
  type InboundShipmentCache,
  type InboundShipmentDateRange,
  type InboundShipmentIssueLevel,
  type InboundShipmentJob,
  type InboundShipmentReportIssue,
  type InboundShipmentSnapshot,
  type InboundShipmentStatusFilter,
} from "../inbound-shipments";

type ApiProblem = {
  message?: string;
  requestId?: string | null;
};

export const INBOUND_SHIPMENT_RENDER_BATCH = 50;
export const INBOUND_ITEM_RENDER_BATCH = 100;
export const INBOUND_ISSUE_RENDER_BATCH = 100;
export const INBOUND_COVERAGE_ISSUE_RENDER_BATCH = 100;

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "FBA 入庫貨件同步未完成。";
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/iu, "")
    .replace(/^Error:\s*/iu, "");
}

function progressLabel(job: InboundShipmentJob): string {
  const phase = {
    shipments: "正在讀取貨件清單",
    items: "正在讀取全部貨件商品數量",
    issues: "正在整理每日三層瑕疵報表",
  }[job.progress.phase];
  return job.progress.total === null
    ? `${phase} · 已完成 ${job.progress.completed.toLocaleString("zh-TW")} 筆`
    : `${phase} · ${job.progress.completed.toLocaleString("zh-TW")} / ${job.progress.total.toLocaleString("zh-TW")}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function issueLevelCopy(level: InboundShipmentIssueLevel): {
  title: string;
  detail: string;
} {
  if (level === "shipment") {
    return { title: "貨件層級瑕疵", detail: "整票貨件或建立／接收流程問題" };
  }
  if (level === "carton") {
    return { title: "包裝箱層級瑕疵", detail: "有 Amazon carton ID 的包裝箱問題" };
  }
  return { title: "產品層級瑕疵", detail: "特定 SKU／FNSKU／ASIN 的商品問題" };
}

function IssueRow({ issue }: { issue: InboundShipmentReportIssue }) {
  return (
    <article className="inbound-issue-row">
      <div>
        <strong>{issue.problemType}</strong>
        <small>{issue.productName ?? issue.sellerSku ?? issue.shipmentId}</small>
      </div>
      <dl>
        <div><dt>貨件</dt><dd>{issue.shipmentId}</dd></div>
        {issue.cartonId && <div><dt>包裝箱</dt><dd>{issue.cartonId}</dd></div>}
        {issue.sellerSku && <div><dt>SKU</dt><dd>{issue.sellerSku}</dd></div>}
        {issue.fnsku && <div><dt>FNSKU</dt><dd>{issue.fnsku}</dd></div>}
        {issue.problemQuantity !== null && <div><dt>問題數量</dt><dd>{issue.problemQuantity.toLocaleString("zh-TW")}</dd></div>}
        {issue.expectedUnits !== null && <div><dt>預期</dt><dd>{issue.expectedUnits.toLocaleString("zh-TW")}</dd></div>}
        {issue.receivedUnits !== null && <div><dt>Amazon 已接收</dt><dd>{issue.receivedUnits.toLocaleString("zh-TW")}</dd></div>}
      </dl>
      {(issue.notice || issue.alertStatus || issue.reportedAt) && (
        <p>{[
          issue.notice,
          issue.alertStatus ? `狀態：${issue.alertStatus}` : "",
          issue.reportedAt ? `回報：${formatTimestamp(issue.reportedAt)}` : "",
        ].filter(Boolean).join(" · ")}</p>
      )}
    </article>
  );
}

export default function InboundShipmentsPanel({
  marketplaceId,
  marketplaceShort,
  marketplaceTimeZone,
  cachedResult,
  onCachedResultChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  marketplaceTimeZone: string;
  cachedResult?: InboundShipmentCache | null;
  onCachedResultChange?: (cache: InboundShipmentCache) => void;
}) {
  const defaultRange = useMemo(
    () => defaultInboundShipmentDateRange({ timeZone: marketplaceTimeZone, days: 90 }),
    [marketplaceTimeZone],
  );
  const [range, setRange] = useState<InboundShipmentDateRange>(
    cachedResult?.dateRange ?? defaultRange,
  );
  const [job, setJob] = useState<InboundShipmentJob | null>(cachedResult?.job ?? null);
  const [snapshot, setSnapshot] = useState<InboundShipmentSnapshot | null>(
    cachedResult?.snapshot ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(cachedResult?.error ?? null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InboundShipmentStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [shipmentLimit, setShipmentLimit] = useState(INBOUND_SHIPMENT_RENDER_BATCH);
  const [expandedShipmentIds, setExpandedShipmentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [itemLimits, setItemLimits] = useState<Record<string, number>>({});
  const [issueLimits, setIssueLimits] = useState<
    Record<InboundShipmentIssueLevel, number>
  >({ shipment: INBOUND_ISSUE_RENDER_BATCH, carton: INBOUND_ISSUE_RENDER_BATCH, product: INBOUND_ISSUE_RENDER_BATCH });
  const [coverageIssuesOpen, setCoverageIssuesOpen] = useState(false);
  const [coverageIssueLimit, setCoverageIssueLimit] = useState(
    INBOUND_COVERAGE_ISSUE_RENDER_BATCH,
  );
  const abortRef = useRef<AbortController | null>(null);
  const activePollRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const existingJob = cachedResult?.job;
    if (!existingJob || existingJob.state !== "running" || activePollRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    activePollRef.current = true;
    setBusy(true);
    setError(null);
    const existingRange = cachedResult.dateRange;
    const existingSnapshot = cachedResult.snapshot;
    void pollInboundShipmentJob({
      marketplaceId,
      dateRange: existingRange,
      initialJob: existingJob,
      signal: controller.signal,
      request: (url, signal) => fetch(url, { cache: "no-store", signal }),
      onJob: (next) => {
        if (controller.signal.aborted) return;
        setJob(next);
        if (next.snapshot) setSnapshot(next.snapshot);
        onCachedResultChange?.({
          marketplaceId,
          dateRange: existingRange,
          job: next,
          snapshot: next.snapshot ?? existingSnapshot,
          error: null,
        });
      },
    }).then((terminal) => {
      if (controller.signal.aborted) return;
      if (terminal.state === "failed" || !terminal.snapshot) {
        throw new Error(terminal.notice || "FBA 入庫貨件同步未完成。" );
      }
      setJob(terminal);
      setSnapshot(terminal.snapshot);
      onCachedResultChange?.({
        marketplaceId,
        dateRange: existingRange,
        job: terminal,
        snapshot: terminal.snapshot,
        error: null,
      });
    }).catch((resumeError) => {
      if (resumeError instanceof Error && resumeError.name === "AbortError") return;
      const message = cleanError(resumeError);
      setSnapshot(null);
      setError(message);
      onCachedResultChange?.({
        marketplaceId,
        dateRange: existingRange,
        job: null,
        snapshot: existingSnapshot,
        error: message,
      });
    }).finally(() => {
      if (abortRef.current === controller) {
        activePollRef.current = false;
        setBusy(false);
      }
    });
    return () => controller.abort();
  }, [cachedResult?.job?.jobId, marketplaceId, onCachedResultChange]);

  const applyShortcut = (days: 30 | 90 | 180) => {
    setRange(defaultInboundShipmentDateRange({
      timeZone: marketplaceTimeZone,
      days,
    }));
  };

  const runSynchronization = async(input: {
    dateRange?: InboundShipmentDateRange;
    retryIssueReport?: boolean;
    preserveSnapshot?: InboundShipmentSnapshot | null;
  } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    activePollRef.current = true;
    setBusy(true);
    setError(null);
    setJob(null);
    const preservedSnapshot = input.preserveSnapshot ?? null;
    if (!preservedSnapshot) setSnapshot(null);
    let requestedRange: InboundShipmentDateRange | null = null;
    let lastKnownJob: InboundShipmentJob | null = null;
    try {
      requestedRange = validateInboundShipmentDateRange(input.dateRange ?? range);
      const activeRange = requestedRange;
      setRange(activeRange);
      const startedResponse = await fetch("/api/sp-api/inbound-shipments", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inboundShipmentStartBody({
          marketplaceId,
          dateRange: activeRange,
          retryIssueReport: input.retryIssueReport,
        })),
        signal: controller.signal,
      });
      let startedPayload: unknown;
      try {
        startedPayload = await startedResponse.json();
      } catch {
        if (startedResponse.status === 404) {
          throw new Error(
            "FBA 入庫貨件追蹤需要 AMZ.API Notebook Key v0.1.17 或更新版本。請先更新桌機 Key，再回來同步。",
          );
        }
        throw new Error("FBA 入庫貨件同步回應不是可驗證的 JSON。");
      }
      if (!startedResponse.ok) {
        const problem = startedPayload && typeof startedPayload === "object"
          ? startedPayload as ApiProblem
          : {};
        if (startedResponse.status === 404) {
          throw new Error(
            "FBA 入庫貨件追蹤需要 AMZ.API Notebook Key v0.1.17 或更新版本。請先更新桌機 Key，再回來同步。",
          );
        }
        throw new Error(
          `${problem.message || "無法開始 FBA 入庫貨件同步。"}${
            problem.requestId ? `（Request ID: ${problem.requestId}）` : ""
          }`,
        );
      }
      let current = parseInboundShipmentJob(
        startedPayload,
        marketplaceId,
        activeRange,
      );
      lastKnownJob = current;
      setJob(current);
      onCachedResultChange?.({
        marketplaceId,
        dateRange: activeRange,
        job: current,
        snapshot: preservedSnapshot,
        error: null,
      });
      current = await pollInboundShipmentJob({
        marketplaceId,
        dateRange: activeRange,
        initialJob: current,
        signal: controller.signal,
        request: (url, signal) => fetch(url, { cache: "no-store", signal }),
        onJob: (next) => {
          lastKnownJob = next;
          setJob(next);
          if (next.snapshot) setSnapshot(next.snapshot);
          onCachedResultChange?.({
            marketplaceId,
            dateRange: activeRange,
            job: next,
            snapshot: next.snapshot ?? preservedSnapshot,
            error: null,
          });
        },
      });
      lastKnownJob = current;
      if (current.state === "failed" || !current.snapshot) {
        throw new Error(current.notice || "FBA 入庫貨件同步未完成。" );
      }
      setJob(current);
      setSnapshot(current.snapshot);
      onCachedResultChange?.({
        marketplaceId,
        dateRange: activeRange,
        job: current,
        snapshot: current.snapshot,
        error: null,
      });
    } catch (syncError) {
      if (syncError instanceof Error && syncError.name === "AbortError") return;
      if (abortRef.current === controller) {
        if (!preservedSnapshot) setSnapshot(null);
        const message = cleanError(syncError);
        setError(message);
        if (requestedRange) {
          onCachedResultChange?.({
            marketplaceId,
            dateRange: requestedRange,
            job: lastKnownJob?.state === "failed" ? lastKnownJob : null,
            snapshot: preservedSnapshot,
            error: message,
          });
        }
      }
    } finally {
      if (abortRef.current === controller) {
        activePollRef.current = false;
        setBusy(false);
      }
    }
  };

  const synchronize = () => runSynchronization();

  const retryIssueReport = () => {
    if (!snapshot || snapshot.issueReport.state !== "unavailable") return;
    return runSynchronization({
      dateRange: {
        startDate: snapshot.dateRange.startDate,
        endDate: snapshot.dateRange.endDate,
      },
      retryIssueReport: true,
      preserveSnapshot: snapshot,
    });
  };

  const visibleShipments = useMemo(
    () => snapshot
      ? filterInboundShipments({
          snapshot,
          status: statusFilter,
          search,
          differencesOnly,
        })
      : [],
    [differencesOnly, search, snapshot, statusFilter],
  );
  const renderedShipments = visibleShipments.slice(0, shipmentLimit);
  const itemsByShipment = useMemo(() => {
    const grouped = new Map<string, InboundShipmentSnapshot["items"]>();
    for (const item of snapshot?.items ?? []) {
      const items = grouped.get(item.shipmentId);
      if (items) {
        items.push(item);
      } else {
        grouped.set(item.shipmentId, [item]);
      }
    }
    return grouped;
  }, [snapshot]);

  useEffect(() => {
    setShipmentLimit(INBOUND_SHIPMENT_RENDER_BATCH);
  }, [differencesOnly, search, snapshot?.fetchedAt, statusFilter]);

  useEffect(() => {
    setExpandedShipmentIds(new Set());
    setItemLimits({});
    setIssueLimits({
      shipment: INBOUND_ISSUE_RENDER_BATCH,
      carton: INBOUND_ISSUE_RENDER_BATCH,
      product: INBOUND_ISSUE_RENDER_BATCH,
    });
    setCoverageIssuesOpen(false);
    setCoverageIssueLimit(INBOUND_COVERAGE_ISSUE_RENDER_BATCH);
    setExportError(null);
  }, [snapshot?.fetchedAt]);

  const toggleShipment = (shipmentId: string, open: boolean) => {
    setExpandedShipmentIds((current) => {
      const next = new Set(current);
      if (open) next.add(shipmentId);
      else next.delete(shipmentId);
      return next;
    });
    if (open) {
      setItemLimits((current) => current[shipmentId]
        ? current
        : { ...current, [shipmentId]: INBOUND_ITEM_RENDER_BATCH });
    }
  };

  const downloadExcel = () => {
    setExportError(null);
    try {
      downloadInboundShipmentWorkbook(snapshot!, marketplaceShort);
    } catch (downloadError) {
      setExportError(cleanError(downloadError));
    }
  };

  return (
    <section className="inbound-shipments-panel" aria-label="FBA 入庫貨件追蹤">
      <div className="inbound-boundary" role="note">
        <strong>「Amazon 已接收」是公開 SP-API 的 QuantityReceived</strong>
        <p>它不冒充 Seller Central 秒級更新的「已找到商品」、調查資格或遺失結論。CHECKED_IN／RECEIVING 等尚未關閉狀態的差額只稱「尚在接收／暫時差異」。</p>
      </div>

      <section className="inbound-sync-card" aria-label="同步範圍">
        <div className="inbound-range-heading">
          <div><span>AMAZON LAST UPDATED WINDOW</span><strong>選擇貨件最後更新範圍</strong><small>公開 v0 API 可依日期篩選，但不回傳每一票的更新時間。</small></div>
          <div className="inbound-range-shortcuts" role="group" aria-label="日期快捷">
            {([30, 90, 180] as const).map((days) => (
              <button type="button" key={days} onClick={() => applyShortcut(days)} disabled={busy}>{days} 天</button>
            ))}
          </div>
        </div>
        <div className="inbound-range-controls">
          <label><span>開始日期</span><input type="date" value={range.startDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} disabled={busy} /></label>
          <label><span>結束日期</span><input type="date" value={range.endDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} disabled={busy} /></label>
          <button type="button" className="inbound-sync-button" onClick={() => void synchronize()} disabled={busy}>{busy ? "正在同步全部明細…" : `同步 ${marketplaceShort} 貨件與全部商品`}</button>
        </div>
        {job?.state === "running" && (
          <div className="inbound-progress" role="status">
            <span>{progressLabel(job)}</span>
            {job.progress.total !== null && (
              <progress value={job.progress.completed} max={Math.max(1, job.progress.total)} />
            )}
            <small>這個同步會自動讀完所選範圍的貨件與 SKU 明細，不需要逐票展開。</small>
          </div>
        )}
        {error && <div className="inbound-error" role="alert">{error}</div>}
      </section>

      {snapshot && (
        <>
          <div className="inbound-summary" aria-label="貨件同步摘要">
            {[
              ["貨件", snapshot.summary.shipmentCount],
              ["SKU 明細列", snapshot.summary.itemCount],
              ["預期／送出", snapshot.summary.verifiedTotals.expectedUnits],
              ["Amazon 已接收", snapshot.summary.verifiedTotals.receivedUnits],
              ["尚未接收", snapshot.summary.verifiedTotals.pendingUnits],
              ["多接收", snapshot.summary.verifiedTotals.overReceivedUnits],
            ].map(([label, value]) => (
              <article key={String(label)}><span>{snapshot.coverage.state === "partial" && typeof value === "number" && label !== "貨件" ? "已核對 · " : ""}{label}</span><strong>{Number(value).toLocaleString("zh-TW")}</strong></article>
            ))}
          </div>
          <div className={`inbound-coverage ${snapshot.coverage.state}`} role="status">
            <strong>{snapshot.coverage.state === "complete" ? "全部貨件商品明細已完成" : `${snapshot.coverage.incompleteShipmentCount} 個貨件明細未完整`}</strong>
            <p>{snapshot.notice}</p>
            {snapshot.coverage.issues.length > 0 && (
              <details open={coverageIssuesOpen} onToggle={(event) => setCoverageIssuesOpen(event.currentTarget.open)}><summary>查看未完成範圍（{snapshot.coverage.issues.length.toLocaleString("zh-TW")}）</summary>{coverageIssuesOpen && <><ul>{snapshot.coverage.issues.slice(0, coverageIssueLimit).map((issue, index) => <li key={`${issue.shipmentId ?? "root"}-${issue.code}-${index}`}>{issue.shipmentId ? `${issue.shipmentId} · ` : ""}{issue.message}</li>)}</ul><div className="inbound-render-controls"><span>畫面 {Math.min(coverageIssueLimit, snapshot.coverage.issues.length).toLocaleString("zh-TW")} / {snapshot.coverage.issues.length.toLocaleString("zh-TW")} 個未完成貨件。</span>{coverageIssueLimit < snapshot.coverage.issues.length && <button type="button" onClick={() => setCoverageIssueLimit((current) => current + INBOUND_COVERAGE_ISSUE_RENDER_BATCH)}>顯示更多未完成範圍（{(snapshot.coverage.issues.length - coverageIssueLimit).toLocaleString("zh-TW")}）</button>}</div></>}</details>
            )}
          </div>

          <div className="inbound-filterbar">
            <label className="inbound-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋貨件 ID、名稱、FC、SKU、FNSKU、ASIN" aria-label="搜尋 FBA 入庫貨件" /></label>
            <label><span>貨件狀態</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InboundShipmentStatusFilter)}><option value="all">全部狀態</option><option value="receiving">運送／接收中</option><option value="completed">已完成／關閉</option><option value="cancelled">已取消／刪除</option><option value="unknown">Amazon 未提供狀態</option></select></label>
            <label className="inbound-difference-toggle"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} /><span>只看差異</span></label>
            <button type="button" className="inbound-export-button" onClick={downloadExcel}>下載 Excel</button>
          </div>
          {exportError && <div className="inbound-error" role="alert">{exportError}</div>}

          <section className="inbound-shipment-results" aria-label="貨件與商品明細">
            <header><div><span>SHIPMENTS</span><strong>畫面 {renderedShipments.length.toLocaleString("zh-TW")} / {visibleShipments.length.toLocaleString("zh-TW")} 個符合貨件</strong></div><small>篩選先作用於全部貨件，再分批顯示；Excel 含本次快照全部資料，不受畫面篩選。差異優先，其餘依 Shipment ID。</small></header>
            {visibleShipments.length === 0 && <p className="inbound-empty">目前篩選條件沒有符合的貨件。</p>}
            {renderedShipments.map((shipment) => {
              const totals = shipment.totals ?? shipment.verifiedTotals;
              const difference = inboundShipmentDifferenceCopy({ totals, status: shipment.status, complete: shipment.itemCoverage === "complete" });
              const shipmentItems = itemsByShipment.get(shipment.shipmentId) ?? [];
              const expanded = expandedShipmentIds.has(shipment.shipmentId);
              const itemLimit = itemLimits[shipment.shipmentId] ?? INBOUND_ITEM_RENDER_BATCH;
              const renderedItems = expanded ? shipmentItems.slice(0, itemLimit) : [];
              return (
                <details className="inbound-shipment" key={shipment.shipmentId} open={expanded} onToggle={(event) => toggleShipment(shipment.shipmentId, event.currentTarget.open)}>
                  <summary>
                    <div className="inbound-shipment-identity"><span>{inboundShipmentStatusLabel(shipment.status)}</span><strong>{shipment.shipmentName ?? "Amazon 未提供貨件名稱"}</strong><small>{shipment.shipmentId} · {shipment.destinationFulfillmentCenterId ?? "目的地 FC 未提供"}</small></div>
                    <div className="inbound-shipment-metrics"><span><small>{shipment.itemCoverage === "partial" ? "已核對 SKU" : "SKU"}</small><strong>{shipment.itemCount.toLocaleString("zh-TW")}</strong></span><span><small>預期</small><strong>{totals.expectedUnits.toLocaleString("zh-TW")}</strong></span><span><small>Amazon 已接收</small><strong>{totals.receivedUnits.toLocaleString("zh-TW")}</strong></span></div>
                    <span className={`inbound-difference ${difference.tone}`}>{difference.label}</span>
                    <i aria-hidden="true">⌄</i>
                  </summary>
                  {expanded && (
                    <>
                      <div className="inbound-item-table-scroll">
                        <table>
                          <thead><tr><th>MSKU／商品</th><th>FNSKU／ASIN</th><th>預期／送出</th><th>Amazon 已接收<br /><small>QuantityReceived</small></th><th>尚未接收</th><th>多接收</th><th>判讀</th></tr></thead>
                          <tbody>{renderedItems.map((item) => {
                            const itemDifference = inboundShipmentDifferenceCopy({ totals: item, status: shipment.status, complete: shipment.itemCoverage === "complete" });
                            return <tr key={`${item.sellerSku}-${item.fulfillmentNetworkSku ?? "none"}`}><td><strong>{item.sellerSku}</strong><small>{item.title ?? "Amazon 此 API 未提供商品名稱"}</small></td><td><strong>{item.fulfillmentNetworkSku ?? "—"}</strong><small>{item.asin ?? "ASIN 未提供"}</small></td><td>{item.expectedUnits.toLocaleString("zh-TW")}</td><td>{item.receivedUnits.toLocaleString("zh-TW")}</td><td>{item.pendingUnits.toLocaleString("zh-TW")}</td><td>{item.overReceivedUnits.toLocaleString("zh-TW")}</td><td><span className={`inbound-difference ${itemDifference.tone}`}>{itemDifference.label}</span></td></tr>;
                          })}</tbody>
                        </table>
                      </div>
                      <div className="inbound-render-controls"><span>畫面 {renderedItems.length.toLocaleString("zh-TW")} / {shipmentItems.length.toLocaleString("zh-TW")} 個 SKU 明細；Excel 含本次快照全部資料，不受畫面篩選。</span>{renderedItems.length < shipmentItems.length && <button type="button" onClick={() => setItemLimits((current) => ({ ...current, [shipment.shipmentId]: itemLimit + INBOUND_ITEM_RENDER_BATCH }))}>顯示更多商品明細（{(shipmentItems.length - renderedItems.length).toLocaleString("zh-TW")}）</button>}</div>
                      {shipment.itemCoverage === "partial" && <p className="inbound-item-partial">這一票只顯示已核對的 SKU 列與數量；未讀到的內容保持未知，不補 0。</p>}
                    </>
                  )}
                </details>
              );
            })}
            {renderedShipments.length < visibleShipments.length && <div className="inbound-render-controls"><span>目前畫面分批顯示；Excel 含本次快照全部資料，不受畫面篩選。</span><button type="button" onClick={() => setShipmentLimit((current) => current + INBOUND_SHIPMENT_RENDER_BATCH)}>顯示更多貨件（{(visibleShipments.length - renderedShipments.length).toLocaleString("zh-TW")}）</button></div>}
          </section>

          <section className="inbound-issues" aria-label="FBA 入庫三層瑕疵">
            <header><div><span>DAILY INBOUND PERFORMANCE REPORT</span><strong>貨件／包裝箱／產品三層瑕疵</strong></div><p>這是 Amazon 每日問題報表，可能落後 Seller Central 即時狀態；沒有問題列只代表 Amazon 目前未回傳，不代表零瑕疵。</p></header>
            <div className={`inbound-issue-report-state ${snapshot.issueReport.state}`}><strong>{snapshot.issueReport.state === "completed" ? "每日報表已讀取" : snapshot.issueReport.state === "partial" ? "每日報表部分完成" : "每日報表目前不可用"}</strong><span>{snapshot.issueReport.notice}</span><small>每日瑕疵報表讀取時間：{snapshot.issueReport.fetchedAt ? formatTimestamp(snapshot.issueReport.fetchedAt) : "未取得"}；Amazon 未提供可證明的 dataThrough。</small>{snapshot.issueReport.excludedShipmentCount !== null && snapshot.issueReport.excludedShipmentCount > 0 && <small>另排除 {snapshot.issueReport.excludedShipmentCount.toLocaleString("zh-TW")} 個不在本次日期範圍的問題貨件；未暴露其識別碼。</small>}</div>
            {snapshot.issueReport.state === "unavailable" && (
              <div className="inbound-issue-retry">
                <button type="button" onClick={() => void retryIssueReport()} disabled={busy}>
                  {busy ? "正在重新嘗試每日瑕疵報表…" : "重新嘗試每日瑕疵報表"}
                </button>
                <p>如果 Amazon 的安全等待時間尚未到，這次明確重試仍可能不會重建每日報表；一般同步與背景接回不會自動重試。</p>
              </div>
            )}
            <div className="inbound-issue-levels">
              {(["shipment", "carton", "product"] as const).map((level) => {
                const copy = issueLevelCopy(level);
                const issues = snapshot.issueReport[level];
                const renderedIssues = issues.slice(0, issueLimits[level]);
                return <section key={level}><header><div><strong>{copy.title}</strong><small>{copy.detail}</small></div><b>畫面 {renderedIssues.length.toLocaleString("zh-TW")} / {issues.length.toLocaleString("zh-TW")}</b></header>{issues.length ? <><div className="inbound-issue-list">{renderedIssues.map((issue, index) => <IssueRow issue={issue} key={`${issue.shipmentId}-${issue.problemType}-${index}`} />)}</div><div className="inbound-render-controls"><span>Excel 含本次快照全部資料，不受畫面篩選。</span>{renderedIssues.length < issues.length && <button type="button" onClick={() => setIssueLimits((current) => ({ ...current, [level]: current[level] + INBOUND_ISSUE_RENDER_BATCH }))}>顯示更多{copy.title}（{(issues.length - renderedIssues.length).toLocaleString("zh-TW")}）</button>}</div></> : <p className="inbound-no-issues">Amazon 每日問題報表目前未回傳這個層級的問題列。</p>}</section>;
              })}
            </div>
          </section>

          <p className="inbound-footnote">貨件數量快照時間：{formatTimestamp(snapshot.fetchedAt)}。查詢範圍 {snapshot.dateRange.startDate} – {snapshot.dateRange.endDate}；Amazon 公開 v0 API 不回傳逐貨件更新時間，因此表內不會捏造日期排序。</p>
        </>
      )}
    </section>
  );
}
