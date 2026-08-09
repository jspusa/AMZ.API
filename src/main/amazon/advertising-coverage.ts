export type AdvertisingCoverageListing = {
  sellerSku: string;
  asin: string;
  title: string;
};

export type AdvertisingCoverageCampaign = {
  campaignId: string;
  name: string;
  state: "ENABLED" | "PAUSED" | "ARCHIVED";
  adProduct?: "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";
};

export type AdvertisingCoverageEvidence = {
  kind: "seller-sku" | "same-asin";
  campaignId: string;
  campaignName: string;
  campaignSellerSku: string;
};

export type AdvertisingCoverageRow = AdvertisingCoverageListing & {
  covered: boolean;
  evidence: AdvertisingCoverageEvidence | null;
};

export type AdvertisingCoverageSnapshot = {
  schemaVersion: 1;
  mode: "live" | "demo";
  marketplaceId: string;
  marketplaceCode: string;
  fetchedAt: string;
  rows: AdvertisingCoverageRow[];
  uncovered: AdvertisingCoverageRow[];
  summary: {
    currentFbaSkuCount: number;
    coveredSkuCount: number;
    directSkuCount: number;
    sameAsinCount: number;
    uncoveredSkuCount: number;
    eligibleCampaignCount: number;
    ignoredInactiveCampaignCount: number;
    ignoredMalformedCampaignCount: number;
  };
  rule: string;
  notice: string;
};

export class AdvertisingCoverageInputError extends Error {
  readonly code = "ADS_LISTING_COVERAGE_INCOMPLETE";

  constructor(message: string) {
    super(message);
    this.name = "AdvertisingCoverageInputError";
  }
}

type ParsedCampaignName = {
  marketplaceCode: string;
  asin: string;
  sellerSku: string;
};

const CAMPAIGN_NAME = /^\[ProductAI\]\s+([A-Z]{2})-([A-Z0-9]{10})-(.+)-SP-PAT-([A-Z][a-z]{2})(\d{1,2})(\d{4})$/u;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function validSellerSku(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 40 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validAsin(value: string): boolean {
  return /^[A-Z0-9]{10}$/u.test(value);
}

export function prepareAdvertisingCoverageListings(input: {
  rows: ReadonlyArray<{ sellerSku: string; asin: string; title: string }>;
  errors: readonly unknown[];
}): AdvertisingCoverageListing[] {
  if (input.errors.length) {
    throw new AdvertisingCoverageInputError(
      "FBA 全商品清單仍有讀取未完成，已停止 Ads 覆蓋健檢，不會把部分資料稱為全站。",
    );
  }
  const listings = input.rows.map((row) => ({
    sellerSku: row.sellerSku,
    asin: row.asin,
    title: row.title,
  }));
  if (listings.some((row) => !validSellerSku(row.sellerSku) || !validAsin(row.asin))) {
    throw new AdvertisingCoverageInputError(
      "FBA 全商品清單含缺失或無效的 Seller SKU／ASIN，已停止 Ads 覆蓋健檢。",
    );
  }
  return listings;
}

function validCampaignDate(month: string, dayText: string, yearText: string): boolean {
  const monthIndex = MONTHS.indexOf(month as (typeof MONTHS)[number]);
  const day = Number(dayText);
  const year = Number(yearText);
  if (monthIndex < 0 || !Number.isInteger(day) || !Number.isInteger(year)) return false;
  const candidate = new Date(Date.UTC(year, monthIndex, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === monthIndex &&
    candidate.getUTCDate() === day
  );
}

export function parseProductAiCampaignName(name: string): ParsedCampaignName | null {
  const match = CAMPAIGN_NAME.exec(name);
  if (!match) return null;
  const [, marketplaceCode, asin, sellerSku, month, day, year] = match;
  if (
    !validAsin(asin) ||
    !validSellerSku(sellerSku) ||
    !validCampaignDate(month, day, year)
  ) {
    return null;
  }
  return { marketplaceCode, asin, sellerSku };
}

function assertListings(listings: AdvertisingCoverageListing[]): void {
  const seen = new Set<string>();
  for (const listing of listings) {
    if (
      !validSellerSku(listing.sellerSku) ||
      !validAsin(listing.asin) ||
      typeof listing.title !== "string" ||
      seen.has(listing.sellerSku)
    ) {
      throw new Error("目前 FBA 商品清單無法安全用於廣告覆蓋健檢。");
    }
    seen.add(listing.sellerSku);
  }
}

export function auditAdvertisingCoverage(input: {
  mode: "live" | "demo";
  marketplaceId: string;
  marketplaceCode: string;
  listings: AdvertisingCoverageListing[];
  campaigns: AdvertisingCoverageCampaign[];
  fetchedAt?: string;
}): AdvertisingCoverageSnapshot {
  assertListings(input.listings);
  if (!/^[A-Z]{2}$/u.test(input.marketplaceCode)) {
    throw new Error("Amazon Ads 站點代碼無效。");
  }

  const listingBySku = new Map(
    input.listings.map((listing) => [listing.sellerSku, listing] as const),
  );
  const eligible: Array<{
    campaign: AdvertisingCoverageCampaign;
    parsed: ParsedCampaignName;
  }> = [];
  let ignoredInactiveCampaignCount = 0;
  let ignoredMalformedCampaignCount = 0;

  for (const campaign of input.campaigns) {
    if (campaign.state !== "ENABLED") {
      ignoredInactiveCampaignCount += 1;
      continue;
    }
    if (
      campaign.adProduct !== undefined &&
      campaign.adProduct !== "SPONSORED_PRODUCTS"
    ) {
      ignoredMalformedCampaignCount += 1;
      continue;
    }
    const parsed = parseProductAiCampaignName(campaign.name);
    const campaignListing = parsed ? listingBySku.get(parsed.sellerSku) : null;
    if (
      !parsed ||
      parsed.marketplaceCode !== input.marketplaceCode ||
      !campaignListing ||
      campaignListing.asin !== parsed.asin
    ) {
      ignoredMalformedCampaignCount += 1;
      continue;
    }
    eligible.push({ campaign, parsed });
  }

  eligible.sort((left, right) =>
    left.campaign.name.localeCompare(right.campaign.name) ||
    left.campaign.campaignId.localeCompare(right.campaign.campaignId),
  );

  const rows = [...input.listings]
    .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku))
    .map((listing): AdvertisingCoverageRow => {
      const direct = eligible.find(
        ({ parsed }) =>
          parsed.sellerSku === listing.sellerSku && parsed.asin === listing.asin,
      );
      const sameAsin = direct
        ? null
        : eligible.find(({ parsed }) => parsed.asin === listing.asin);
      const match = direct ?? sameAsin;
      return {
        ...listing,
        covered: Boolean(match),
        evidence: match
          ? {
              kind: direct ? "seller-sku" : "same-asin",
              campaignId: match.campaign.campaignId,
              campaignName: match.campaign.name,
              campaignSellerSku: match.parsed.sellerSku,
            }
          : null,
      };
    });
  const uncovered = rows.filter((row) => !row.covered);
  const directSkuCount = rows.filter(
    (row) => row.evidence?.kind === "seller-sku",
  ).length;
  const sameAsinCount = rows.filter(
    (row) => row.evidence?.kind === "same-asin",
  ).length;

  return {
    schemaVersion: 1,
    mode: input.mode,
    marketplaceId: input.marketplaceId,
    marketplaceCode: input.marketplaceCode,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    rows,
    uncovered,
    summary: {
      currentFbaSkuCount: rows.length,
      coveredSkuCount: rows.length - uncovered.length,
      directSkuCount,
      sameAsinCount,
      uncoveredSkuCount: uncovered.length,
      eligibleCampaignCount: eligible.length,
      ignoredInactiveCampaignCount,
      ignoredMalformedCampaignCount,
    },
    rule:
      "只計入 ENABLED Sponsored Products 活動；名稱必須符合 [ProductAI] 站點-ASIN-SKU-SP-PAT-日期。Seller SKU 完全相同，或已證明的同 ASIN SKU，才視為有廣告覆蓋。",
    notice:
      "健檢只讀取同次完整 FBA SKU 清單與 Amazon Ads campaigns；不建立、不暫停，也不修改任何廣告。",
  };
}
