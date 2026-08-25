import { describe, expect, it, vi } from "vitest";
import { SkuCommand } from "../src/main/amazon/sku-command";
import {
  SpExecutionContextError,
  type OpaqueAccountScope,
  type SpExecutionContext,
} from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type {
  ListingContentSnapshot,
  ListingImageSnapshot,
  ListingPriceSnapshot,
  RestockPlanSnapshot,
  SubscribeAndSaveOfferSnapshot,
} from "../src/main/amazon/sp-api";
import type { ProductMasterState } from "../src/main/local-store";
import type { MarketplaceId } from "../src/shared/marketplaces";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as MarketplaceId;
const SELLER_SKU = "AFA-TRKY-4OZ";
const ACCOUNT_SCOPE = "sku-command-test-scope" as OpaqueAccountScope;
const FETCHED_AT = "2026-08-25T01:02:03.000Z";

const context: SpExecutionContext = Object.freeze({
  marketplaceId: MARKETPLACE_ID,
  region: "na",
  mode: "demo",
  accountScope: ACCOUNT_SCOPE,
  generation: 7,
});

function productMaster(settingsConfigured = true): ProductMasterState {
  return {
    found: true,
    persistence: "durable",
    profile: {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      displayName: "Stored title",
      asin: "B000000001",
      fnSku: "X000000001",
      casePack: 12,
      cartonsPerPallet: 40,
      leadTimeDays: 20,
      safetyDays: 10,
      targetDays: 60,
      supplyRoute: "AWD_TO_FBA",
      awdBufferDays: 15,
      shelfLifeDays: null,
      minimumRemainingDays: null,
      factory: null,
      notes: null,
      settingsConfigured,
      lastSyncedAt: "2026-08-24T00:00:00.000Z",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    },
  };
}

function listingPrice(): ListingPriceSnapshot {
  return {
    title: "Fresh Amazon title",
    asin: "B000000002",
    standardPrice: { amount: 19.99, currencyCode: "USD" },
  } as ListingPriceSnapshot;
}

function listingContent(): ListingContentSnapshot {
  return {
    title: "Fresh content title",
    asin: "B000000003",
    bulletPoints: ["one", "two", "three", "four", "five"],
    ingredients: "Turkey",
    issues: [],
    capabilities: {
      title: { supported: true },
      bulletPoints: { supported: true, maxItems: 5 },
      ingredients: { supported: true },
    },
  } as unknown as ListingContentSnapshot;
}

function listingImages(): ListingImageSnapshot {
  return {
    images: Array.from({ length: 6 }, (_, index) => ({
      url: `https://images.example.test/${index + 1}.jpg`,
    })),
  } as ListingImageSnapshot;
}

function subscribeSave(): SubscribeAndSaveOfferSnapshot {
  return {
    found: true,
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
  } as SubscribeAndSaveOfferSnapshot;
}

function restockPlan(): RestockPlanSnapshot {
  return {
    title: "Fresh restock title",
    asin: "B000000004",
    fnSku: "X000000004",
    action: "HEALTHY",
    daysOfCover: 75,
    recommendedUnits: 0,
    casePack: 12,
  } as RestockPlanSnapshot;
}

function harness(input: {
  profile?: ProductMasterState;
  synced?: ProductMasterState;
  price?: () => Promise<ListingPriceSnapshot>;
  content?: () => Promise<ListingContentSnapshot>;
  images?: () => Promise<ListingImageSnapshot>;
  subscribeSave?: () => Promise<SubscribeAndSaveOfferSnapshot>;
  restock?: () => Promise<RestockPlanSnapshot>;
  assertCurrent?: () => Promise<void>;
} = {}) {
  const profile = input.profile ?? productMaster();
  const synced = input.synced ?? {
    ...productMaster(false),
    profile: {
      ...productMaster(false).profile,
      displayName: "Fresh Amazon title",
      asin: "B000000002",
      fnSku: "X000000004",
    },
  };
  const capture = vi.fn(async () => context);
  const assertCurrent = vi.fn(input.assertCurrent ?? (async () => undefined));
  const get = vi.fn(async () => profile);
  const syncIdentity = vi.fn(async () => synced);
  const price = vi.fn(input.price ?? (async () => listingPrice()));
  const content = vi.fn(input.content ?? (async () => listingContent()));
  const images = vi.fn(input.images ?? (async () => listingImages()));
  const readSubscribeSave = vi.fn(
    input.subscribeSave ?? (async () => subscribeSave()),
  );
  const restock = vi.fn(input.restock ?? (async () => restockPlan()));
  const command = new SkuCommand({
    context: { capture, assertCurrent },
    productMaster: { get, syncIdentity },
    reads: {
      price,
      content,
      images,
      subscribeSave: readSubscribeSave,
      restock,
    },
    now: () => new Date(FETCHED_AT),
  });
  return {
    command,
    capture,
    assertCurrent,
    get,
    syncIdentity,
    price,
    content,
    images,
    subscribeSave: readSubscribeSave,
    restock,
  };
}

describe("R04 SKU command semantic owner", () => {
  it("fans out the five exact reads, syncs identity, and returns the stable DTO", async () => {
    const subject = harness();

    const result = await subject.command.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(subject.capture).toHaveBeenCalledWith(MARKETPLACE_ID);
    expect(subject.get).toHaveBeenCalledWith(
      ACCOUNT_SCOPE,
      MARKETPLACE_ID,
      SELLER_SKU,
    );
    const identity = { marketplaceId: MARKETPLACE_ID, sellerSku: SELLER_SKU };
    expect(subject.price).toHaveBeenCalledWith(identity);
    expect(subject.content).toHaveBeenCalledWith(identity);
    expect(subject.images).toHaveBeenCalledWith(identity);
    expect(subject.subscribeSave).toHaveBeenCalledWith(identity);
    expect(subject.restock).toHaveBeenCalledWith({
      ...identity,
      targetDays: 60,
      leadTimeDays: 35,
      safetyDays: 10,
      casePack: 12,
    });
    expect(subject.assertCurrent).toHaveBeenCalledWith(context);
    expect(subject.syncIdentity).toHaveBeenCalledWith({
      accountScope: ACCOUNT_SCOPE,
      ...identity,
      displayName: "Fresh Amazon title",
      asin: "B000000002",
      fnSku: "X000000004",
    });
    expect(result).toMatchObject({
      mode: "demo",
      ...identity,
      fetchedAt: FETCHED_AT,
      profile: {
        profile: {
          displayName: "Fresh Amazon title",
          settingsConfigured: true,
        },
      },
      price: { data: listingPrice(), error: null },
      content: { data: listingContent(), error: null },
      images: { data: listingImages(), error: null },
      subscribeSave: { data: subscribeSave(), error: null },
      restock: { data: restockPlan(), error: null },
      tasks: [
        {
          id: "all-clear",
          automation: "automatic",
          severity: "info",
          tool: null,
        },
      ],
      summary: {
        score: 100,
        sourceReady: 5,
        sourceTotal: 5,
        critical: 0,
        warning: 0,
        manual: 0,
        overall: "ready",
      },
    });
    expect(result.notice).toContain("只讀整合掃描");
    expect(result.notice).toContain("Touch ID／Windows Hello");
  });

  it("keeps partial results while exposing only sanitized source errors", async () => {
    const subject = harness({
      price: async () => {
        throw new SpApiError("refresh_token=must-not-cross-the-boundary", {
          status: 429,
          code: "RATE_LIMITED",
          requestId: "request-safe-001",
          operation: "getListingsItem",
          upstreamCode: "QuotaExceeded",
        });
      },
      subscribeSave: async () => {
        throw new Error("private adapter failure");
      },
    });

    const result = await subject.command.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });

    expect(result.price).toEqual({
      data: null,
      error: {
        code: "RATE_LIMITED",
        message: "這項 Amazon 資料暫時無法讀取，其他結果仍可使用。",
        requestId: "request-safe-001",
        operation: "getListingsItem",
        upstreamCode: "QuotaExceeded",
      },
    });
    expect(JSON.stringify(result.price)).not.toContain("must-not-cross");
    expect(result.subscribeSave).toEqual({
      data: null,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "這項 Amazon 資料暫時無法讀取，其他結果仍可使用。",
        requestId: null,
      },
    });
    expect(result.tasks.map((task) => task.id)).toEqual([
      "source-price",
      "source-subscribe",
    ]);
    expect(result.summary).toEqual({
      score: 60,
      sourceReady: 3,
      sourceTotal: 5,
      critical: 0,
      warning: 1,
      manual: 0,
      overall: "attention",
    });
  });

  it("stops before Product Master identity sync when the account fence changes", async () => {
    const fenceError = new SpExecutionContextError(
      "ACCOUNT_SCOPE_CHANGED",
      "Amazon 帳號範圍已改變；本次操作已停止。",
    );
    const subject = harness({
      assertCurrent: async () => {
        throw fenceError;
      },
    });

    await expect(subject.command.read({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    })).rejects.toBe(fenceError);

    expect(subject.price).toHaveBeenCalledOnce();
    expect(subject.content).toHaveBeenCalledOnce();
    expect(subject.images).toHaveBeenCalledOnce();
    expect(subject.subscribeSave).toHaveBeenCalledOnce();
    expect(subject.restock).toHaveBeenCalledOnce();
    expect(subject.syncIdentity).not.toHaveBeenCalled();
  });
});
