"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  businessPricingEditorProposal,
  createSubmittedBusinessPricePreview,
  parseBusinessPriceUpdate,
  type BusinessPricingEditorMode,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
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

export default function BusinessPricingEditor({
  listing,
  onClose,
  onVerified,
  onError,
  onBusyChange,
}: Readonly<{
  listing: BusinessPricingListingSnapshot;
  onClose: () => void;
  onVerified: (result: BusinessPriceUpdate) => void;
  onError: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}>) {
  const priceOnlyProposal = businessPricingEditorProposal(listing, "price_only");
  const [newPrice, setNewPrice] = useState(
    priceOnlyProposal?.businessPrice.toFixed(2) ??
      listing.businessPrice?.amount.toString() ?? "",
  );
  const [editorMode, setEditorMode] =
    useState<BusinessPricingEditorMode>("price_only");
  const [tierDrafts, setTierDrafts] = useState<readonly TierDraft[]>([]);
  const [submittedPreview, setSubmittedPreview] =
    useState<SubmittedBusinessPricePreview | null>(null);
  const [result, setResult] = useState<BusinessPriceUpdate | null>(null);
  const [loading, setLoading] = useState(false);
  const revisionRef = useRef(0);
  const validation = submittedPreview?.validation ?? null;
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
  const canReplaceQuantityDiscounts = Boolean(
    listing.businessPricingCapability.quantityDiscountsEditable &&
    listing.quantityDiscountPlanPresence !== "ambiguous" &&
    !listing.businessPricingManagedByAutomation,
  );

  const setBusy = (busy: boolean) => {
    setLoading(busy);
    onBusyChange(busy);
  };
  const resetPreview = () => {
    revisionRef.current += 1;
    setSubmittedPreview(null);
    setResult(null);
    onError(null);
  };
  const chooseEditorMode = (nextMode: BusinessPricingEditorMode) => {
    if (nextMode === "combined" && !canReplaceQuantityDiscounts) return;
    resetPreview();
    setEditorMode(nextMode);
    if (nextMode === "combined") {
      const proposal = businessPricingEditorProposal(listing, "combined");
      setTierDrafts(proposal?.quantityDiscountTiers?.map((tier) => ({
        lowerBound: String(tier.lowerBound),
        percent: String(tier.percent),
      })) ?? []);
    } else {
      setTierDrafts([]);
    }
  };

  const previewPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (
      parsedNewPrice === null ||
      (unchanged && tierDrafts.length === 0) ||
      parsedTiers === null
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
        expectedQuantityDiscountPlanHash: listing.quantityDiscountPlanHash,
        quantityDiscountTiers: parsedTiers,
      }),
      idempotencyKey,
    });
    const revision = ++revisionRef.current;
    setBusy(true);
    onError(null);
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
        onError(requestError instanceof Error
          ? requestError.message
          : "Amazon B2B 價格預檢未通過。");
      }
    } finally {
      if (revisionRef.current === revision) setBusy(false);
    }
  };

  const commitPrice = async () => {
    const submitted = submittedPreview;
    if (!submitted) return;
    setBusy(true);
    onError(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitted.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "Amazon 未能確認 B2B 價格更新。",
        ));
      }
      const nextResult = parseBusinessPriceUpdate(payload, submitted);
      setResult(nextResult);
      setSubmittedPreview(null);
      onVerified(nextResult);
    } catch (requestError) {
      onError(requestError instanceof Error
        ? requestError.message
        : "Amazon 未能確認 B2B 價格更新。");
    } finally {
      setBusy(false);
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
        <div><dt>目前 B2B 價格</dt><dd>{formatMoney(listing.businessPrice)}</dd></div>
        <div>
          <dt>目前數量折扣</dt>
          <dd>{formatQuantityDiscountPlan(listing.quantityDiscountPlan)}</dd>
        </div>
      </dl>
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
            disabled={loading}
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
            <button
              type="button"
              aria-pressed={editorMode === "price_only"}
              onClick={() => chooseEditorMode("price_only")}
              disabled={loading}
            >只改價格並保留原數量折扣</button>
            <button
              type="button"
              aria-pressed={editorMode === "combined"}
              onClick={() => chooseEditorMode("combined")}
              disabled={loading}
            >明確一併更新階梯折扣</button>
          </div>
          {editorMode === "price_only" ? (
            <div className="price-warning compact">
              <strong>Price-only</strong>
              <p>本次預檢與正式 PATCH 都不帶 quantity_discount_plan，完整保留現有階梯折扣。</p>
            </div>
          ) : (
            <fieldset className="business-pricing-tier-fieldset" disabled={loading}>
              <legend>新數量折扣（1–5 階 percent）</legend>
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
                    {tierDrafts.length > 1 && (
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
                {tierDrafts.length < 5 && (
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
          <strong>數量折扣不可直接修改</strong>
          <p>{listing.businessPricingManagedByAutomation
            ? "此 contribution 由 Amazon Automate Pricing 管理；請先在 Seller Central 處理規則。"
            : listing.quantityDiscountPlanPresence === "ambiguous"
            ? "Amazon 回傳的 quantity_discount_plan 不唯一；本次只允許 price-only 並保留原方案。"
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
        <div className="business-pricing-validation">
          <strong>{validation.notice}</strong>
          <p>舊數量折扣：{formatQuantityDiscountPlan(
            validation.previousQuantityDiscountPlan,
          )}</p>
          <p>新數量折扣：{formatQuantityDiscountPlan(
            validation.requestedQuantityDiscountPlan,
          )}</p>
          {validation.issues.map((issue, index) => (
            <p key={`${issue.severity}-${index}`}>
              {issue.severity} · {issue.message}
            </p>
          ))}
          <button
            type="button"
            className="price-primary-button"
            onClick={() => void commitPrice()}
            disabled={loading}
          >{loading
            ? "送出並回查中…"
            : "Touch ID／Windows Hello 確認並送出"}</button>
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
        listing.businessPricingCapability.editable && (
        <button
          type="submit"
          className="price-primary-button"
          disabled={
            loading ||
            parsedNewPrice === null ||
            tierInputInvalid ||
            (unchanged && tierDrafts.length === 0)
          }
        >{loading
          ? "Amazon 預檢中…"
          : editorMode === "combined"
          ? "先預檢 B2B 價格與階梯折扣（不寫入）"
          : "先預檢 B2B 價格並保留原數量折扣（不寫入）"}</button>
      )}
    </form>
  );
}
