import { throwIfAborted } from "../abort-utils";
import {
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import { demoFbaCatalogRows } from "./demo-fba-catalog";
import { SpApiError } from "./sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
  SpExecutionMode,
} from "./sp-execution-context";

const DAY_MS = 86_400_000;

const ORDER_FULFILLMENT_STATUSES = Object.freeze([
  "PENDING_AVAILABILITY",
  "PENDING",
  "UNSHIPPED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "CANCELLED",
  "UNFULFILLABLE",
] as const);

export type OrderFulfillmentStatus =
  (typeof ORDER_FULFILLMENT_STATUSES)[number];

const ORDER_FULFILLMENT_STATUS_SET: ReadonlySet<string> = new Set(
  ORDER_FULFILLMENT_STATUSES,
);

export function isOrderFulfillmentStatus(
  value: string,
): value is OrderFulfillmentStatus {
  return ORDER_FULFILLMENT_STATUS_SET.has(value);
}

export type Money = {
  amount: number;
  currencyCode: string;
};

export type DashboardOrderItem = {
  orderItemId: string;
  asin: string;
  sellerSku: string;
  title: string;
  quantity: number;
  unitPrice: Money | null;
  lineTotal: Money | null;
};

export type DashboardOrder = {
  orderId: string;
  createdTime: string;
  lastUpdatedTime: string;
  marketplaceId: string;
  marketplaceName: string;
  programs: string[];
  fulfillmentStatus: string;
  fulfilledBy: string;
  fulfillmentServiceLevel: string;
  shipBy: string | null;
  deliverBy: string | null;
  total: Money | null;
  items: DashboardOrderItem[];
};

export type OrdersSnapshot = {
  mode: "live" | "demo";
  orders: DashboardOrder[];
  marketplaceId: string;
  fetchedAt: string;
  nextToken: string | null;
  lastUpdatedBefore: string | null;
  requestId: string | null;
  rateLimit: string | null;
  notice: string | null;
};

export type DashboardOrdersReadInput = Readonly<{
  intent: "dashboard-page";
  marketplaceId: MarketplaceId;
  days: number;
  fulfillmentStatus: OrderFulfillmentStatus | null;
  paginationToken: string | null;
  signal?: AbortSignal;
}>;

export type OrdersConnectionProbeInput = Readonly<{
  intent: "connection-probe";
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>;

export type OrdersReadInput =
  | DashboardOrdersReadInput
  | OrdersConnectionProbeInput;

export interface OrdersReadsPort {
  read(input: OrdersReadInput): Promise<OrdersSnapshot>;
}

export type OrdersReadIntent = OrdersReadInput["intent"];

export type OrdersPagePlan = Readonly<{
  intent: OrdersReadIntent;
  marketplaceId: MarketplaceId;
  lastUpdatedAfter: string;
  fulfillmentStatus: OrderFulfillmentStatus | null;
  paginationToken: string | null;
  expectedMode: SpExecutionMode;
  signal?: AbortSignal;
}>;

export type OrdersPageResult = Readonly<{
  status: number;
  payload: unknown;
  requestId: string | null;
  rateLimit: string | null;
  retryAfter: string | null;
}>;

/** Fixed Orders read seam; transport details are deliberately not expressible. */
export interface OrdersPageAdapter {
  read(plan: OrdersPagePlan): Promise<OrdersPageResult>;
}

type AmazonMoney = {
  amount?: string | number;
  currencyCode?: string;
};

type AmazonOrderItem = {
  orderItemId?: string;
  quantityOrdered?: number;
  product?: {
    asin?: string;
    title?: string;
    sellerSku?: string;
    price?: { unitPrice?: AmazonMoney };
  };
  proceeds?: { proceedsTotal?: AmazonMoney };
};

type AmazonOrder = {
  orderId?: string;
  createdTime?: string;
  lastUpdatedTime?: string;
  programs?: string[];
  salesChannel?: {
    marketplaceId?: string;
    marketplaceName?: string;
  };
  proceeds?: { grandTotal?: AmazonMoney };
  fulfillment?: {
    fulfillmentStatus?: string;
    fulfilledBy?: string;
    fulfillmentServiceLevel?: string;
    shipByWindow?: { latestDateTime?: string };
    deliverByWindow?: { latestDateTime?: string };
  };
  orderItems?: AmazonOrderItem[];
};

type SearchOrdersResponse = {
  orders?: AmazonOrder[];
  pagination?: { nextToken?: string };
  lastUpdatedBefore?: string;
};

function parseMoney(value: AmazonMoney | undefined): Money | null {
  const amount = Number(value?.amount);
  if (!Number.isFinite(amount) || !value?.currencyCode) return null;
  return { amount, currencyCode: value.currencyCode };
}

function safeText(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeOrders(
  orders: AmazonOrder[] | undefined,
  fallbackMarketplaceId: MarketplaceId,
): DashboardOrder[] {
  const marketplace = marketplaceById(fallbackMarketplaceId);
  if (!marketplace) throw new TypeError("Amazon marketplace is invalid.");

  return (orders ?? []).map((order, orderIndex) => {
    const items = (order.orderItems ?? []).map((item, itemIndex) => {
      const unitPrice = parseMoney(item.product?.price?.unitPrice);
      const quantity = Number.isFinite(item.quantityOrdered)
        ? Math.max(0, Number(item.quantityOrdered))
        : 0;
      const suppliedLineTotal = parseMoney(item.proceeds?.proceedsTotal);
      const lineTotal = suppliedLineTotal ??
        (unitPrice
          ? {
              amount: unitPrice.amount * quantity,
              currencyCode: unitPrice.currencyCode,
            }
          : null);

      return {
        orderItemId: safeText(
          item.orderItemId,
          `item-${orderIndex + 1}-${itemIndex + 1}`,
        ),
        asin: safeText(item.product?.asin, "—"),
        sellerSku: safeText(item.product?.sellerSku, "—"),
        title: safeText(item.product?.title, "未提供商品名稱"),
        quantity,
        unitPrice,
        lineTotal,
      };
    });

    const calculatedTotal = items.reduce<Money | null>((total, item) => {
      if (!item.lineTotal) return total;
      if (!total) return { ...item.lineTotal };
      if (total.currencyCode !== item.lineTotal.currencyCode) return total;
      return {
        amount: total.amount + item.lineTotal.amount,
        currencyCode: total.currencyCode,
      };
    }, null);

    return {
      orderId: safeText(order.orderId, `unknown-${orderIndex + 1}`),
      createdTime: safeText(order.createdTime, new Date(0).toISOString()),
      lastUpdatedTime: safeText(
        order.lastUpdatedTime,
        safeText(order.createdTime, new Date(0).toISOString()),
      ),
      marketplaceId: safeText(
        order.salesChannel?.marketplaceId,
        fallbackMarketplaceId,
      ),
      marketplaceName: safeText(
        order.salesChannel?.marketplaceName,
        marketplace.name,
      ),
      programs: Array.isArray(order.programs) ? order.programs : [],
      fulfillmentStatus: safeText(
        order.fulfillment?.fulfillmentStatus,
        "UNKNOWN",
      ),
      fulfilledBy: safeText(order.fulfillment?.fulfilledBy, "UNKNOWN"),
      fulfillmentServiceLevel: safeText(
        order.fulfillment?.fulfillmentServiceLevel,
        "—",
      ),
      shipBy: order.fulfillment?.shipByWindow?.latestDateTime ?? null,
      deliverBy: order.fulfillment?.deliverByWindow?.latestDateTime ?? null,
      total: parseMoney(order.proceeds?.grandTotal) ?? calculatedTotal,
      items,
    };
  });
}

function invalidInput(message: string): never {
  throw new SpApiError(message, { status: 400, code: "INVALID_INPUT" });
}

function assertDashboardInput(input: DashboardOrdersReadInput): void {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) {
    invalidInput("日期範圍必須介於 1 到 90 天。");
  }
  if (
    input.fulfillmentStatus !== null &&
    !isOrderFulfillmentStatus(input.fulfillmentStatus)
  ) {
    invalidInput("不支援這個訂單狀態。");
  }
  if (
    input.paginationToken !== null &&
    (typeof input.paginationToken !== "string" ||
      input.paginationToken.length > 4_096)
  ) {
    invalidInput("分頁資訊無效，請重新查詢。");
  }
}

function buildPagePlan(
  input: OrdersReadInput,
  context: SpExecutionContext,
  now: Date,
): OrdersPagePlan {
  if (input.intent === "dashboard-page") assertDashboardInput(input);
  const days = input.intent === "dashboard-page" ? input.days : 1;
  return Object.freeze({
    intent: input.intent,
    marketplaceId: input.marketplaceId,
    lastUpdatedAfter: new Date(now.getTime() - days * DAY_MS).toISOString(),
    fulfillmentStatus: input.intent === "dashboard-page"
      ? input.fulfillmentStatus
      : null,
    paginationToken: input.intent === "dashboard-page"
      ? input.paginationToken
      : null,
    expectedMode: context.mode,
    signal: input.signal,
  });
}

const DEMO_STATUSES: readonly OrderFulfillmentStatus[] = Object.freeze([
  "UNSHIPPED",
  "SHIPPED",
  "SHIPPED",
  "PARTIALLY_SHIPPED",
  "CANCELLED",
  "PENDING",
  "SHIPPED",
  "UNSHIPPED",
]);

function buildDemoOrders(
  marketplaceId: MarketplaceId,
  now: Date,
): DashboardOrder[] {
  const marketplace = marketplaceById(marketplaceId);
  if (!marketplace) throw new TypeError("Amazon marketplace is invalid.");
  const rows = demoFbaCatalogRows(marketplaceId);
  const nowMs = now.getTime();
  const isJapan = marketplace.code === "JP";
  const isoHoursAgo = (hours: number) =>
    new Date(nowMs - hours * 3_600_000).toISOString();

  return DEMO_STATUSES.map((status, index) => {
    const product = rows[index % rows.length]!;
    const quantity = (index % 3) + 1;
    const itemTotal = status === "CANCELLED"
      ? 0
      : product.unitAmount * quantity;
    return {
      orderId: `DEMO-${isJapan ? "JP" : "US"}-${String(840215 + index).padStart(7, "0")}`,
      createdTime: isoHoursAgo(3 + index * 11),
      lastUpdatedTime: isoHoursAgo(1 + index * 8),
      marketplaceId,
      marketplaceName: marketplace.name,
      programs: index % 2 === 0 ? ["PRIME"] : [],
      fulfillmentStatus: status,
      fulfilledBy: "AMAZON",
      fulfillmentServiceLevel: index % 2 === 0 ? "EXPEDITED" : "STANDARD",
      shipBy: status === "CANCELLED"
        ? null
        : new Date(nowMs + (index + 1) * 8 * 3_600_000).toISOString(),
      deliverBy: status === "CANCELLED"
        ? null
        : new Date(nowMs + (index + 2) * 24 * 3_600_000).toISOString(),
      total: { amount: itemTotal, currencyCode: marketplace.currency },
      items: [{
        orderItemId: `DEMO-ITEM-${index + 1}`,
        sellerSku: product.sellerSku,
        asin: product.asin,
        title: product.title,
        quantity,
        unitPrice: {
          amount: product.unitAmount,
          currencyCode: marketplace.currency,
        },
        lineTotal: { amount: itemTotal, currencyCode: marketplace.currency },
      }],
    };
  });
}

function upstreamError(result: OrdersPageResult): never {
  const status = result.status;
  const code = status === 401 || status === 403
    ? "UNAUTHORIZED"
    : status === 429
      ? "RATE_LIMITED"
      : "UPSTREAM_UNAVAILABLE";
  const message = status === 401 || status === 403
    ? "Amazon 拒絕了這次請求，請確認 app 角色、refresh token 與站點授權。"
    : status === 429
      ? "Amazon API 正在限流，請稍後再重新整理。"
      : "Amazon SP-API 暫時無法完成請求。";
  throw new SpApiError(message, {
    status,
    code,
    requestId: result.requestId,
    retryAfter: result.retryAfter,
  });
}

/** Semantic owner for the dashboard-page and connection-probe Orders reads. */
export class OrdersReads implements OrdersReadsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly live: OrdersPageAdapter;
  private readonly isConfiguredForMarketplace: (
    marketplaceId: MarketplaceId,
  ) => boolean;
  private readonly now: () => Date;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    live: OrdersPageAdapter;
    isConfiguredForMarketplace(marketplaceId: MarketplaceId): boolean;
    now?: () => Date;
  }>) {
    this.context = input.context;
    this.live = input.live;
    this.isConfiguredForMarketplace = input.isConfiguredForMarketplace;
    this.now = input.now ?? (() => new Date());
  }

  async read(input: OrdersReadInput): Promise<OrdersSnapshot> {
    throwIfAborted(input.signal);
    if (!marketplaceById(input.marketplaceId)) {
      invalidInput("不支援這個 Amazon 站點。");
    }
    if (input.intent === "dashboard-page") assertDashboardInput(input);
    const rangeNow = this.now();
    const context = await this.context.capture(input.marketplaceId);
    await this.context.assertCurrent(context);
    throwIfAborted(input.signal);

    if (context.mode === "demo") {
      let orders = buildDemoOrders(input.marketplaceId, rangeNow);
      if (input.intent === "dashboard-page" && input.fulfillmentStatus) {
        orders = orders.filter(
          (order) => order.fulfillmentStatus === input.fulfillmentStatus,
        );
      }
      orders = orders.filter((order) => order.fulfilledBy === "AMAZON");
      await this.context.assertCurrent(context);
      throwIfAborted(input.signal);
      const marketplace = marketplaceById(input.marketplaceId)!;
      const fetchedAt = this.now().toISOString();
      const lastUpdatedBefore = this.now().toISOString();
      return {
        mode: "demo",
        orders,
        marketplaceId: input.marketplaceId,
        fetchedAt,
        nextToken: null,
        lastUpdatedBefore,
        requestId: null,
        rateLimit: null,
        notice: this.isConfiguredForMarketplace(input.marketplaceId)
          ? "目前由 SP_API_MODE 強制使用展示資料。"
          : `${marketplace.label}尚未在本機系統安全儲存區加入 refresh token，因此顯示展示資料。`,
      };
    }

    const plan = buildPagePlan(input, context, rangeNow);
    let result: OrdersPageResult;
    try {
      result = await this.live.read(plan);
    } catch (error) {
      await this.context.assertCurrent(context);
      throwIfAborted(input.signal);
      throw error;
    }
    await this.context.assertCurrent(context);
    throwIfAborted(input.signal);

    if (result.status < 200 || result.status >= 300) upstreamError(result);
    // This cast deliberately preserves the legacy malformed-success behavior:
    // invalid envelopes still throw naturally instead of gaining a new code.
    const payload = result.payload as SearchOrdersResponse;
    const orders = normalizeOrders(payload.orders, input.marketplaceId).filter(
      (order) => order.fulfilledBy === "AMAZON",
    );
    return {
      mode: "live",
      orders,
      marketplaceId: input.marketplaceId,
      fetchedAt: this.now().toISOString(),
      nextToken: payload.pagination?.nextToken ?? null,
      lastUpdatedBefore: payload.lastUpdatedBefore ?? null,
      requestId: result.requestId,
      rateLimit: result.rateLimit,
      notice: null,
    };
  }
}
