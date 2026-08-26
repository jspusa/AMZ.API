import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ListingImageSnapshot,
  ListingImageUpdateResult,
} from "../src/main/amazon/listing-image-types";
import { imageReadbackDecision, reconcileImageWrite } from
  "../src/main/listing-image-mutations";

const US = "ATVPDKIKX0DER" as const;
const URLS = [
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

function snapshot(): ListingImageSnapshot {
  return {
    mode: "live",
    marketplaceId: US,
    sellerSku: "AFA-TRKY-4OZ",
    asin: "B09S5VY2JS",
    productType: "PET_FOOD",
    title: "Turkey Tendon",
    attributesPresent: true,
    images: URLS.map((url, index) => ({
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
    fetchedAt: "2026-08-26T09:00:00.000Z",
    requestId: "w03-readback",
    issues: [],
    notice: "canonical",
  };
}

function durableResult(
  requestedUrls = [...URLS],
): ListingImageUpdateResult {
  const previousUrls = [...URLS];
  const changedSlots = requestedUrls.flatMap((url, index) =>
    url === previousUrls[index] ? [] : [index]
  );
  return {
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: US,
    sellerSku: "AFA-TRKY-4OZ",
    previousUrls,
    requestedUrls,
    changedSlots,
    completedAt: "2026-08-26T08:59:00.000Z",
    submissionId: "submission-w03",
    requestId: "request-w03",
    issues: [],
    notice: "accepted",
    imageWriteEvidence: {
      version: 1,
      asin: "B09S5VY2JS",
      productType: "PET_FOOD",
      fulfillment: "FBA",
      expectedOldHash: createHash("sha256")
        .update(JSON.stringify(previousUrls))
        .digest("hex"),
      previousUrls,
      requestedUrls,
      changedSlots,
    },
  } as ListingImageUpdateResult;
}

describe("Listing Image canonical write readback", () => {
  it("never verifies a response with an empty changed-slot vector", () => {
    const result: ListingImageUpdateResult = {
      mode: "live",
      status: "ACCEPTED",
      marketplaceId: US,
      sellerSku: "AFA-TRKY-4OZ",
      previousUrls: [...URLS],
      requestedUrls: [...URLS],
      changedSlots: [],
      completedAt: "2026-08-26T08:59:00.000Z",
      submissionId: "submission-w03",
      requestId: "request-w03",
      issues: [],
      notice: "accepted",
    };

    expect(imageReadbackDecision(result, {
      snapshot: snapshot(),
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");
  });

  it("verifies only a complete nine-slot canonical target", () => {
    const requested = [...URLS];
    requested[1] = "https://images.example.test/replacement-1.jpg";
    const canonical = snapshot();
    canonical.images[1]!.url = requested[1]!;

    expect(imageReadbackDecision(durableResult(requested), {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("verified");
  });

  it("keeps ASIN or main-image identity drift pending", () => {
    const requested = [...URLS];
    requested[1] = "https://images.example.test/replacement-1.jpg";
    const canonical = snapshot();
    canonical.images[1]!.url = requested[1]!;
    canonical.asin = "B000000001";

    expect(imageReadbackDecision(durableResult(requested), {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");

    canonical.asin = "B09S5VY2JS";
    canonical.images[0]!.url = "https://images.example.test/other-main.jpg";
    expect(imageReadbackDecision(durableResult(requested), {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");
  });

  it("keeps malformed durable image evidence pending", () => {
    const requested = [...URLS];
    requested[1] = "https://images.example.test/replacement-1.jpg";
    const canonical = snapshot();
    canonical.images[1]!.url = requested[1]!;
    const observation = {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "FBA" as const,
    };
    const cases: Array<readonly [string, (value: any) => void]> = [
      ["missing previous vector", (value) => {
        delete value.imageWriteEvidence.previousUrls;
      }],
      ["short requested vector", (value) => {
        value.imageWriteEvidence.requestedUrls.pop();
      }],
      ["empty changed slots", (value) => {
        value.changedSlots = [];
        value.imageWriteEvidence.changedSlots = [];
      }],
      ["duplicate changed slots", (value) => {
        value.changedSlots = [1, 1];
        value.imageWriteEvidence.changedSlots = [1, 1];
      }],
      ["wrong expected-old hash", (value) => {
        value.imageWriteEvidence.expectedOldHash = "0".repeat(64);
      }],
    ];

    for (const [label, mutate] of cases) {
      const value = structuredClone(durableResult(requested)) as any;
      mutate(value);
      expect(
        imageReadbackDecision(value, observation),
        label,
      ).toBe("pending");
      expect(reconcileImageWrite(value, observation), label).toBeNull();
    }
  });

  it("keeps Product Type, FBA, attributes, slot order, or issue drift pending", () => {
    const requested = [...URLS];
    requested[1] = "https://images.example.test/replacement-1.jpg";
    const result = durableResult(requested);
    const canonical = snapshot();
    canonical.images[1]!.url = requested[1]!;

    const productTypeDrift = structuredClone(canonical);
    productTypeDrift.productType = "DOG_TREAT";
    expect(imageReadbackDecision(result, {
      snapshot: productTypeDrift,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");

    expect(imageReadbackDecision(result, {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "MFN" as never,
    })).toBe("pending");

    const attributesMissing = structuredClone(canonical);
    attributesMissing.attributesPresent = false;
    expect(imageReadbackDecision(result, {
      snapshot: attributesMissing,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");

    const wrongOrder = structuredClone(canonical);
    [wrongOrder.images[1], wrongOrder.images[2]] = [
      wrongOrder.images[2]!,
      wrongOrder.images[1]!,
    ];
    expect(imageReadbackDecision(result, {
      snapshot: wrongOrder,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");

    const errorIssue = structuredClone(canonical);
    errorIssue.issues = [{
      code: "90220",
      severity: "ERROR",
      message: "Image not processed.",
      attributeNames: ["other_product_image_locator_1"],
    }];
    expect(imageReadbackDecision(result, {
      snapshot: errorIssue,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    })).toBe("pending");
  });

  it("projects an exact later GET into a durable verified lifecycle", () => {
    const requested = [...URLS];
    requested[1] = "https://images.example.test/replacement-1.jpg";
    const canonical = snapshot();
    canonical.images[1]!.url = requested[1]!;

    expect(reconcileImageWrite(durableResult(requested), {
      snapshot: canonical,
      sourceEvidence: {} as never,
      fulfillment: "FBA",
    }, () => new Date("2026-08-26T09:05:00.000Z"))).toMatchObject({
      writeLifecycle: {
        state: "verified",
        verified: true,
        authoritative: true,
        acceptedAt: "2026-08-26T08:59:00.000Z",
        verifiedAt: "2026-08-26T09:05:00.000Z",
        attempts: 0,
      },
    });
  });
});
