import { SpApiError } from "./sp-api-error";

const EXACT_BATCH_SELLER_SKU =
  /^(?!.*[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]).+$/u;

export const EXACT_SELLER_SKU_BATCH_SIZE = 20;

/**
 * Plans fixed Listings identifier batches without trimming, aliasing, or
 * falling back to per-SKU requests. Values that cannot be represented exactly
 * in the official comma-delimited identifiers parameter remain explicit.
 */
export function planExactSellerSkuBatches(
  sellerSkus: readonly string[],
): { batches: string[][]; unqueryableSellerSkus: string[] } {
  const batches: string[][] = [];
  const unqueryableSellerSkus: string[] = [];
  const seen = new Set<string>();
  let batch: string[] = [];

  for (const sellerSku of sellerSkus) {
    if (seen.has(sellerSku)) {
      throw new SpApiError("批次含有重複 Seller SKU。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seen.add(sellerSku);
    const queryable =
      typeof sellerSku === "string" &&
      Boolean(sellerSku) &&
      sellerSku.length <= 40 &&
      sellerSku === sellerSku.trim() &&
      !sellerSku.includes(",") &&
      EXACT_BATCH_SELLER_SKU.test(sellerSku);
    if (!queryable) {
      unqueryableSellerSkus.push(sellerSku);
      continue;
    }
    batch.push(sellerSku);
    if (batch.length === EXACT_SELLER_SKU_BATCH_SIZE) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);
  return { batches, unqueryableSellerSkus };
}
