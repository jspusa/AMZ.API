"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseReportAccessPlan,
  parseReportLibrarySnapshot,
  reportStateLabel,
  type ReportAccessPlanView,
  type ReportCatalogView,
  type ReportLibrarySnapshot,
} from "../report-library";

const CATEGORY_LABELS: Record<string, string> = {
  AMAZON_BUSINESS: "Amazon Business",
  ANALYTICS: "品牌與分析",
  B2B_OPPORTUNITIES: "B2B 機會",
  BROWSE_TREE: "目錄分類",
  EASY_SHIP: "Easy Ship（非 FBA）",
  FBA: "FBA",
  INVENTORY: "商品與庫存",
  INVOICE_DATA: "發票資料",
  ORDER: "訂單",
  PAYMENT: "款項",
  PERFORMANCE: "績效與促銷",
  REGULATORY: "法規與 EPR",
  RETURNS: "退貨",
  SETTLEMENT: "結算",
  TAX: "稅務",
};

const ACCESS_FILTERS = [
  { value: "ALL", label: "全部可見報表" },
  { value: "READY", label: "目前站點可規劃" },
  { value: "EXTRA", label: "需額外角色／資格" },
  { value: "MARKETPLACE_UNAVAILABLE", label: "目前站點不支援" },
  { value: "FBA_FILTER_REQUIRED", label: "需 FBA 篩選證據" },
  { value: "OUT_OF_FBA_SCOPE", label: "非 FBA 範圍" },
] as const;

type AccessFilter = (typeof ACCESS_FILTERS)[number]["value"];

function matchesAccessFilter(report: ReportCatalogView, filter: AccessFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "READY") return report.state === "READY_TO_PLAN";
  if (filter === "EXTRA") {
    return [
      "EXTRA_ROLE_REQUIRED",
      "RDT_REQUIRED",
      "MANUAL_PREREQUISITE",
      "AMAZON_GENERATED_ONLY",
    ].includes(report.state);
  }
  return report.state === filter;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function ReportLibraryPanel({
  marketplaceId,
  onOpenExport,
}: {
  marketplaceId: string;
  onOpenExport?: (exportId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ReportLibrarySnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("ALL");
  const [busy, setBusy] = useState<string | null>("catalog");
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Record<string, ReportAccessPlanView>>({});
  const controllerRef = useRef<AbortController | null>(null);
  const planControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    planControllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSnapshot(null);
    setPlans({});
    setError(null);
    setBusy("catalog");
    const params = new URLSearchParams({ marketplaceId });
    void fetch(`/api/sp-api/report-library?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const raw = await response.json() as unknown;
      if (!response.ok) throw new Error(errorMessage(raw, "文件庫載入失敗。"));
      const parsed = parseReportLibrarySnapshot(raw);
      if (parsed.marketplaceId !== marketplaceId) throw new Error("文件庫回應站點不一致。");
      setSnapshot(parsed);
    }).catch((loadError) => {
      if (loadError instanceof Error && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "文件庫載入失敗。");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(null);
    });
    return () => {
      controller.abort();
      planControllerRef.current?.abort();
    };
  }, [marketplaceId]);

  const categories = useMemo(() => {
    const values = new Set(
      snapshot?.reports
        .filter((report) => report.party !== "VENDOR")
        .flatMap((report) => report.categories) ?? [],
    );
    return ["ALL", ...Object.keys(CATEGORY_LABELS).filter((key) => values.has(key))];
  }, [snapshot]);

  const sellerReports = useMemo(
    () => snapshot?.reports.filter((report) => report.party !== "VENDOR") ?? [],
    [snapshot],
  );
  const visibleAppExports = useMemo(
    () => snapshot?.currentAppExports.filter((item) => item.id !== "REVIEW_TOPIC_AUDIT_XLSX") ?? [],
    [snapshot],
  );

  const visibleReports = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    return sellerReports.filter((report) =>
      (category === "ALL" || report.categories.includes(category)) &&
      matchesAccessFilter(report, accessFilter) &&
      (!normalized || [
        report.reportType,
        report.label,
        report.description,
        report.roles.join(" "),
      ].join(" ").toLocaleLowerCase("en-US").includes(normalized)),
    );
  }, [accessFilter, category, query, sellerReports]);

  const requestPlan = async (report: ReportCatalogView) => {
    planControllerRef.current?.abort();
    const controller = new AbortController();
    planControllerRef.current = controller;
    const requestedMarketplaceId = marketplaceId;
    setBusy(report.reportType);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/report-library/access-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplaceId: requestedMarketplaceId,
          reportType: report.reportType,
        }),
        signal: controller.signal,
      });
      const raw = await response.json() as unknown;
      if (!response.ok) throw new Error(errorMessage(raw, "無法查看此 report type 的安全規劃。"));
      const plan = parseReportAccessPlan(
        raw,
        requestedMarketplaceId,
        report.reportType,
      );
      if (controller.signal.aborted) return;
      setPlans((current) => ({ ...current, [report.reportType]: plan }));
    } catch (planError) {
      if (
        controller.signal.aborted ||
        (planError instanceof Error && planError.name === "AbortError")
      ) return;
      setError(planError instanceof Error ? planError.message : "無法查看報表規劃。");
    } finally {
      if (planControllerRef.current === controller) {
        planControllerRef.current = null;
        if (!controller.signal.aborted) setBusy(null);
      }
    }
  };

  return (
    <section className="report-library-panel" aria-label="Amazon API 文件庫">
      <header className="report-library-hero">
        <div>
          <p className="eyebrow">PUBLIC API · FBA ONLY</p>
          <h2>文件庫</h2>
          <p>先看現在就能匯出的 Excel，再查閱 Amazon 公開 Reports API 的完整能力邊界。</p>
        </div>
        {snapshot && (
          <a href={snapshot.officialCatalog.source} target="_blank" rel="noreferrer noopener">
            Amazon 官方 report type 清單 ↗
          </a>
        )}
      </header>

      {error && <div className="report-library-error" role="alert">{error}</div>}
      {busy === "catalog" && <div className="report-library-loading" role="status">正在整理 Amazon 公開文件能力…</div>}

      {snapshot && (
        <>
          <section className="report-library-ready" aria-labelledby="report-library-ready-title">
            <div className="report-library-section-heading">
              <div><p className="eyebrow">READY IN AMZ.API</p><h3 id="report-library-ready-title">目前 App 已可匯出</h3></div>
              <span>{visibleAppExports.length} 項 Excel 能力</span>
            </div>
            <div className="report-library-export-grid">
              {visibleAppExports.map((item) => (
                <article className="report-library-export-card" key={item.id}>
                  <strong>{item.label}</strong>
                  <p>{item.scope}</p>
                  <small>資料來源：{item.source}</small>
                  <button type="button" onClick={() => onOpenExport?.(item.id)} disabled={!onOpenExport}>
                    {item.availability === "AVAILABLE_AFTER_SUCCESSFUL_AUDIT" ? "開啟健檢後匯出" : "前往健檢與匯出"}
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="report-library-catalog" aria-labelledby="report-library-catalog-title">
            <div className="report-library-section-heading">
              <div>
                <p className="eyebrow">AMAZON PUBLIC REPORTS API</p>
                <h3 id="report-library-catalog-title">Amazon 有的報表類型</h3>
              </div>
              <span>{sellerReports.length} 個 Seller 可見 report types</span>
            </div>
            <div className="report-library-catalog-notice" role="note">
              <strong>Amazon 有此文件 ≠ 本 App 已可直接下載</strong>
              <p>{snapshot.officialCatalog.changeNotice}</p>
              <small>驗證日：{snapshot.officialCatalog.verifiedAt} · {snapshot.officialCatalog.officialPageUpdatedLabel}</small>
            </div>
            <div className="report-library-toolbar">
              <label><span className="sr-only">搜尋 report type</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋名稱、reportType 或角色" /></label>
              <label className="report-library-access-filter">
                <span className="sr-only">依存取條件篩選</span>
                <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value as AccessFilter)}>
                  {ACCESS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <nav aria-label="報表分類">
                {categories.map((key) => (
                  <button type="button" key={key} className={category === key ? "active" : ""} onClick={() => setCategory(key)}>
                    {key === "ALL" ? "全部" : CATEGORY_LABELS[key]}
                  </button>
                ))}
              </nav>
            </div>
            <div className="report-library-report-list">
              {visibleReports.map((report) => {
                const plan = plans[report.reportType];
                return (
                  <article className={`report-library-report ${report.state.toLocaleLowerCase()}`} key={report.reportType}>
                    <header><div><strong>{report.label}</strong><code>{report.reportType}</code></div><span>{reportStateLabel(report.state)}</span></header>
                    <p>{report.description}</p>
                    <div className="report-library-meta">
                      <span>{report.output}</span><span>{report.lifecycle}</span><span>{report.fbaScope}</span>
                      {report.roles.length > 0 && <span>角色：{report.roles.join("、")}</span>}
                    </div>
                    <small>{report.marketplaceAvailability}</small>
                    <footer>
                      <button type="button" onClick={() => void requestPlan(report)} disabled={Boolean(busy)}>
                        {busy === report.reportType ? "檢查中…" : "查看接線條件"}
                      </button>
                      <a href={report.officialSource} target="_blank" rel="noreferrer noopener">官方說明 ↗</a>
                    </footer>
                    {plan && <div className="report-library-plan" role="status"><strong>本 App 尚未接線這個下載</strong><p>{plan.notice}</p>{plan.nextStep && <small>{plan.nextStep}</small>}</div>}
                  </article>
                );
              })}
              {!visibleReports.length && (
                <p className="variation-empty">目前篩選條件沒有符合的 Seller report type。</p>
              )}
            </div>
          </section>

          <section className="report-library-unavailable" aria-labelledby="report-library-unavailable-title">
            <h3 id="report-library-unavailable-title">公開 API 目前無法提供</h3>
            {snapshot.unavailableDocuments.map((item) => (
              <article key={item.id}><strong>{item.label}</strong><p>{item.reason}</p><a href={item.officialSource} target="_blank" rel="noreferrer noopener">官方邊界 ↗</a></article>
            ))}
          </section>
          <p className="report-library-footnote">{snapshot.notice}</p>
        </>
      )}
    </section>
  );
}
