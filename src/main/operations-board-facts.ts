import type { ListingPriceSnapshot } from "./amazon/listing-price-types";
import { SpApiError } from "./amazon/sp-api-error";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "./amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import type {
  OperationsBoardFactField,
  OperationsBoardSkuFact,
} from "../shared/operations-board";
import { bodyRecord, isPlainRecord } from "./route-input";
import { invalid, json } from "./route-response";

const MAX_FACTS = 100;
const MAX_CONCURRENT_READS = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

type Identity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

type ParsedItem = Identity & Readonly<{ id: string }>;

export interface OperationsBoardFactsPort {
  handle(request: ApiRequest): Promise<ApiResponse>;
  cancel(requestId: string): void;
}

type PriceReader = (
  identity: Identity,
  context: SpExecutionContext,
) => Promise<ListingPriceSnapshot>;

type InventoryReader = (
  identity: Identity,
  context: SpExecutionContext,
  signal: AbortSignal,
) => Promise<number>;

class Semaphore {
  private available: number;
  private readonly waiters: Array<Readonly<{
    permits: number;
    resolve: () => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    onAbort: () => void;
  }>> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  private abortError(): Error {
    const error = new Error("公布欄 SKU 資料查詢已取消。");
    error.name = "AbortError";
    return error;
  }

  private async acquire(permits: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw this.abortError();
    if (this.waiters.length === 0 && this.available >= permits) {
      this.available -= permits;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        permits,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(this.abortError());
        },
      };
      this.waiters.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0]!;
      if (waiter.signal.aborted) {
        this.waiters.shift();
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(this.abortError());
        continue;
      }
      if (waiter.permits > this.available) return;
      this.waiters.shift();
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      this.available -= waiter.permits;
      waiter.resolve();
    }
  }

  private release(permits: number): void {
    this.available += permits;
    this.drain();
  }

  async runWithPermits<Value>(
    permits: number,
    operation: () => Promise<Value>,
    signal: AbortSignal,
  ): Promise<Value> {
    await this.acquire(permits, signal);
    try {
      if (signal.aborted) throw this.abortError();
      return await operation();
    } finally {
      this.release(permits);
    }
  }
}

function parseItems(request: ApiRequest): ParsedItem[] | null {
  const body = bodyRecord(request);
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "items") ||
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > MAX_FACTS
  ) {
    return null;
  }
  const parsed: ParsedItem[] = [];
  const ids = new Set<string>();
  for (const value of body.items) {
    if (
      !isPlainRecord(value) ||
      Object.keys(value).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(value, "id") ||
      !Object.prototype.hasOwnProperty.call(value, "marketplaceId") ||
      !Object.prototype.hasOwnProperty.call(value, "sellerSku") ||
      typeof value.id !== "string" ||
      !UUID_PATTERN.test(value.id) ||
      ids.has(value.id) ||
      typeof value.marketplaceId !== "string" ||
      !marketplaceById(value.marketplaceId) ||
      typeof value.sellerSku !== "string"
    ) {
      return null;
    }
    const sellerSku = value.sellerSku.trim();
    if (!sellerSku || sellerSku.length > 40 || UNSAFE_TEXT.test(sellerSku)) {
      return null;
    }
    ids.add(value.id);
    parsed.push({
      id: value.id,
      marketplaceId: value.marketplaceId as MarketplaceId,
      sellerSku,
    });
  }
  return parsed;
}

function unavailable<Value>(): OperationsBoardFactField<Value> {
  return { state: "unavailable", value: null };
}

function ready<Value>(value: Value): OperationsBoardFactField<Value> {
  return { state: "ready", value };
}

function canonicalSnapshot(
  value: ListingPriceSnapshot,
  identity: Identity,
  context: SpExecutionContext,
): boolean {
  return value.marketplaceId === identity.marketplaceId &&
    value.sellerSku === identity.sellerSku &&
    value.mode === context.mode;
}

function priceField(
  snapshot: ListingPriceSnapshot | null,
): OperationsBoardSkuFact["price"] {
  const money = snapshot?.effectivePrice ?? snapshot?.standardPrice ?? null;
  return money &&
      Number.isFinite(money.amount) &&
      money.amount >= 0 &&
      /^[A-Z]{3}$/u.test(money.currencyCode)
    ? ready({ amount: money.amount, currencyCode: money.currencyCode })
    : unavailable();
}

function demoInventoryField(
  snapshot: ListingPriceSnapshot | null,
): OperationsBoardSkuFact["inventory"] {
  const quantity = snapshot?.fulfillmentAvailability.find(
    (entry) => entry.fulfillment === "FBA",
  )?.quantity;
  return typeof quantity === "number" &&
      Number.isSafeInteger(quantity) &&
      quantity >= 0
    ? ready(quantity)
    : unavailable();
}

function liveInventoryField(
  result: PromiseSettledResult<number> | null,
): OperationsBoardSkuFact["inventory"] {
  return result?.status === "fulfilled" &&
      Number.isSafeInteger(result.value) &&
      result.value >= 0
    ? ready(result.value)
    : unavailable();
}

function identityKey(item: Identity): string {
  return `${item.marketplaceId}\u0000${item.sellerSku}`;
}

function itemLocalFailure(error: unknown): boolean {
  return error instanceof SpApiError &&
    error.status === 404 &&
    ["SKU_NOT_FOUND", "FBA_SKU_NOT_FOUND", "DEMO_NO_INVENTORY"].includes(error.code);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class OperationsBoardFacts implements OperationsBoardFactsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly readPrice: PriceReader;
  private readonly readLiveInventory: InventoryReader;
  private readonly now: () => Date;
  private readonly semaphore = new Semaphore(MAX_CONCURRENT_READS);
  private readonly active = new Map<string, AbortController>();

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    readPrice: PriceReader;
    readLiveInventory: InventoryReader;
    now?: () => Date;
  }>) {
    this.context = input.context;
    this.readPrice = input.readPrice;
    this.readLiveInventory = input.readLiveInventory;
    this.now = input.now ?? (() => new Date());
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    const items = parseItems(request);
    if (!items) {
      return invalid("請提供 1–100 個有效的公布欄 SKU。", 400, "INVALID_INPUT");
    }
    for (const controller of this.active.values()) controller.abort();
    const abort = new AbortController();
    this.active.set(request.requestId, abort);
    const unique = new Map<string, Identity>();
    for (const item of items) unique.set(identityKey(item), {
      marketplaceId: item.marketplaceId,
      sellerSku: item.sellerSku,
    });

    let systemicError: unknown = null;
    try {
      const byIdentity = new Map<string, Omit<OperationsBoardSkuFact, "id">>();
      const tasks = [...unique.entries()].map(async ([key, identity]) => {
        try {
          if (abort.signal.aborted) throw Object.assign(new Error("AbortError"), {
            name: "AbortError",
          });
          const context = await this.context.capture(identity.marketplaceId);
          if (abort.signal.aborted) throw Object.assign(new Error("AbortError"), {
            name: "AbortError",
          });
          await this.semaphore.runWithPermits(
            context.mode === "live" ? 2 : 1,
            async () => {
              try {
                const pricePromise = this.readPrice(identity, context);
                const inventoryPromise = context.mode === "live"
                  ? this.readLiveInventory(identity, context, abort.signal)
                  : null;
                const [priceResult, inventoryResult] = await Promise.all([
                  Promise.resolve(pricePromise).then(
                    (value): PromiseSettledResult<ListingPriceSnapshot> => ({ status: "fulfilled", value }),
                    (reason): PromiseSettledResult<ListingPriceSnapshot> => ({ status: "rejected", reason }),
                  ),
                  inventoryPromise
                    ? Promise.resolve(inventoryPromise).then(
                        (value): PromiseSettledResult<number> => ({ status: "fulfilled", value }),
                        (reason): PromiseSettledResult<number> => ({ status: "rejected", reason }),
                      )
                    : Promise.resolve(null),
                ]);
                for (const result of [priceResult, inventoryResult]) {
                  if (
                    result?.status === "rejected" &&
                    !itemLocalFailure(result.reason) &&
                    !isAbortError(result.reason)
                  ) {
                    throw result.reason;
                  }
                }
                if (abort.signal.aborted) {
                  throw Object.assign(new Error("AbortError"), { name: "AbortError" });
                }
                await this.context.assertCurrent(context);
                const snapshot = priceResult.status === "fulfilled" &&
                    canonicalSnapshot(priceResult.value, identity, context)
                  ? priceResult.value
                  : null;
                byIdentity.set(key, {
                  marketplaceId: identity.marketplaceId,
                  sellerSku: identity.sellerSku,
                  mode: context.mode,
                  inventory: context.mode === "demo"
                    ? demoInventoryField(snapshot)
                    : liveInventoryField(inventoryResult),
                  price: priceField(snapshot),
                  fetchedAt: this.now().toISOString(),
                });
              } catch (error) {
                if (!isAbortError(error)) systemicError ??= error;
                abort.abort();
                throw error;
              }
            },
            abort.signal,
          );
        } catch (error) {
          if (!isAbortError(error)) systemicError ??= error;
          abort.abort();
          throw error;
        }
      });
      try {
        await Promise.all(tasks);
      } catch (error) {
        abort.abort();
        await Promise.allSettled(tasks);
        throw error;
      }

      return json({
        facts: items.map((item) => ({
          id: item.id,
          ...byIdentity.get(identityKey(item))!,
        })),
      });
    } catch (error) {
      if (systemicError !== null) throw systemicError;
      if (abort.signal.aborted || isAbortError(error)) {
        return json({
          code: "REQUEST_CANCELLED",
          message: "公布欄 SKU 資料查詢已取消。",
        }, 409);
      }
      throw error;
    } finally {
      if (this.active.get(request.requestId) === abort) {
        this.active.delete(request.requestId);
      }
    }
  }
}
