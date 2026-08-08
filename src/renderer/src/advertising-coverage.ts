export type AdvertisingCoverageSnapshot = {
  schemaVersion: 1;
  mode: "live" | "demo";
  marketplaceId: string;
  marketplaceCode: string;
  fetchedAt: string;
  rows: Array<{
    sellerSku: string;
    asin: string;
    title: string;
    covered: boolean;
    evidence: null | {
      kind: "seller-sku" | "same-asin";
      campaignId: string;
      campaignName: string;
      campaignSellerSku: string;
    };
  }>;
  uncovered: AdvertisingCoverageSnapshot["rows"];
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sku(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 40 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function parseAdvertisingCoverageSnapshot(
  value: unknown,
  expectedMarketplaceId: string,
): AdvertisingCoverageSnapshot {
  const root = record(value);
  const summary = record(root?.summary);
  if (
    !root ||
    root.schemaVersion !== 1 ||
    (root.mode !== "live" && root.mode !== "demo") ||
    root.marketplaceId !== expectedMarketplaceId ||
    typeof root.marketplaceCode !== "string" ||
    !/^[A-Z]{2}$/u.test(root.marketplaceCode) ||
    typeof root.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(root.fetchedAt)) ||
    !Array.isArray(root.rows) ||
    !Array.isArray(root.uncovered) ||
    !summary ||
    typeof root.rule !== "string" ||
    typeof root.notice !== "string"
  ) {
    throw new Error("廣告覆蓋健檢回應無法安全辨識。");
  }
  const rows = root.rows.map((raw) => {
    const row = record(raw);
    const evidence = row?.evidence === null ? null : record(row?.evidence);
    if (
      !row ||
      !sku(row.sellerSku) ||
      typeof row.asin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(row.asin) ||
      typeof row.title !== "string" ||
      typeof row.covered !== "boolean" ||
      (row.covered !== Boolean(evidence)) ||
      (evidence &&
        ((evidence.kind !== "seller-sku" && evidence.kind !== "same-asin") ||
          typeof evidence.campaignId !== "string" ||
          !evidence.campaignId ||
          typeof evidence.campaignName !== "string" ||
          !evidence.campaignName ||
          !sku(evidence.campaignSellerSku)))
    ) {
      throw new Error("廣告覆蓋健檢回應無法安全辨識。");
    }
    return {
      sellerSku: row.sellerSku,
      asin: row.asin,
      title: row.title,
      covered: row.covered,
      evidence: evidence
        ? {
            kind: evidence.kind,
            campaignId: evidence.campaignId,
            campaignName: evidence.campaignName,
            campaignSellerSku: evidence.campaignSellerSku,
          }
        : null,
    } as AdvertisingCoverageSnapshot["rows"][number];
  });
  if (new Set(rows.map((row) => row.sellerSku)).size !== rows.length) {
    throw new Error("廣告覆蓋健檢含有重複 FBA SKU。");
  }
  const uncovered = rows.filter((row) => !row.covered);
  const suppliedUncovered = root.uncovered.map((raw) => {
    const row = record(raw);
    return typeof row?.sellerSku === "string" ? row.sellerSku : null;
  });
  const directSkuCount = rows.filter((row) => row.evidence?.kind === "seller-sku").length;
  const sameAsinCount = rows.filter((row) => row.evidence?.kind === "same-asin").length;
  const countKeys = [
    "currentFbaSkuCount",
    "coveredSkuCount",
    "directSkuCount",
    "sameAsinCount",
    "uncoveredSkuCount",
    "eligibleCampaignCount",
    "ignoredInactiveCampaignCount",
    "ignoredMalformedCampaignCount",
  ] as const;
  if (
    countKeys.some((key) => !count(summary[key])) ||
    summary.currentFbaSkuCount !== rows.length ||
    summary.coveredSkuCount !== rows.length - uncovered.length ||
    summary.directSkuCount !== directSkuCount ||
    summary.sameAsinCount !== sameAsinCount ||
    summary.uncoveredSkuCount !== uncovered.length ||
    suppliedUncovered.length !== uncovered.length ||
    suppliedUncovered.some((value, index) => value !== uncovered[index]?.sellerSku)
  ) {
    throw new Error("廣告覆蓋健檢加總與 SKU 明細不一致。");
  }
  return {
    schemaVersion: 1,
    mode: root.mode,
    marketplaceId: root.marketplaceId,
    marketplaceCode: root.marketplaceCode,
    fetchedAt: root.fetchedAt,
    rows,
    uncovered,
    summary: {
      currentFbaSkuCount: summary.currentFbaSkuCount,
      coveredSkuCount: summary.coveredSkuCount,
      directSkuCount: summary.directSkuCount,
      sameAsinCount: summary.sameAsinCount,
      uncoveredSkuCount: summary.uncoveredSkuCount,
      eligibleCampaignCount: summary.eligibleCampaignCount as number,
      ignoredInactiveCampaignCount: summary.ignoredInactiveCampaignCount as number,
      ignoredMalformedCampaignCount: summary.ignoredMalformedCampaignCount as number,
    },
    rule: root.rule,
    notice: root.notice,
  };
}
