"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyBusinessPriceWriteStatusToAuditSnapshot,
  applyBusinessPricingListingReadToAuditSnapshot,
  applyVerifiedBusinessPricingListingToAuditSnapshot,
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingWorkflowProgress,
  businessPricingRowMatchesFilter,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  retainBusinessPricingWorkflowActivities,
  type BusinessPricingAuditFilter,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
  type BusinessPriceWriteStatus,
  type BusinessQuantityDiscountPlan,
  type BusinessPricingWorkflowProgress,
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
import AuditDetailsDisclosure from "./audit-details-disclosure";
import type { AuditSurfacePresentation } from "./audit-workspace-shell";
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
  { value: "configured", label: "正確設定" },
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

function statusLabel(row: BusinessPricingAuditRow): string {
  if (row.status === "configured") {
    return row.recommendedPriceMismatch ||
        row.recommendedQuantityDiscountMismatch
      ? "已設定但需調整"
      : "正確設定";
  }
  if (row.status === "above_standard") return "B2B 高於一般售價";
  if (row.status === "missing") return "未設定 B2B 價格";
  if (row.status === "unsupported") return "請至 Amazon 後台確認";
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
  if (
    row.recommendedPriceMismatch ||
    row.recommendedQuantityDiscountMismatch
  ) {
    return "已找到 Amazon Business 價格，但仍有建議規則需要調整。";
  }
  return "Business Price 與建議數量折扣皆已正確設定。";
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

function WorkflowProgress({
  progress,
}: Readonly<{ progress: BusinessPricingWorkflowProgress }>) {
  const stateLabel = (state: BusinessPricingWorkflowProgress["steps"][number]["state"]): string => {
    if (state === "complete") return "完成";
    if (state === "current") return "目前步驟";
    if (state === "skipped") return "本次不需要";
    return "尚未開始";
  };
  return (
    <div
      className={`business-pricing-workflow is-${progress.state.replace("_", "-")}`}
      aria-label={`B2B 調整進度：${progress.headline}`}
    >
      <header>
        <strong>{progress.headline}</strong>
        <span>已調整商品</span>
      </header>
      <ol>
        {progress.steps.map((step, index) => (
          <li className={`is-${step.state}`} key={step.label}>
            <i aria-hidden="true">{step.state === "complete"
              ? "✓"
              : step.state === "current"
              ? index + 1
              : "–"}</i>
            <span>{step.label}</span>
            <small>{step.statusLabel ?? stateLabel(step.state)}</small>
            {(step.target || step.observed) && (
              <span className="business-pricing-workflow-values">
                {step.target && <em>目標 {formatMoney(step.target)}</em>}
                {step.observed && (
                  <em>Amazon 回查 {formatMoney(step.observed)}</em>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
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
  presentation = "dialog",
  initialSnapshot = null,
  cachedSnapshot = null,
  initialJob = null,
  onSnapshotChange,
  onJobChange,
  onEditorOpenChange,
  onEditorBusyChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  presentation?: AuditSurfacePresentation;
  initialSnapshot?: BusinessPricingAuditSnapshot | null;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  initialJob?: StandaloneAuditJob | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onJobChange?: (job: StandaloneAuditJob) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onEditorBusyChange?: (busy: boolean) => void;
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
  const [openingSellerSku, setOpeningSellerSku] = useState<string | null>(null);
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
  const panelRef = useRef<HTMLElement | null>(null);
  const auditScrollTopRef = useRef(0);
  const editorOpenRef = useRef(false);
  const snapshotRef = useRef<BusinessPricingAuditSnapshot | null>(snapshot);

  const publishSnapshot = (next: BusinessPricingAuditSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    onSnapshotChange?.(next);
  };

  const rememberWriteStatus = (writeStatus: BusinessPriceWriteStatus) => {
    const current = snapshotRef.current;
    if (!current) return;
    publishSnapshot(applyBusinessPriceWriteStatusToAuditSnapshot(
      current,
      writeStatus,
    ));
  };

  const rememberListingRead = (listing: BusinessPricingListingSnapshot) => {
    const current = snapshotRef.current;
    if (!current || !listing.writeStatus) return;
    publishSnapshot(applyBusinessPricingListingReadToAuditSnapshot(
      current,
      listing,
    ));
  };

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

  useEffect(() => {
    onEditorOpenChange?.(selected !== null);
  }, [onEditorOpenChange, selected]);

  useEffect(() => {
    const editorOpen = selected !== null;
    if (editorOpenRef.current === editorOpen) return;
    editorOpenRef.current = editorOpen;
    const targetScrollTop = editorOpen ? 0 : auditScrollTopRef.current;
    if (presentation === "dialog") {
      const panel = panelRef.current;
      if (panel) panel.scrollTop = targetScrollTop;
      return;
    }

    let restoreFrame: number | null = null;
    let scrollRoot: HTMLElement | null = null;
    let previousScrollBehavior: string | null = null;
    try {
      scrollRoot = document.documentElement;
      previousScrollBehavior = scrollRoot.style.scrollBehavior;
      // The workspace presentation has no panel scroller: the browser window
      // owns the audit-list position. Disable global smooth scrolling for this
      // state restoration so the editor and the originating row land exactly.
      scrollRoot.style.scrollBehavior = "auto";
      window.scrollTo(0, targetScrollTop);
      restoreFrame = window.requestAnimationFrame(() => {
        if (scrollRoot && previousScrollBehavior !== null) {
          scrollRoot.style.scrollBehavior = previousScrollBehavior;
        }
        scrollRoot = null;
        previousScrollBehavior = null;
      });
    } catch {
      // Embedded test browsers may not implement scrolling.
    }
    return () => {
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      if (scrollRoot && previousScrollBehavior !== null) {
        scrollRoot.style.scrollBehavior = previousScrollBehavior;
      }
    };
  }, [presentation, selected]);

  const visibleRows = useMemo(() => {
    if (!visibleSnapshot) return [];
    const activityOrder = new Map(
      (visibleSnapshot.workflowActivities ?? []).map((activity, index) => [
        activity.sellerSku,
        index,
      ]),
    );
    return visibleSnapshot.rows
      .filter((row) =>
        businessPricingRowMatchesFilter(row, filter) ||
        (filter === "problem" && activityOrder.has(row.sellerSku))
      )
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftActivity = activityOrder.get(left.row.sellerSku);
        const rightActivity = activityOrder.get(right.row.sellerSku);
        if (leftActivity === undefined && rightActivity === undefined) {
          return left.index - right.index;
        }
        if (leftActivity === undefined) return 1;
        if (rightActivity === undefined) return -1;
        return leftActivity - rightActivity;
      })
      .map(({ row }) => row);
  },
    [filter, visibleSnapshot],
  );

  const workflowActivities = visibleSnapshot?.workflowActivities ?? [];
  const workflowCounts = workflowActivities.reduce((counts, activity) => {
    const state = businessPricingWorkflowProgress(activity).state;
    counts[state] += 1;
    return counts;
  }, { waiting_amazon: 0, waiting_b2b: 0, complete: 0 });

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
    const previousActivities = snapshotRef.current?.workflowActivities ?? [];
    const retainedActivities = retainBusinessPricingWorkflowActivities(
      next,
      previousActivities,
    );
    publishSnapshot(retainedActivities.length > 0
      ? { ...next, workflowActivities: retainedActivities }
      : next);
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
    auditScrollTopRef.current = presentation === "workspace"
      ? window.scrollY
      : panelRef.current?.scrollTop ?? 0;
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setOpeningSellerSku(row.sellerSku);
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
        fresh.sellerSku !== row.sellerSku ||
        fresh.asin !== row.asin ||
        fresh.productType !== row.productType
      ) {
        throw new Error(
          "Amazon 商品身分已變更，請重新健檢後再開啟 B2B 價格編輯。",
        );
      }
      if (editorRevisionRef.current !== revision) return;
      if (fresh.writeStatus) rememberListingRead(fresh);
      setSelected(fresh);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error
          ? requestError.message
          : "無法開啟 B2B 價格編輯。");
      }
    } finally {
      if (editorRevisionRef.current === revision) {
        setEditLoading(false);
        setOpeningSellerSku(null);
      }
    }
  };

  const closeEditor = () => {
    if (editLoading) return;
    editorRevisionRef.current += 1;
    setSelected(null);
    setEditLoading(false);
    setOpeningSellerSku(null);
    onEditorBusyChange?.(false);
  };

  const applyVerifiedPrice = (nextResult: BusinessPriceUpdate) => {
    const current = snapshotRef.current;
    if (!current) return;
    const nextSnapshot = applyVerifiedBusinessPriceToAuditSnapshot(
      current,
      nextResult,
    );
    publishSnapshot(nextSnapshot);
  };

  const applyVerifiedListing = (
    nextListing: BusinessPricingListingSnapshot,
  ) => {
    const current = snapshotRef.current;
    if (!current) return;
    let nextSnapshot = applyVerifiedBusinessPricingListingToAuditSnapshot(
      current,
      nextListing,
    );
    if (nextListing.writeStatus) {
      nextSnapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
        nextSnapshot,
        nextListing.writeStatus,
      );
    }
    publishSnapshot(nextSnapshot);
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
    <section
      ref={panelRef}
      className={`business-pricing-audit-panel ${
        selected ? "is-editor-view" : "is-audit-view"
      }`}
      data-business-pricing-view={selected ? "editor" : "audit"}
      aria-label={selected
        ? `${selected.sellerSku} B2B 價格編輯`
        : "全站 FBA Amazon Business 價格健檢"}
    >
      {selected ? (
        <div className="business-pricing-detail-view">
          <div className="business-pricing-detail-toolbar">
            <button
              type="button"
              onClick={closeEditor}
              disabled={editLoading}
              aria-label="返回全站 B2B 價格健檢"
              autoFocus
            >← 返回健檢結果</button>
            <div>
              <span>安全調整 B2B 價格</span>
              <strong>{selected.sellerSku}</strong>
            </div>
          </div>
          <BusinessPricingEditor
            key={`${selected.sellerSku}-${selected.fetchedAt}`}
            listing={selected}
            onClose={closeEditor}
            onVerified={applyVerifiedPrice}
            onCanonicalListingVerified={applyVerifiedListing}
            onCanonicalListingRead={rememberListingRead}
            onWriteStatusChange={rememberWriteStatus}
            onError={setError}
            onBusyChange={(busy) => {
              setEditLoading(busy);
              onEditorBusyChange?.(busy);
            }}
          />
        </div>
      ) : (
        <>
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
      <AuditDetailsDisclosure summary="查看詳細規則">
        <div className="business-pricing-recommendation" aria-label="B2B 價格建議規則">
          <strong>Jasper US 建議規則</strong>
          <span>US 一般售價 – USD 1.00</span>
          <span>數量折扣：5 件 5%・10 件 10%・15 件 15%・20 件 20%</span>
        </div>
        <p className="business-pricing-safety-note">編輯前會重新核對指定 SKU、你帳號的 Amazon 可編輯規則，並執行 Amazon Validation Preview（零寫入）；若 Amazon 規則允許安全更新階梯，預設一併帶入 Business Price 與 1–5 階 percent 建議折扣。你仍可明確切換為只改 Business Price，該模式會完整保留現有階梯折扣；正式送出仍需 Touch ID／Windows Hello。</p>
      </AuditDetailsDisclosure>
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
          {workflowActivities.length > 0 && (
            <section
              className="business-pricing-activity-summary"
              aria-label="已調整商品進度"
            >
              <div>
                <strong>已調整商品進度</strong>
                <span>
                  本次 App 使用期間 · {workflowActivities.length} 個已調整 SKU 已置頂
                </span>
              </div>
              <dl>
                <div><dt>等待 Amazon</dt><dd>{workflowCounts.waiting_amazon}</dd></div>
                <div><dt>待送 B2B</dt><dd>{workflowCounts.waiting_b2b}</dd></div>
                <div><dt>已完成</dt><dd>{workflowCounts.complete}</dd></div>
              </dl>
            </section>
          )}
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
            {visibleRows.map((row) => {
              const activity = workflowActivities.find((candidate) =>
                candidate.sellerSku === row.sellerSku
              );
              const rowWorkflow = activity
                ? businessPricingWorkflowProgress(activity)
                : null;
              return (
                <article
                key={row.sellerSku}
                className={`business-pricing-row ${row.status}${
                  row.recommendedPriceMismatch ? " is-price-mismatch" : ""
                }${
                  row.recommendedQuantityDiscountMismatch
                    ? " is-tier-mismatch"
                    : ""
                }${rowWorkflow ? " has-workflow-progress" : ""}`}
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
                  <span>{statusLabel(row)}</span>
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
                    aria-busy={openingSellerSku === row.sellerSku}
                  >{openingSellerSku === row.sellerSku
                      ? "正在讀取 Amazon…"
                      : rowWorkflow?.state === "waiting_b2b"
                      ? "繼續預檢 B2B"
                      : rowWorkflow?.state === "waiting_amazon"
                      ? "查看／重新確認"
                      : rowWorkflow?.state === "complete"
                      ? "查看完成結果"
                      : row.status === "missing"
                      ? "設定 B2B 價格"
                      : "調整 B2B 價格"}</button>
                  <button
                    type="button"
                    className="business-pricing-seller-central"
                    onClick={() => void openSellerCentralInventory(row.sellerSku)}
                    disabled={!fixedSellerCentralHandoffs}
                  >前往 Amazon 後台 ↗</button>
                </div>
                {rowWorkflow && <WorkflowProgress progress={rowWorkflow} />}
              </article>
              );
            })}
            {visibleRows.length === 0 && <p className="business-pricing-empty">這個篩選沒有商品。</p>}
          </div>
        </>
      )}

        </>
      )}
    </section>
  );
}
