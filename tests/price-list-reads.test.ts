import { describe, expect, it } from "vitest";
import { readPriceListListing } from "../src/main/amazon/price-list-reads";
import { createScriptedListingsReadAdapter } from "../src/main/amazon/listings-reads";

const US = "ATVPDKIKX0DER" as const;
const identity = { sellerSku: "SKU-ONE", asin: "B000000001" };
const amount = (value: unknown) => [{ schedule: [{ value_with_tax: value }] }];
function fixture(
  offer: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {},
) {
  return createScriptedListingsReadAdapter([
    {
      operation: "item",
      result: {
        status: 200,
        requestId: null,
        retryAfter: null,
        rateLimit: null,
        profile: "full",
        envelope: {
          sku: identity.sellerSku,
          summaries: [
            { marketplaceId: US, asin: identity.asin, productType: "PET_FOOD" },
          ],
          attributes: {
            purchasable_offer: [
              {
                marketplace_id: US,
                currency: "USD",
                audience: "ALL",
                our_price: amount(19.99),
                minimum_seller_allowed_price: amount(12.99),
                ...offer,
              },
            ],
            main_product_image_locator: [
              {
                marketplace_id: US,
                media_location:
                  "https://m.media-amazon.com/images/I/example.jpg",
              },
            ],
          },
          ...envelope,
        },
      },
    },
  ]);
}
describe("price-list exact read", () => {
  it("prefers Amazon's returned primary image over an older submitted image attribute", async () => {
    const adapter = fixture(
      {},
      {
        summaries: [
          {
            marketplaceId: US,
            asin: identity.asin,
            productType: "PET_FOOD",
            itemName: "Amazon current product title",
            mainImage: {
              link: "https://m.media-amazon.com/images/I/current.jpg",
            },
          },
        ],
      },
    );
    expect(
      await readPriceListListing(adapter, { ...identity, marketplaceId: US }),
    ).toMatchObject({
      imageUrl: "https://m.media-amazon.com/images/I/current.jpg",
      title: "Amazon current product title",
    });
  });
  it("reads configured price, seller minimum and main image without any write capability", async () => {
    const adapter = fixture();
    const result = await readPriceListListing(adapter, {
      ...identity,
      marketplaceId: US,
    });
    expect(result).toMatchObject({
      standardPrice: 19.99,
      minimumPrice: 12.99,
      minimumPriceStatus: "set",
      imageUrl: "https://m.media-amazon.com/images/I/example.jpg",
    });
    expect(adapter.requests.map((request) => request.operation)).toEqual([
      "item",
    ]);
  });
  it("distinguishes an absent minimum from malformed or scheduled evidence", async () => {
    expect(
      await readPriceListListing(
        fixture({ minimum_seller_allowed_price: undefined }),
        { ...identity, marketplaceId: US },
      ),
    ).toMatchObject({ minimumPrice: null, minimumPriceStatus: "not-set" });
    for (const invalid of [
      amount(""),
      amount(false),
      amount(-1),
      [{ schedule: [{ value_with_tax: 12, start_at: "2026-09-01" }] }],
    ]) {
      expect(
        await readPriceListListing(
          fixture({ minimum_seller_allowed_price: invalid }),
          { ...identity, marketplaceId: US },
        ),
      ).toMatchObject({
        minimumPrice: null,
        minimumPriceStatus: "unavailable",
      });
    }
  });
  it("rejects ASIN drift and treats missing attributes as incomplete", async () => {
    await expect(
      readPriceListListing(
        fixture(
          {},
          {
            summaries: [
              {
                marketplaceId: US,
                asin: "B000000002",
                productType: "PET_FOOD",
              },
            ],
          },
        ),
        { ...identity, marketplaceId: US },
      ),
    ).rejects.toThrow();
    expect(
      await readPriceListListing(fixture({}, { attributes: {} }), {
        ...identity,
        marketplaceId: US,
      }),
    ).toMatchObject({ standardPrice: null, minimumPriceStatus: "unavailable" });
  });
  it("does not use B2B-only price, duplicate ALL offers or non-Amazon image URLs", async () => {
    const attributes = {
      purchasable_offer: [
        {
          marketplace_id: US,
          currency: "USD",
          audience: "B2B",
          our_price: amount(10),
        },
      ],
      main_product_image_locator: [
        {
          marketplace_id: US,
          media_location: "https://private.invalid/secret",
        },
      ],
    };
    expect(
      await readPriceListListing(fixture({}, { attributes }), {
        ...identity,
        marketplaceId: US,
      }),
    ).toMatchObject({
      standardPrice: null,
      minimumPriceStatus: "unavailable",
      imageUrl: null,
    });
    attributes.purchasable_offer.push(
      { ...attributes.purchasable_offer[0]!, audience: "ALL" },
      { ...attributes.purchasable_offer[0]!, audience: "ALL" },
    );
    expect(
      await readPriceListListing(fixture({}, { attributes }), {
        ...identity,
        marketplaceId: US,
      }),
    ).toMatchObject({ standardPrice: null, minimumPriceStatus: "unavailable" });
  });
});
