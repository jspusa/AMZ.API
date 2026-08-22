import { describe, expect, it, vi } from "vitest";
import {
  businessPriceReadbackDecision,
  commitWithCanonicalReadback,
  contentReadbackDecision,
  imageReadbackDecision,
  priceReadbackDecision,
  salePriceReadbackDecision,
} from "../src/main/amazon/listing-write-readback";

const identity = {
  mode: "live" as const,
  marketplaceId: "ATVPDKIKX0DER" as const,
  sellerSku: "SKU-1",
};

describe("main-owned listing write readback", () => {
  it("commits exactly once and completes only after a canonical GET match", async () => {
    const commit = vi.fn(async () => ({
      ...identity,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-08-18T00:00:00.000Z",
      requestedPrice: { amount: 12.34, currencyCode: "USD" },
      previousPrice: { amount: 11, currencyCode: "USD" },
      submissionId: "submission-1",
      requestId: "request-1",
      issues: [],
      notice: "accepted",
    }));
    const read = vi.fn()
      .mockResolvedValueOnce({
        ...identity,
        purchasableOfferPresence: "present",
        standardPrice: { amount: 11, currencyCode: "USD" },
        issues: [],
      })
      .mockResolvedValueOnce({
        ...identity,
        purchasableOfferPresence: "present",
        standardPrice: { amount: 12.34, currencyCode: "USD" },
        issues: [],
      });
    const onAccepted = vi.fn(async () => undefined);

    const result = await commitWithCanonicalReadback({
      commit,
      onAccepted,
      read,
      decide: priceReadbackDecision,
      delaysMs: [0, 0],
      now: () => new Date("2026-08-18T00:00:02.000Z"),
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.writeLifecycle).toEqual({
      state: "verified",
      verified: true,
      authoritative: true,
      acceptedAt: "2026-08-18T00:00:00.000Z",
      verifiedAt: "2026-08-18T00:00:02.000Z",
      attempts: 2,
    });
  });

  it("fails unknown after ACCEPTED without ever repeating the write", async () => {
    const commit = vi.fn(async () => ({
      ...identity,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-08-18T00:00:00.000Z",
    }));
    const read = vi.fn(async () => ({ ...identity }));
    await expect(commitWithCanonicalReadback({
      commit,
      read,
      decide: () => "pending",
      delaysMs: [0, 0, 0],
    })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("treats a demo write as verified without a read", async () => {
    const read = vi.fn();
    const result = await commitWithCanonicalReadback({
      commit: async () => ({
        mode: "demo" as const,
        status: "SIMULATED" as const,
        completedAt: "2026-08-18T00:00:00.000Z",
      }),
      read,
      decide: () => "pending",
    });
    expect(read).not.toHaveBeenCalled();
    expect(result.writeLifecycle.verified).toBe(true);
  });

  it("compares only changed content fields and preserves bullet order", () => {
    const result = {
      ...identity,
      status: "ACCEPTED" as const,
      previous: {
        title: "Old",
        itemHighlight: "Old highlight",
        bulletPoints: ["A", "B"],
        productDescription: "Old description",
        ingredients: "Old",
      },
      requested: {
        title: "New\r\nTitle",
        itemHighlight: "New highlight",
        bulletPoints: ["A", "B"],
        productDescription: "New description",
        ingredients: "New",
      },
      changedFields: ["title"] as const,
    };
    const snapshot = {
      ...identity,
      title: " New\nTitle ",
      itemHighlight: "New highlight",
      bulletPoints: ["different"],
      productDescription: "New description",
      ingredients: "different",
      attributePresence: {
        title: true,
        itemHighlight: true,
        bulletPoints: true,
        productDescription: true,
        ingredients: true,
      },
      issues: [],
    };
    expect(contentReadbackDecision(result as never, snapshot as never)).toBe("verified");
    expect(contentReadbackDecision(
      { ...result, changedFields: ["bulletPoints"] } as never,
      { ...snapshot, bulletPoints: ["B", "A"] } as never,
    )).toBe("pending");
    expect(contentReadbackDecision(
      result as never,
      {
        ...snapshot,
        attributePresence: { ...snapshot.attributePresence, title: false },
      } as never,
    )).toBe("pending");
    expect(contentReadbackDecision(
      { ...result, changedFields: ["itemHighlight"] } as never,
      { ...snapshot, itemHighlight: "different" } as never,
    )).toBe("pending");
    expect(contentReadbackDecision(
      { ...result, changedFields: ["productDescription"] } as never,
      {
        ...snapshot,
        productDescription: " New description\r\n",
      } as never,
    )).toBe("verified");
    expect(contentReadbackDecision(
      { ...result, changedFields: ["productDescription"] } as never,
      {
        ...snapshot,
        attributePresence: {
          ...snapshot.attributePresence,
          productDescription: false,
        },
      } as never,
    )).toBe("pending");
    expect(contentReadbackDecision(
      { ...result, changedFields: ["itemHighlight"] } as never,
      {
        ...snapshot,
        issues: [{
          code: "INVALID_HIGHLIGHT",
          severity: "ERROR",
          message: "invalid highlight",
          attributeNames: ["title_differentiation"],
        }],
      } as never,
    )).toBe("pending");
  });

  it("requires exact sale schedule and explicit cancellation absence", () => {
    const base = {
      ...identity,
      status: "ACCEPTED" as const,
      action: "set" as const,
      standardPrice: { amount: 15, currencyCode: "USD" },
      requestedDiscountedPrice: {
        price: { amount: 9.99, currencyCode: "USD" },
        startAt: "2026-08-18",
        endAt: "2026-08-31",
      },
    };
    expect(salePriceReadbackDecision(base as never, {
      ...identity,
      issues: [],
      purchasableOfferPresence: "present",
      standardPrice: { amount: 15, currencyCode: "USD" },
      hasDiscountedPrice: true,
      discountedPricePresence: "valid",
      discountedPrice: {
        price: { amount: 9.99, currencyCode: "USD" },
        startAt: "2026-08-18T00:00:00Z",
        endAt: "2026-08-31T23:59:59Z",
      },
    } as never)).toBe("verified");
    expect(salePriceReadbackDecision(
      { ...base, action: "cancel", requestedDiscountedPrice: null } as never,
      {
        ...identity,
        issues: [],
        purchasableOfferPresence: "present",
        standardPrice: { amount: 15, currencyCode: "USD" },
        hasDiscountedPrice: false,
        discountedPricePresence: "absent",
        discountedPrice: null,
      } as never,
    )).toBe("verified");
    expect(salePriceReadbackDecision(
      { ...base, action: "cancel", requestedDiscountedPrice: null } as never,
      {
        ...identity,
        issues: [],
        purchasableOfferPresence: "present",
        standardPrice: { amount: 15, currencyCode: "USD" },
        hasDiscountedPrice: false,
        discountedPricePresence: "invalid",
        discountedPrice: null,
      } as never,
    )).toBe("pending");

    for (const purchasableOfferPresence of ["absent", "ambiguous"] as const) {
      expect(salePriceReadbackDecision(
        { ...base, action: "cancel", requestedDiscountedPrice: null } as never,
        {
          ...identity,
          issues: [],
          purchasableOfferPresence,
          standardPrice: null,
          hasDiscountedPrice: false,
          discountedPricePresence: "absent",
          discountedPrice: null,
        } as never,
      )).toBe("pending");
    }
  });

  it("verifies the exact B2B price while preserving standard price and quantity discounts", () => {
    const result = {
      ...identity,
      status: "ACCEPTED" as const,
      asin: "B012345678",
      productType: "PET_FOOD",
      standardPrice: { amount: 30, currencyCode: "USD" },
      previousBusinessPrice: { amount: 28, currencyCode: "USD" },
      requestedBusinessPrice: { amount: 27.5, currencyCode: "USD" },
      businessOfferGuardHash: "quantity-discounts-before-write",
    };
    const snapshot = {
      ...identity,
      asin: "B012345678",
      productType: "PET_FOOD",
      issues: [],
      standardPrice: { amount: 30, currencyCode: "USD" },
      businessPrice: { amount: 27.5, currencyCode: "USD" },
      businessOfferPresence: "present" as const,
      businessOfferGuardHash: "quantity-discounts-before-write",
    };

    expect(businessPriceReadbackDecision(result as never, snapshot as never))
      .toBe("verified");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      standardPrice: { amount: 31, currencyCode: "USD" },
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      asin: "B087654321",
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      businessOfferGuardHash: "quantity-discounts-changed",
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_B2B_OFFER",
        severity: "ERROR",
        message: "invalid",
        attributeNames: ["purchasable_offer"],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "DUAL_ATTRIBUTE_SCOPE",
        severity: "ERROR",
        message: "Legacy price scope must not be discarded.",
        attributeNames: [],
        attributeName: "purchasable_offer",
        categories: ["INVALID_ATTRIBUTE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "UNSCOPED_ERROR",
        severity: "ERROR",
        message: "Amazon returned an unscoped error.",
        attributeNames: [],
        categories: [],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_B2B_SELECTOR",
        severity: "ERROR",
        message: "Business audience is invalid.",
        attributeNames: ["audience"],
        categories: ["INVALID_ATTRIBUTE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "INVALID_QDP",
        severity: "ERROR",
        message: "invalid quantity discounts",
        attributeNames: ["quantity_discount_plan"],
      }],
    } as never)).toBe("pending");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "18027",
        severity: "ERROR",
        message: "Image is invalid.",
        attributeNames: [],
        categories: ["INVALID_IMAGE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("verified");
    expect(businessPriceReadbackDecision(result as never, {
      ...snapshot,
      issues: [{
        code: "90220",
        severity: "ERROR",
        message: "Price is invalid.",
        attributeNames: [],
        categories: ["INVALID_PRICE"],
        marketplaceIds: [identity.marketplaceId],
      }],
    } as never)).toBe("pending");
  });

  it("does not verify offer writes while the relevant Listing attribute has an ERROR", () => {
    const price = {
      ...identity,
      status: "ACCEPTED" as const,
      requestedPrice: { amount: 12.34, currencyCode: "USD" },
    };
    const snapshot = {
      ...identity,
      purchasableOfferPresence: "present",
      standardPrice: { amount: 12.34, currencyCode: "USD" },
      issues: [{
        code: "INVALID",
        severity: "ERROR",
        message: "invalid offer",
        attributeNames: ["purchasable_offer"],
      }],
    };
    expect(priceReadbackDecision(price as never, snapshot as never)).toBe("pending");
  });

  it("checks only changed image slots using canonical URLs", () => {
    const result = {
      ...identity,
      changedSlots: [1],
      requestedUrls: ["https://example.com/main.jpg", "https://EXAMPLE.com/b.jpg?q=1"],
    };
    const snapshot = {
      ...identity,
      attributesPresent: true,
      issues: [],
      images: [
        { url: "https://different.example/main.jpg" },
        { url: "https://example.com/b.jpg?q=1" },
      ],
    };
    expect(imageReadbackDecision(result as never, snapshot as never)).toBe("verified");
    expect(imageReadbackDecision(
      {
        ...result,
        changedSlots: [1],
        requestedUrls: [null, null],
      } as never,
      {
        ...snapshot,
        attributesPresent: false,
        images: snapshot.images.map(() => ({ url: null })),
      } as never,
    )).toBe("pending");
    expect(imageReadbackDecision(
      {
        ...result,
        changedSlots: [1],
        requestedUrls: [null, null],
      } as never,
      {
        ...snapshot,
        images: [snapshot.images[0], { url: "not-a-valid-url" }],
      } as never,
    )).toBe("pending");
  });
});
