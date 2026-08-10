"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Money = {
  amount: number;
  currencyCode: string;
};

type ListingIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};

type ListingPriceSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  status: string[];
  standardPrice: Money | null;
  effectivePrice: Money | null;
  minimumPrice: Money | null;
  maximumPrice: Money | null;
  hasDiscountedPrice: boolean;
  hasAutomatedPricing: boolean;
  fetchedAt: string;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string | null;
};

type PriceValidationResult = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  previousPrice: Money;
  requestedPrice: Money;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};

type PriceUpdateResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  previousPrice: Money;
  requestedPrice: Money;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};

type ApiProblem = {
  message?: string;
  requestId?: string | null;
  issues?: ListingIssue[];
};

type SubscribeSaveSnapshot = {
  mode: "live" | "demo";
  found: boolean;
  eligibility: string | null;
  enrollmentMethod: string | null;
  autoEnrollment: string | null;
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  amazonFundedBaseDiscount: number | null;
  amazonFundedTieredDiscount: number | null;
  subscriptions: number | null;
  notice: string;
  writable: false;
};

type HistoryEntry = {
  id: string;
  marketplaceLabel: string;
  sellerSku: string;
  previousPrice: Money;
  requestedPrice: Money;
  createdAt: string;
  status: "processing" | "standard" | "effective" | "simulated";
};

const MARKETPLACES = [
  { id: "ATVPDKIKX0DER", label: "US · 美國站", currency: "USD", sampleSku: "AFA-TRKY-4OZ", snsSupported: true, snsManage: "https://sellercentral.amazon.com/sns/manage" },
  { id: "A1VC38T7YXB528", label: "JP · 日本站", currency: "JPY", sampleSku: "AFA100-JP", snsSupported: true, snsManage: "https://sellercentral.amazon.co.jp/sns/manage" },
  { id: "A2EUQ1WTGCTBG2", label: "CA · 加拿大站", currency: "CAD", sampleSku: "AFA-TRKY-4OZ", snsSupported: true, snsManage: "https://sellercentral.amazon.ca" },
  { id: "A19VAU5U5O7RUS", label: "SG · 新加坡站", currency: "SGD", sampleSku: "AFA-TRKY-4OZ", snsSupported: false, snsManage: "https://sellercentral.amazon.sg" },
  { id: "A39IBJ37TRP1C6", label: "AU · 澳洲站", currency: "AUD", sampleSku: "AFA-TRKY-4OZ", snsSupported: false, snsManage: "https://sellercentral.amazon.com.au" },
  { id: "A1F83G8C2ARO7P", label: "UK · 英國站", currency: "GBP", sampleSku: "AFA-TRKY-4OZ", snsSupported: true, snsManage: "https://sellercentral.amazon.co.uk" },
  { id: "A1PA6795UKMFR9", label: "DE · 德國站", currency: "EUR", sampleSku: "AFA-TRKY-4OZ", snsSupported: true, snsManage: "https://sellercentral.amazon.de" },
];

function formatMoney(money: Money | null): string {
  if (!money) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: money.currencyCode,
      maximumFractionDigits: money.currencyCode === "JPY" ? 0 : 2,
    }).format(money.amount);
  } catch {
    return `${money.currencyCode} ${money.amount.toLocaleString()}`;
  }
}

function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function parsePrice(value: string, currencyCode: string): number | null {
  const pattern = currencyCode === "JPY" ? /^\d{1,9}$/ : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function apiPrice(money: Money): string {
  return money.currencyCode === "JPY"
    ? Math.round(money.amount).toString()
    : money.amount.toFixed(2);
}

function createIdempotencyKey(): string {
  const values = new Uint32Array(3);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    values.set([
      Math.floor(Math.random() * 0xffffffff),
      Math.floor(Math.random() * 0xffffffff),
      Math.floor(Math.random() * 0xffffffff),
    ]);
  }
  return `price-${Date.now().toString(36)}-${Array.from(values, (value) =>
    value.toString(36),
  ).join("-")}`;
}

function problemMessage(payload: ApiProblem, fallback: string): string {
  const requestId = payload.requestId ? `（Request ID: ${payload.requestId}）` : "";
  return `${payload.message || fallback}${requestId}`;
}

export default function PriceDrawer({
  initialMarketplaceId,
  initialSellerSku = "",
  onContextResolved,
  onClose,
}: {
  initialMarketplaceId: string;
  initialSellerSku?: string;
  onContextResolved?: (marketplaceId: string, sellerSku: string) => void;
  onClose: () => void;
}) {
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [skuInput, setSkuInput] = useState(initialSellerSku);
  const [listing, setListing] = useState<ListingPriceSnapshot | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [phase, setPhase] = useState<"edit" | "confirm" | "result">("edit");
  const [validation, setValidation] = useState<PriceValidationResult | null>(null);
  const [result, setResult] = useState<PriceUpdateResult | null>(null);
  const [confirmationSku, setConfirmationSku] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [confirmationState, setConfirmationState] = useState<
    "pending" | "standard" | "effective"
  >("pending");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [subscribeSave, setSubscribeSave] = useState<SubscribeSaveSnapshot | null>(null);
  const [subscribeSaveLoading, setSubscribeSaveLoading] = useState(false);
  const [subscribeSaveError, setSubscribeSaveError] = useState<string | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const autoLookupRef = useRef(false);
  const autoRecheckRef = useRef("");

  const marketplace =
    MARKETPLACES.find((item) => item.id === marketplaceId) ?? MARKETPLACES[0];
  const parsedNewPrice = parsePrice(newPrice, marketplace.currency);
  const change = useMemo(() => {
    if (!listing?.standardPrice || parsedNewPrice === null) return null;
    const difference = parsedNewPrice - listing.standardPrice.amount;
    return {
      difference,
      ratio: difference / listing.standardPrice.amount,
    };
  }, [listing, parsedNewPrice]);
  const isLargeChange = Boolean(change && Math.abs(change.ratio) >= 0.2);
  const guardrailError = useMemo(() => {
    if (parsedNewPrice === null || !listing) return null;
    if (listing.minimumPrice && parsedNewPrice < listing.minimumPrice.amount) {
      return `低於最低允許售價 ${formatMoney(listing.minimumPrice)}`;
    }
    if (listing.maximumPrice && parsedNewPrice > listing.maximumPrice.amount) {
      return `高於最高允許售價 ${formatMoney(listing.maximumPrice)}`;
    }
    return null;
  }, [listing, parsedNewPrice]);
  const priceError = useMemo(() => {
    if (!newPrice) return null;
    if (parsedNewPrice === null) {
      return marketplace.currency === "JPY"
        ? "日圓請輸入大於 0 的整數"
        : "請輸入大於 0、最多兩位小數的金額";
    }
    if (listing?.standardPrice && parsedNewPrice === listing.standardPrice.amount) {
      return "新價格與目前標準售價相同";
    }
    return guardrailError;
  }, [guardrailError, listing, marketplace.currency, newPrice, parsedNewPrice]);

  const closeDrawer = useCallback(() => {
    const hasUnsavedChange =
      phase !== "result" && Boolean(listing && newPrice && parsedNewPrice !== null);
    if (hasUnsavedChange && !window.confirm("尚有未送出的價格變更，確定要捨棄嗎？")) {
      return;
    }
    lookupAbortRef.current?.abort();
    onClose();
  }, [listing, newPrice, onClose, parsedNewPrice, phase]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || actionLoading) return;
      if (phase === "confirm") {
        setPhase("edit");
        setValidation(null);
        setConfirmationSku("");
        return;
      }
      closeDrawer();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionLoading, closeDrawer, phase]);

  const resetListing = (nextMarketplaceId?: string) => {
    lookupAbortRef.current?.abort();
    if (nextMarketplaceId) setMarketplaceId(nextMarketplaceId);
    setSkuInput("");
    setListing(null);
    setNewPrice("");
    setValidation(null);
    setResult(null);
    setConfirmationSku("");
    setIdempotencyKey("");
    setConfirmationState("pending");
    setError(null);
    setSubscribeSave(null);
    setSubscribeSaveError(null);
    setPhase("edit");
  };

  const fetchSubscribeSave = useCallback(
    async (sellerSku: string) => {
      if (!marketplace.snsSupported) {
        setSubscribeSave(null);
        setSubscribeSaveError("此站點目前不在 Amazon 公開的 Seller Replenishment API 支援清單。");
        return;
      }
      setSubscribeSaveLoading(true);
      setSubscribeSaveError(null);
      try {
        const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
        const response = await fetch(`/api/sp-api/subscribe-save?${params}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as SubscribeSaveSnapshot | ApiProblem;
        if (!response.ok) {
          throw new Error(problemMessage(payload as ApiProblem, "目前無法查詢訂閱省。"));
        }
        setSubscribeSave(payload as SubscribeSaveSnapshot);
      } catch (requestError) {
        setSubscribeSaveError(requestError instanceof Error ? requestError.message : "目前無法查詢訂閱省。");
      } finally {
        setSubscribeSaveLoading(false);
      }
    },
    [marketplace.snsSupported, marketplaceId],
  );

  const fetchListing = useCallback(
    async (sellerSku: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/listings?${params}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as ListingPriceSnapshot | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "目前無法查詢這個 SKU。"));
      }
      return payload as ListingPriceSnapshot;
    },
    [marketplaceId],
  );

  const lookup = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const sellerSku = skuInput.trim();
    if (!sellerSku) {
      setError("請輸入完整 Seller SKU。");
      return;
    }

    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    setLookupLoading(true);
    setError(null);
    setListing(null);
    setNewPrice("");
    setResult(null);
    setConfirmationState("pending");

    try {
      const nextListing = await fetchListing(sellerSku, controller.signal);
      setListing(nextListing);
      onContextResolved?.(marketplaceId, nextListing.sellerSku);
      void fetchSubscribeSave(sellerSku);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error ? requestError.message : "目前無法查詢這個 SKU。",
      );
    } finally {
      if (lookupAbortRef.current === controller) setLookupLoading(false);
    }
  }, [fetchListing, fetchSubscribeSave, marketplaceId, onContextResolved, skuInput]);

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookup();
  }, [initialSellerSku, lookup]);

  const updateBody = (
    key = idempotencyKey,
    confirmedSku = confirmationSku,
  ) => ({
    marketplaceId,
    sellerSku: listing?.sellerSku,
    expectedPrice: listing?.standardPrice ? apiPrice(listing.standardPrice) : "",
    newPrice,
    confirmationSku: confirmedSku,
    idempotencyKey: key,
  });

  const acceptPriceResult = (
    nextResult: PriceUpdateResult,
    key: string,
  ) => {
    if (!listing) return;
    setResult(nextResult);
    setPhase("result");
    setHistory((entries) => [
      {
        id: key,
        marketplaceLabel: marketplace.label,
        sellerSku: listing.sellerSku,
        previousPrice: nextResult.previousPrice,
        requestedPrice: nextResult.requestedPrice,
        createdAt: nextResult.acceptedAt,
        status: (nextResult.mode === "demo"
          ? "simulated"
          : "processing") as HistoryEntry["status"],
      },
      ...entries,
    ].slice(0, 5));
  };

  const previewChange = async () => {
    if (!listing?.standardPrice || parsedNewPrice === null || priceError) return;
    setActionLoading(true);
    setError(null);
    const key = createIdempotencyKey();

    try {
      const response = await fetch("/api/sp-api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...updateBody(), idempotencyKey: key }),
      });
      const payload = (await response.json()) as PriceValidationResult | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 價格預檢未通過。"));
      }
      const nextValidation = payload as PriceValidationResult;
      setValidation(nextValidation);
      setIdempotencyKey(key);
      setConfirmationSku("");
      if (!isLargeChange && nextValidation.issues.length === 0) {
        const updateResponse = await fetch("/api/sp-api/listings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(updateBody(key, "")),
        });
        const updatePayload = (await updateResponse.json()) as PriceUpdateResult | ApiProblem;
        if (!updateResponse.ok) {
          throw new Error(
            problemMessage(updatePayload as ApiProblem, "Amazon 未接受這次價格更新。"),
          );
        }
        acceptPriceResult(updatePayload as PriceUpdateResult, key);
      } else {
        setPhase("confirm");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Amazon 價格預檢未通過。",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const submitChange = async () => {
    if (!listing?.standardPrice || !validation || !idempotencyKey) return;
    if (isLargeChange && confirmationSku !== listing.sellerSku) return;
    setActionLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sp-api/listings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateBody()),
      });
      const payload = (await response.json()) as PriceUpdateResult | ApiProblem;
      if (!response.ok) {
        throw new Error(problemMessage(payload as ApiProblem, "Amazon 未接受這次價格更新。"));
      }
      acceptPriceResult(payload as PriceUpdateResult, idempotencyKey);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Amazon 未接受這次價格更新。",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const recheck = useCallback(async () => {
    if (!listing || !result) return;
    setRecheckLoading(true);
    setError(null);
    try {
      const latest = await fetchListing(listing.sellerSku);
      setListing(latest);
      const standardMatches = Boolean(
        latest.standardPrice &&
          Math.abs(latest.standardPrice.amount - result.requestedPrice.amount) <
            (result.requestedPrice.currencyCode === "JPY" ? 0.5 : 0.005),
      );
      const effectiveMatches = Boolean(
        latest.effectivePrice &&
          Math.abs(latest.effectivePrice.amount - result.requestedPrice.amount) <
            (result.requestedPrice.currencyCode === "JPY" ? 0.5 : 0.005),
      );
      const canConfirmCustomerPrice =
        !latest.hasDiscountedPrice && !latest.hasAutomatedPricing;
      const nextState =
        result.mode === "live" && standardMatches
          ? canConfirmCustomerPrice && effectiveMatches
            ? "effective"
            : "standard"
          : "pending";
      setConfirmationState(nextState);
      if (nextState === "effective" || nextState === "standard") {
        setHistory((entries) =>
          entries.map((entry) =>
            entry.id === idempotencyKey ? { ...entry, status: nextState } : entry,
          ),
        );
      } else if (result.mode === "live") {
        setError("Amazon 目前仍顯示原價格，請稍後再重新確認。");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "目前無法重新確認價格。",
      );
    } finally {
      setRecheckLoading(false);
    }
  }, [fetchListing, idempotencyKey, listing, result]);

  useEffect(() => {
    if (
      phase !== "result" ||
      !result ||
      result.mode !== "live" ||
      confirmationState !== "pending" ||
      autoRecheckRef.current === idempotencyKey
    ) {
      return;
    }
    autoRecheckRef.current = idempotencyKey;
    const timeout = window.setTimeout(() => void recheck(), 4_000);
    return () => window.clearTimeout(timeout);
  }, [confirmationState, idempotencyKey, phase, recheck, result]);

  const statusLabel = (status: HistoryEntry["status"]) => {
    if (status === "effective") return "已生效";
    if (status === "standard") return "標準售價已更新";
    if (status === "simulated") return "模擬";
    return "Amazon 處理中";
  };

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionLoading) closeDrawer();
      }}
    >
      <aside
        className="order-drawer price-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-drawer-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">LISTINGS ITEMS · V2021-08-01</p>
            <h2 id="price-drawer-title">定價與訂閱</h2>
          </div>
          <button type="button" onClick={closeDrawer} disabled={actionLoading} aria-label="關閉調價中心">
            ×
          </button>
        </div>

        {phase === "edit" && (
          <>
            <p className="price-intro">輸入精確 SKU，一次看標準售價與訂閱折扣；價格可直接改，訂閱設定依 Amazon 公開 API 保持唯讀。</p>
            <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>全域 SKU 開啟即查現價、S&amp;S、上下限、價差與幣別。</p><span className="automation-badge one_click">一鍵</span><p>一般調價會自動預檢、送出並回查；達 20% 或 Amazon 有提醒才停下確認。</p><span className="automation-badge manual">需人工</span><p>Subscribe &amp; Save 資格與折扣必須在 Amazon 管理。</p></div>
            <form className="price-search" onSubmit={lookup}>
              <label htmlFor="price-marketplace">
                <span>Amazon 站點</span>
                <select
                  id="price-marketplace"
                  value={marketplaceId}
                  onChange={(event) => resetListing(event.target.value)}
                  disabled={lookupLoading || actionLoading}
                >
                  {MARKETPLACES.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="price-sku-input">
                <span>Seller SKU</span>
                <div className="sku-search-row">
                  <input
                    id="price-sku-input"
                    value={skuInput}
                    onChange={(event) => setSkuInput(event.target.value)}
                    maxLength={40}
                    placeholder={`例如 ${marketplace.sampleSku}`}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    disabled={lookupLoading || actionLoading}
                  />
                  <button type="submit" disabled={lookupLoading || !skuInput.trim()}>
                    {lookupLoading ? "查詢中" : "查詢"}
                  </button>
                </div>
              </label>
            </form>

            {error && <div className="price-error" role="alert">{error}</div>}

            {listing && (
              <section className="listing-result" aria-label="查詢到的 Listing">
                <div className="listing-title-row">
                  <div className="listing-avatar" aria-hidden="true">{listing.title.slice(0, 1)}</div>
                  <div>
                    <strong>{listing.title}</strong>
                    <p>{listing.sellerSku} · {listing.asin ?? "無 ASIN"}</p>
                  </div>
                  <span className={`listing-mode ${listing.mode}`}>{listing.mode === "live" ? "Live" : "Demo"}</span>
                </div>
                <div className="listing-status-row">
                  {listing.status.map((item) => <span key={item}>{item}</span>)}
                  <small>查詢 {formatDateTime(listing.fetchedAt)}</small>
                </div>
                <dl className="price-facts">
                  <div>
                    <dt>目前標準售價</dt>
                    <dd>{formatMoney(listing.standardPrice)}</dd>
                  </div>
                  <div>
                    <dt>Amazon 有效售價</dt>
                    <dd>{formatMoney(listing.effectivePrice)}</dd>
                  </div>
                  {(listing.minimumPrice || listing.maximumPrice) && (
                    <div>
                      <dt>允許範圍</dt>
                      <dd>{formatMoney(listing.minimumPrice)} – {formatMoney(listing.maximumPrice)}</dd>
                    </div>
                  )}
                </dl>

                <section className="price-sns-card">
                  <div className="price-sns-heading">
                    <div>
                      <span>Subscribe &amp; Save</span>
                      <strong>訂閱省</strong>
                    </div>
                    <span className="capability-pill readonly">Amazon API 唯讀</span>
                  </div>
                  {subscribeSaveLoading && <p className="sns-inline-loading">正在查詢訂閱狀態…</p>}
                  {!subscribeSaveLoading && subscribeSave && subscribeSave.found && (
                    <>
                      <dl className="price-sns-facts">
                        <div><dt>資格／狀態</dt><dd>{subscribeSave.eligibility ?? "—"}</dd></div>
                        <div><dt>賣家 Base</dt><dd>{subscribeSave.sellerFundedBaseDiscount ?? 0}%</dd></div>
                        <div><dt>賣家 Tiered</dt><dd>{subscribeSave.sellerFundedTieredDiscount ?? 0}%</dd></div>
                        <div><dt>目前有效訂閱</dt><dd>{formatCount(subscribeSave.subscriptions)}</dd></div>
                      </dl>
                      <p>「目前有效訂閱」是 Amazon listOffers 的查詢快照，不是期間新增、歷史累計、配送次數或唯一顧客數。</p>
                      <p>{subscribeSave.notice}</p>
                    </>
                  )}
                  {!subscribeSaveLoading && subscribeSave && !subscribeSave.found && <p>Amazon 沒有回傳此 SKU 的 Subscribe &amp; Save offer。</p>}
                  {!subscribeSaveLoading && subscribeSaveError && <p className="sns-inline-error">{subscribeSaveError}</p>}
                  <a href={marketplace.snsManage} target="_blank" rel="noreferrer">管理訂閱資格與折扣 ↗</a>
                </section>

                {(listing.hasDiscountedPrice || listing.hasAutomatedPricing) && (
                  <div className="price-warning compact">
                    <strong>顧客看到的價格可能不同</strong>
                    <p>
                      {listing.hasDiscountedPrice ? "此 Listing 有促銷價設定。" : ""}
                      {listing.hasAutomatedPricing ? "此 Listing 已連結 Amazon 自動定價。" : ""}
                      本工具只改標準售價，不會刪除這些設定。
                    </p>
                  </div>
                )}

                {!listing.standardPrice ? (
                  <div className="price-error">查不到可核對的標準售價，為避免誤改，已停用寫入。</div>
                ) : (
                  <div className="new-price-panel">
                    <label htmlFor="new-standard-price">
                      <span>新標準售價 · {marketplace.currency}</span>
                      <div className="price-input-row">
                        <b>{marketplace.currency}</b>
                        <input
                          id="new-standard-price"
                          value={newPrice}
                          onChange={(event) => {
                            setNewPrice(event.target.value);
                            setValidation(null);
                            setError(null);
                          }}
                          inputMode={marketplace.currency === "JPY" ? "numeric" : "decimal"}
                          placeholder={marketplace.currency === "JPY" ? "1980" : "14.99"}
                          autoComplete="off"
                          aria-invalid={Boolean(priceError)}
                        />
                      </div>
                    </label>
                    {priceError && <small className="field-error">{priceError}</small>}
                    {change && !priceError && (
                      <div className={`price-difference ${isLargeChange ? "large" : ""}`}>
                        <span>{formatMoney(listing.standardPrice)} → {formatMoney({ amount: parsedNewPrice!, currencyCode: marketplace.currency })}</span>
                        <strong>
                          {change.difference > 0 ? "+" : ""}{formatMoney({ amount: change.difference, currencyCode: marketplace.currency })}
                          {" · "}{change.ratio > 0 ? "+" : ""}{(change.ratio * 100).toFixed(1)}%
                        </strong>
                      </div>
                    )}
                    {isLargeChange && !priceError && (
                      <div className="price-warning danger">
                        <strong>大幅價格變動</strong>
                        <p>變動達 20%，最終送出前必須重新輸入完整 SKU。</p>
                      </div>
                    )}
                    <button
                      className="price-primary-button"
                      type="button"
                      onClick={previewChange}
                      disabled={actionLoading || parsedNewPrice === null || Boolean(priceError)}
                    >
                      {actionLoading ? "自動預檢與送出中…" : "安全一鍵套用"}
                    </button>
                    <p className="automation-inline-note">先由 Amazon 預檢；只有沒有提醒且變動低於 20% 才會自動送出。</p>
                  </div>
                )}
              </section>
            )}

            {history.length > 0 && (
              <section className="price-history">
                <h3>本次工作階段</h3>
                {history.map((entry) => (
                  <article key={entry.id}>
                    <div>
                      <strong>{entry.sellerSku}</strong>
                      <small>{entry.marketplaceLabel} · {formatDateTime(entry.createdAt)}</small>
                    </div>
                    <div>
                      <span>{formatMoney(entry.previousPrice)} → {formatMoney(entry.requestedPrice)}</span>
                      <small className={entry.status}>{statusLabel(entry.status)}</small>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        {phase === "confirm" && listing && validation && (
          <section className="price-confirmation">
            <button
              className="back-link"
              type="button"
              onClick={() => {
                setPhase("edit");
                setValidation(null);
                setConfirmationSku("");
                setError(null);
              }}
              disabled={actionLoading}
            >
              ← 返回修改
            </button>
            <p className="eyebrow">FINAL CONFIRMATION</p>
            <h3>確認這次價格變更</h3>
            <p className="confirmation-product">{marketplace.label} · {listing.sellerSku}</p>
            <div className="price-transition">
              <div><span>目前標準售價</span><strong>{formatMoney(validation.previousPrice)}</strong></div>
              <i>→</i>
              <div><span>新標準售價</span><strong>{formatMoney(validation.requestedPrice)}</strong></div>
            </div>
            {change && (
              <p className={`confirmation-delta ${isLargeChange ? "large" : ""}`}>
                {change.difference >= 0 ? "調漲" : "調降"} {formatMoney({ amount: Math.abs(change.difference), currencyCode: marketplace.currency })}
                （{Math.abs(change.ratio * 100).toFixed(1)}%）
              </p>
            )}
            <div className={`validation-status ${validation.mode}`}>
              <strong>{validation.mode === "live" ? "Amazon Validation Preview 已通過" : "展示預檢已通過"}</strong>
              <p>{validation.notice}</p>
            </div>
            {validation.issues.length > 0 && (
              <div className="validation-issues">
                <strong>Amazon 預檢提醒</strong>
                {validation.issues.map((issue, index) => (
                  <p key={`${issue.code ?? "issue"}-${index}`}>{issue.message}</p>
                ))}
              </div>
            )}
            {isLargeChange && (
              <label className="confirmation-input" htmlFor="price-confirmation-sku">
                <span>重新輸入完整 SKU 以確認</span>
                <input
                  id="price-confirmation-sku"
                  value={confirmationSku}
                  onChange={(event) => setConfirmationSku(event.target.value)}
                  placeholder={listing.sellerSku}
                  autoComplete="off"
                  spellCheck={false}
                />
                {confirmationSku && confirmationSku !== listing.sellerSku && <small>SKU 尚未完全一致</small>}
              </label>
            )}
            {error && <div className="price-error" role="alert">{error}</div>}
            <button
              className="price-primary-button danger-button"
              type="button"
              onClick={submitChange}
              disabled={actionLoading || (isLargeChange && confirmationSku !== listing.sellerSku)}
            >
              {actionLoading
                ? "送交 Amazon 中…"
                : validation.mode === "demo"
                  ? `模擬把 ${listing.sellerSku} 改為 ${formatMoney(validation.requestedPrice)}`
                  : `確認把 ${marketplace.label.split(" · ")[0]} · ${listing.sellerSku} 改為 ${formatMoney(validation.requestedPrice)}`}
            </button>
            <p className="submission-note">送出前本機 App 會重新查價並再次預檢；若價格已變動，這次更新會停止。</p>
          </section>
        )}

        {phase === "result" && listing && result && (
          <section className="price-result">
            <div className={`result-icon ${confirmationState !== "pending" ? confirmationState : result.mode}`}>
              {confirmationState === "effective" ? "✓" : confirmationState === "standard" ? "S" : result.mode === "demo" ? "D" : "…"}
            </div>
            <p className="eyebrow">
              {confirmationState === "effective"
                ? "PRICE CONFIRMED"
                : confirmationState === "standard"
                  ? "STANDARD PRICE RECORDED"
                  : result.mode === "demo"
                    ? "SIMULATION ONLY"
                    : "AMAZON ACCEPTED"}
            </p>
            <h3>
              {confirmationState === "effective"
                ? "新價格已確認生效"
                : confirmationState === "standard"
                  ? "標準售價已更新"
                  : result.mode === "demo"
                    ? "模擬調價完成"
                    : "Amazon 已接受，等待確認"}
            </h3>
            <p>
              {confirmationState === "standard"
                ? listing.hasDiscountedPrice || listing.hasAutomatedPricing
                  ? "Amazon 已記錄新標準售價；因促銷或自動定價仍存在，顧客看到的有效售價可能不同。"
                  : "Amazon 已記錄新標準售價，有效售價仍在同步中。"
                : result.notice}
            </p>
            <div className="result-price-card">
              <span>{listing.sellerSku}</span>
              <strong>{formatMoney(result.previousPrice)} → {formatMoney(result.requestedPrice)}</strong>
              {result.submissionId && <small>Submission ID · {result.submissionId}</small>}
            </div>
            {error && <div className="price-error" role="status">{error}</div>}
            {result.mode === "live" && confirmationState !== "effective" && (
              <button className="price-primary-button" type="button" onClick={recheck} disabled={recheckLoading}>
                {recheckLoading ? "重新查詢中…" : "立即再查一次"}
              </button>
            )}
            <button className="secondary-wide-button" type="button" onClick={() => resetListing()} disabled={recheckLoading}>
              調整另一個 SKU
            </button>
          </section>
        )}

        <div className="privacy-footnote price-footnote">
          憑證只留在這台電腦的系統安全儲存區。正式調價會先核對舊價、跑 Amazon 預檢，再送出單一 SKU 更新。
        </div>
      </aside>
    </div>
  );
}
