import { describe, expect, it } from "vitest";
import { auditListingImageRows } from "../src/main/amazon/image-audit";

describe("image audit backend snapshot", () => {
  it("deduplicates image URLs and excludes incomplete reads from under-five counts", () => {
    const snapshot = auditListingImageRows({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      rows: [
        {
          sellerSku: "FOUR",
          asin: "B0FOUR",
          productType: "PET_FOOD",
          title: "Four images",
          imageUrls: [
            "https://a/1.jpg",
            "https://a/2.jpg",
            "https://a/3.jpg",
            "https://a/4.jpg",
            "https://a/4.jpg",
          ],
          readStatus: "complete",
          readErrors: [],
        },
        {
          sellerSku: "UNKNOWN",
          asin: "",
          productType: "PET_FOOD",
          title: "Unknown images",
          imageUrls: [],
          readStatus: "incomplete",
          readErrors: [
            { code: "LISTING_CONTENT_NOT_RETURNED", message: "attributes missing" },
          ],
        },
      ],
    });

    expect(snapshot.rows[0].imageCount).toBe(4);
    expect(snapshot.summary).toEqual({
      total: 2,
      completed: 1,
      incomplete: 1,
      underMinimum: 1,
    });
  });

  it("rejects an invalid threshold instead of silently widening scope", () => {
    expect(() =>
      auditListingImageRows({
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-08T08:00:00.000Z",
        minimumImages: 10,
        rows: [],
      }),
    ).toThrow(/1 到 9/);
  });
});
