"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  businessPricingEditorProposal,
  createSubmittedBusinessPricePreview,
  parseBusinessPriceProcessing,
  parseBusinessPriceUpdate,
  parseBusinessPricingListingSnapshot,
  type BusinessPricingEditorMode,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
  type BusinessPriceWriteStatus,
  type BusinessQuantityDiscountPlan,
  type BusinessQuantityDiscountTier,
  type SubmittedBusinessPricePreview,
} from "../business-pricing-audit";
import {
  createRendererIdempotencyKey,
  publicProblemMessage,
} from "../write-request";

type TierDraft = Readonly<{ lowerBound: string; percent: string }>;

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

function formatMinimumPriceEvidence(
  listing: BusinessPricingListingSnapshot,
): string {
  if (listing.minimumPricePresence === "canonical") {
    return formatMoney(listing.minimumPrice);
  }
  return listing.minimumPricePresence === "absent"
    ? "未設定"
    : "Amazon 無法確認";
}

function formatSubmittedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function exactProblemMoney(
  value: unknown,
  expected: BusinessPricingMoney,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Object.keys(source).length === 2 &&
    source.amount === expected.amount &&
    source.currencyCode === expected.currencyCode;
}

function verifiedMinimumPriceFromProblem(
  value: unknown,
  submitted: SubmittedBusinessPricePreview,
): BusinessPricingMoney | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.code !== "BUSINESS_PRICE_PARTIAL_UPDATE" &&
    source.code !== "UPDATE_STATUS_UNKNOWN"
  ) return null;
  const evidence = source.minimumPriceUpdate;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }
  const update = evidence as Record<string, unknown>;
  const validation = submitted.validation;
  if (
    Object.keys(update).length !== 4 ||
    update.status !== "verified" ||
    validation.minimumPriceChange !== "lower" ||
    !validation.previousMinimumPrice ||
    !validation.requestedMinimumPrice ||
    !validation.lowestTierUnitPrice ||
    !exactProblemMoney(
      update.previousMinimumPrice,
      validation.previousMinimumPrice,
    ) ||
    !exactProblemMoney(
      update.requestedMinimumPrice,
      validation.requestedMinimumPrice,
    ) ||
    !exactProblemMoney(
      update.lowestTierUnitPrice,
      validation.lowestTierUnitPrice,
    )
  ) return null;
  return validation.requestedMinimumPrice;
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

function quantityDiscountValueAt(
  plan: BusinessQuantityDiscountPlan | null,
  lowerBound: number,
): string {
  const level = plan?.levels.find((entry) => entry.lowerBound === lowerBound);
  if (!level) return plan?.discountType === "fixed" ? "未設定" : "0%";
  return plan?.discountType === "percent"
    ? `${level.value}%`
    : `固定單價 ${level.value}`;
}

function quantityDiscountLowerBounds(
  previous: BusinessQuantityDiscountPlan | null,
  requested: BusinessQuantityDiscountPlan,
): readonly number[] {
  return [...new Set([
    ...(previous?.levels.map((level) => level.lowerBound) ?? []),
    ...requested.levels.map((level) => level.lowerBound),
  ])].sort((left, right) => left - right);
}

export default function BusinessPricingEditor({
  listing: initialListing,
  onClose,
  onVerified,
  onCanonicalListingVerified,
  onWriteStatusChange,
  onError,
  onBusyChange,
}: Readonly<{
  listing: BusinessPricingListingSnapshot;
  onClose: () => void;
  onVerified: (result: BusinessPriceUpdate) => void;
  onCanonicalListingVerified?: (
    listing: BusinessPricingListingSnapshot,
  ) => void;
  onWriteStatusChange?: (status: BusinessPriceWriteStatus) => void;
  onError: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}>) {
  const [listing, setListing] = useState(initialListing);
  const priceOnlyProposal = businessPricingEditorProposal(listing, "price_only");
  const combinedProposal = businessPricingEditorProposal(listing, "combined");
  const repairableDuplicateQuantityDiscounts =
    listing.quantityDiscountPlanPresence === "duplicate" &&
    listing.quantityDiscountPlan?.discountType === "percent";
  const canReplaceQuantityDiscounts = Boolean(
    listing.businessPricingCapability.quantityDiscountsEditable &&
    listing.minimumPricePresence !== "ambiguous" &&
    listing.quantityDiscountPlanPresence !== "ambiguous" &&
    (listing.quantityDiscountPlanPresence !== "duplicate" ||
      repairableDuplicateQuantityDiscounts) &&
    !listing.businessPricingManagedByAutomation,
  );
  const writeBlockedByQuantityEvidence =
    listing.quantityDiscountPlanPresence === "ambiguous" ||
    (listing.quantityDiscountPlanPresence === "duplicate" &&
      !repairableDuplicateQuantityDiscounts);
  const [newPrice, setNewPrice] = useState(
    (repairableDuplicateQuantityDiscounts
      ? listing.businessPrice?.amount.toFixed(2)
      : priceOnlyProposal?.businessPrice.toFixed(2)) ??
      listing.businessPrice?.amount.toString() ?? "",
  );
  const [editorMode, setEditorMode] =
    useState<BusinessPricingEditorMode>(
      canReplaceQuantityDiscounts && combinedProposal ? "combined" : "price_only",
    );
  const [tierDrafts, setTierDrafts] = useState<readonly TierDraft[]>(
    combinedProposal?.quantityDiscountTiers?.map((tier) => ({
      lowerBound: String(tier.lowerBound),
      percent: String(tier.percent),
    })) ?? [],
  );
  const [submittedPreview, setSubmittedPreview] =
    useState<SubmittedBusinessPricePreview | null>(null);
  const [result, setResult] = useState<BusinessPriceUpdate | null>(null);
  const [writeStatus, setWriteStatus] = useState<BusinessPriceWriteStatus | null>(
    initialListing.writeStatus,
  );
  const [submissionStartedAt, setSubmissionStartedAt] =
    useState<string | null>(null);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [verifiedPartialMinimumPrice, setVerifiedPartialMinimumPrice] =
    useState<BusinessPricingMoney | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [commitFailed, setCommitFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const revisionRef = useRef(0);
  const validation = submittedPreview?.validation ?? null;
  const writeInFlight = writeStatus?.status === "PROCESSING";
  const displayedBusinessPrice = result?.requestedBusinessPrice ??
    listing.businessPrice;
  const displayedMinimumPrice = result?.requestedMinimumPrice ??
    verifiedPartialMinimumPrice ?? listing.minimumPrice;
  const displayedMinimumPricePresence = result
    ? displayedMinimumPrice ? "canonical" as const : listing.minimumPricePresence
    : listing.minimumPricePresence;
  const displayedQuantityDiscountPlan = result?.quantityDiscountPlanChange ===
      "replace"
    ? result.requestedQuantityDiscountPlan
    : listing.quantityDiscountPlan;
  const parsedNewPrice = listing.standardPrice
    ? priceNumber(newPrice, listing.standardPrice.currencyCode)
    : null;
  const unchanged = Boolean(
    listing.businessPrice &&
    parsedNewPrice !== null &&
    listing.businessPrice.amount === parsedNewPrice,
  );
  const parsedTiers = editorMode === "combined"
    ? parseTierDrafts(tierDrafts)
    : undefined;
  const tierInputInvalid = editorMode === "combined" && parsedTiers === null;
  const noRequestedChange = unchanged && editorMode === "price_only";
  const setBusy = (busy: boolean) => {
    setLoading(busy);
    onBusyChange(busy);
  };
  const resetPreview = () => {
    revisionRef.current += 1;
    setSubmittedPreview(null);
    setResult(null);
    setVerifiedPartialMinimumPrice(null);
    setEditorError(null);
    setCommitFailed(false);
    onError(null);
  };
  const chooseEditorMode = (nextMode: BusinessPricingEditorMode) => {
    if (writeInFlight ||
        (nextMode === "combined" && !canReplaceQuantityDiscounts)) return;
    resetPreview();
    setEditorMode(nextMode);
  };

  const previewPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (
      parsedNewPrice === null ||
      noRequestedChange ||
      parsedTiers === null ||
      writeStatus?.status === "PROCESSING"
    ) return;
    const submittedPrice = parsedNewPrice;
    const idempotencyKey = createRendererIdempotencyKey("business-price");
    const body = Object.freeze({
      marketplaceId: listing.marketplaceId,
      sellerSku: listing.sellerSku,
      expectedStandardPrice: listing.standardPrice!.amount,
      expectedBusinessPrice: listing.businessPrice?.amount ?? null,
      newBusinessPrice: submittedPrice,
      ...(parsedTiers === undefined ? {} : {
        expectedMinimumPrice: listing.minimumPrice?.amount ?? null,
        expectedQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
        quantityDiscountTiers: parsedTiers,
      }),
      idempotencyKey,
    });
    const revision = ++revisionRef.current;
    setBusy(true);
    onError(null);
    setEditorError(null);
    setCommitFailed(false);
    setResult(null);
    setVerifiedPartialMinimumPrice(null);
    setSubmittedPreview(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "Amazon B2B 價格預檢未通過。",
        ));
      }
      const submitted = createSubmittedBusinessPricePreview({
        listing,
        newBusinessPrice: submittedPrice,
        ...(parsedTiers === undefined
          ? {}
          : { quantityDiscountTiers: parsedTiers }),
        idempotencyKey,
        response: payload,
      });
      if (revisionRef.current === revision) setSubmittedPreview(submitted);
    } catch (requestError) {
      if (revisionRef.current === revision) {
        const message = requestError instanceof Error
          ? requestError.message
          : "Amazon B2B 價格預檢未通過。";
        setEditorError(message);
      }
    } finally {
      if (revisionRef.current === revision) setBusy(false);
    }
  };

  const commitPrice = async () => {
    const submitted = submittedPreview;
    if (!submitted) return;
    setBusy(true);
    setSubmissionStartedAt(new Date().toISOString());
    onError(null);
    setEditorError(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setVerifiedPartialMinimumPrice(
          verifiedMinimumPriceFromProblem(payload, submitted),
        );
        throw new Error(publicProblemMessage(
          payload,
          "Amazon 未能確認 B2B 價格更新。",
        ));
      }
      if (response.status === 202) {
        const processing = parseBusinessPriceProcessing(payload, submitted);
        setWriteStatus(processing);
        onWriteStatusChange?.(processing);
        setResult(null);
        setVerifiedPartialMinimumPrice(null);
        setSubmittedPreview(null);
        setEditorError(null);
        setCommitFailed(false);
        return;
      }
      const nextResult = parseBusinessPriceUpdate(payload, submitted);
      setResult(nextResult);
      setWriteStatus(null);
      setVerifiedPartialMinimumPrice(null);
      setSubmittedPreview(null);
      setEditorError(null);
      setCommitFailed(false);
      onVerified(nextResult);
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Amazon 未能確認 B2B 價格更新。";
      setEditorError(message);
      setCommitFailed(true);
    } finally {
      setSubmissionStartedAt(null);
      setBusy(false);
    }
  };

  const refreshWriteStatus = async () => {
    if (!writeStatus || refreshingStatus) return;
    setRefreshingStatus(true);
    setEditorError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId: listing.marketplaceId,
        sku: listing.sellerSku,
      });
      const response = await fetch(`/api/sp-api/business-pricing?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "目前無法重新確認 Amazon 同步狀態。",
        ));
      }
      const fresh = parseBusinessPricingListingSnapshot(payload);
      if (
        fresh.marketplaceId !== listing.marketplaceId ||
        fresh.sellerSku !== listing.sellerSku ||
        fresh.asin !== listing.asin
      ) {
        throw new Error("Amazon 回傳的 B2B 價格識別與目前 SKU 不一致。");
      }
      setListing(fresh);
      if (fresh.writeStatus) {
        setWriteStatus(fresh.writeStatus);
        onWriteStatusChange?.(fresh.writeStatus);
        if (fresh.writeStatus.status === "VERIFIED") {
          setSubmittedPreview(null);
          setCommitFailed(false);
          setVerifiedPartialMinimumPrice(null);
          if (fresh.writeStatus.stage === "business_price") {
            onCanonicalListingVerified?.(fresh);
          }
        }
      }
    } catch (requestError) {
      setEditorError(requestError instanceof Error
        ? requestError.message
        : "目前無法重新確認 Amazon 同步狀態。");
    } finally {
      setRefreshingStatus(false);
    }
  };

  return (
    <form
      className="business-pricing-editor"
      onSubmit={(event) => void previewPrice(event)}
    >
      <div className="business-pricing-editor-heading">
        <div>
          <span>安全調整 B2B PRICE</span>
          <strong>{listing.sellerSku}</strong>
        </div>
        <button
          type="button"
          onClick={() => {
            revisionRef.current += 1;
            onClose();
          }}
          disabled={loading}
          aria-label="關閉 B2B 價格編輯"
        >×</button>
      </div>
      <dl>
        <div><dt>目前一般售價</dt><dd>{formatMoney(listing.standardPrice)}</dd></div>
        <div><dt>目前 B2B 價格</dt><dd>{formatMoney(displayedBusinessPrice)}</dd></div>
        <div>
          <dt>目前最低價</dt>
          <dd>{formatMinimumPriceEvidence({
            ...listing,
            minimumPrice: displayedMinimumPrice,
            minimumPricePresence: displayedMinimumPricePresence,
          })}</dd>
        </div>
        <div>
          <dt>目前數量折扣</dt>
          <dd>{formatQuantityDiscountPlan(displayedQuantityDiscountPlan)}</dd>
        </div>
      </dl>
      {submissionStartedAt && loading && (
        <div
          className="business-pricing-write-status is-submitting"
          role="status"
          aria-live="polite"
        >
          <strong>已按下送出，Notebook Key 正在提交</strong>
          <p>
            已記錄操作時間 {formatSubmittedAt(submissionStartedAt)}。正在等 Amazon
            回覆是否接受；請勿重複送出。
          </p>
        </div>
      )}
      {writeStatus && (
        <div
          className={`business-pricing-write-status ${
            writeStatus.status === "VERIFIED"
              ? "is-verified"
              : "is-processing"
          }`}
          role="status"
          aria-live="polite"
        >
          <strong>{writeStatus.status === "VERIFIED"
            ? writeStatus.stage === "business_price"
              ? "Amazon 已完成同步並確認"
              : "最低價已確認；B2B 尚未送出"
            : writeStatus.stage === "business_price"
            ? "Amazon 已接受，正在同步"
            : "Amazon 已接受最低價，正在同步"}</strong>
          <p>{writeStatus.notice}</p>
          <div className="business-pricing-write-meta">
            <span>送出時間 {formatSubmittedAt(writeStatus.acceptedAt)}</span>
            <span>Request ID：{writeStatus.requestId ?? "Amazon 未提供"}</span>
          </div>
          {writeStatus.stage === "business_price" &&
            writeStatus.requestedBusinessPrice && (
            <div className="business-pricing-diff-row">
              <span className="business-pricing-diff-label">B2B 價格</span>
              <span className="business-pricing-diff-old">
                {formatMoney(writeStatus.previousBusinessPrice)}
              </span>
              <span className="business-pricing-diff-arrow">→</span>
              <span className="business-pricing-diff-new">
                {formatMoney(writeStatus.requestedBusinessPrice)}
              </span>
            </div>
          )}
          {writeStatus.stage === "minimum_price" &&
            writeStatus.requestedMinimumPrice && (
            <div className="business-pricing-diff-row">
              <span className="business-pricing-diff-label">最低價限制</span>
              <span className="business-pricing-diff-old">
                {formatMoney(writeStatus.previousMinimumPrice)}
              </span>
              <span className="business-pricing-diff-arrow">→</span>
              <span className="business-pricing-diff-new">
                {formatMoney(writeStatus.requestedMinimumPrice)}
              </span>
              </div>
            )}
          {writeStatus.stage === "business_price" &&
            writeStatus.quantityDiscountPlanChange === "replace" &&
            writeStatus.requestedQuantityDiscountPlan && (
            <div className="business-pricing-tier-diffs">
              <strong>本次送出的數量折扣</strong>
              {quantityDiscountLowerBounds(
                writeStatus.previousQuantityDiscountPlan,
                writeStatus.requestedQuantityDiscountPlan,
              ).map((lowerBound) => (
                <div className="business-pricing-diff-row" key={lowerBound}>
                  <span className="business-pricing-diff-label">
                    {lowerBound} 件
                  </span>
                  <span className="business-pricing-diff-old">
                    {quantityDiscountValueAt(
                      writeStatus.previousQuantityDiscountPlan,
                      lowerBound,
                    )}
                  </span>
                  <span className="business-pricing-diff-arrow">→</span>
                  <span className="business-pricing-diff-new">
                    {quantityDiscountValueAt(
                      writeStatus.requestedQuantityDiscountPlan,
                      lowerBound,
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {writeStatus.status === "PROCESSING" && (
            <button
              type="button"
              className="business-pricing-refresh-status"
              onClick={() => void refreshWriteStatus()}
              disabled={refreshingStatus}
            >{refreshingStatus
                ? "正在重新讀取 Amazon…"
                : "重新確認 Amazon 狀態"}</button>
          )}
          {writeStatus.status === "VERIFIED" &&
            writeStatus.stage === "minimum_price" && (
            <p className="business-pricing-next-step">
              下方已套用 Amazon 的最新最低價。請重新預檢 B2B 價格與階梯，確認後才會進行第二次送出。
            </p>
          )}
        </div>
      )}
      {!listing.businessPricingCapability.editable ? (
        <div className="price-error">
          {listing.businessPricingCapability.reason ??
            "Amazon PTD 未允許編輯 B2B 價格。"}
        </div>
      ) : (
        <label htmlFor="business-price-input">
          <span>新 B2B 價格 · {listing.standardPrice?.currencyCode}</span>
          <input
            id="business-price-input"
            value={newPrice}
            onChange={(event) => {
              resetPreview();
              setNewPrice(event.target.value);
            }}
            disabled={loading || writeInFlight || writeBlockedByQuantityEvidence ||
              repairableDuplicateQuantityDiscounts}
            inputMode={listing.standardPrice?.currencyCode === "JPY"
              ? "numeric"
              : "decimal"}
            autoComplete="off"
          />
        </label>
      )}
      {canReplaceQuantityDiscounts ? (
        <div className="business-pricing-tier-editor">
          <div
            className="business-pricing-tier-mode"
            role="group"
            aria-label="B2B 數量折扣更新方式"
          >
            {!repairableDuplicateQuantityDiscounts && (
              <button
                type="button"
                aria-pressed={editorMode === "price_only"}
                onClick={() => chooseEditorMode("price_only")}
                disabled={loading || writeInFlight}
              >只改價格並保留原數量折扣</button>
            )}
            <button
              type="button"
              aria-pressed={editorMode === "combined"}
              onClick={() => chooseEditorMode("combined")}
              disabled={loading || writeInFlight ||
                repairableDuplicateQuantityDiscounts}
            >{repairableDuplicateQuantityDiscounts
                ? "修復重複數量折扣"
                : "一併更新預填階梯折扣"}</button>
          </div>
          {editorMode === "price_only" && (
            <div className="price-warning compact">
              <strong>Price-only</strong>
              <p>本次只會更新 B2B 價格；現有數量折扣會完整保留。</p>
            </div>
          )}
          {editorMode === "combined" && (
            <fieldset
              className="business-pricing-tier-fieldset"
              disabled={loading || writeInFlight ||
                repairableDuplicateQuantityDiscounts}
            >
              <legend>{repairableDuplicateQuantityDiscounts
                ? "目前數量折扣（將去除重複）"
                : "預填建議數量折扣（1–5 階 percent）"}</legend>
              {repairableDuplicateQuantityDiscounts && (
                <div className="price-warning compact" role="status">
                  <strong>將修復重複數量折扣</strong>
                  <p>Amazon 回傳多份內容相同的 quantity_discount_plan；已預填目前階梯。預檢通過後，正式送出會以單一 B2B contribution 取代重複資料。</p>
                </div>
              )}
              <p className="business-pricing-notice">
                {repairableDuplicateQuantityDiscounts
                  ? "修復模式會固定使用目前 B2B 價格與目前階梯；本次不會變更售價或折扣內容。"
                  : "已選擇一併更新；你可直接預檢，或先調整下列建議值。"}
              </p>
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
                        disabled={repairableDuplicateQuantityDiscounts}
                        onChange={(event) => {
                          resetPreview();
                          setTierDrafts((current) => current.map(
                            (entry, entryIndex) => entryIndex === index
                              ? { ...entry, lowerBound: event.target.value }
                              : entry,
                          ));
                        }}
                      />
                    </label>
                    <label htmlFor={`business-tier-percent-${index}`}>
                      <span>折扣百分比</span>
                      <input
                        id={`business-tier-percent-${index}`}
                        inputMode="decimal"
                        value={tier.percent}
                        disabled={repairableDuplicateQuantityDiscounts}
                        onChange={(event) => {
                          resetPreview();
                          setTierDrafts((current) => current.map(
                            (entry, entryIndex) => entryIndex === index
                              ? { ...entry, percent: event.target.value }
                              : entry,
                          ));
                        }}
                      />
                    </label>
                    {!repairableDuplicateQuantityDiscounts &&
                      tierDrafts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          resetPreview();
                          setTierDrafts((current) => current.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ));
                        }}
                      >刪除此階</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="business-pricing-tier-actions">
                {!repairableDuplicateQuantityDiscounts &&
                  tierDrafts.length < 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      resetPreview();
                      const last = tierDrafts.at(-1);
                      setTierDrafts((current) => [...current, {
                        lowerBound: String((Number(last?.lowerBound) || 0) + 5),
                        percent: String(Math.min(
                          (Number(last?.percent) || 0) + 5,
                          99,
                        )),
                      }]);
                    }}
                  >＋ 新增一階</button>
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
          <strong>{writeInFlight
            ? "Amazon 正在同步，暫停再次編輯"
            : "數量折扣不可直接修改"}</strong>
          <p>{writeInFlight
            ? "這個 SKU 已有 Amazon 接受的更新正在處理；暫時看到多份價格或階梯不代表寫入失敗，請使用上方按鈕稍後重新確認。"
            : listing.businessPricingManagedByAutomation
            ? "此 contribution 由 Amazon Automate Pricing 管理；請先在 Seller Central 處理規則。"
            : listing.minimumPricePresence === "ambiguous"
            ? "Amazon 無法確認目前最低價；仍可只改 B2B 價格，但不會送出階梯或調整最低價。"
            : listing.quantityDiscountPlanPresence === "ambiguous"
            ? "Amazon 回傳的數量折扣目前不唯一或尚未同步完成；價格與折扣先停止修改，避免覆蓋未知方案。"
            : listing.quantityDiscountPlanPresence === "duplicate"
            ? "Amazon 回傳重複的固定單價折扣方案；目前介面只能安全修復 percent 階梯，請先至 Seller Central 核對。"
            : listing.businessPricingCapability.quantityDiscountsReason ??
              "seller-specific PTD 未開放 quantity_discount_plan。"}</p>
        </div>
      )}
      {parsedNewPrice !== null &&
        listing.standardPrice &&
        parsedNewPrice > listing.standardPrice.amount && (
        <div className="price-warning compact">
          <strong>B2B 價格高於一般售價</strong>
          <p>Amazon 可能拒絕；預檢會以 seller-specific PTD 為準。</p>
        </div>
      )}
      {validation && (
        <div
          className="business-pricing-validation"
          role="status"
          aria-live="polite"
        >
          <strong>{validation.notice}</strong>
          <div className="business-pricing-diff-row">
            <span className="business-pricing-diff-label">B2B 價格</span>
            <span className="business-pricing-diff-old">
              {validation.previousBusinessPrice
                ? formatMoney(validation.previousBusinessPrice)
                : "未設定"}
            </span>
            <span className="business-pricing-diff-arrow">→</span>
            <span className="business-pricing-diff-new">
              {formatMoney(validation.requestedBusinessPrice)}
            </span>
          </div>
          {validation.minimumPriceChange === "lower" && (
            <>
              <div className="business-pricing-diff-row">
                <span className="business-pricing-diff-label">
                  最低價限制
                </span>
                <span className="business-pricing-diff-old">
                  {formatMoney(validation.previousMinimumPrice)}
                </span>
                <span className="business-pricing-diff-arrow">→</span>
                <span className="business-pricing-diff-new">
                  {formatMoney(validation.requestedMinimumPrice)}
                </span>
              </div>
              <div
                className="price-warning compact"
                role="alert"
              >
                <strong>會先調低 Amazon 最低價限制</strong>
                <p>
                  最低價是 ALL audience 的價格護欄，也可能影響一般售價／自動定價；本次只送出最低價。稍後請手動重新確認 Amazon 狀態，確認完成後重新預檢，並第二次使用 Touch ID／Windows Hello 才會送出 B2B 價格與階梯。
                </p>
              </div>
            </>
          )}
          {validation.lowestTierUnitPrice && (
            <div className="business-pricing-quantity-tier">
              <strong>最低階梯實際單價</strong>
              <span>{formatMoney(validation.lowestTierUnitPrice)}</span>
            </div>
          )}
          {validation.quantityDiscountPlanChange === "replace" &&
            validation.requestedQuantityDiscountPlan ? (
              <div className="business-pricing-tier-diffs">
                <strong>數量折扣</strong>
                {quantityDiscountLowerBounds(
                  validation.previousQuantityDiscountPlan,
                  validation.requestedQuantityDiscountPlan,
                ).map((lowerBound) => (
                  <div
                    className="business-pricing-diff-row"
                    key={lowerBound}
                  >
                    <span className="business-pricing-diff-label">
                      {lowerBound} 件
                    </span>
                    <span className="business-pricing-diff-old">
                      {quantityDiscountValueAt(
                        validation.previousQuantityDiscountPlan,
                        lowerBound,
                      )}
                    </span>
                    <span className="business-pricing-diff-arrow">→</span>
                    <span className="business-pricing-diff-new">
                      {quantityDiscountValueAt(
                        validation.requestedQuantityDiscountPlan,
                        lowerBound,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>數量折扣保持不變：{formatQuantityDiscountPlan(
                validation.previousQuantityDiscountPlan,
              )}</p>
            )}
          {validation.issues.map((issue, index) => (
            <p key={`${issue.severity}-${index}`}>
              {issue.severity} · {issue.message}
            </p>
          ))}
          <button
            type="button"
            className="price-primary-button"
            onClick={() => void commitPrice()}
            disabled={loading || commitFailed}
          >{loading
            ? "送出中，等待 Amazon 接受…"
            : commitFailed
            ? "請重新讀取 Amazon 後再預檢"
            : "Touch ID／Windows Hello 確認並送出"}</button>
        </div>
      )}
      {editorError && (
        <div
          className="price-error business-pricing-editor-error"
          role="alert"
        >
          <strong>Amazon 預檢／更新未完成</strong>
          <p>{editorError}</p>
        </div>
      )}
      {result && (
        <div className="business-pricing-result" role="status">
          <strong>已完成並回查</strong>
          <p>{result.notice}</p>
        </div>
      )}
      {!validation &&
        !result &&
        !writeBlockedByQuantityEvidence &&
        listing.businessPricingCapability.editable && (
        <button
          type="submit"
          className="price-primary-button"
          disabled={
            loading ||
            writeInFlight ||
            parsedNewPrice === null ||
            tierInputInvalid ||
            noRequestedChange
          }
        >{loading
          ? "Amazon 預檢中…"
          : writeStatus?.status === "VERIFIED" &&
              writeStatus.stage === "minimum_price"
          ? "重新預檢 B2B 價格與階梯（不寫入）"
          : editorMode === "combined"
          ? "先預檢 B2B 價格與階梯折扣（不寫入）"
          : "先預檢 B2B 價格並保留原數量折扣（不寫入）"}</button>
      )}
    </form>
  );
}
