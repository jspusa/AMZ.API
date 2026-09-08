import { createHash } from "node:crypto";
import type { PriceHealthMoney, PriceHealthReference, PriceHealthRow, PriceHealthSegment, PriceHealthSnapshot } from "../../shared/price-health";
import { marketplaceById } from "../../shared/marketplaces";
import { throwIfAborted } from "../abort-utils";
import type { OperationsReadInput } from "./operations-read-context";
import type { SpExecutionContext, SpExecutionContextAdapter } from "./sp-execution-context";
import { SpApiError } from "./sp-api-error";

/** Main-private semantic batch; no caller-supplied URL, method, token or body. */
export type PriceHealthBatchPlan = Readonly<{
  context: SpExecutionContext;
  asins: readonly string[];
  signal: AbortSignal;
  beforeDispatch(): Promise<void>;
}>;
export type PriceHealthReadAdapter = Readonly<{
  readCompetitiveSummary(plan: PriceHealthBatchPlan): Promise<Readonly<{
    payload: unknown;
    /** Remains main-only; only a comparison boolean is projected publicly. */
    ownSellerId: string | null;
  }>>;
}>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function money(value: unknown, currency: string): PriceHealthMoney | null {
  const data = record(value);
  return typeof data.amount === "number" && Number.isFinite(data.amount) &&
    data.amount >= 0 && data.currencyCode === currency
    ? { amount: data.amount, currencyCode: currency } : null;
}

function unavailable(identity: { sellerSku: string; asin: string }, warning: string): PriceHealthRow {
  return {
    ...identity, status: "insufficient-evidence", availability: "unavailable",
    currentPrice: null, overallEligibility: "unknown", featuredObservation: "unknown",
    segments: [], referencePrices: [], warnings: [warning]
  };
}

function failure(status: unknown): string {
  if (status === 401 || status === 403) return "價格資料權限不足；請核對 Product Pricing 授權。";
  if (status === 429) return "Amazon 價格 API 限流；此次未取得該商品資料。";
  return "Amazon 未提供可驗證的商品價格資料；請稍後重新同步。";
}

export class PriceHealthReads {
  constructor(private readonly dependencies: Readonly<{
    adapter: PriceHealthReadAdapter;
    context: SpExecutionContextAdapter;
  }>) { }

  async read(input: OperationsReadInput): Promise<PriceHealthSnapshot> {
    if (!Array.isArray(input.fba) || input.fba.length > 10_000 || input.fba.some(identity =>
      !identity || typeof identity.sellerSku !== "string" || !identity.sellerSku || identity.sellerSku.length > 200 ||
      identity.sellerSku !== identity.sellerSku.trim() || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(identity.sellerSku) ||
      typeof identity.asin !== "string" || !/^[A-Z0-9]{10}$/u.test(identity.asin)) ||
      new Set(input.fba.map(identity => identity.sellerSku)).size !== input.fba.length) {
      throw new SpApiError("價格健檢需要不重複且完整的目前 FBA 商品身分。", { status: 409, code: "LISTING_IDENTITY_MISMATCH" });
    }
    input = { ...input, fba: input.fba.map(identity => ({ sellerSku: identity.sellerSku, asin: identity.asin })) };
    const fence = async () => {
      throwIfAborted(input.signal);
      await this.dependencies.context.assertCurrent(input.context);
      throwIfAborted(input.signal);
    };
    await fence();
    if (input.context.mode === "demo") {
      const warning = "展示模式未提供價格健康範例；未連線 Amazon，也不產生真實價格判斷。";
      return {
        marketplaceId: input.context.marketplaceId, mode: "demo", fetchedAt: new Date().toISOString(),
        coverage: "partial", warnings: [warning], findings: [], rows: input.fba.map(identity => unavailable(identity, warning))
      };
    }
    const currency = marketplaceById(input.context.marketplaceId)!.currency;
    const byAsin = new Map<string, { response: unknown; ownSellerId: string | null }>();
    const asins = [...new Set(input.fba.map(row => row.asin))];
    let stopped = false;
    for (let offset = 0; offset < Math.min(asins.length, 400); offset += 20) {
      await fence();
      const batch = asins.slice(offset, offset + 20);
      const result = await this.dependencies.adapter.readCompetitiveSummary({
        context: input.context, asins: batch, signal: input.signal, beforeDispatch: fence,
      }).catch(async (error: unknown) => {
        await fence();
        throw error;
      });
      await fence();
      const responses = record(result.payload).responses;
      if (!Array.isArray(responses) || responses.length > 20) {
        throw new SpApiError("Amazon 價格批次回應格式不完整。", { status: 502, code: "PRICE_HEALTH_UNAVAILABLE" });
      }
      for (const response of responses) {
        const body = record(record(response).body);
        if (typeof body.asin !== "string" || !batch.includes(body.asin) ||
          body.marketplaceId !== input.context.marketplaceId || byAsin.has(body.asin)) {
          throw new SpApiError("Amazon 價格回應的商品或站點身分不一致。", { status: 502, code: "PRICE_HEALTH_IDENTITY_MISMATCH" });
        }
        byAsin.set(body.asin, { response, ownSellerId: result.ownSellerId });
        const status = record(record(response).status).statusCode;
        if (status === 401 || status === 403 || status === 429 || (typeof status === "number" && status >= 500)) stopped = true;
      }
      if (stopped) break;
    }
    const rows: PriceHealthRow[] = input.fba.map(identity => {
      const result = byAsin.get(identity.asin);
      const response = result?.response;
      const status = record(record(response).status).statusCode;
      if (status !== 200) {
        const warning = !result && stopped
          ? "先前批次遇到權限、限流或服務錯誤，後續商品未送出讀取。"
          : !result && asins.indexOf(identity.asin) >= 400
            ? "此次已達 400 個 ASIN 安全讀取上限，該商品尚未讀取。"
            : failure(status);
        return unavailable(identity, warning);
      }
      const body = record(record(response).body);
      const segments: PriceHealthSegment[] = [];
      const warnings: string[] = [];
      const warn = () => {
        if (!warnings.length) warnings.push("部分價格或 Featured Offer 分段資料未回報或無法核對。");
      };
      const array = (value: unknown, max = 100): unknown[] => {
        if (!Array.isArray(value) || value.length > max) { warn(); return []; }
        return value;
      };
      for (const option of array(body.featuredBuyingOptions, 20)) {
        if (record(option).buyingOptionType !== "New") { warn(); continue; }
        for (const offer of array(record(option).segmentedFeaturedOffers)) {
          const data = record(offer);
          if (data.condition !== "New" || (data.fulfillmentType !== "AFN" && data.fulfillmentType !== "MFN") ||
            typeof data.sellerId !== "string" || data.sellerId.length === 0 || data.sellerId !== data.sellerId.trim()) {
            warn(); continue;
          }
          const listingPrice = money(data.listingPrice, currency);
          if (!listingPrice) warn();
          let shippingPrice: PriceHealthMoney | null = null;
          if (data.shippingOptions !== undefined) {
            const options = array(data.shippingOptions, 20);
            const defaults = options.filter(value => record(value).shippingOptionType === "DEFAULT");
            if (defaults.length === 1) shippingPrice = money(record(defaults[0]).price, currency);
            if (!shippingPrice || defaults.length !== options.length) warn();
          }
          for (const segment of array(data.featuredOfferSegments)) {
            if (segments.length >= 200) { warn(); break; }
            const membership = record(segment).customerMembership;
            if (membership !== "PRIME" && membership !== "NON_PRIME" && membership !== "DEFAULT") { warn(); continue; }
            if (!record(segment).segmentDetails || typeof record(segment).segmentDetails !== "object" || Array.isArray(record(segment).segmentDetails)) { warn(); continue; }
            const rawWeight = record(record(segment).segmentDetails).glanceViewWeightPercentage;
            const weight = typeof rawWeight === "number" && Number.isFinite(rawWeight) && rawWeight >= 0 && rawWeight <= 100 ? rawWeight : null;
            if (rawWeight !== undefined && weight === null) warn();
            if (!result?.ownSellerId) warn();
            segments.push({
              membership,
              isOwnSeller: result?.ownSellerId && typeof data.sellerId === "string" ? data.sellerId === result.ownSellerId : null,
              fulfillment: data.fulfillmentType === "AFN" || data.fulfillmentType === "MFN" ? data.fulfillmentType : "unknown",
              listingPrice, shippingPrice,
              glanceViewWeightPercentage: weight,
            });
          }
        }
      }
      const own = segments.some(segment => segment.isOwnSeller === true && segment.fulfillment === "AFN");
      const other = segments.some(segment => segment.isOwnSeller === false);
      if (segments.some(segment => segment.isOwnSeller === true && segment.fulfillment !== "AFN")) {
        warnings.push("已見本帳號非 FBA 的 Featured Offer 分段；不能作為本 SKU 的 FBA 得標證據。");
      }
      if (!segments.length) warn();
      if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length)) warn();
      const referenceByName = new Map<PriceHealthReference["name"], PriceHealthReference>();
      for (const value of array(body.referencePrices, 30)) {
        const ref = record(value);
        const name = ref.name === "CompetitivePriceThreshold" || ref.name === "CompetitivePrice" || ref.name === "WasPrice" ? ref.name : "unknown" as const;
        const price = money(ref.price, currency);
        if (name === "unknown" || !price) warn();
        if (referenceByName.has(name)) {
          warn();
          referenceByName.set(name, { name, price: null });
        } else referenceByName.set(name, { name, price });
      }
      const referencePrices = [...referenceByName.values()];
      return {
        ...identity, status: other ? "needs-review" : own ? "observed" : "insufficient-evidence",
        availability: warnings.length ? "partial" : "complete", currentPrice: null, overallEligibility: "unknown",
        featuredObservation: own && other ? "mixed-observed" : own ? "own-observed" : other ? "other-observed" : "unknown",
        segments,
        referencePrices, warnings,
      };
    });
    return {
      marketplaceId: input.context.marketplaceId, mode: input.context.mode,
      fetchedAt: new Date().toISOString(), coverage: rows.every(row => row.availability === "complete") ? "complete" : "partial", rows,
      warnings: [
        "Featured Offer 僅為已回傳 ASIN 分段的觀察；同 ASIN 多個 SKU 不等於各 SKU 皆得標，不代表整體 Buy Box 資格，也不能判定外部通路造成價格問題。",
        "未讀取同次自身 SKU 售價；參考價不是自動調價建議。",
        ...(asins.length > 400 ? ["此次最多讀取 400 個 ASIN，超出範圍保留為未完成。"] : []),
        ...(stopped ? ["因批次項目權限、限流或服務異常，後續讀取已停止。"] : []),
      ],
      findings: rows.filter(row => row.status === "needs-review").map(row => ({
        key: `price-health-featured:${createHash("sha256").update(JSON.stringify([row.sellerSku, row.asin])).digest("hex").slice(0, 24)}`,
        source: "price-health", sellerSku: row.sellerSku,
        severity: "warning", title: "Featured Offer 分段需核對",
        detail: "Amazon 已回傳的部分分段由其他賣家取得 Featured Offer；請核對，不能據此斷定整體 Buy Box 資格。",
      })),
    };
  }
}
