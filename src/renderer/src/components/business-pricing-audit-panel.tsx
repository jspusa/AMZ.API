"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingEditorProposal,
  businessPricingRowMatchesFilter,
  createSubmittedBusinessPricePreview,
  parseBusinessPriceUpdate,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  type BusinessPricingAuditFilter,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessQuantityDiscountPlan,
  type BusinessQuantityDiscountTier,
  type BusinessPriceUpdate,
  type BusinessPricingEditorMode,
  type SubmittedBusinessPricePreview,
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

const FILTERS: readonly Readonly<{
  value: BusinessPricingAuditFilter;
  label: string;
}>[] = [
  { value: "all", label: "全部" },
  { value: "problem", label: "需處理" },
  { value: "above_standard", label: "高於一般售價" },
  { value: "missing", label: "未設定" },
  { value: "configured", label: "已設定" },
  { value: "unsupported", label: "唯讀／不支援" },
  { value: "incomplete", label: "資料未完成" },
];

function problemMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }
  const source = payload as Record<string, unknown>;
  const message = typeof source.message === "string" &&
      source.message.length <= 4_000 &&
      !source.message.includes("\u0000") &&
      source.message.trim()
    ? source.message
    : fallback;
  const requestId = typeof source.requestId === "string" &&
      source.requestId.length <= 256 &&
      source.requestId === source.requestId.trim() &&
      !/[\u0000-\u001f\u007f]/u.test(source.requestId) &&
      source.requestId
    ? source.requestId
    : null;
  return `${message}${requestId ? `（Request ID: ${requestId}）` : ""}`;
}

function createIdempotencyKey(): string {
  return `business-price-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}

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

function priceNumber(value: string, currencyCode: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000) {
    return null;
  }
  if (currencyCode === "JPY" && !Number.isInteger(parsed)) return null;
  return parsed;
}

function statusLabel(status: BusinessPricingAuditRow["status"]): string {
  if (status === "configured") return "已設定";
  if (status === "above_standard") return "B2B 高於一般售價";
  if (status === "missing") return "未設定 B2B 價格";
  if (status === "unsupported") return "PTD 不支援";
  return "資料未完成";
}

type TierDraft = Readonly<{ lowerBound: string; percent: string }>;

function parseTierDrafts(
  drafts: readonly TierDraft[],
): readonly BusinessQuantityDiscountTier[] | null {
  if (drafts.length < 1 || drafts.length > 5) return null;
  const tiers: BusinessQuantityDiscountTier[] = [];
  for (const draft of drafts) {
    if (!/^[1-9]\d*$/u.test(draft.lowerBound) ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(draft.percent)) return null;
    const lowerBound = Number(draft.lowerBound);
    const percent = Number(draft.percent);
    const previous = tiers.at(-1);
    if (!Number.isSafeInteger(lowerBound) || lowerBound <= 0 ||
        !Number.isFinite(percent) || percent <= 0 || percent >= 100 ||
        (previous &&
          (lowerBound <= previous.lowerBound || percent <= previous.percent))) {
      return null;
    }
    tiers.push({ lowerBound, percent });
  }
  return tiers;
}

function formatQuantityDiscountPlan(
  plan: BusinessQuantityDiscountPlan | null,
): string {
  if (!plan) return "未設定";
  const suffix = plan.discountType === "percent" ? "%" : "";
  return `${plan.discountType === "percent" ? "百分比" : "固定單價"}：${plan.levels
    .map((level) => `${level.lowerBound} 件＝${level.value}${suffix}`)
    .join("、")}`;
}

function formatAuditQuantityDiscount(row: BusinessPricingAuditRow): string {
  if (row.quantityDiscountPlanPresence === "ambiguous") {
    return "Amazon 未能確認，請到後台核對";
  }
  return formatQuantityDiscountPlan(row.quantityDiscountPlan);
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
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<BusinessPricingListingSnapshot | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [editorMode, setEditorMode] =
    useState<BusinessPricingEditorMode>("price_only");
  const [tierDrafts, setTierDrafts] = useState<readonly TierDraft[]>([]);
  const [submittedPreview, setSubmittedPreview] =
    useState<SubmittedBusinessPricePreview | null>(null);
  const [result, setResult] = useState<BusinessPriceUpdate | null>(null);
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

  const validation = submittedPreview?.validation ?? null;
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
    setSelected(null);
    setResult(null);
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

  const openEditor = async (row: BusinessPricingAuditRow) => {
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setError(null);
    setSelected(null);
    setSubmittedPreview(null);
    setResult(null);
    setNewPrice("");
    setEditorMode("price_only");
    setTierDrafts([]);
    try {
      const params = new URLSearchParams({ marketplaceId, sku: row.sellerSku });
      const response = await fetch(`/api/sp-api/business-pricing?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "無法重新讀取此 SKU 的 B2B 價格。"));
      }
      const fresh = parseBusinessPricingListingSnapshot(payload);
      if (fresh.marketplaceId !== marketplaceId || fresh.sellerSku !== row.sellerSku) {
        throw new Error("Amazon 回傳的 B2B 價格識別與所選 SKU 不一致。");
      }
      if (editorRevisionRef.current !== revision) return;
      setSelected(fresh);
      const proposal = businessPricingEditorProposal(fresh, "price_only");
      setNewPrice(
        proposal?.businessPrice.toFixed(2) ??
          fresh.businessPrice?.amount.toString() ?? "",
      );
      setTierDrafts([]);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error ? requestError.message : "無法開啟 B2B 價格編輯。" );
      }
    } finally {
      if (editorRevisionRef.current === revision) setEditLoading(false);
    }
  };

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

  const parsedNewPrice = selected?.standardPrice
    ? priceNumber(newPrice, selected.standardPrice.currencyCode)
    : null;
  const unchanged = Boolean(
    selected?.businessPrice &&
    parsedNewPrice !== null &&
    selected.businessPrice.amount === parsedNewPrice,
  );
  const parsedTiers = editorMode === "combined"
    ? parseTierDrafts(tierDrafts)
    : undefined;
  const tierInputInvalid = editorMode === "combined" && parsedTiers === null;
  const canReplaceQuantityDiscounts = Boolean(
    selected?.businessPricingCapability.quantityDiscountsEditable &&
    selected.quantityDiscountPlanPresence !== "ambiguous" &&
    !selected.businessPricingManagedByAutomation,
  );

  const chooseEditorMode = (mode: BusinessPricingEditorMode) => {
    if (!selected || (mode === "combined" && !canReplaceQuantityDiscounts)) return;
    editorRevisionRef.current += 1;
    setEditorMode(mode);
    if (mode === "combined") {
      const proposal = businessPricingEditorProposal(selected, "combined");
      setTierDrafts(proposal?.quantityDiscountTiers?.map((tier) => ({
        lowerBound: String(tier.lowerBound),
        percent: String(tier.percent),
      })) ?? []);
    } else {
      setTierDrafts([]);
    }
    setSubmittedPreview(null);
    setResult(null);
  };

  const previewPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || parsedNewPrice === null ||
        (unchanged && tierDrafts.length === 0) || parsedTiers === null) return;
    const listing = selected;
    const submittedPrice = parsedNewPrice;
    const key = createIdempotencyKey();
    const body = Object.freeze({
      marketplaceId: listing.marketplaceId,
      sellerSku: listing.sellerSku,
      expectedStandardPrice: listing.standardPrice!.amount,
      expectedBusinessPrice: listing.businessPrice?.amount ?? null,
      newBusinessPrice: submittedPrice,
      ...(parsedTiers === undefined ? {} : {
        expectedQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
        quantityDiscountTiers: parsedTiers,
      }),
      idempotencyKey: key,
    });
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setError(null);
    setResult(null);
    setSubmittedPreview(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "Amazon B2B 價格預檢未通過。"));
      }
      const submitted = createSubmittedBusinessPricePreview({
        listing,
        newBusinessPrice: submittedPrice,
        ...(parsedTiers === undefined
          ? {}
          : { quantityDiscountTiers: parsedTiers }),
        idempotencyKey: key,
        response: payload,
      });
      if (editorRevisionRef.current !== revision) return;
      setSubmittedPreview(submitted);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error ? requestError.message : "Amazon B2B 價格預檢未通過。" );
      }
    } finally {
      if (editorRevisionRef.current === revision) setEditLoading(false);
    }
  };

  const commitPrice = async () => {
    const submitted = submittedPreview;
    if (!selected || !submitted) return;
    setEditLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(problemMessage(payload, "Amazon 未能確認 B2B 價格更新。"));
      }
      const nextResult = parseBusinessPriceUpdate(payload, submitted);
      setResult(nextResult);
      setSubmittedPreview(null);
      if (snapshot) {
        const nextSnapshot = applyVerifiedBusinessPriceToAuditSnapshot(
          snapshot,
          nextResult,
        );
        setSnapshot(nextSnapshot);
        onSnapshotChange?.(nextSnapshot);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Amazon 未能確認 B2B 價格更新。" );
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <section className="business-pricing-audit-panel" aria-label="全站 FBA Amazon Business 價格健檢">
      <div className="business-pricing-audit-intro">
        <div>
          <span>{marketplaceShort} · FBA ONLY</span>
          <h3>找出未設定或高於一般售價的 B2B contribution</h3>
          <p>同時核對 Business Price 與 canonical quantity discount plan；能否修改由 seller-specific PTD 決定。</p>
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
      <p className="business-pricing-safety-note">先由 Amazon Validation Preview 核對，零寫入；正式送出前仍需 Touch ID／Windows Hello。combined 操作只用一次 PATCH 更新同一個 B2B contribution 的 our_price 與完整數量折扣，不改一般售價，也不盲目重送。</p>
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
          <p className="business-pricing-notice">{visibleSnapshot.notice}</p>
          <div className="business-pricing-list" role="list" aria-label="FBA B2B 價格商品">
            {visibleRows.map((row) => (
              <article key={row.sellerSku} className={`business-pricing-row ${row.status}`} role="listitem">
                <div>
                  <strong>{row.title || row.sellerSku}</strong>
                  <small>{row.sellerSku} · {row.asin || "無 ASIN"}</small>
                </div>
                <dl>
                  <div><dt>一般售價</dt><dd>{formatMoney(row.standardPrice)}</dd></div>
                  <div><dt>B2B 價格</dt><dd>{formatMoney(row.businessPrice)}</dd></div>
                  <div><dt>建議 B2B 價格</dt><dd>{formatMoney(recommendedBusinessPrice(row.standardPrice))}</dd></div>
                  <div><dt>目前數量折扣</dt><dd>{formatAuditQuantityDiscount(row)}</dd></div>
                </dl>
                <div className="business-pricing-row-status">
                  <span>{statusLabel(row.status)}</span>
                  <small>{row.reason}</small>
                </div>
                <div className="business-pricing-row-actions">
                  {row.editable && row.standardPrice ? (
                    <button type="button" onClick={() => void openEditor(row)} disabled={editLoading}>
                      {row.status === "missing" ? "設定 B2B 價格" : "調整 B2B 價格"}
                    </button>
                  ) : <span className="business-pricing-readonly">請到 Amazon 後台編輯</span>}
                  <button
                    type="button"
                    className="business-pricing-seller-central"
                    onClick={() => void openSellerCentralInventory(row.sellerSku)}
                    disabled={!fixedSellerCentralHandoffs}
                  >前往編輯 ↗</button>
                </div>
              </article>
            ))}
            {visibleRows.length === 0 && <p className="business-pricing-empty">這個篩選沒有商品。</p>}
          </div>
        </>
      )}

      {selected && (
        <form className="business-pricing-editor" onSubmit={(event) => void previewPrice(event)}>
          <div className="business-pricing-editor-heading">
            <div><span>安全調整 B2B PRICE</span><strong>{selected.sellerSku}</strong></div>
            <button type="button" onClick={() => {
              editorRevisionRef.current += 1;
              setSelected(null);
              setEditorMode("price_only");
              setTierDrafts([]);
              setSubmittedPreview(null);
              setResult(null);
            }} disabled={editLoading} aria-label="關閉 B2B 價格編輯">×</button>
          </div>
          <dl>
            <div><dt>目前一般售價</dt><dd>{formatMoney(selected.standardPrice)}</dd></div>
            <div><dt>目前 B2B 價格</dt><dd>{formatMoney(selected.businessPrice)}</dd></div>
            <div><dt>目前數量折扣</dt><dd>{formatQuantityDiscountPlan(selected.quantityDiscountPlan)}</dd></div>
          </dl>
          {!selected.businessPricingCapability.editable ? (
            <div className="price-error">{selected.businessPricingCapability.reason ?? "Amazon PTD 未允許編輯 B2B 價格。"}</div>
          ) : (
            <label htmlFor="business-price-input">
              <span>新 B2B 價格 · {selected.standardPrice?.currencyCode}</span>
              <input id="business-price-input" value={newPrice} onChange={(event) => {
                editorRevisionRef.current += 1;
                setNewPrice(event.target.value);
                setSubmittedPreview(null);
                setResult(null);
              }} disabled={editLoading} inputMode={selected.standardPrice?.currencyCode === "JPY" ? "numeric" : "decimal"} autoComplete="off" />
            </label>
          )}
          {canReplaceQuantityDiscounts ? (
            <div className="business-pricing-tier-editor">
              <div className="business-pricing-tier-mode" role="group" aria-label="B2B 數量折扣更新方式">
                <button type="button" aria-pressed={editorMode === "price_only"} onClick={() => chooseEditorMode("price_only")} disabled={editLoading}>
                  只改價格並保留原數量折扣
                </button>
                <button type="button" aria-pressed={editorMode === "combined"} onClick={() => chooseEditorMode("combined")} disabled={editLoading}>
                  明確套用四階數量折扣
                </button>
              </div>
              {editorMode === "price_only" ? (
                <div className="price-warning compact">
                  <strong>Price-only</strong>
                  <p>本次預檢與正式 PATCH 都不帶 quantity_discount_plan，既有方案保持不變。</p>
                </div>
              ) : (
                <fieldset className="business-pricing-tier-fieldset" disabled={editLoading}>
                  <legend>新數量折扣（1–5 階百分比）</legend>
                  <div className="business-pricing-tier-grid">
                    {tierDrafts.map((tier, index) => (
                      <div className="business-pricing-tier-card" key={index}>
                        <strong>第 {index + 1} 階</strong>
                        <label htmlFor={`business-tier-bound-${index}`}>
                          <span>門檻件數</span>
                          <input
                            id={`business-tier-bound-${index}`}
                            inputMode="numeric"
                            value={tier.lowerBound}
                            onChange={(event) => {
                              editorRevisionRef.current += 1;
                              setTierDrafts((current) => current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, lowerBound: event.target.value }
                                  : entry));
                              setSubmittedPreview(null);
                              setResult(null);
                            }}
                          />
                        </label>
                        <label htmlFor={`business-tier-percent-${index}`}>
                          <span>折扣百分比</span>
                          <input
                            id={`business-tier-percent-${index}`}
                            inputMode="decimal"
                            value={tier.percent}
                            onChange={(event) => {
                              editorRevisionRef.current += 1;
                              setTierDrafts((current) => current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, percent: event.target.value }
                                  : entry));
                              setSubmittedPreview(null);
                              setResult(null);
                            }}
                          />
                        </label>
                        {tierDrafts.length > 1 && (
                          <button type="button" onClick={() => {
                            editorRevisionRef.current += 1;
                            setTierDrafts((current) => current.filter((_, entryIndex) =>
                              entryIndex !== index));
                            setSubmittedPreview(null);
                            setResult(null);
                          }}>刪除此階</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="business-pricing-tier-actions">
                    {tierDrafts.length < 5 && (
                      <button type="button" onClick={() => {
                        editorRevisionRef.current += 1;
                        const last = tierDrafts.at(-1);
                        setTierDrafts((current) => [...current, {
                          lowerBound: String((Number(last?.lowerBound) || 0) + 5),
                          percent: String(Math.min((Number(last?.percent) || 0) + 5, 99)),
                        }]);
                        setSubmittedPreview(null);
                        setResult(null);
                      }}>＋ 新增一階</button>
                    )}
                    {tierInputInvalid && (
                      <small role="alert">件數與百分比必須合法且逐階嚴格遞增；百分比需大於 0、小於 100。</small>
                    )}
                  </div>
                </fieldset>
              )}
            </div>
          ) : (
            <div className="price-warning compact">
              <strong>數量折扣請到 Amazon 後台編輯</strong>
              <p>{selected.businessPricingManagedByAutomation
                ? "此 contribution 由 Amazon Automate Pricing 管理；請先在 Seller Central 處理規則。"
                : selected.quantityDiscountPlanPresence === "ambiguous"
                ? "Amazon 回傳的 quantity_discount_plan 不唯一或無法 canonicalize；本次只允許 price-only 並保留原方案。"
                : selected.businessPricingCapability.quantityDiscountsReason ?? "seller-specific PTD 未開放 quantity_discount_plan。"}</p>
            </div>
          )}
          {parsedNewPrice !== null && selected.standardPrice && parsedNewPrice > selected.standardPrice.amount && (
            <div className="price-warning compact"><strong>B2B 價格高於一般售價</strong><p>Amazon 可能拒絕；預檢會以 seller-specific PTD 為準。</p></div>
          )}
          {validation && (
            <div className="business-pricing-validation">
              <strong>{validation.notice}</strong>
              <p>舊數量折扣：{formatQuantityDiscountPlan(validation.previousQuantityDiscountPlan)}</p>
              <p>新數量折扣：{formatQuantityDiscountPlan(validation.requestedQuantityDiscountPlan)}</p>
              {validation.issues.map((issue, index) => <p key={`${issue.severity}-${index}`}>{issue.severity} · {issue.message}</p>)}
              <button type="button" className="price-primary-button" onClick={() => void commitPrice()} disabled={editLoading}>
                {editLoading ? "送出並回查中…" : "Touch ID／Windows Hello 確認並送出"}
              </button>
            </div>
          )}
          {result && <div className="business-pricing-result" role="status"><strong>已完成並回查</strong><p>{result.notice}</p></div>}
          {!validation && !result && selected.businessPricingCapability.editable && (
            <button type="submit" className="price-primary-button" disabled={editLoading || parsedNewPrice === null || tierInputInvalid || (unchanged && tierDrafts.length === 0)}>
              {editLoading
                ? "Amazon 預檢中…"
                : editorMode === "combined"
                  ? "先預檢 B2B 價格與四階數量折扣（不寫入）"
                  : "先預檢 B2B 價格並保留原數量折扣（不寫入）"}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
