import {
  MARKETPLACES as MARKETPLACE_METADATA,
  type MarketplaceId,
  type MarketplaceRegion,
} from "../../shared/marketplaces";

export type SpApiMarketplace = {
  label: string;
  shortLabel: string;
  name: string;
  currency: string;
  region: MarketplaceRegion;
  issueLocale: string;
  timeZone: string;
};

/** Public, credential-free marketplace metadata used by the local console. */
export const MARKETPLACES = Object.freeze(
  Object.fromEntries(
    MARKETPLACE_METADATA.map((marketplace) => [
      marketplace.id,
      {
        label: marketplace.label.replace(/站$/u, ""),
        shortLabel: marketplace.shortLabel,
        name: marketplace.name,
        currency: marketplace.currency,
        region: marketplace.region,
        issueLocale: marketplace.locale.replace("-", "_"),
        timeZone: marketplace.timeZone,
      },
    ]),
  ) as Record<MarketplaceId, SpApiMarketplace>,
);

export function isMarketplaceId(value: string): value is MarketplaceId {
  return Object.hasOwn(MARKETPLACES, value);
}
