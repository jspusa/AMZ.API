import { businessPricingRecommendationFlags } from
  "../../shared/business-pricing-recommendations";
import type { MarketplaceId } from "../../shared/marketplaces";
import { throwIfAborted as assertNotAborted } from "../abort-utils";
import type { BusinessPricingListingSnapshot } from
  "./business-pricing-types";
import {
  summarizeBusinessPricingAuditRows,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type FbaCatalogExport,
  type FbaCatalogIdentitySnapshot,
  type FbaCatalogSeed,
} from "./catalog-report-reads";
import { demoFbaCatalogRows } from "./demo-fba-catalog";
import type { FbaCatalogReportsDemoSource } from "./fba-catalog-reports";
import type { ListingContentSnapshot } from "./listing-content-types";
import {
  buildAllVariationFamilyRows,
  type VerifiedVariationFamilyMember,
} from "./unbound-variation-audit";
import type { VariationDemoRuntime } from "./variation-demo-runtime";
import type {
  UnboundVariationAuditRow,
  UnboundVariationAuditSnapshot,
} from "./variation-catalog-reads";

export type CatalogReportsDemoIdentity = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
}>;

type CatalogReportsDemoContent = Pick<
  ListingContentSnapshot,
  | "asin"
  | "productType"
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients"
  | "status"
  | "updatedAt"
>;

type CatalogReportsDemoBusinessPricing = Pick<
  BusinessPricingListingSnapshot,
  | "sellerSku"
  | "asin"
  | "title"
  | "productType"
  | "standardPrice"
  | "businessPrice"
  | "businessOfferPresence"
  | "quantityDiscountPlan"
  | "quantityDiscountPlanPresence"
>;

export type CatalogReportsDemoSourceDependencies = Readonly<{
  marketplaceDisplayName(marketplaceId: MarketplaceId): string;
  readDemoContent(
    identity: CatalogReportsDemoIdentity,
  ): CatalogReportsDemoContent;
  readDemoBusinessPricing(
    identity: CatalogReportsDemoIdentity,
  ): CatalogReportsDemoBusinessPricing;
  variationDemo: Pick<VariationDemoRuntime, "readFamily">;
}>;

function demoAllListingsExportData(
  dependencies: CatalogReportsDemoSourceDependencies,
  marketplaceId: MarketplaceId,
): FbaCatalogExport {
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(marketplaceId).map((item) => item.sellerSku),
    ),
  ];
  const rows = sellerSkus.map((sellerSku, index) => {
    const listing = dependencies.readDemoContent({
      marketplaceId,
      sellerSku,
    });
    return {
      marketplace: dependencies.marketplaceDisplayName(marketplaceId),
      sellerSku,
      asin: listing.asin ?? "",
      productType: listing.productType,
      title: listing.title,
      itemHighlight: listing.itemHighlight,
      bulletPoints: listing.bulletPoints,
      productDescription: listing.productDescription,
      ingredients: listing.ingredients,
      imageUrls: Array.from(
        { length: index === 0 ? 4 : 7 },
        (_, imageIndex) =>
          `https://images.example.invalid/${encodeURIComponent(sellerSku)}/${imageIndex + 1}.jpg`,
      ),
      status: listing.status.join(", "),
      updatedAt: listing.updatedAt ?? "",
      readStatus: "complete" as const,
      readErrors: [],
    };
  });
  return { rows, errors: [], fetchedAt: new Date().toISOString() };
}

function demoFbaCatalogIdentity(
  dependencies: CatalogReportsDemoSourceDependencies,
  marketplaceId: MarketplaceId,
  signal?: AbortSignal,
): FbaCatalogIdentitySnapshot {
  assertNotAborted(signal);
  const data = demoAllListingsExportData(dependencies, marketplaceId);
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt: data.fetchedAt,
    rows: data.rows.map(({ sellerSku, asin, title }) => ({
      sellerSku,
      asin,
      title,
    })),
    notice: "展示資料只供廣告策略表版面測試，不是你的真實 FBA 商品。",
  };
}

function demoBusinessPricingAuditData(
  dependencies: CatalogReportsDemoSourceDependencies,
  marketplaceId: MarketplaceId,
  signal?: AbortSignal,
): BusinessPricingAuditSnapshot {
  assertNotAborted(signal);
  const listingData = demoAllListingsExportData(dependencies, marketplaceId);
  const rows = listingData.rows.map((row): BusinessPricingAuditRow => {
    const listing = dependencies.readDemoBusinessPricing({
      marketplaceId,
      sellerSku: row.sellerSku,
    });
    const status: BusinessPricingAuditRow["status"] =
      listing.businessOfferPresence === "present"
        ? listing.standardPrice && listing.businessPrice &&
            listing.businessPrice.amount > listing.standardPrice.amount
          ? "above_standard"
          : "configured"
        : listing.businessOfferPresence === "absent"
          ? "missing"
          : "incomplete";
    const auditRow = {
      sellerSku: listing.sellerSku,
      asin: listing.asin ?? "",
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: listing.businessPrice,
      businessOfferPresence: listing.businessOfferPresence,
      quantityDiscountPlan: listing.quantityDiscountPlan,
      quantityDiscountPlanPresence: listing.quantityDiscountPlanPresence,
      status,
      editable: false as const,
      reason: status === "above_standard"
        ? "Amazon Business 價格高於一般售價；展示資料僅供檢視，不會寫入 Amazon。"
        : status === "configured"
          ? "已設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。"
          : status === "missing"
            ? "尚未設定 Amazon Business 價格；展示資料僅供檢視，不會寫入 Amazon。"
            : "B2B offer 證據不完整，展示模式已停止編輯。",
    };
    return {
      ...auditRow,
      ...businessPricingRecommendationFlags({
        standardPrice: auditRow.standardPrice,
        businessPrice: auditRow.businessPrice,
        quantityDiscountPlan: auditRow.quantityDiscountPlan,
        quantityDiscountPlanPresence:
          auditRow.quantityDiscountPlanPresence,
      }),
    };
  });
  assertNotAborted(signal);
  return {
    mode: "demo",
    marketplaceId,
    fetchedAt: listingData.fetchedAt,
    rows,
    summary: summarizeBusinessPricingAuditRows(rows),
    notice:
      "展示快照只供 B2B 價格健檢版面與安全流程測試，不是 Amazon 真實 Business Price。",
  };
}

function demoUnboundVariationAuditSnapshot(
  dependencies: CatalogReportsDemoSourceDependencies,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    signal?: AbortSignal;
  }>,
): UnboundVariationAuditSnapshot {
  const sellerSkus = [
    ...new Set(
      demoFbaCatalogRows(input.marketplaceId).map((item) => item.sellerSku),
    ),
  ];
  const rows: UnboundVariationAuditRow[] = [];
  const verifiedVariationMembers: VerifiedVariationFamilyMember[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  for (const sellerSku of sellerSkus) {
    assertNotAborted(input.signal);
    const family = dependencies.variationDemo.readFamily(
      input.marketplaceId,
      sellerSku,
    );
    verifiedVariationMembers.push({
      sellerSku: family.queried.sellerSku,
      title: family.queried.title,
      productType: family.queried.productType,
      role: family.queried.role,
      parentSku: family.queried.parentSku,
      variationTheme: family.queried.variationTheme,
    });
    if (family.queried.role === "standalone") {
      rows.push({
        sellerSku,
        asin: family.queried.asin ?? "",
        title: family.queried.title,
        productType: family.queried.productType,
        relationshipEvidence: "relationships",
        notice: "展示 relationships 明確沒有 parent；不會寫入 Amazon。",
      });
    } else if (family.queried.role === "child") {
      boundChildren += 1;
    } else {
      parentContainers += 1;
    }
  }
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    fetchedAt: new Date().toISOString(),
    rows,
    incompleteRows: [],
    allVariationRows: buildAllVariationFamilyRows(verifiedVariationMembers),
    summary: {
      totalFbaListings: sellerSkus.length,
      completed: sellerSkus.length,
      unbound: rows.length,
      boundChildren,
      parentContainers,
      incomplete: 0,
    },
    notice:
      "展示結果只驗證流程；正式模式會以官方 searchListingsItems 每批最多 20 個 SKU 要求 Amazon relationships 證據。",
  };
}

/** Fixed FBA-only demo projections for the Catalog report coordinator. */
export function createCatalogReportsDemoSource(
  dependencies: CatalogReportsDemoSourceDependencies,
): FbaCatalogReportsDemoSource {
  const source: FbaCatalogReportsDemoSource = {
    export: ({ marketplaceId, signal }) => {
      assertNotAborted(signal);
      return demoAllListingsExportData(dependencies, marketplaceId);
    },
    identity: ({ marketplaceId, signal }) =>
      demoFbaCatalogIdentity(dependencies, marketplaceId, signal),
    seeds: ({ marketplaceId, signal }): FbaCatalogSeed[] => {
      assertNotAborted(signal);
      return demoAllListingsExportData(dependencies, marketplaceId).rows.map(
        ({ sellerSku, asin, title }) => ({ sellerSku, asin, title }),
      );
    },
    businessPricingAudit: ({ marketplaceId, signal }) =>
      demoBusinessPricingAuditData(
        dependencies,
        marketplaceId,
        signal,
      ),
    unboundVariationAudit: (input) =>
      demoUnboundVariationAuditSnapshot(dependencies, input),
  };
  return Object.freeze(source);
}
