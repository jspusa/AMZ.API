import { describe, expect, it, vi } from "vitest";
import {
  commitWithCanonicalReadback,
  ListingWriteAcceptedButPendingError,
} from "../src/main/amazon/listing-write-readback";
import type {
  ListingContentGateway,
  ListingContentGatewayRead,
  ListingContentPtdEvidence,
  ListingContentSourceEvidence,
} from "../src/main/amazon/listing-content-gateway";
import type {
  ListingContentSnapshot,
  ListingContentValues,
} from "../src/main/amazon/listing-content-types";
import {
  createScriptedSpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import {
  contentReadbackDecision,
  createListingContentMutations,
  type ListingContentPreparedPreview,
} from "../src/main/listing-content-mutations";
import {
  priceReadbackDecision,
  salePriceReadbackDecision,
} from "../src/main/listing-price-mutations";
import { SpExecutionContextError } from "../src/main/amazon/sp-execution-context";
import type {
  MainWriteGateExecuteInput,
  MainWriteGatePort,
} from "../src/main/write-gate";

const identity = {
  mode: "live" as const,
  marketplaceId: "ATVPDKIKX0DER" as const,
  sellerSku: "SKU-1",
};

const contentWritableCapability = {
  supported: true,
  editable: true,
  required: false,
  minItems: null,
  maxItems: null,
  minLength: 1,
  maxLength: 2_000,
  maxUtf8Bytes: 8_000,
  languageTags: ["en_US"],
  reason: null,
};

const contentSourceSnapshot: ListingContentSnapshot = {
  ...identity,
  asin: "B000000001",
  productType: "PET_FOOD",
  status: ["BUYABLE"],
  title: "Old",
  itemHighlight: "Old highlight",
  bulletPoints: ["Old A", "Old B"],
  productDescription: "Old description",
  ingredients: "Old",
  languageTag: "en_US",
  attributePresence: {
    title: true,
    itemHighlight: true,
    bulletPoints: true,
    productDescription: true,
    ingredients: true,
  },
  capabilities: {
    title: { ...contentWritableCapability },
    itemHighlight: { ...contentWritableCapability },
    bulletPoints: {
      ...contentWritableCapability,
      minItems: 1,
      maxItems: 5,
    },
    productDescription: { ...contentWritableCapability },
    ingredients: { ...contentWritableCapability },
    images: [],
    schemaChecksum: "content-readback-schema-checksum",
  },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  fetchedAt: "2026-08-18T00:00:01.000Z",
  requestId: "content-readback-source-request",
  issues: [],
  notice: null,
};

const contentGuardHashes = {
  rawContentGuardHash: "a".repeat(64),
  capabilityGuardHash: "b".repeat(64),
  fbaEvidenceHash: "c".repeat(64),
} as const;

function contentObservation(
  snapshot: ListingContentSnapshot = contentSourceSnapshot,
): ListingContentGatewayRead {
  return {
    snapshot,
    fulfillment: "FBA",
    ...contentGuardHashes,
    sourceEvidence: {} as ListingContentSourceEvidence,
    ptdEvidence: {} as ListingContentPtdEvidence,
  };
}

const contentFixtureGateway: ListingContentGateway = {
  mode: () => "live",
  read: async () => contentObservation(),
  validationPreview: async () => ({
    status: "VALID",
    canonicalPatchHash: "d".repeat(64),
    exactBulletReplacement: null,
    requestId: "content-readback-preview-request",
    issues: [],
  }),
  commitOnce: async () => {
    throw new Error("Readback decision fixture must not send a write.");
  },
  replaceDemoContent: async () => {
    throw new Error("Readback decision fixture must not mutate demo content.");
  },
};

const contentFixtureWriteGate: MainWriteGatePort = {
  stagePreview: async () => undefined,
  execute: async <T>(_input: MainWriteGateExecuteInput<T>): Promise<T> => {
    throw new Error("Readback decision fixture must not execute the Write Gate.");
  },
  reconcile: async () => undefined,
  clearEphemeral: () => undefined,
};

const contentFixtureOwner = createListingContentMutations({
  context: createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: identity.marketplaceId,
    mode: "live",
    accountScope: "content-readback-fixture-scope",
  })),
  writeGate: contentFixtureWriteGate,
  gateway: contentFixtureGateway,
});

async function prepareContentResult(
  requestedChanges: Partial<ListingContentValues>,
) {
  const requested = {
    title: contentSourceSnapshot.title,
    itemHighlight: contentSourceSnapshot.itemHighlight,
    bulletPoints: [...contentSourceSnapshot.bulletPoints],
    productDescription: contentSourceSnapshot.productDescription,
    ingredients: contentSourceSnapshot.ingredients,
    ...requestedChanges,
  };
  const preview = await contentFixtureOwner.previewOne({
    marketplaceId: identity.marketplaceId,
    sellerSku: identity.sellerSku,
    expectedTitle: contentSourceSnapshot.title,
    expectedItemHighlight: contentSourceSnapshot.itemHighlight,
    expectedBulletPoints: [...contentSourceSnapshot.bulletPoints],
    expectedProductDescription: contentSourceSnapshot.productDescription,
    expectedIngredients: contentSourceSnapshot.ingredients,
    ...requested,
  });
  return contentDurableResult(preview);
}

function contentDurableResult(preview: ListingContentPreparedPreview) {
  return {
    ...identity,
    status: "ACCEPTED" as const,
    previous: preview.previous,
    requested: preview.requested,
    changedFields: preview.changedFields,
    acceptedAt: "2026-08-18T00:00:00.000Z",
    submissionId: "content-readback-submission",
    requestId: "content-readback-request",
    issues: [],
    notice: "accepted",
    _writeEvidence: {
      ...preview.evidence,
      previous: preview.previous,
      requested: preview.requested,
      proposalFingerprint: preview.proposalFingerprint,
    },
  };
}

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
    })).rejects.toBeInstanceOf(ListingWriteAcceptedButPendingError);
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

  it("compares only changed content fields and preserves bullet order", async () => {
    const titleResult = await prepareContentResult({ title: "New\r\nTitle" });
    const bulletResult = await prepareContentResult({
      bulletPoints: ["A", "B"],
    });
    const highlightResult = await prepareContentResult({
      itemHighlight: "New highlight",
    });
    const descriptionResult = await prepareContentResult({
      productDescription: "New description",
    });
    const snapshot = {
      ...contentSourceSnapshot,
      title: " New\nTitle ",
      itemHighlight: "New highlight",
      bulletPoints: ["different"],
      productDescription: "New description",
      ingredients: "different",
      issues: [],
    };
    expect(contentReadbackDecision(
      titleResult as never,
      contentObservation(snapshot),
    )).toBe("verified");
    expect(contentReadbackDecision(
      bulletResult as never,
      contentObservation({ ...snapshot, bulletPoints: ["B", "A"] }),
    )).toBe("pending");
    expect(contentReadbackDecision(
      titleResult as never,
      contentObservation({
        ...snapshot,
        attributePresence: { ...snapshot.attributePresence, title: false },
      }),
    )).toBe("pending");
    expect(contentReadbackDecision(
      highlightResult as never,
      contentObservation({ ...snapshot, itemHighlight: "different" }),
    )).toBe("pending");
    expect(contentReadbackDecision(
      descriptionResult as never,
      contentObservation({
        ...snapshot,
        productDescription: " New description\r\n",
      }),
    )).toBe("verified");
    expect(contentReadbackDecision(
      descriptionResult as never,
      contentObservation({
        ...snapshot,
        attributePresence: {
          ...snapshot.attributePresence,
          productDescription: false,
        },
      }),
    )).toBe("pending");
    expect(contentReadbackDecision(
      highlightResult as never,
      contentObservation({
        ...snapshot,
        issues: [{
          code: "INVALID_HIGHLIGHT",
          severity: "ERROR",
          message: "invalid highlight",
          attributeNames: ["title_differentiation"],
        }],
      }),
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
