/** Main-only proof of the actual single-market Listings GET and its raw attributes. */
declare const listingItemReadScopeBrand: unique symbol;
export type ListingItemReadScope = Readonly<{
  [listingItemReadScopeBrand]: true;
}>;

type ScopeRecord = Readonly<{
  marketplaceId: string;
  sellerSku: string;
  attributes: object;
}>;

const scopes = new WeakMap<object, ScopeRecord>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Called only by the production reader using the query attached to its response. */
export function captureListingItemReadScope(input: Readonly<{
  marketplaceIds: readonly string[];
  marketplaceId: string;
  sellerSku: string;
  envelope: unknown;
}>): ListingItemReadScope | undefined {
  if (
    input.marketplaceIds.length !== 1 ||
    input.marketplaceIds[0] !== input.marketplaceId ||
    !isRecord(input.envelope) ||
    input.envelope.sku !== input.sellerSku ||
    !isRecord(input.envelope.attributes)
  ) return undefined;
  const scope = Object.freeze({}) as ListingItemReadScope;
  scopes.set(scope, {
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    attributes: input.envelope.attributes,
  });
  return scope;
}

export function listingItemReadScopeMatches(input: Readonly<{
  scope: ListingItemReadScope | undefined;
  marketplaceId: string;
  sellerSku: string | undefined;
  attributes: unknown;
}>): boolean {
  if (!input.scope) return false;
  const record = scopes.get(input.scope);
  return Boolean(record &&
    record.marketplaceId === input.marketplaceId &&
    record.sellerSku === input.sellerSku &&
    record.attributes === input.attributes);
}
