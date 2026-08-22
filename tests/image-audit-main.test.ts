import { describe, expect, it } from "vitest";
import { auditListingImageRows } from "../src/main/amazon/image-audit";

describe("image audit backend snapshot", () => {
  it("flags zero through five images, passes six, and excludes incomplete reads", () => {
    const snapshot = auditListingImageRows({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      rows: [
        {
          sellerSku: "FIVE",
          asin: "B0FIVE",
          productType: "PET_FOOD",
          title: "Five images",
          imageUrls: [
            "https://a/1.jpg",
            "https://a/2.jpg",
            "https://a/3.jpg",
            "https://a/4.jpg",
            "https://a/5.jpg",
            "https://a/5.jpg",
          ],
          readStatus: "complete",
          readErrors: [],
        },
        {
          sellerSku: "SIX",
          asin: "B0SIX",
          productType: "PET_FOOD",
          title: "Six images",
          imageUrls: Array.from({ length: 6 }, (_value, index) => `https://b/${index + 1}.jpg`),
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

    expect(snapshot.minimumImages).toBe(6);
    expect(snapshot.rows[0].imageCount).toBe(5);
    expect(snapshot.rows[1].imageCount).toBe(6);
    expect(snapshot.summary).toEqual({
      total: 3,
      completed: 2,
      incomplete: 1,
      underMinimum: 1,
    });
  });

  it("rejects any threshold other than the fixed six-image standard", () => {
    expect(() =>
      auditListingImageRows({
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-08T08:00:00.000Z",
        minimumImages: 5,
        rows: [],
      }),
    ).toThrow(/固定門檻為 6 張/);
  });
});
