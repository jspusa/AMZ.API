import { describe, expect, it, vi } from "vitest";
import type {
  ListingImageGateway,
  ListingImageSourceEvidence,
  ListingImageUrlVector,
} from "../src/main/amazon/listing-image-gateway";
import type { ListingImageSnapshot } from
  "../src/main/amazon/listing-image-types";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { createListingImageMutationOperations } from
  "../src/main/listing-image-mutations";

const US = "ATVPDKIKX0DER" as const;
const IDENTITY = {
  marketplaceId: US,
  sellerSku: "AFA-TRKY-4OZ",
} as const;
const SOURCE_EVIDENCE = {} as ListingImageSourceEvidence;
const CURRENT_URLS: ListingImageUrlVector = [
  "https://images.example.test/main.jpg",
  "https://images.example.test/alternate-1.jpg",
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

function imageSnapshot(): ListingImageSnapshot {
  return {
    mode: "live",
    ...IDENTITY,
    asin: "B09S5VY2JS",
    productType: "PET_FOOD",
    title: "Turkey Tendon",
    attributesPresent: true,
    images: CURRENT_URLS.map((url, index) => ({
      attributeName: index === 0
        ? "main_product_image_locator"
        : `other_product_image_locator_${index}`,
      label: index === 0 ? "主圖" : `副圖 ${index}`,
      url,
      capability: {
        attributeName: index === 0
          ? "main_product_image_locator"
          : `other_product_image_locator_${index}`,
        label: index === 0 ? "主圖" : `副圖 ${index}`,
        supported: true,
        editable: true,
        required: index === 0,
        reason: null,
      },
    })),
    fetchedAt: "2026-08-26T08:30:00.000Z",
    requestId: "w03-operation-read",
    issues: [],
    notice: "圖片 URL 取自 Listing attributes。",
  };
}

describe("Listing Image mutation operations", () => {
  it("rejects a stale expected image vector before Validation Preview or commit", async () => {
    const validationPreview =
      vi.fn<ListingImageGateway["validationPreview"]>();
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>();
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview,
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);
    const staleExpectedUrls = [...CURRENT_URLS];
    staleExpectedUrls[1] = "https://images.example.test/stale-alternate-1.jpg";

    const error = await operations.preview({
      ...IDENTITY,
      expectedUrls: staleExpectedUrls,
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toMatchObject({ code: "STALE_LISTING", status: 409 });
    expect(validationPreview).not.toHaveBeenCalled();
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("fails closed when a VALID preview carries malformed issue evidence", async () => {
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>();
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-malformed",
        retryAfter: null,
        payload: { status: "VALID", issues: "not-an-array" },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);

    const error = await operations.preview({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toMatchObject({
      code: "VALIDATION_STATUS_UNKNOWN",
      status: 502,
    });
    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("preserves Listings preview throttling evidence without classifying a write as sent", async () => {
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: false,
        status: 429,
        requestId: "w03-preview-throttled",
        retryAfter: "7",
        payload: {
          errors: [{
            code: "QuotaExceeded",
            message: "Preview quota exceeded.",
          }],
        },
      })),
      commitOnce: vi.fn(),
      replaceDemoImages: vi.fn(),
    };
    const operations = createListingImageMutationOperations(gateway);

    const error = await operations.preview({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      requestId: "w03-preview-throttled",
      retryAfter: "7",
      operation: "patchListingsItemPreview",
      upstreamCode: "QuotaExceeded",
    });
  });

  it("classifies only an explicit INVALID commit receipt as a known rejection", async () => {
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>(async () => ({
      ok: true,
      status: 200,
      requestId: "w03-commit-invalid",
      retryAfter: null,
      payload: {
        status: "INVALID",
        issues: [{
          code: "90180",
          message: "Amazon rejected the image locator.",
          severity: "ERROR",
          categories: ["INVALID_ATTRIBUTE"],
          attributeNames: ["other_product_image_locator_1"],
          marketplaceIds: [US],
        }],
      },
    }));
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);

    const error = await operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, { assertCurrent: vi.fn(async () => undefined) })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpApiError);
    expect(error).toMatchObject({ code: "UPDATE_REJECTED", status: 422 });
    expect(commitOnce).toHaveBeenCalledOnce();
  });

  it("honors an explicit ACCEPTED receipt even when Amazon returns an ERROR issue", async () => {
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>(async () => ({
      ok: true,
      status: 200,
      requestId: "w03-commit-accepted-with-issue",
      retryAfter: null,
      payload: {
        status: "ACCEPTED",
        submissionId: "w03-submission-accepted-with-issue",
        issues: [{
          code: "90220",
          message: "Amazon accepted the submission with an image warning.",
          severity: "ERROR",
          categories: ["INVALID_ATTRIBUTE"],
          attributeNames: ["other_product_image_locator_1"],
          marketplaceIds: [US],
        }],
      },
    }));
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);

    const result = await operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, { assertCurrent: vi.fn(async () => undefined) });

    expect(result).toMatchObject({
      status: "ACCEPTED",
      submissionId: "w03-submission-accepted-with-issue",
      requestId: "w03-commit-accepted-with-issue",
      issues: [{ code: "90220", severity: "ERROR" }],
    });
  });

  it("keeps a contradictory non-2xx ACCEPTED receipt unknown", async () => {
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce: vi.fn(async () => ({
        ok: false,
        status: 400,
        requestId: "w03-commit-contradictory",
        retryAfter: null,
        payload: {
          status: "ACCEPTED",
          submissionId: "w03-contradictory-submission",
          issues: [],
        },
      })),
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);

    await expect(operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, { assertCurrent: vi.fn(async () => undefined) })).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      status: 503,
      requestId: "w03-commit-contradictory",
    });
  });

  it("sanitizes accepted receipt metadata before it can enter the durable ledger", async () => {
    const safeIssue = {
      code: "SAFE_IMAGE_WARNING",
      message: "Verify the image in Seller Central.",
      severity: "WARNING",
      categories: ["INVALID_ATTRIBUTE"],
      attributeNames: ["other_product_image_locator_1"],
      marketplaceIds: [US],
    };
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "unsafe\nrequest-id",
        retryAfter: null,
        payload: {
          status: "ACCEPTED",
          submissionId:
            "https://example.test/?access_token=private-submission",
          issues: [safeIssue, {
            code: "HOSTILE_IMAGE_WARNING",
            message:
              "Bearer secret-token https://example.test/?access_token=secret-token",
            severity: "WARNING",
            categories: ["INVALID_ATTRIBUTE"],
            attributeNames: ["other_product_image_locator_1"],
            marketplaceIds: [US],
          }],
        },
      })),
      replaceDemoImages: vi.fn(async () => undefined),
    };
    const operations = createListingImageMutationOperations(gateway);

    const result = await operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/replacement-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, { assertCurrent: vi.fn(async () => undefined) });

    expect(result.requestId).toBeNull();
    expect(result.submissionId).toBeNull();
    expect(result.issues).toEqual([safeIssue]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("checks the final execution fence before publishing a demo image override", async () => {
    const replaceDemoImages =
      vi.fn<ListingImageGateway["replaceDemoImages"]>(async () => undefined);
    const gateway: ListingImageGateway = {
      mode: () => "demo",
      read: vi.fn(async () => ({
        snapshot: { ...imageSnapshot(), mode: "demo" as const },
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(),
      commitOnce: vi.fn(),
      replaceDemoImages,
    };
    const operations = createListingImageMutationOperations(gateway);
    const fenceError = new Error("stale execution context");

    await expect(operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/demo-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, {
      assertCurrent: vi.fn(async () => {
        throw fenceError;
      }),
    })).rejects.toBe(fenceError);

    expect(replaceDemoImages).not.toHaveBeenCalled();
  });

  it("checks the final execution fence immediately before a live commit", async () => {
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>(async () => ({
      ok: true,
      status: 200,
      requestId: "should-not-send",
      retryAfter: null,
      payload: { status: "ACCEPTED", issues: [] },
    }));
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-valid",
        retryAfter: null,
        payload: { status: "VALID", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(),
    };
    const operations = createListingImageMutationOperations(gateway);
    const fenceError = new Error("stale execution context");

    await expect(operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/live-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, {
      assertCurrent: vi.fn(async () => {
        throw fenceError;
      }),
    })).rejects.toBe(fenceError);

    expect(commitOnce).not.toHaveBeenCalled();
  });

  it("marks an unknown Validation Preview as precommit with zero commit sends", async () => {
    const commitOnce = vi.fn<ListingImageGateway["commitOnce"]>();
    const gateway: ListingImageGateway = {
      mode: () => "live",
      read: vi.fn(async () => ({
        snapshot: imageSnapshot(),
        sourceEvidence: SOURCE_EVIDENCE,
        fulfillment: "FBA" as const,
      })),
      validationPreview: vi.fn(async () => ({
        ok: true,
        status: 200,
        requestId: "w03-preview-unknown",
        retryAfter: null,
        payload: { status: "MYSTERY", issues: [] },
      })),
      commitOnce,
      replaceDemoImages: vi.fn(),
    };
    const operations = createListingImageMutationOperations(gateway);

    await expect(operations.commit({
      ...IDENTITY,
      expectedUrls: [...CURRENT_URLS],
      urls: [
        CURRENT_URLS[0],
        "https://images.example.test/live-alternate-1.jpg",
        ...CURRENT_URLS.slice(2),
      ],
    }, { assertCurrent: vi.fn(async () => undefined) })).rejects.toMatchObject({
      name: "SpApiPreCommitError",
      code: "VALIDATION_STATUS_UNKNOWN",
      commitPatchSent: false,
    });
    expect(commitOnce).not.toHaveBeenCalled();
  });
});
