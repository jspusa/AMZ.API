import { describe, expect, it, vi } from "vitest";
import {
  commitWithCanonicalReadback,
  contentReadbackDecision,
} from "../src/main/amazon/listing-write-readback";
import {
  priceReadbackDecision,
  salePriceReadbackDecision,
} from "../src/main/listing-price-mutations";
import { SpExecutionContextError } from "../src/main/amazon/sp-execution-context";

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

  it("preserves the context error when the fence fails before the write", async () => {
    const commit = vi.fn();
    const read = vi.fn();
    const assertCurrent = vi.fn(async () => {
      throw new SpExecutionContextError(
        "ACCOUNT_SCOPE_CHANGED",
        "Amazon 帳號範圍已改變；本次操作已停止。",
      );
    });

    await expect(commitWithCanonicalReadback({
      commit,
      assertCurrent,
      read,
      decide: () => "pending",
    })).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_SCOPE_CHANGED",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("locks the result as unknown when context changes after Amazon accepts", async () => {
    const commit = vi.fn(async () => ({
      ...identity,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-08-18T00:00:00.000Z",
    }));
    const onAccepted = vi.fn(async () => undefined);
    const read = vi.fn();
    const assertCurrent = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境已更新；請重新開始這次操作。",
      ));

    await expect(commitWithCanonicalReadback({
      commit,
      onAccepted,
      assertCurrent,
      read,
      decide: () => "pending",
    })).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
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

});
