import { describe, expect, it } from "vitest";
import { auditListingImageRows } from "../src/main/amazon/image-audit";

describe("image audit backend snapshot", () => {
  it("flags zero through five images, passes six, and excludes incomplete reads", () => {
    const snapshot = auditListingImageRows({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 6,
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

  it("evaluates a ten-image threshold from fresh counts while keeping eight as the default", () => {
    const input = { marketplaceId: "ATVPDKIKX0DER", fetchedAt: "2026-09-12T12:00:00.000Z", rows: [9, 10].map(count => ({ sellerSku: `IMAGES-${count}`, asin: "B012345678", productType: "PET_FOOD", title: "Fixture", imageUrls: Array.from({ length: count }, (_, index) => `https://images.example/${index}.jpg`), readStatus: "complete" as const, readErrors: [] })) };
    const ten = auditListingImageRows({ ...input, minimumImages: 10 });
    expect(ten.minimumImages).toBe(10);
    expect(ten.summary.underMinimum).toBe(1);
    expect(auditListingImageRows(input).minimumImages).toBe(8);
    expect(auditListingImageRows(input).summary.underMinimum).toBe(0);
  });

  it("rejects a threshold outside the one-to-ten range", () => {
    expect(() =>
      auditListingImageRows({
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-08T08:00:00.000Z",
        minimumImages: 0,
        rows: [],
      }),
    ).toThrow(/最低張數只能選 1–10 張/);
  });
});
