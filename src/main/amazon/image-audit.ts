export type ListingImageAuditReadError = {
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
};

export type ListingImageAuditSourceRow = {
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  imageUrls: string[];
  readStatus: "complete" | "incomplete";
  readErrors: ListingImageAuditReadError[];
};

export const IMAGE_AUDIT_MINIMUM_IMAGES = 6 as const;

export function auditListingImageRows(input: {
  marketplaceId: string;
  fetchedAt: string;
  rows: ListingImageAuditSourceRow[];
  minimumImages?: number;
}) {
  const minimumImages = input.minimumImages ?? IMAGE_AUDIT_MINIMUM_IMAGES;
  if (minimumImages !== IMAGE_AUDIT_MINIMUM_IMAGES) {
    throw new Error("圖片健檢固定門檻為 6 張；拒絕使用其他標準。");
  }
  const rows = input.rows.map((row) => {
    const imageUrls = [...new Set(
      row.imageUrls.map((url) => url.trim()).filter(Boolean),
    )].slice(0, 9);
    const readErrors = row.readErrors.map((error) => ({ ...error }));
    const readStatus = row.readStatus === "complete" && readErrors.length === 0
      ? "complete" as const
      : "incomplete" as const;
    return {
      sellerSku: row.sellerSku,
      asin: row.asin,
      productType: row.productType,
      title: row.title,
      imageUrls,
      imageCount: readStatus === "complete" ? imageUrls.length : 0,
      readStatus,
      readErrors,
    };
  });
  const completed = rows.filter((row) => row.readStatus === "complete").length;
  return {
    marketplaceId: input.marketplaceId,
    fetchedAt: input.fetchedAt,
    minimumImages,
    rows,
    summary: {
      total: rows.length,
      completed,
      incomplete: rows.length - completed,
      underMinimum: rows.filter(
        (row) => row.readStatus === "complete" && row.imageCount < minimumImages,
      ).length,
    },
  };
}
