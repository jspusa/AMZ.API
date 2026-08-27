import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  businessPricingGatewayProduction,
  invalidateSpApiCredentialCaches,
  listingContentGatewayProduction,
  listingImageGatewayProduction,
  listingPriceGatewayProduction,
} from "../src/main/amazon/sp-api";
import type {
  BusinessPriceUpdateResult,
  BusinessPricingListingSnapshot,
  UpdateBusinessPriceInput,
} from "../src/main/amazon/business-pricing-types";
import type { ListingWriteExecutionFence } from
  "../src/main/amazon/listing-write-execution-fence";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { createListingImageMutationOperations } from
  "../src/main/listing-image-mutations";
import { createListingPriceMutationOperations } from
  "../src/main/listing-price-mutations";
import { createBusinessPricingMutations } from
  "../src/main/business-pricing-mutations";
import type {
  MainWriteGateExecuteInput,
  MainWriteGatePort,
  MainWriteGateSession,
} from "../src/main/write-gate";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const priceOperations = createListingPriceMutationOperations(
  listingPriceGatewayProduction,
);
const imageOperations = createListingImageMutationOperations(
  listingImageGatewayProduction,
);
const getListingPrice = priceOperations.read;
const getListingImages = async (
  input: Parameters<typeof imageOperations.read>[0],
) => (await imageOperations.read(input)).snapshot;
const readListingContentSnapshot = async (
  input: Parameters<typeof listingContentGatewayProduction.read>[0],
) => (await listingContentGatewayProduction.read(input, "read-only")).snapshot;
const previewListingPriceUpdate = priceOperations.previewStandard;
const previewListingSalePriceUpdate = priceOperations.previewSale;
const updateListingPrice = priceOperations.commitStandard;
const updateListingImages = imageOperations.commit;
const currentFence = { assertCurrent: async () => undefined } as const;

const SP_ENV_KEYS = Object.keys(process.env).filter((key) => key.startsWith("SP_API_"));
const savedEnvironment = new Map(SP_ENV_KEYS.map((key) => [key, process.env[key]]));
let businessPricingOperationSequence = 0;

function businessPricingResponseValue<T>(response: ApiResponse): T {
  if (response.body.kind !== "json") {
    throw new Error("Expected Business Pricing JSON response.");
  }
  if (response.status >= 400) {
    const value = response.body.value as Record<string, unknown>;
    throw Object.assign(
      new Error(
        typeof value.message === "string"
          ? value.message
          : "Business Pricing route failed.",
      ),
      { status: response.status, ...value },
    );
  }
  return response.body.value as T;
}

function businessPricingRequest(
  method: "GET" | "PATCH",
  input: Readonly<{
    marketplaceId: "ATVPDKIKX0DER";
    sellerSku: string;
  }> | UpdateBusinessPriceInput,
  idempotencyKey: string,
): ApiRequest {
  return {
    requestId: `demo-business-owner-${++businessPricingOperationSequence}`,
    method,
    path: "/api/sp-api/business-pricing",
    query: method === "GET"
      ? { marketplaceId: input.marketplaceId, sku: input.sellerSku }
      : {},
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    ...(method === "GET"
      ? {}
      : {
          body: {
            kind: "json",
            value: { ...input, idempotencyKey },
          } as const,
        }),
  };
}

function wireBusinessPricingOwner(
  fence?: ListingWriteExecutionFence,
) {
  const context = createScriptedSpExecutionContextAdapter((marketplaceId) => ({
    marketplaceId,
    mode: businessPricingGatewayProduction.mode(marketplaceId),
    accountScope: "demo-business-pricing-owner-scope",
  }));
  const writeGate: MainWriteGatePort = {
    stagePreview: async () => undefined,
    execute: async <T>(input: MainWriteGateExecuteInput<T>): Promise<T> => {
      const session: MainWriteGateSession = {
        attempt: async (attempt) => attempt.execute({
          recordDurableEvidence: async () => undefined,
          recordAccepted: async () => undefined,
          assertCurrent: async () => {
            await fence?.assertCurrent();
          },
        }),
      };
      return input.run(session);
    },
    reconcile: async () => undefined,
    clearEphemeral: () => undefined,
  };
  return createBusinessPricingMutations({
    context,
    writeGate,
    gateway: businessPricingGatewayProduction,
    priceObserver: { observeCanonical: async () => undefined },
  });
}

async function getBusinessPricing(input: Readonly<{
  marketplaceId: "ATVPDKIKX0DER";
  sellerSku: string;
}>): Promise<BusinessPricingListingSnapshot> {
  const idempotencyKey = `demo-business-read-${businessPricingOperationSequence + 1}`;
  const owner = wireBusinessPricingOwner();
  return businessPricingResponseValue(await owner.handle({
    operation: "read",
    request: businessPricingRequest("GET", input, idempotencyKey),
  }));
}

async function updateBusinessPrice(
  input: UpdateBusinessPriceInput,
  fence?: ListingWriteExecutionFence,
): Promise<BusinessPriceUpdateResult> {
  const idempotencyKey = `demo-business-commit-${businessPricingOperationSequence + 1}`;
  const owner = wireBusinessPricingOwner(fence);
  return businessPricingResponseValue(await owner.handle({
    operation: "commit",
    request: businessPricingRequest("PATCH", input, idempotencyKey),
  }));
}

describe("SP-API demo safety boundary", () => {
  beforeEach(() => {
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("keeps price changes behind preview and expected-price checks", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });
    expect(current.mode).toBe("demo");
    expect(current.standardPrice).not.toBeNull();
    const expectedPrice = current.standardPrice!.amount;
    const newPrice = expectedPrice + 1;

    const preview = await previewListingPriceUpdate({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      expectedPrice,
      newPrice,
    });
    expect(preview.status).toBe("SIMULATED");

    const result = await updateListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      expectedPrice,
      newPrice,
    }, currentFence);
    expect(result.status).toBe("SIMULATED");
    expect(result.previousPrice.amount).toBe(expectedPrice);
    expect(result.requestedPrice.amount).toBe(newPrice);
  });

  it("clears context-bound demo writes when the SP execution context is invalidated", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const original = await getListingPrice(identity);
    const expectedPrice = original.standardPrice!.amount;
    await updateListingPrice({
      ...identity,
      expectedPrice,
      newPrice: expectedPrice + 3,
    }, currentFence);
    expect((await getListingPrice(identity)).standardPrice?.amount).toBe(expectedPrice + 3);

    invalidateSpApiCredentialCaches();

    expect((await getListingPrice(identity)).standardPrice?.amount).toBe(expectedPrice);
  });

  it("preserves valid Marketplace Day literals in a Sale Price preview", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });
    const preview = await previewListingSalePriceUpdate({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: current.sellerSku,
      action: "set",
      expectedPrice: current.standardPrice!.amount,
      expectedDiscountedPrice: current.discountedPrice?.price.amount ?? null,
      expectedStartAt: current.discountedPrice?.startAt ?? null,
      expectedEndAt: current.discountedPrice?.endAt ?? null,
      salePrice: current.standardPrice!.amount - 1,
      startAt: "2026-03-08",
      endAt: "2026-03-09",
    });

    expect(preview.status).toBe("SIMULATED");
    expect(preview.requestedDiscountedPrice).toMatchObject({
      startAt: "2026-03-08",
      endAt: "2026-03-09",
    });
  });

  it("rejects an impossible Sale Price date during preview", async () => {
    const current = await getListingPrice({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA-TRKY-4OZ",
    });

    await expect(
      previewListingSalePriceUpdate({
        marketplaceId: "ATVPDKIKX0DER",
        sellerSku: current.sellerSku,
        action: "set",
        expectedPrice: current.standardPrice!.amount,
        expectedDiscountedPrice: current.discountedPrice?.price.amount ?? null,
        expectedStartAt: current.discountedPrice?.startAt ?? null,
        expectedEndAt: current.discountedPrice?.endAt ?? null,
        salePrice: current.standardPrice!.amount - 1,
        startAt: "2026-02-30",
        endAt: "2026-03-09",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SALE_PRICE" });
  });

  it("provides content and nine ordered image slots", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const [content, images] = await Promise.all([
      readListingContentSnapshot(identity),
      getListingImages(identity),
    ]);
    expect(content.mode).toBe("demo");
    expect(content.itemHighlight).not.toBe("");
    expect(content.bulletPoints.length).toBeLessThanOrEqual(5);
    expect(content.productDescription).not.toBe("");
    expect(content.capabilities.itemHighlight.maxLength).toBe(125);
    expect(content.capabilities.productDescription.supported).toBe(true);
    expect(images.images).toHaveLength(9);
    expect(images.images[0].attributeName).toBe("main_product_image_locator");
  });

  it("does not republish a demo image override after context invalidation", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const before = await getListingImages(identity);
    const expectedUrls = before.images.map((image) => image.url);
    const update = updateListingImages(
      {
        ...identity,
        expectedUrls,
        urls: ["https://example.com/main.jpg", ...expectedUrls.slice(1)],
      },
      currentFence,
    );

    invalidateSpApiCredentialCaches();

    await expect(update).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect((await getListingImages(identity)).images.map((image) => image.url))
      .toEqual(expectedUrls);
  });

  it("does not republish demo B2B overrides after context invalidation", async () => {
    const identity = {
      marketplaceId: "ATVPDKIKX0DER" as const,
      sellerSku: "AFA-TRKY-4OZ",
    };
    const before = await getBusinessPricing(identity);
    if (!before.standardPrice) throw new Error("Expected demo standard price");
    let contextCurrent = true;
    const update = updateBusinessPrice({
      ...identity,
      expectedStandardPrice: before.standardPrice.amount,
      expectedBusinessPrice: before.businessPrice?.amount ?? null,
      newBusinessPrice: Number((before.standardPrice.amount - 1).toFixed(2)),
    }, {
      assertCurrent: async () => {
        if (!contextCurrent) {
          throw new SpApiError(
            "Amazon 憑證已在展示 B2B 價格更新期間改變；舊結果已丟棄。",
            { status: 409, code: "CREDENTIALS_CHANGED" },
          );
        }
      },
    });

    contextCurrent = false;
    invalidateSpApiCredentialCaches();

    await expect(update).rejects.toMatchObject({ code: "CREDENTIALS_CHANGED" });
    expect((await getBusinessPricing(identity)).businessPrice?.amount ?? null)
      .toBe(before.businessPrice?.amount ?? null);
  });

});
