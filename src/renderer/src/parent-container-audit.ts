import {
  parseVariationFamilyResponse,
} from "./variation-planner";

type AuditReadError = {
  code: string;
  message: string;
};

export type ParentCheckAuditRow = {
  sellerSku: string;
  asin?: string;
  readStatus: "complete" | "incomplete";
  readErrors: readonly AuditReadError[];
};

export type ParentContainerLookup = (
  row: ParentCheckAuditRow,
  signal: AbortSignal,
) => Promise<boolean>;

export type ParentContainerExclusion<T> = {
  rows: T[];
  excludedParentSkus: string[];
};

export function needsParentContainerProof(row: ParentCheckAuditRow): boolean {
  return row.readStatus === "incomplete" && row.readErrors.some(
    (error) =>
      error.code === "LISTING_CONTENT_NOT_RETURNED" &&
      error.message.includes("fulfillmentAvailability"),
  );
}

async function lookupProvenParentContainer(
  marketplaceId: string,
  row: ParentCheckAuditRow,
  signal: AbortSignal,
): Promise<boolean> {
  const params = new URLSearchParams({ marketplaceId, sku: row.sellerSku });
  const response = await fetch(`/api/sp-api/variation-family?${params}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return false;
  const raw = (await response.json()) as unknown;
  const family = parseVariationFamilyResponse(raw, {
    marketplaceId,
    sellerSku: row.sellerSku,
  });
  return (
    family.mode === "live" &&
    family.queriedRole === "parent" &&
    family.queried.role === "parent" &&
    family.queried.relationshipSources.includes("relationships") &&
    family.queried.childSkus.length > 0 &&
    typeof row.asin === "string" &&
    row.asin.length > 0 &&
    family.queried.asin === row.asin
  );
}

export async function excludeProvenParentContainers<
  T extends ParentCheckAuditRow,
>(input: {
  marketplaceId: string;
  rows: readonly T[];
  signal: AbortSignal;
  lookup?: ParentContainerLookup;
}): Promise<ParentContainerExclusion<T>> {
  const lookup = input.lookup ?? ((row, signal) =>
    lookupProvenParentContainer(input.marketplaceId, row, signal));
  const parentBySku = new Map<string, boolean>();

  for (const row of input.rows) {
    if (!needsParentContainerProof(row) || parentBySku.has(row.sellerSku)) continue;
    try {
      input.signal.throwIfAborted();
      parentBySku.set(row.sellerSku, await lookup(row, input.signal));
      input.signal.throwIfAborted();
    } catch (error) {
      if (input.signal.aborted) throw error;
      // A failed or ambiguous secondary read must stay visible as incomplete.
      parentBySku.set(row.sellerSku, false);
    }
  }

  const excludedParentSkus = input.rows
    .filter((row) => parentBySku.get(row.sellerSku) === true)
    .map((row) => row.sellerSku);
  const excluded = new Set(excludedParentSkus);
  return {
    rows: input.rows.filter((row) => !excluded.has(row.sellerSku)),
    excludedParentSkus,
  };
}
