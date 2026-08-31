"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingRowMatchesFilter,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  type BusinessPricingAuditFilter,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
  type BusinessQuantityDiscountPlan,
} from "../business-pricing-audit";
import {
  pollStandaloneAuditJob,
  standaloneAuditSnapshotMatchesJob,
  startStandaloneAuditJob,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";
import {
  openSellerCentralInventoryHandoff,
  supportsFixedSellerCentralHandoffs,
} from "../seller-central-handoff";
import { auditExportFilename } from "../audit-export-filename";
import { publicProblemMessage } from "../write-request";
import BusinessPricingEditor from "./business-pricing-editor";

const FILTERS: readonly Readonly<{
  value: BusinessPricingAuditFilter;
  label: string;
}>[] = [
  { value: "all", label: "全部" },
  { value: "problem", label: "需處理" },
  { value: "recommended_price_mismatch", label: "不符建議 B2B 價格" },
  {
    value: "recommended_quantity_discount_mismatch",
    label: "未正確設定階梯折扣",
  },
  { value: "above_standard", label: "高於一般售價" },
  { value: "missing", label: "未設定" },
  { value: "configured", label: "已設定" },
  { value: "incomplete", label: "資料未完成" },
];

function formatMoney(value: BusinessPricingMoney | null): string {
  if (!value) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: value.currencyCode,
      maximumFractionDigits: value.currencyCode === "JPY" ? 0 : 2,
    }).format(value.amount);
  } catch {
    return `${value.currencyCode} ${value.amount}`;
  }
}

function statusLabel(status: BusinessPricingAuditRow["status"]): string {
  if (status === "configured") return "已設定";
  if (status === "above_standard") return "B2B 高於一般售價";
  if (status === "missing") return "未設定 B2B 價格";
  if (status === "unsupported") return "請至 Amazon 後台確認";
  return "資料未完成";
}

function rowStatusDetail(row: BusinessPricingAuditRow): string {
  if (row.status === "incomplete") {
    return row.reason;
  }
  if (row.status === "unsupported") {
    return "請至 Amazon 後台核對 Business Price 與數量折扣。";
  }
  if (row.status === "above_standard") {
    return "目前 B2B 價格高於一般售價，建議調整。";
  }
  if (row.status === "missing") {
    return "Amazon Business 可用，但尚未設定 B2B 價格。";
  }
  return "已找到 Amazon Business 價格；需要調整時請前往 Amazon 後台。";
}

function recommendationFindings(row: BusinessPricingAuditRow): string[] {
  return [
    ...(row.recommendedPriceMismatch ? ["不符建議 B2B 價格"] : []),
    ...(row.recommendedQuantityDiscountMismatch
      ? ["未正確設定階梯折扣"]
      : []),
  ];
}

function QuantityDiscountPlan({
  plan,
  ambiguous = false,
}: Readonly<{
  plan: BusinessQuantityDiscountPlan | null;
  ambiguous?: boolean;
}>) {
  if (ambiguous) {
    return <span className="business-pricing-quantity-empty">Amazon 未能確認，請到後台核對</span>;
  }
  if (!plan) {
    return <span className="business-pricing-quantity-empty">未設定</span>;
  }
  const percent = plan.discountType === "percent";
  return (
    <div className="business-pricing-quantity-plan">
      <span className="business-pricing-quantity-kind">
        {percent ? "百分比折扣" : "固定單價"}
      </span>
      <div
        className="business-pricing-quantity-tiers"
        role="list"
        aria-label={percent ? "百分比數量折扣階梯" : "固定單價數量折扣階梯"}
      >
        {plan.levels.map((level) => (
          <span
            className="business-pricing-quantity-tier"
            role="listitem"
            key={`${level.lowerBound}-${level.value}`}
          >
            <strong>{level.lowerBound} 件以上</strong>
            <span>{percent ? `省 ${level.value}%` : `每件 ${level.value}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function recommendedBusinessPrice(
  standardPrice: BusinessPricingMoney | null,
): BusinessPricingMoney | null {
  if (!standardPrice || standardPrice.currencyCode !== "USD" ||
      standardPrice.amount <= 1) return null;
  return {
    amount: Number((standardPrice.amount - 1).toFixed(2)),
    currencyCode: "USD",
  };
}

function rowCount(
  snapshot: BusinessPricingAuditSnapshot,
  filter: BusinessPricingAuditFilter,
): number {
  return snapshot.rows.filter((row) =>
    businessPricingRowMatchesFilter(row, filter),
  ).length;
}

export function shouldResumeBusinessPricingAuditJob(input: Readonly<{
  initialJob: StandaloneAuditJob | null;
  snapshot: BusinessPricingAuditSnapshot | null;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  observerJobId: string | null;
}>): boolean {
  const { initialJob } = input;
  if (
    !initialJob ||
    initialJob.kind !== "businessPricing" ||
    initialJob.marketplaceId !== input.marketplaceId ||
    initialJob.mode !== input.mode ||
    (!initialJob.ready && input.observerJobId === initialJob.jobId)
  ) return false;
  return !standaloneAuditSnapshotMatchesJob(input.snapshot, initialJob);
}

export default function BusinessPricingAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  initialSnapshot = null,
  cachedSnapshot = null,
  initialJob = null,
  onSnapshotChange,
  onJobChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  initialSnapshot?: BusinessPricingAuditSnapshot | null;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  initialJob?: StandaloneAuditJob | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onJobChange?: (job: StandaloneAuditJob) => void;
}) {
  const [snapshot, setSnapshot] = useState<BusinessPricingAuditSnapshot | null>(
    initialSnapshot ?? cachedSnapshot,
  );
  const [filter, setFilter] = useState<BusinessPricingAuditFilter>("problem");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] =
    useState<BusinessPricingListingSnapshot | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [job, setJob] = useState<StandaloneAuditJob | null>(
    initialJob?.kind === "businessPricing" &&
      initialJob.marketplaceId === marketplaceId &&
      initialJob.mode === mode
      ? initialJob
      : null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const editorRevisionRef = useRef(0);

  const visibleSnapshot = useMemo(() => {
    if (!snapshot || loading) return null;
    if (!job) return snapshot;
    if (!job.ready || job.status !== "completed") return null;
    const jobSnapshot = job.snapshot;
    return jobSnapshot && typeof jobSnapshot === "object" &&
        !Array.isArray(jobSnapshot) &&
        (jobSnapshot as { fetchedAt?: unknown }).fetchedAt === snapshot.fetchedAt
      ? snapshot
      : null;
  }, [job, loading, snapshot]);
  const terminalJobError = job?.ready && job.status !== "completed"
    ? job.error.message
    : null;

  const fixedSellerCentralHandoffs = supportsFixedSellerCentralHandoffs(
    typeof window === "undefined" ? null : window.fbaOS?.app,
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const visibleRows = useMemo(
    () => visibleSnapshot?.rows.filter((row) =>
      businessPricingRowMatchesFilter(row, filter),
    ) ?? [],
    [filter, visibleSnapshot],
  );

  const loadAudit = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "B2B 價格背景健檢尚未完成。",
      );
    }
    const next = parseBusinessPricingAuditSnapshot(completedJob.snapshot);
    if (next.marketplaceId !== marketplaceId) {
      throw new Error("B2B 價格健檢站點與目前選擇不一致。");
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    setSnapshot(next);
    onSnapshotChange?.(next);
    setFilter("problem");
    setProgress(null);
  };

  const runAudit = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setProgress("正在建立 Amazon FBA 全商品清單…");
    editorRevisionRef.current += 1;
    setSelected(null);
    try {
      let current = await startStandaloneAuditJob({
        kind: "businessPricing",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      setJob(current);
      onJobChange?.(current);
      setProgress(current.progress.message);
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: (next) => {
          setJob(next);
          onJobChange?.(next);
          setProgress(next.progress.message);
        },
      });
      setJob(current);
      onJobChange?.(current);
      await loadAudit(current, controller.signal);
      observerJobIdRef.current = null;
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "B2B 價格健檢失敗。");
      setProgress(null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!shouldResumeBusinessPricingAuditJob({
      initialJob,
      snapshot,
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    // The guard above proves this is a matching B2B job.
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setJob(observedJob);
    setLoading(true);
    setError(null);
    setProgress(observedJob.progress.message);
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: (next) => {
                setJob(next);
                onJobChange?.(next);
                setProgress(next.progress.message);
              },
            });
        setJob(terminal);
        onJobChange?.(terminal);
        await loadAudit(terminal, controller.signal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續 B2B 價格健檢。");
        setProgress(null);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          observerJobIdRef.current = null;
          setLoading(false);
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
  }, [
    initialJob?.jobId,
    initialJob?.contextId,
    initialJob?.ready,
    marketplaceId,
    mode,
  ]);

  const openSellerCentralInventory = async (sellerSku: string) => {
    setHandoffError(null);
    try {
      const outcome = await openSellerCentralInventoryHandoff(
        window.fbaOS.app,
        sellerSku,
      );
      if (outcome === "upgrade-required") {
        setHandoffError(
          "目前 Notebook Key 版本無法安全開啟指定 SKU；請先更新 Notebook Key。為避免開錯商品，不會改開 Seller Central 首頁。",
        );
      }
    } catch {
      setHandoffError("無法開啟這個 SKU 的 Amazon 庫存頁；請更新 Notebook Key 後再試一次。");
    }
  };

  const openEditor = async (row: BusinessPricingAuditRow) => {
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setError(null);
    setSelected(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        sku: row.sellerSku,
      });
      const response = await fetch(`/api/sp-api/business-pricing?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "無法重新讀取此 SKU 的 B2B 價格。",
        ));
      }
      const fresh = parseBusinessPricingListingSnapshot(payload);
      if (
        fresh.marketplaceId !== marketplaceId ||
        fresh.sellerSku !== row.sellerSku
      ) {
        throw new Error("Amazon 回傳的 B2B 價格識別與所選 SKU 不一致。");
      }
      if (editorRevisionRef.current !== revision) return;
      setSelected(fresh);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error
          ? requestError.message
          : "無法開啟 B2B 價格編輯。");
      }
    } finally {
      if (editorRevisionRef.current === revision) setEditLoading(false);
    }
  };

  const applyVerifiedPrice = (nextResult: BusinessPriceUpdate) => {
    if (!snapshot) return;
    const nextSnapshot = applyVerifiedBusinessPriceToAuditSnapshot(
      snapshot,
      nextResult,
    );
    setSnapshot(nextSnapshot);
    onSnapshotChange?.(nextSnapshot);
  };

  const exportExcel = async () => {
    if (
      !visibleSnapshot ||
      exporting ||
      !job?.ready ||
      job.status !== "completed"
    ) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        mode,
        jobId: job.jobId,
        contextId: job.contextId,
      });
      const response = await fetch(
        `/api/sp-api/business-pricing-audit/export?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        let message = "目前無法匯出 B2B 價格 Excel。";
        try {
          const payload = await response.json() as { message?: unknown };
          if (typeof payload.message === "string") message = payload.message;
        } catch {
          // The bytes endpoint may not have a JSON body.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auditExportFilename({
        kind: "businessPricing",
        marketplaceShort,
        fetchedAt: visibleSnapshot.fetchedAt,
      });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error
        ? exportError.message
        : "目前無法匯出 B2B 價格 Excel。");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="business-pricing-audit-panel" aria-label="全站 FBA Amazon Business 價格健檢">
      <div className="business-pricing-audit-intro">
        <div>
          <span>{marketplaceShort} · FBA ONLY</span>
          <h3>找出未設定或高於一般售價的企業價格</h3>
          <p>同時核對 Business Price 與數量折扣；商品列可直接安全預檢，或前往 Amazon 後台。</p>
        </div>
        <button type="button" className="price-primary-button" onClick={() => void runAudit()} disabled={loading || editLoading}>
          {loading ? "健檢中…" : snapshot ? "重新健檢" : "開始全站 B2B 價格健檢"}
        </button>
      </div>
      <div className="business-pricing-recommendation" aria-label="B2B 價格建議規則">
        <strong>Jasper US 建議規則</strong>
        <span>US 一般售價 – USD 1.00</span>
        <span>數量折扣：5 件 5%・10 件 10%・15 件 15%・20 件 20%</span>
      </div>
      <p className="business-pricing-safety-note">編輯前會重新核對指定 SKU、你帳號的 Amazon 可編輯規則，並執行 Amazon Validation Preview（零寫入）；若 Amazon 規則允許安全更新階梯，預設一併帶入 Business Price 與 1–5 階 percent 建議折扣。你仍可明確切換為只改 Business Price，該模式會完整保留現有階梯折扣；正式送出仍需 Touch ID／Windows Hello。</p>
      {(job && !job.ready ? job.progress.message : progress) && (
        <div className="business-pricing-progress" role="status">
          {job && !job.ready ? job.progress.message : progress}
        </div>
      )}
      {(error || terminalJobError) && (
        <div className="price-error" role="alert">{error ?? terminalJobError}</div>
      )}
      {handoffError && <div className="price-error" role="alert">{handoffError}</div>}
      {!fixedSellerCentralHandoffs && (
        <p className="business-pricing-notice" role="status">
          目前 Notebook Key 需更新後才能安全開啟指定 SKU；為避免開錯商品，舊版不會改開 Seller Central 首頁。
        </p>
      )}

      {visibleSnapshot && (
        <>
          <div className="business-pricing-summary is-interactive" role="group" aria-label="B2B 價格健檢摘要與篩選">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${filter === option.value ? "active" : ""}${
                  option.value === "problem" || option.value === "missing" ||
                    option.value === "above_standard"
                    ? " problem"
                    : ""
                }`}
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                <span>{option.label}</span><strong>{rowCount(visibleSnapshot, option.value)}</strong>
              </button>
            ))}
          </div>
          <p className="business-pricing-notice">
            本次已核對 {visibleSnapshot.summary.totalFbaSkuCount} 個 FBA SKU；需要手動處理時可從商品列開啟 Amazon 後台。
          </p>
          <div className="business-pricing-export">
            <button
              type="button"
              className="business-pricing-export-button"
              onClick={() => void exportExcel()}
              disabled={
                exporting ||
                !job?.ready ||
                job.status !== "completed"
              }
            >
              {exporting ? "正在建立 Excel…" : "匯出 B2B 價格 Excel"}
            </button>
            {(!job?.ready || job.status !== "completed") && (
              <small>請先完成本次背景健檢；Excel 只會使用主程序保存的原始快照。</small>
            )}
          </div>
          <div className="business-pricing-list" role="list" aria-label="FBA B2B 價格商品">
            {visibleRows.map((row) => (
              <article
                key={row.sellerSku}
                className={`business-pricing-row ${row.status}${
                  row.recommendedPriceMismatch ? " is-price-mismatch" : ""
                }${
                  row.recommendedQuantityDiscountMismatch
                    ? " is-tier-mismatch"
                    : ""
                }`}
                role="listitem"
              >
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <small>{row.sellerSku} · {row.asin || "無 ASIN"}</small>
                </div>
                <dl>
                  <div><dt>一般售價</dt><dd>{formatMoney(row.standardPrice)}</dd></div>
                  <div><dt>B2B 價格</dt><dd>{formatMoney(row.businessPrice)}</dd></div>
                  <div><dt>建議 B2B 價格</dt><dd>{formatMoney(recommendedBusinessPrice(row.standardPrice))}</dd></div>
                  <div className="business-pricing-quantity-cell">
                    <dt>目前數量折扣</dt>
                    <dd>
                      <QuantityDiscountPlan
                        plan={row.quantityDiscountPlan}
                        ambiguous={row.quantityDiscountPlanPresence === "ambiguous"}
                      />
                    </dd>
                  </div>
                </dl>
                <div className="business-pricing-row-status">
                  <span>{statusLabel(row.status)}</span>
                  {recommendationFindings(row).length > 0 && (
                    <div className="business-pricing-findings" aria-label="建議規則問題">
                      {recommendationFindings(row).map((finding) => (
                        <strong key={finding}>{finding}</strong>
                      ))}
                    </div>
                  )}
                  <small>{rowStatusDetail(row)}</small>
                </div>
                <div className="business-pricing-row-actions">
                  <button
                    type="button"
                    onClick={() => void openEditor(row)}
                    disabled={editLoading || loading}
                  >{row.status === "missing" ? "設定 B2B 價格" : "調整 B2B 價格"}</button>
                  <button
                    type="button"
                    className="business-pricing-seller-central"
                    onClick={() => void openSellerCentralInventory(row.sellerSku)}
                    disabled={!fixedSellerCentralHandoffs}
                  >前往 Amazon 後台 ↗</button>
                </div>
              </article>
            ))}
            {visibleRows.length === 0 && <p className="business-pricing-empty">這個篩選沒有商品。</p>}
          </div>
        </>
      )}

      {selected && (
        <BusinessPricingEditor
          key={`${selected.sellerSku}-${selected.fetchedAt}`}
          listing={selected}
          onClose={() => {
            editorRevisionRef.current += 1;
            setSelected(null);
            setEditLoading(false);
          }}
          onVerified={applyVerifiedPrice}
          onError={setError}
          onBusyChange={setEditLoading}
        />
      )}
    </section>
  );
}
