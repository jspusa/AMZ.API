const SELLER_CENTRAL_INVENTORY_PREFIX =
  "https://sellercentral.amazon.com/myinventory/inventory?fulfilledBy=all&page=1&pageSize=250&searchField=all&searchTerm=";
const SELLER_CENTRAL_INVENTORY_SUFFIX =
  "&sort=date_created_desc&status=all&ref_=xx_invmgr_favb_xx";

export function sellerCentralInventoryUrl(sellerSku: unknown): string {
  if (
    typeof sellerSku !== "string" ||
    sellerSku.length < 1 ||
    sellerSku.length > 40 ||
    sellerSku !== sellerSku.trim() ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
      sellerSku,
    )
  ) {
    throw new TypeError("Seller SKU 無法安全辨識。");
  }
  return `${SELLER_CENTRAL_INVENTORY_PREFIX}${encodeURIComponent(sellerSku)}${SELLER_CENTRAL_INVENTORY_SUFFIX}`;
}
