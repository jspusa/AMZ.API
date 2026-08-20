export const MARKETPLACES = [
  {
    id: "ATVPDKIKX0DER",
    code: "US",
    label: "美國站",
    shortLabel: "US",
    name: "Amazon.com",
    currency: "USD",
    region: "na",
    locale: "en-US",
    timeZone: "America/Los_Angeles",
    sampleSku: "AFA-TRKY-4OZ",
  },
  {
    id: "A1VC38T7YXB528",
    code: "JP",
    label: "日本站",
    shortLabel: "JP",
    name: "Amazon.co.jp",
    currency: "JPY",
    region: "fe",
    locale: "ja-JP",
    timeZone: "Asia/Tokyo",
    sampleSku: "AFA100-JP",
  },
  {
    id: "A2EUQ1WTGCTBG2",
    code: "CA",
    label: "加拿大站",
    shortLabel: "CA",
    name: "Amazon.ca",
    currency: "CAD",
    region: "na",
    locale: "en-CA",
    timeZone: "America/Vancouver",
    sampleSku: "AFA-TRKY-4OZ",
  },
  {
    id: "A19VAU5U5O7RUS",
    code: "SG",
    label: "新加坡站",
    shortLabel: "SG",
    name: "Amazon.sg",
    currency: "SGD",
    region: "fe",
    locale: "en-SG",
    timeZone: "Asia/Singapore",
    sampleSku: "AFA-TRKY-4OZ",
  },
  {
    id: "A39IBJ37TRP1C6",
    code: "AU",
    label: "澳洲站",
    shortLabel: "AU",
    name: "Amazon.com.au",
    currency: "AUD",
    region: "fe",
    locale: "en-AU",
    timeZone: "Australia/Sydney",
    sampleSku: "AFA-TRKY-4OZ",
  },
  {
    id: "A1F83G8C2ARO7P",
    code: "UK",
    label: "英國站",
    shortLabel: "UK",
    name: "Amazon.co.uk",
    currency: "GBP",
    region: "eu",
    locale: "en-GB",
    timeZone: "Europe/London",
    sampleSku: "AFA-TRKY-4OZ",
  },
  {
    id: "A1PA6795UKMFR9",
    code: "DE",
    label: "德國站",
    shortLabel: "DE",
    name: "Amazon.de",
    currency: "EUR",
    region: "eu",
    locale: "de-DE",
    timeZone: "Europe/Berlin",
    sampleSku: "AFA-TRKY-4OZ",
  },
] as const;

export type Marketplace = (typeof MARKETPLACES)[number];
export type MarketplaceId = Marketplace["id"];
export type MarketplaceCode = Marketplace["code"];
export type MarketplaceRegion = Marketplace["region"];

export const DEFAULT_MARKETPLACE_ID: MarketplaceId = MARKETPLACES[0].id;

export function marketplaceById(id: string): Marketplace | undefined {
  return MARKETPLACES.find((marketplace) => marketplace.id === id);
}

export function marketplaceByCode<Code extends MarketplaceCode>(
  code: Code,
): Extract<Marketplace, { code: Code }> {
  const marketplace = MARKETPLACES.find((candidate) => candidate.code === code);
  if (!marketplace) throw new Error(`Missing marketplace metadata for ${code}.`);
  return marketplace as Extract<Marketplace, { code: Code }>;
}

export function marketplaceSelectLabel(marketplace: Marketplace): string {
  return `${marketplace.code} · ${marketplace.label}`;
}
