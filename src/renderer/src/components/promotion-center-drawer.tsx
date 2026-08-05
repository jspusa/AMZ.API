"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Money = { amount: number; currencyCode: string };
type ListingIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};
type SaleSchedule = {
  price: Money;
  startAt: string | null;
  endAt: string | null;
};
type ListingSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  title: string;
  standardPrice: Money | null;
  minimumPrice: Money | null;
  maximumPrice: Money | null;
  discountedPrice: SaleSchedule | null;
  hasAutomatedPricing: boolean;
  fetchedAt: string;
  issues: ListingIssue[];
};
type SaleValidation = {
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  action: "set" | "cancel";
  standardPrice: Money;
  previousDiscountedPrice: SaleSchedule | null;
  requestedDiscountedPrice: SaleSchedule | null;
  validatedAt: string;
  issues: ListingIssue[];
  notice: string;
};
type SaleResult = {
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  action: "set" | "cancel";
  standardPrice: Money;
  previousDiscountedPrice: SaleSchedule | null;
  requestedDiscountedPrice: SaleSchedule | null;
  acceptedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
  notice: string;
};
type SubscribeSaveSnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  found: boolean;
  asin: string | null;
  eligibility: string | null;
  enrollmentMethod: string | null;
  autoEnrollment: string | null;
  sellerFundedBaseDiscount: number | null;
  sellerFundedTieredDiscount: number | null;
  amazonFundedBaseDiscount: number | null;
  amazonFundedTieredDiscount: number | null;
  price: Money | null;
  inventory: number | null;
  subscriptions: number | null;
  stockRisk: string | null;
  forecastDeliveries: {
    next15Days: number | null;
    next30Days: number | null;
    next60Days: number | null;
    next90Days: number | null;
  } | null;
  deliveryConditions: Array<{
    condition: string;
    next30DaysDeliveries: number | null;
  }>;
  fetchedAt: string;
  requestId: string | null;
  rateLimit: string | null;
  notice: string;
  writable: false;
};
type ApiProblem = {
  code?: string;
  message?: string;
  requestId?: string | null;
  issues?: ListingIssue[];
};

const MARKETPLACES = [
  {
    id: "ATVPDKIKX0DER",
    label: "US · 美國站",
    currency: "USD",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral.amazon.com",
    snsManage: "https://sellercentral.amazon.com/sns/manage",
    snsSupported: true,
  },
  {
    id: "A1VC38T7YXB528",
    label: "JP · 日本站",
    currency: "JPY",
    sample: "AFA100-JP",
    snsSample: "GTC454-JP",
    sellerCentral: "https://sellercentral.amazon.co.jp",
    snsManage: "https://sellercentral.amazon.co.jp/sns/manage",
    snsSupported: true,
  },
  {
    id: "A2EUQ1WTGCTBG2",
    label: "CA · 加拿大站",
    currency: "CAD",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral.amazon.ca",
    snsManage: "https://sellercentral.amazon.ca",
    snsSupported: true,
  },
  {
    id: "A19VAU5U5O7RUS",
    label: "SG · 新加坡站",
    currency: "SGD",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral.amazon.sg",
    snsManage: "https://sellercentral.amazon.sg",
    snsSupported: false,
  },
  {
    id: "A39IBJ37TRP1C6",
    label: "AU · 澳洲站",
    currency: "AUD",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral.amazon.com.au",
    snsManage: "https://sellercentral.amazon.com.au",
    snsSupported: false,
  },
  {
    id: "A1F83G8C2ARO7P",
    label: "UK · 英國站",
    currency: "GBP",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral-europe.amazon.com",
    snsManage: "https://sellercentral-europe.amazon.com",
    snsSupported: true,
  },
  {
    id: "A1PA6795UKMFR9",
    label: "DE · 德國站",
    currency: "EUR",
    sample: "AFA-TRKY-4OZ",
    snsSample: "GTC-CHKN-1LB",
    sellerCentral: "https://sellercentral-europe.amazon.com",
    snsManage: "https://sellercentral-europe.amazon.com",
    snsSupported: true,
  },
];

const ELIGIBILITY_LABELS: Record<string, string> = {
  ELIGIBLE: "可接受新訂閱",
  INELIGIBLE: "目前不符合資格",
  SUSPENDED: "暫停新訂閱",
  REPLENISHMENT_ONLY_ORDERING: "只履行既有訂閱",
};

const CONDITION_LABELS: Record<string, string> = {
  NEXT_30_DAYS_DELIVERIES_PAUSED_PRICING: "未來 30 天有訂單因價格暫停",
  NEXT_30_DAYS_DELIVERIES_PAUSED_NON_BUYABLE: "未來 30 天有訂單因不可購買暫停",
  NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK_ONLY: "未來 30 天只有低庫存風險",
  NEXT_30_DAYS_DELIVERIES_AT_LOW_INVENTORY_RISK: "未來 30 天有低庫存風險",
  NO_ISSUES_FOR_NEXT_30_DAYS_DELIVERIES: "未來 30 天沒有配送風險",
};

function formatMoney(money: Money | null) {
  if (!money) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: money.currencyCode,
      maximumFractionDigits: money.currencyCode === "JPY" ? 0 : 2,
    }).format(money.amount);
  } catch {
    return `${money.currencyCode} ${money.amount}`;
  }
}

function apiPrice(money: Money) {
  return money.currencyCode === "JPY"
    ? Math.round(money.amount).toString()
    : money.amount.toFixed(2);
}

function parsePrice(value: string, currencyCode: string) {
  const pattern =
    currencyCode === "JPY"
      ? /^\d{1,9}$/
      : /^\d{1,9}(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function dateFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeIdempotencyKey() {
  const values = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(values);
  return `sale-${Date.now().toString(36)}-${Array.from(values, (value) =>
    value.toString(36),
  ).join("-")}`;
}

function problemMessage(payload: ApiProblem, fallback: string) {
  return `${payload.message || fallback}${
    payload.requestId ? `（Request ID: ${payload.requestId}）` : ""
  }`;
}

export default function PromotionCenterDrawer({
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
  const [tab, setTab] = useState<"sale" | "coupon" | "sns">("sale");
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId);
  const [saleSku, setSaleSku] = useState(initialSellerSku);
  const [listing, setListing] = useState<ListingSnapshot | null>(null);
  const [salePrice, setSalePrice] = useState("");
  const [startAt, setStartAt] = useState(dateFromNow(1));
  const [endAt, setEndAt] = useState(dateFromNow(8));
  const [salePhase, setSalePhase] = useState<"edit" | "confirm" | "result">(
    "edit",
  );
  const [saleAction, setSaleAction] = useState<"set" | "cancel">("set");
  const [validation, setValidation] = useState<SaleValidation | null>(null);
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [confirmationSku, setConfirmationSku] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [recheckState, setRecheckState] = useState<
    "pending" | "processing" | "effective"
  >("pending");
  const [snsSku, setSnsSku] = useState("");
  const [snsResult, setSnsResult] =
    useState<SubscribeSaveSnapshot | null>(null);
  const [snsLoading, setSnsLoading] = useState(false);
  const [snsError, setSnsError] = useState<string | null>(null);
  const [couponSku, setCouponSku] = useState(initialSellerSku);
  const [couponType, setCouponType] = useState<"percent" | "amount">(
    "percent",
  );
  const [couponValue, setCouponValue] = useState("10");
  const [couponBudget, setCouponBudget] = useState("500");
  const [couponStart, setCouponStart] = useState(dateFromNow(2));
  const [couponEnd, setCouponEnd] = useState(dateFromNow(16));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const autoLookupRef = useRef(false);
  const autoRecheckRef = useRef("");
  const saleRequestSequence = useRef(0);

  const marketplace =
    MARKETPLACES.find((item) => item.id === marketplaceId) ?? MARKETPLACES[0];
  const parsedSalePrice = parsePrice(salePrice, marketplace.currency);
  const discountRatio = useMemo(() => {
    if (!listing?.standardPrice || parsedSalePrice === null) return null;
    return (
      (listing.standardPrice.amount - parsedSalePrice) /
      listing.standardPrice.amount
    );
  }, [listing, parsedSalePrice]);
  const saleFieldError = useMemo(() => {
    if (!listing || !salePrice) return null;
    if (parsedSalePrice === null) {
      return marketplace.currency === "JPY"
        ? "日圓折扣價必須是大於 0 的整數"
        : "折扣價必須大於 0，且最多兩位小數";
    }
    if (
      listing.standardPrice &&
      parsedSalePrice >= listing.standardPrice.amount
    ) {
      return "折扣價必須低於標準售價";
    }
    if (
      listing.minimumPrice &&
      parsedSalePrice < listing.minimumPrice.amount
    ) {
      return `低於最低允許售價 ${formatMoney(listing.minimumPrice)}`;
    }
    if (!startAt || !endAt || endAt <= startAt) {
      return "結束日期必須晚於開始日期";
    }
    return null;
  }, [endAt, listing, marketplace.currency, parsedSalePrice, salePrice, startAt]);
  const requiresExactSku =
    saleAction === "cancel" || Boolean(discountRatio && discountRatio >= 0.2);

  const closeDrawer = useCallback(() => {
    if (
      salePhase === "confirm" &&
      !window.confirm("尚有已通過預檢的折扣變更，確定要捨棄嗎？")
    ) {
      return;
    }
    onClose();
  }, [onClose, salePhase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saleLoading && !snsLoading) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, saleLoading, snsLoading]);

  const resetSale = () => {
    setSaleSku("");
    setListing(null);
    setSalePrice("");
    setStartAt(dateFromNow(1));
    setEndAt(dateFromNow(8));
    setSalePhase("edit");
    setValidation(null);
    setSaleResult(null);
    setSaleError(null);
    setConfirmationSku("");
    setIdempotencyKey("");
    setRecheckState("pending");
  };

  const changeMarketplace = (value: string) => {
    if (
      (listing || snsResult) &&
      !window.confirm("切換站點會清除目前查詢結果，確定繼續嗎？")
    ) {
      return;
    }
    saleRequestSequence.current += 1;
    setMarketplaceId(value);
    resetSale();
    setSnsSku("");
    setSnsResult(null);
    setSnsError(null);
    setCopyState("idle");
  };

  const fetchListing = useCallback(
    async (sellerSku: string, requestedMarketplaceId = marketplaceId) => {
      const params = new URLSearchParams({ marketplaceId: requestedMarketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/listings?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ListingSnapshot | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "目前無法查詢這個 SKU。"),
        );
      }
      const snapshot = payload as ListingSnapshot;
      if (snapshot.marketplaceId !== requestedMarketplaceId) {
        throw new Error("Amazon 回傳站點與目前選擇不一致，已停止套用結果。");
      }
      return snapshot;
    },
    [marketplaceId],
  );

  const lookupSale = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const sellerSku = saleSku.trim();
    if (!sellerSku) return setSaleError("請輸入完整 Seller SKU。");
    const sequence = ++saleRequestSequence.current;
    const requestedMarketplaceId = marketplaceId;
    setSaleLoading(true);
    setSaleError(null);
    setListing(null);
    setSalePhase("edit");
    setSaleResult(null);
    setRecheckState("pending");
    try {
      const nextListing = await fetchListing(sellerSku, requestedMarketplaceId);
      if (sequence !== saleRequestSequence.current) return;
      setListing(nextListing);
      onContextResolved?.(requestedMarketplaceId, nextListing.sellerSku);
    } catch (error) {
      if (sequence !== saleRequestSequence.current) return;
      setSaleError(error instanceof Error ? error.message : "目前無法查詢 SKU。");
    } finally {
      if (sequence === saleRequestSequence.current) setSaleLoading(false);
    }
  }, [fetchListing, marketplaceId, onContextResolved, saleSku]);

  useEffect(() => {
    if (autoLookupRef.current || !initialSellerSku.trim()) return;
    autoLookupRef.current = true;
    void lookupSale();
  }, [initialSellerSku, lookupSale]);

  const saleBody = (
    action: "set" | "cancel",
    key = idempotencyKey,
  ) => ({
    marketplaceId,
    sellerSku: listing?.sellerSku,
    action,
    expectedPrice: listing?.standardPrice
      ? apiPrice(listing.standardPrice)
      : "",
    expectedDiscountedPrice: listing?.discountedPrice
      ? apiPrice(listing.discountedPrice.price)
      : null,
    expectedStartAt: listing?.discountedPrice?.startAt ?? null,
    expectedEndAt: listing?.discountedPrice?.endAt ?? null,
    salePrice: action === "set" ? salePrice : null,
    startAt: action === "set" ? startAt : null,
    endAt: action === "set" ? endAt : null,
    confirmationSku,
    idempotencyKey: key,
  });

  const previewSale = async (action: "set" | "cancel") => {
    if (!listing?.standardPrice) return;
    if (
      action === "set" &&
      (parsedSalePrice === null || saleFieldError)
    ) {
      return;
    }
    setSaleLoading(true);
    setSaleError(null);
    const key = makeIdempotencyKey();
    try {
      const response = await fetch("/api/sp-api/sale-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saleBody(action, key)),
      });
      const payload = (await response.json()) as SaleValidation | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "Amazon 折扣預檢未通過。"),
        );
      }
      const nextValidation = payload as SaleValidation;
      const nextRequiresExactSku =
        action === "cancel" || Boolean(discountRatio && discountRatio >= 0.2);
      setSaleAction(action);
      setValidation(nextValidation);
      setIdempotencyKey(key);
      setConfirmationSku("");

      if (
        action === "set" &&
        !nextRequiresExactSku &&
        nextValidation.issues.length === 0
      ) {
        const updateResponse = await fetch("/api/sp-api/sale-price", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(saleBody(action, key)),
        });
        const updatePayload = (await updateResponse.json()) as
          | SaleResult
          | ApiProblem;
        if (!updateResponse.ok) {
          const problem = updatePayload as ApiProblem;
          if (
            problem.code === "UPDATE_STATUS_UNKNOWN" ||
            problem.code === "OPERATION_IN_PROGRESS"
          ) {
            setSalePhase("confirm");
          }
          throw new Error(
            problemMessage(problem, "Amazon 未接受這次折扣更新。"),
          );
        }
        const nextResult = updatePayload as SaleResult;
        setSaleResult(nextResult);
        setSalePhase("result");
        setRecheckState(nextResult.mode === "demo" ? "effective" : "processing");
        return;
      }
      setSalePhase("confirm");
    } catch (error) {
      setSaleError(
        error instanceof Error ? error.message : "Amazon 折扣預檢未通過。",
      );
    } finally {
      setSaleLoading(false);
    }
  };

  const submitSale = async () => {
    if (!listing || !validation || !idempotencyKey) return;
    if (requiresExactSku && confirmationSku !== listing.sellerSku) return;
    setSaleLoading(true);
    setSaleError(null);
    try {
      const response = await fetch("/api/sp-api/sale-price", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saleBody(saleAction)),
      });
      const payload = (await response.json()) as SaleResult | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "Amazon 未接受這次折扣更新。"),
        );
      }
      setSaleResult(payload as SaleResult);
      setSalePhase("result");
      setRecheckState((payload as SaleResult).mode === "demo" ? "effective" : "processing");
    } catch (error) {
      setSaleError(
        error instanceof Error ? error.message : "Amazon 未接受這次折扣更新。",
      );
    } finally {
      setSaleLoading(false);
    }
  };

  const recheckSale = useCallback(async () => {
    if (!listing || !saleResult) return;
    setSaleLoading(true);
    setSaleError(null);
    try {
      const refreshed = await fetchListing(listing.sellerSku);
      setListing(refreshed);
      const expected = saleResult.requestedDiscountedPrice;
      const blockingIssues = (refreshed.issues ?? []).filter(
        (issue) => issue.severity.toUpperCase() === "ERROR",
      );
      const confirmed =
        blockingIssues.length === 0 &&
        (saleResult.action === "cancel"
          ? !refreshed.discountedPrice
          : Boolean(
              expected &&
                refreshed.discountedPrice &&
                refreshed.discountedPrice.price.amount === expected.price.amount &&
                refreshed.discountedPrice.startAt === expected.startAt &&
                refreshed.discountedPrice.endAt === expected.endAt,
            ));
      setRecheckState(confirmed ? "effective" : "processing");
      if (blockingIssues.length) {
        setSaleError(
          `Amazon 尚未完成這筆折扣：${blockingIssues[0].message}（請先修正 Listing issue）`,
        );
      }
    } catch (error) {
      setSaleError(error instanceof Error ? error.message : "重新查詢失敗。");
    } finally {
      setSaleLoading(false);
    }
  }, [fetchListing, listing, saleResult]);

  useEffect(() => {
    if (
      salePhase !== "result" ||
      saleResult?.mode !== "live" ||
      !idempotencyKey ||
      autoRecheckRef.current === idempotencyKey
    ) {
      return;
    }
    autoRecheckRef.current = idempotencyKey;
    const timeout = window.setTimeout(() => void recheckSale(), 4_000);
    return () => window.clearTimeout(timeout);
  }, [idempotencyKey, recheckSale, salePhase, saleResult?.mode]);

  const lookupSns = async (event?: FormEvent) => {
    event?.preventDefault();
    const sellerSku = snsSku.trim();
    if (!sellerSku) return setSnsError("請輸入完整 Seller SKU。");
    if (!marketplace.snsSupported) {
      return setSnsError("此站點目前不在 Amazon 公開的 Seller Replenishment API 支援清單。");
    }
    setSnsLoading(true);
    setSnsError(null);
    setSnsResult(null);
    try {
      const params = new URLSearchParams({ marketplaceId, sku: sellerSku });
      const response = await fetch(`/api/sp-api/subscribe-save?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | SubscribeSaveSnapshot
        | ApiProblem;
      if (!response.ok) {
        throw new Error(
          problemMessage(payload as ApiProblem, "目前無法查詢 Subscribe & Save。"),
        );
      }
      setSnsResult(payload as SubscribeSaveSnapshot);
    } catch (error) {
      setSnsError(
        error instanceof Error ? error.message : "目前無法查詢 Subscribe & Save。",
      );
    } finally {
      setSnsLoading(false);
    }
  };

  const copyCouponPlan = async () => {
    const summary = [
      `Amazon Coupon 設定摘要`,
      `站點：${marketplace.label}`,
      `SKU：${couponSku.trim() || "尚未填寫"}`,
      `折扣：${couponValue || "—"}${couponType === "percent" ? "%" : ` ${marketplace.currency}`}`,
      `預算：${couponBudget || "—"} ${marketplace.currency}`,
      `期間：${couponStart} ～ ${couponEnd}`,
      `提醒：此摘要尚未送出，需在 Seller Central 完成資格與費用確認。`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDrawer();
      }}
    >
      <aside
        className="order-drawer promotion-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-drawer-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">PROMOTION CENTER</p>
            <h2 id="promotion-drawer-title">促銷中心</h2>
          </div>
          <button type="button" onClick={closeDrawer} aria-label="關閉促銷中心">
            ×
          </button>
        </div>
        <p className="price-intro promotion-intro">
          限時折扣價可直接寫入 Amazon；Coupon 會整理設定並開啟官方頁完成。訂閱省已整合到「定價與訂閱」。
        </p>
        <div className="automation-summary"><span className="automation-badge automatic">自動</span><p>全域 SKU 開啟即查；折扣幅度、日期、價格上下限與送出後回查由系統處理。</p><span className="automation-badge one_click">一鍵</span><p>一般限時售價會自動預檢、建立並回查；達 20% 或 Amazon 有提醒才停下確認。</p><span className="automation-badge manual">需人工</span><p>取消折扣、Coupon 資格／費用與最終 Coupon 建立需由你確認。</p></div>

        <nav className="promotion-tabs" aria-label="促銷工具">
          <button
            className={tab === "sale" ? "active" : ""}
            type="button"
            onClick={() => setTab("sale")}
          >
            限時折扣 <small>API 可建立</small>
          </button>
          <button
            className={tab === "coupon" ? "active" : ""}
            type="button"
            onClick={() => setTab("coupon")}
          >
            Coupon <small>官方頁完成</small>
          </button>
        </nav>

        <label className="promotion-marketplace">
          <span>Amazon 站點</span>
          <select
            value={marketplaceId}
            onChange={(event) => changeMarketplace(event.target.value)}
            disabled={saleLoading || snsLoading}
          >
            {MARKETPLACES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {tab === "sale" && (
          <section className="promotion-panel" aria-label="限時折扣價">
            {salePhase === "edit" && (
              <>
                <div className="capability-banner success">
                  <span>✓</span>
                  <div>
                    <strong>真正由 Listings Items API 建立</strong>
                    <p>只更新 discounted_price，不改標準價、B2B、最低價或自動調價規則。</p>
                  </div>
                </div>
                <form className="promotion-search" onSubmit={lookupSale}>
                  <label>
                    <span>Seller SKU</span>
                    <div className="sku-search-row">
                      <input
                        value={saleSku}
                        onChange={(event) => {
                          setSaleSku(event.target.value);
                          setListing(null);
                          setValidation(null);
                          setSaleResult(null);
                          setSalePhase("edit");
                          setRecheckState("pending");
                        }}
                        placeholder={`例如 ${marketplace.sample}`}
                        autoComplete="off"
                        disabled={saleLoading}
                      />
                      <button type="submit" disabled={saleLoading}>
                        {saleLoading ? "查詢中" : "查 SKU"}
                      </button>
                    </div>
                  </label>
                </form>
                {saleError && <div className="price-error" role="alert">{saleError}</div>}
                {listing && (
                  <div className="promotion-listing">
                    <div className="promotion-product">
                      <div className="listing-avatar" aria-hidden="true">
                        {listing.title.slice(0, 1)}
                      </div>
                      <div>
                        <strong>{listing.title}</strong>
                        <p>{listing.sellerSku} · {listing.asin ?? "—"}</p>
                      </div>
                      <span className={`listing-mode ${listing.mode}`}>{listing.mode}</span>
                    </div>
                    <dl className="promotion-price-facts">
                      <div>
                        <dt>標準售價</dt>
                        <dd>{formatMoney(listing.standardPrice)}</dd>
                      </div>
                      <div>
                        <dt>目前限時折扣</dt>
                        <dd>{formatMoney(listing.discountedPrice?.price ?? null)}</dd>
                        {listing.discountedPrice && (
                          <small>{listing.discountedPrice.startAt ?? "—"} ～ {listing.discountedPrice.endAt ?? "—"}</small>
                        )}
                      </div>
                    </dl>
                    <div className="sale-editor">
                      <label>
                        <span>折扣價</span>
                        <div className="price-input-row">
                          <b>{marketplace.currency}</b>
                          <input
                            inputMode="decimal"
                            value={salePrice}
                            onChange={(event) => setSalePrice(event.target.value)}
                            placeholder={marketplace.currency === "JPY" ? "1480" : "11.99"}
                          />
                        </div>
                      </label>
                      <div className="sale-date-grid">
                        <label>
                          <span>開始日</span>
                          <input type="date" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
                        </label>
                        <label>
                          <span>結束日</span>
                          <input type="date" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
                        </label>
                      </div>
                      {saleFieldError && <small className="field-error">{saleFieldError}</small>}
                      {discountRatio !== null && discountRatio > 0 && (
                        <div className={`sale-discount-preview ${discountRatio >= 0.2 ? "large" : ""}`}>
                          <span>折扣幅度</span>
                          <strong>{(discountRatio * 100).toFixed(1)}% off</strong>
                        </div>
                      )}
                      <button
                        className="price-primary-button"
                        type="button"
                        onClick={() => void previewSale("set")}
                        disabled={Boolean(saleFieldError) || parsedSalePrice === null || saleLoading}
                      >
                        {saleLoading ? "安全處理中…" : "安全一鍵建立限時售價"}
                      </button>
                      {listing.discountedPrice && (
                        <button
                          className="secondary-wide-button sale-cancel-button"
                          type="button"
                          onClick={() => void previewSale("cancel")}
                          disabled={saleLoading}
                        >
                          預檢取消目前折扣
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {salePhase === "confirm" && validation && listing && (
              <div className="promotion-confirmation">
                <button
                  className="back-link"
                  type="button"
                  onClick={() => {
                    setSalePhase("edit");
                    setValidation(null);
                    setConfirmationSku("");
                  }}
                >
                  ← 返回修改
                </button>
                <p className="eyebrow">FINAL CONFIRMATION</p>
                <h3>{saleAction === "cancel" ? "確認取消限時折扣" : "確認建立限時折扣"}</h3>
                <p className="confirmation-product">{listing.sellerSku} · {marketplace.label}</p>
                <div className="sale-confirm-card">
                  <div>
                    <span>標準售價</span>
                    <strong>{formatMoney(validation.standardPrice)}</strong>
                  </div>
                  <i>→</i>
                  <div>
                    <span>{saleAction === "cancel" ? "取消後" : "限時折扣"}</span>
                    <strong>{formatMoney(validation.requestedDiscountedPrice?.price ?? validation.standardPrice)}</strong>
                  </div>
                </div>
                {validation.requestedDiscountedPrice && (
                  <div className="sale-period-confirm">
                    Amazon 站點日期 · {validation.requestedDiscountedPrice.startAt} ～ {validation.requestedDiscountedPrice.endAt}
                  </div>
                )}
                <div className={`validation-status ${validation.mode === "demo" ? "demo" : ""}`}>
                  <strong>{validation.mode === "demo" ? "展示預檢通過" : "Amazon Validation Preview 通過"}</strong>
                  <p>{validation.notice}</p>
                </div>
                {validation.issues.length > 0 && (
                  <div className="validation-issues">
                    <strong>Amazon 回傳 {validation.issues.length} 個提醒</strong>
                    {validation.issues.map((issue, index) => (
                      <p key={`${issue.code ?? "issue"}-${index}`}>{issue.message}</p>
                    ))}
                  </div>
                )}
                {requiresExactSku && (
                  <label className="confirmation-input">
                    <span>再次輸入完整 SKU：{listing.sellerSku}</span>
                    <input
                      value={confirmationSku}
                      onChange={(event) => setConfirmationSku(event.target.value)}
                      autoComplete="off"
                    />
                    {confirmationSku && confirmationSku !== listing.sellerSku && <small>SKU 尚未完全相符</small>}
                  </label>
                )}
                {saleError && <div className="price-error" role="alert">{saleError}</div>}
                <button
                  className={`price-primary-button ${saleAction === "cancel" ? "danger-button" : ""}`}
                  type="button"
                  onClick={() => void submitSale()}
                  disabled={saleLoading || (requiresExactSku && confirmationSku !== listing.sellerSku)}
                >
                  {saleLoading
                    ? "送出中…"
                    : saleAction === "cancel"
                      ? "確認取消折扣"
                      : "確認建立限時折扣"}
                </button>
                <p className="submission-note">送出後 Amazon 會非同步處理；看到重新查詢確認才代表生效。</p>
              </div>
            )}

            {salePhase === "result" && saleResult && listing && (
              <div className="promotion-result">
                <div className={`result-icon ${saleResult.mode === "demo" ? "demo" : recheckState === "effective" ? "effective" : ""}`}>
                  {recheckState === "effective" ? "✓" : "↻"}
                </div>
                <p className="eyebrow">{recheckState === "effective" ? "CONFIRMED" : "PROCESSING"}</p>
                <h3>
                  {recheckState === "effective"
                    ? saleResult.action === "cancel"
                      ? "折扣已取消"
                      : "限時折扣已確認"
                    : "Amazon 已接受，等待生效"}
                </h3>
                <p>{saleResult.notice}</p>
                <div className="result-price-card">
                  <span>{listing.sellerSku}</span>
                  <strong>{formatMoney(saleResult.requestedDiscountedPrice?.price ?? saleResult.standardPrice)}</strong>
                  <small>{saleResult.requestedDiscountedPrice ? `${saleResult.requestedDiscountedPrice.startAt} ～ ${saleResult.requestedDiscountedPrice.endAt}` : "已恢復標準售價"}</small>
                </div>
                {saleError && <div className="price-error" role="alert">{saleError}</div>}
                <button className="price-primary-button" type="button" onClick={() => void recheckSale()} disabled={saleLoading}>
                  {saleLoading ? "查詢中…" : "立即再查一次"}
                </button>
                <button className="secondary-wide-button" type="button" onClick={resetSale}>處理另一個 SKU</button>
              </div>
            )}
          </section>
        )}

        {tab === "coupon" && (
          <section className="promotion-panel" aria-label="Coupon 設定接手">
            <div className="capability-banner boundary">
              <span>!</span>
              <div>
                <strong>Amazon 尚未提供 Coupon 建立 API</strong>
                <p>此頁幫你備妥設定並開啟正確站點，不會使用未公開的 Seller Central 內部接口。</p>
              </div>
            </div>
            <div className="coupon-planner">
              <div className="coupon-grid two">
                <label>
                  <span>Seller SKU</span>
                  <input value={couponSku} onChange={(event) => setCouponSku(event.target.value)} placeholder={marketplace.sample} />
                </label>
                <label>
                  <span>折扣類型</span>
                  <select value={couponType} onChange={(event) => setCouponType(event.target.value as "percent" | "amount")}>
                    <option value="percent">百分比折扣</option>
                    <option value="amount">固定金額折扣</option>
                  </select>
                </label>
              </div>
              <div className="coupon-grid two">
                <label>
                  <span>{couponType === "percent" ? "折扣百分比" : `折扣金額（${marketplace.currency}）`}</span>
                  <input inputMode="decimal" value={couponValue} onChange={(event) => setCouponValue(event.target.value)} />
                </label>
                <label>
                  <span>活動預算（{marketplace.currency}）</span>
                  <input inputMode="decimal" value={couponBudget} onChange={(event) => setCouponBudget(event.target.value)} />
                </label>
              </div>
              <div className="coupon-grid two">
                <label>
                  <span>開始日</span>
                  <input type="date" value={couponStart} onChange={(event) => setCouponStart(event.target.value)} />
                </label>
                <label>
                  <span>結束日</span>
                  <input type="date" value={couponEnd} onChange={(event) => setCouponEnd(event.target.value)} />
                </label>
              </div>
              <button className="secondary-wide-button" type="button" onClick={() => void copyCouponPlan()}>
                {copyState === "copied" ? "✓ 已複製設定摘要" : "複製 Coupon 設定摘要"}
              </button>
              {copyState === "error" && <div className="price-error" role="alert">瀏覽器無法複製；請手動記下上方設定。</div>}
              <a className="promotion-external-button" href={marketplace.sellerCentral} target="_blank" rel="noreferrer">
                前往 Amazon 建立 Coupon ↗
              </a>
              <ol className="handoff-steps">
                <li><span>1</span><p>在 Seller Central 進入 Advertising / Coupons。</p></li>
                <li><span>2</span><p>貼上 SKU，依上方摘要輸入折扣、預算與期間。</p></li>
                <li><span>3</span><p>再次確認資格、Coupon 費用與 Amazon 顯示預覽後送出。</p></li>
              </ol>
            </div>
          </section>
        )}

        {tab === "sns" && (
          <section className="promotion-panel" aria-label="Subscribe and Save 狀態">
            <div className="capability-banner info">
              <span>i</span>
              <div>
                <strong>Replenishment API 可直接查狀態，但不能啟用或改折扣</strong>
                <p>查到資格、訂閱數與庫存風險後，再由 Amazon 官方頁完成管理。</p>
              </div>
            </div>
            <form className="promotion-search" onSubmit={lookupSns}>
              <label>
                <span>Seller SKU</span>
                <div className="sku-search-row">
                  <input value={snsSku} onChange={(event) => setSnsSku(event.target.value)} placeholder={`例如 ${marketplace.snsSample}`} autoComplete="off" />
                  <button type="submit" disabled={snsLoading || !marketplace.snsSupported}>
                    {snsLoading ? "查詢中" : "查訂閱狀態"}
                  </button>
                </div>
              </label>
            </form>
            {!marketplace.snsSupported && <div className="price-warning compact"><strong>此站點不支援 Seller 查詢</strong><p>Amazon 公開模型目前未把這個站點列為 Seller Replenishment API 支援市場。</p></div>}
            {snsError && <div className="price-error" role="alert">{snsError}</div>}
            {snsResult && !snsResult.found && (
              <div className="sns-empty">
                <span>?</span>
                <strong>Amazon 未回傳此 SKU 的訂閱 offer</strong>
                <p>{snsResult.notice}</p>
                <a href={marketplace.snsManage} target="_blank" rel="noreferrer">前往 Amazon 查資格／申請加入 ↗</a>
              </div>
            )}
            {snsResult?.found && (
              <div className="sns-result">
                <div className="sns-heading">
                  <div>
                    <p className="eyebrow">{snsResult.mode === "demo" ? "DEMO OFFER" : "LIVE OFFER"}</p>
                    <h3>{snsResult.sellerSku}</h3>
                    <small>{snsResult.asin ?? "—"}</small>
                  </div>
                  <span className={`sns-eligibility ${(snsResult.eligibility ?? "").toLowerCase()}`}>
                    {ELIGIBILITY_LABELS[snsResult.eligibility ?? ""] ?? snsResult.eligibility ?? "未知"}
                  </span>
                </div>
                <dl className="sns-facts">
                  <div><dt>有效訂閱</dt><dd>{snsResult.subscriptions ?? "—"}</dd></div>
                  <div><dt>可售庫存</dt><dd>{snsResult.inventory ?? "—"}</dd></div>
                  <div><dt>目前售價</dt><dd>{formatMoney(snsResult.price)}</dd></div>
                  <div><dt>缺貨風險</dt><dd>{snsResult.stockRisk ?? "—"}</dd></div>
                </dl>
                <div className="sns-config-grid">
                  <div><span>加入方式</span><strong>{snsResult.enrollmentMethod === "AUTOMATIC" ? "自動加入" : snsResult.enrollmentMethod === "MANUAL" ? "手動加入" : "—"}</strong></div>
                  <div><span>Auto enrollment</span><strong>{snsResult.autoEnrollment === "OPTED_IN" ? "已開啟" : snsResult.autoEnrollment === "OPTED_OUT" ? "已關閉" : "—"}</strong></div>
                  <div><span>賣家出資 Base</span><strong>{snsResult.sellerFundedBaseDiscount ?? "—"}%</strong></div>
                  <div><span>賣家出資 Tiered</span><strong>{snsResult.sellerFundedTieredDiscount ?? "—"}%</strong></div>
                  <div><span>Amazon 出資 Base</span><strong>{snsResult.amazonFundedBaseDiscount ?? "—"}%</strong></div>
                  <div><span>Amazon 出資 Tiered</span><strong>{snsResult.amazonFundedTieredDiscount ?? "—"}%</strong></div>
                </div>
                {snsResult.forecastDeliveries && (
                  <div className="sns-forecast">
                    <div><span>15 天</span><strong>{snsResult.forecastDeliveries.next15Days ?? "—"}</strong></div>
                    <div><span>30 天</span><strong>{snsResult.forecastDeliveries.next30Days ?? "—"}</strong></div>
                    <div><span>60 天</span><strong>{snsResult.forecastDeliveries.next60Days ?? "—"}</strong></div>
                    <div><span>90 天</span><strong>{snsResult.forecastDeliveries.next90Days ?? "—"}</strong></div>
                  </div>
                )}
                {snsResult.deliveryConditions.map((condition) => (
                  <div className={`sns-risk ${condition.condition === "NO_ISSUES_FOR_NEXT_30_DAYS_DELIVERIES" ? "good" : "warn"}`} key={condition.condition}>
                    <strong>{CONDITION_LABELS[condition.condition] ?? condition.condition}</strong>
                    <span>{condition.next30DaysDeliveries ?? "—"} 次預計配送</span>
                  </div>
                ))}
                <p className="sns-notice">{snsResult.notice}</p>
                <a className="promotion-external-button" href={marketplace.snsManage} target="_blank" rel="noreferrer">
                  前往 Amazon 管理／申請加入 ↗
                </a>
              </div>
            )}
          </section>
        )}

        <div className="promotion-source-note">
          <strong>能力邊界</strong>
          <span>Listings Items v2021-08-01 · Coupon 無公開寫入 API · 不使用 Seller Central 私有接口</span>
        </div>
      </aside>
    </div>
  );
}
