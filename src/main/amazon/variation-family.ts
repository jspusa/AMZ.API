export type VariationRole = "parent" | "child" | "standalone";

export type VariationDimension = {
  name: string;
  label: string;
  values: string[];
};

export type VariationIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};

export type VariationFamilyMember = {
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  status: string[];
  role: VariationRole;
  parentSku: string | null;
  childSkus: string[];
  variationTheme: string | null;
  dimensions: VariationDimension[];
  fba: boolean;
  issues: VariationIssue[];
  relationshipSources: Array<"relationships" | "attributes" | "variationParentSku">;
};

export type VariationFamilySnapshot = {
  mode: "live" | "demo";
  marketplaceId: string;
  queriedSku: string;
  queriedRole: VariationRole;
  queried: VariationFamilyMember;
  parent: VariationFamilyMember | null;
  children: VariationFamilyMember[];
  excludedChildren: Array<{
    sellerSku: string;
    reason: string;
  }>;
  variationTheme: string | null;
  dimensionNames: string[];
  familyComplete: boolean;
  fetchedAt: string;
  requestIds: string[];
  writable: false;
  boundaries: string[];
  notice: string;
};

type JsonRecord = Record<string, unknown>;

export type VariationListingPayload = {
  sku?: string;
  summaries?: Array<{
    marketplaceId?: string;
    asin?: string;
    productType?: string;
    status?: string[];
    itemName?: string;
  }>;
  productTypes?: Array<{
    marketplaceId?: string;
    productType?: string;
  }>;
  attributes?: Record<string, unknown>;
  relationships?: Array<{
    marketplaceId?: string;
    relationships?: Array<{
      type?: string;
      childSkus?: string[];
      parentSkus?: string[];
      variationTheme?: {
        attributes?: string[];
        theme?: string;
      };
    }>;
  }>;
  issues?: Array<{
    code?: string;
    severity?: string;
    message?: string;
    attributeName?: string;
    attributeNames?: string[];
  }>;
  fulfillmentAvailability?: Array<{
    fulfillmentChannelCode?: string;
    quantity?: number;
  }>;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function attributeItems(
  payload: VariationListingPayload,
  name: string,
  marketplaceId: string,
): JsonRecord[] {
  const raw = payload.attributes?.[name];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is JsonRecord => {
    if (!isRecord(item)) return false;
    const itemMarketplace = cleanText(item.marketplace_id);
    return !itemMarketplace || itemMarketplace === marketplaceId;
  });
}

function scalarValues(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return unique(value.flatMap((item) => scalarValues(item, depth + 1)));
  }
  if (!isRecord(value)) return [];

  // Listings attributes normally expose the customer-facing value under
  // `value`. Fall back to a small set of documented value containers without
  // serialising marketplace/language metadata as a variation dimension.
  for (const key of ["value", "name", "display_value", "value_name"]) {
    if (value[key] !== undefined) {
      const found = scalarValues(value[key], depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

function relationshipsForMarketplace(
  payload: VariationListingPayload,
  marketplaceId: string,
) {
  const groups = payload.relationships ?? [];
  const selected = groups.filter(
    (group) => !group.marketplaceId || group.marketplaceId === marketplaceId,
  );
  return (selected.length ? selected : groups).flatMap(
    (group) => group.relationships ?? [],
  );
}

function attributeParentSkus(
  payload: VariationListingPayload,
  marketplaceId: string,
): string[] {
  const direct = attributeItems(payload, "parent_sku", marketplaceId)
    .flatMap((item) => scalarValues(item.value));
  const relationships = attributeItems(
    payload,
    "child_parent_sku_relationship",
    marketplaceId,
  ).flatMap((item) => [
    ...scalarValues(item.parent_sku),
    ...(isRecord(item.value) ? scalarValues(item.value.parent_sku) : []),
  ]);
  return unique([...direct, ...relationships]);
}

function attributeParentage(
  payload: VariationListingPayload,
  marketplaceId: string,
): string | null {
  return (
    attributeItems(payload, "parentage_level", marketplaceId)
      .flatMap((item) => scalarValues(item.value))
      .map((value) => value.toLowerCase())
      .find((value) => value === "parent" || value === "child") ?? null
  );
}

function attributeVariationTheme(
  payload: VariationListingPayload,
  marketplaceId: string,
): string | null {
  for (const item of attributeItems(payload, "variation_theme", marketplaceId)) {
    const values = [
      ...scalarValues(item.name),
      ...scalarValues(item.value),
      ...(isRecord(item.value) ? scalarValues(item.value.name) : []),
    ];
    if (values[0]) return values[0];
  }
  return null;
}

function dimensionLabel(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferredThemeAttributes(
  payload: VariationListingPayload,
  theme: string | null,
): string[] {
  if (!theme || !payload.attributes) return [];
  return theme
    .split(/[\/,;+]/)
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter((name) => Boolean(name) && payload.attributes?.[name] !== undefined);
}

export function variationPayloadHasFba(
  payload: VariationListingPayload,
): boolean {
  return (payload.fulfillmentAvailability ?? []).some((availability) =>
    /^(AMAZON|AFN)(?:_|$)/i.test(
      cleanText(availability.fulfillmentChannelCode) ?? "",
    ),
  );
}

export function normalizeVariationMember(
  payload: VariationListingPayload,
  marketplaceId: string,
  relationshipSource: "relationships" | "attributes" | "variationParentSku" =
    "relationships",
): VariationFamilyMember {
  const summary =
    payload.summaries?.find((item) => item.marketplaceId === marketplaceId) ??
    payload.summaries?.[0];
  const relations = relationshipsForMarketplace(payload, marketplaceId);
  const relationshipParents = unique(
    relations.flatMap((relationship) => relationship.parentSkus ?? []),
  );
  const relationshipChildren = unique(
    relations.flatMap((relationship) => relationship.childSkus ?? []),
  );
  const attributeParents = attributeParentSkus(payload, marketplaceId);
  const parentSkus = unique([...relationshipParents, ...attributeParents]);
  const parentage = attributeParentage(payload, marketplaceId);
  const role: VariationRole = relationshipChildren.length || parentage === "parent"
    ? "parent"
    : parentSkus.length || parentage === "child"
      ? "child"
      : "standalone";
  const relationshipTheme = relations
    .map((relationship) => cleanText(relationship.variationTheme?.theme))
    .find((value): value is string => Boolean(value));
  const variationTheme =
    relationshipTheme ?? attributeVariationTheme(payload, marketplaceId);
  const relationshipDimensionNames = unique(
    relations.flatMap(
      (relationship) => relationship.variationTheme?.attributes ?? [],
    ),
  );
  const dimensionNames = unique([
    ...relationshipDimensionNames,
    ...inferredThemeAttributes(payload, variationTheme),
  ]);
  const relationshipSources: VariationFamilyMember["relationshipSources"] = [];
  if (relations.length) relationshipSources.push("relationships");
  if (attributeParents.length || parentage || attributeVariationTheme(payload, marketplaceId)) {
    relationshipSources.push("attributes");
  }
  if (relationshipSource === "variationParentSku") {
    relationshipSources.push("variationParentSku");
  }

  return {
    sellerSku: cleanText(payload.sku) ?? "",
    asin: cleanText(summary?.asin),
    title: cleanText(summary?.itemName) ?? "未命名 Listing",
    productType:
      cleanText(
        payload.productTypes?.find(
          (item) => item.marketplaceId === marketplaceId,
        )?.productType ?? payload.productTypes?.[0]?.productType,
      ) ?? cleanText(summary?.productType) ?? "PRODUCT",
    status: Array.isArray(summary?.status)
      ? summary.status.filter((value): value is string => typeof value === "string")
      : [],
    role,
    parentSku: parentSkus[0] ?? null,
    childSkus: relationshipChildren,
    variationTheme,
    dimensions: dimensionNames.map((name) => ({
      name,
      label: dimensionLabel(name),
      values: unique(
        attributeItems(payload, name, marketplaceId).flatMap((item) =>
          scalarValues(item),
        ),
      ),
    })),
    fba: variationPayloadHasFba(payload),
    issues: (payload.issues ?? []).map((issue) => ({
      code: cleanText(issue.code),
      severity: cleanText(issue.severity) ?? "INFO",
      message: cleanText(issue.message) ?? "Amazon 回傳未具名的 Listing 提醒。",
      attributeNames: unique([
        cleanText(issue.attributeName),
        ...(issue.attributeNames ?? []).map((value) => cleanText(value)),
      ]),
    })),
    relationshipSources: unique(relationshipSources) as VariationFamilyMember["relationshipSources"],
  };
}

export function applyVariationDimensionNames(
  payload: VariationListingPayload,
  marketplaceId: string,
  member: VariationFamilyMember,
  variationTheme: string | null,
  dimensionNames: string[],
): VariationFamilyMember {
  const names = unique([
    ...member.dimensions.map((dimension) => dimension.name),
    ...dimensionNames,
  ]);
  return {
    ...member,
    variationTheme: member.variationTheme ?? variationTheme,
    dimensions: names.map((name) => {
      const existing = member.dimensions.find(
        (dimension) => dimension.name === name,
      );
      return {
        name,
        label: existing?.label ?? dimensionLabel(name),
        values: unique([
          ...(existing?.values ?? []),
          ...attributeItems(payload, name, marketplaceId).flatMap((item) =>
            scalarValues(item),
          ),
        ]),
      };
    }),
  };
}

export function variationSearchIncludesDeclaredChildren(
  parent: VariationFamilyMember | null,
  searchedChildren: VariationFamilyMember[],
): boolean {
  if (!parent?.childSkus.length) return true;
  const searchedSkus = new Set(
    searchedChildren
      .map((child) => child.sellerSku.trim())
      .filter(Boolean),
  );
  return parent.childSkus.every((childSku) =>
    searchedSkus.has(childSku.trim()),
  );
}
