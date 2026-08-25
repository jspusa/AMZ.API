import {
  marketplaceByCode,
  type MarketplaceId,
} from "../../shared/marketplaces";

/** Product facts shared by deterministic FBA demo projections. */
export type DemoFbaCatalogRow = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
  unitAmount: number;
}>;

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

const JP_ROWS: readonly DemoFbaCatalogRow[] = Object.freeze([
  Object.freeze({
    sellerSku: "AFA100-JP",
    asin: "B0JPFA1001",
    title: "Afreschi 七面鳥筋肉ジャーキー 100g",
    unitAmount: 1_680,
  }),
  Object.freeze({
    sellerSku: "GTC454-JP",
    asin: "B0JPGTC454",
    title: "GooToE チキンジャーキー 454g",
    unitAmount: 2_980,
  }),
  Object.freeze({
    sellerSku: "AFA285-JP",
    asin: "B0JPFA2851",
    title: "Afreschi ターキーテンドン 285g",
    unitAmount: 3_680,
  }),
  Object.freeze({
    sellerSku: "HERZ-SC-JP",
    asin: "B0JPHERZ01",
    title: "HERZ ソフトチキントリーツ",
    unitAmount: 1_280,
  }),
]);

const NON_JP_ROWS: readonly DemoFbaCatalogRow[] = Object.freeze([
  Object.freeze({
    sellerSku: "AFA-TRKY-4OZ",
    asin: "B0USAFA004",
    title: "Afreschi Turkey Tendon Jerky, 4 oz",
    unitAmount: 13.99,
  }),
  Object.freeze({
    sellerSku: "GTC-CHKN-1LB",
    asin: "B0USGTC001",
    title: "GooToE Chicken Jerky Treats, 1 lb",
    unitAmount: 14.99,
  }),
  Object.freeze({
    sellerSku: "AFA-TRKY-285G",
    asin: "B0USAFA285",
    title: "Afreschi Turkey Tendon, 10 oz",
    unitAmount: 29.99,
  }),
  Object.freeze({
    sellerSku: "ACTL-TRAIN-8OZ",
    asin: "B0USACTL08",
    title: "Afreschi Training-Friendly Chicken Treats",
    unitAmount: 16.49,
  }),
]);

/** Neutral catalog rows; order timing and fulfillment semantics stay elsewhere. */
export function demoFbaCatalogRows(
  marketplaceId: MarketplaceId,
): readonly DemoFbaCatalogRow[] {
  return marketplaceId === JP_MARKETPLACE_ID ? JP_ROWS : NON_JP_ROWS;
}
