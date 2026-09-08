import { describe, expect, it } from "vitest";
import { PriceHealthReads } from "../src/main/amazon/price-health-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";

const US = "ATVPDKIKX0DER" as const;
const fba = [{ sellerSku: "TEST-FBA-1", asin: "B000000001" }];

function contextAdapter() {
  return createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: US, mode: "live", accountScope: "fixture-account",
  }));
}

function summary(asin = "B000000001", sellerId = "fixture-other") {
  return {
    status: { statusCode: 200 },
    body: {
      asin, marketplaceId: US,
      featuredBuyingOptions: [{
        buyingOptionType: "New",
        segmentedFeaturedOffers: [{
          sellerId, condition: "New", fulfillmentType: "AFN",
          listingPrice: { amount: 18, currencyCode: "USD" },
          featuredOfferSegments: [{ customerMembership: "PRIME", segmentDetails: {} }],
        }],
      }],
      referencePrices: [{
        name: "CompetitivePriceThreshold", price: { amount: 17, currencyCode: "USD" },
      }],
    },
  };
}

describe("PriceHealthReads", () => {
  it("reports segmented competitor evidence as needs-review without declaring lost eligibility or guessing our price", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({
      context,
      adapter: {
        readCompetitiveSummary: async () => ({
          payload: { responses: [summary()] }, ownSellerId: "fixture-own",
        })
      },
    });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result).toMatchObject({
      marketplaceId: US, mode: "live", coverage: "complete",
      rows: [{
        sellerSku: "TEST-FBA-1", asin: "B000000001", status: "needs-review",
        availability: "complete", currentPrice: null, overallEligibility: "unknown",
        featuredObservation: "other-observed",
        segments: [{
          membership: "PRIME", isOwnSeller: false, fulfillment: "AFN",
          listingPrice: { amount: 18, currencyCode: "USD" }, shippingPrice: null,
          glanceViewWeightPercentage: null
        }],
        referencePrices: [{ name: "CompetitivePriceThreshold", price: { amount: 17, currencyCode: "USD" } }],
      }],
      findings: [{ source: "price-health", sellerSku: "TEST-FBA-1", severity: "warning", title: "Featured Offer 分段需核對" }],
    });
    expect(JSON.stringify(result)).not.toContain("fixture-other");
    expect(JSON.stringify(result)).not.toContain("fixture-own");
  });

  it("matches each batch response by exact identity and preserves permission failure as unavailable, not an empty healthy row", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({
      context, adapter: {
        readCompetitiveSummary: async () => ({
          ownSellerId: "fixture-own", payload: {
            responses: [
              { status: { statusCode: 403 }, body: { asin: "B000000002", marketplaceId: US, errors: [{ message: "unsafe upstream detail" }] } },
              summary("B000000001", "fixture-own"),
            ]
          },
        })
      }
    });
    const result = await owner.read({
      context: await context.capture(US), signal: new AbortController().signal,
      fba: [...fba, { sellerSku: "TEST-FBA-2", asin: "B000000002" }],
    });
    expect(result).toMatchObject({
      coverage: "partial", rows: [
        { sellerSku: "TEST-FBA-1", status: "observed", featuredObservation: "own-observed" },
        { sellerSku: "TEST-FBA-2", status: "insufficient-evidence", availability: "unavailable", segments: [], referencePrices: [], warnings: ["價格資料權限不足；請核對 Product Pricing 授權。"] },
      ]
    });
    expect(JSON.stringify(result)).not.toContain("unsafe upstream detail");
  });

  it.each([
    {},
    { featuredBuyingOptions: [], referencePrices: [] },
    { featuredBuyingOptions: [{ buyingOptionType: "B2B", segmentedFeaturedOffers: [] }], referencePrices: [] },
  ])("keeps missing or unsupported featured evidence unknown: %j", async evidence => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({
      context, adapter: {
        readCompetitiveSummary: async () => ({
          ownSellerId: "fixture-own", payload: {
            responses: [{
              status: { statusCode: 200 }, body: {
                asin: "B000000001", marketplaceId: US, ...evidence,
              }
            }]
          },
        })
      }
    });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result).toMatchObject({
      coverage: "partial", rows: [{
        status: "insufficient-evidence", availability: "partial", overallEligibility: "unknown", featuredObservation: "unknown",
      }]
    });
  });

  it("reads more than twenty unique ASINs in bounded batches, including duplicate-ASIN FBA SKU projections", async () => {
    const context = contextAdapter();
    const identities = Array.from({ length: 21 }, (_, i) => ({ sellerSku: `TEST-${i}`, asin: `B${String(i).padStart(9, "0")}` }));
    identities.push({ sellerSku: "TEST-ALTERNATE", asin: identities[0]!.asin });
    const owner = new PriceHealthReads({
      context, adapter: {
        readCompetitiveSummary: async plan => {
          if (plan.asins.length > 20) throw new Error("Amazon rejects batches above twenty");
          return { ownSellerId: "fixture-own", payload: { responses: plan.asins.map(asin => summary(asin, "fixture-own")).reverse() } };
        }
      }
    });
    const result = await owner.read({ context: await context.capture(US), fba: identities, signal: new AbortController().signal });
    expect(result.coverage).toBe("complete");
    expect(result.rows).toHaveLength(22);
    expect(result.rows[21]).toMatchObject({ sellerSku: "TEST-ALTERNATE", featuredObservation: "own-observed" });
  });

  it("keeps demo explicitly unavailable without calling the live API", async () => {
    const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "demo", accountScope: "fixture-demo" }));
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => { throw new Error("Live API must not run for demo"); } } });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result).toMatchObject({ mode: "demo", coverage: "partial", findings: [], rows: [{ availability: "unavailable" }] });
  });

  it("rejects duplicate or whitespace-aliased FBA identities before the external request", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => { throw new Error("Unverified FBA identity must not reach API"); } } });
    await expect(owner.read({ context: await context.capture(US), fba: [{ ...fba[0]!, sellerSku: " TEST-FBA-1" }], signal: new AbortController().signal })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
    await expect(owner.read({ context: await context.capture(US), fba: [fba[0]!, fba[0]!], signal: new AbortController().signal })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
  });

  it("preserves available shipping and glance-view weighting per returned segment without fabricating geographic reach", async () => {
    const context = contextAdapter();
    const response = summary("B000000001", "fixture-own");
    const offer = response.body.featuredBuyingOptions[0]!.segmentedFeaturedOffers[0]!;
    Object.assign(offer, { shippingOptions: [{ shippingOptionType: "DEFAULT", price: { amount: 2.5, currencyCode: "USD" } }] });
    Object.assign(offer.featuredOfferSegments[0]!.segmentDetails, { glanceViewWeightPercentage: 34, sampleLocation: { postalCode: { value: "sensitive-location", countryCode: "US" } } });
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own", payload: { responses: [response] } }) } });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result.rows[0]!.segments[0]).toMatchObject({ shippingPrice: { amount: 2.5, currencyCode: "USD" }, glanceViewWeightPercentage: 34 });
    expect(JSON.stringify(result)).not.toContain("sensitive-location");
  });

  it("preserves the account fence even if the old external call fails after invalidation", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({
      context, adapter: {
        readCompetitiveSummary: async () => {
          context.invalidate("account-changed");
          throw new Error("Old-account upstream failure");
        }
      }
    });
    await expect(owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED", status: 409 });
  });

  it("stops later batches when an individual read reports throttling, retaining only the verified completed evidence", async () => {
    const context = contextAdapter();
    const identities = Array.from({ length: 21 }, (_, i) => ({ sellerSku: `TEST-${i}`, asin: `B${String(i).padStart(9, "0")}` }));
    let batches = 0;
    const owner = new PriceHealthReads({
      context, adapter: {
        readCompetitiveSummary: async input => {
          if (++batches > 1) throw new Error("Subsequent batch should stop after throttle");
          return { ownSellerId: "fixture-own", payload: { responses: input.asins.map((asin, index) => index ? summary(asin, "fixture-own") : ({ status: { statusCode: 429 }, body: { asin, marketplaceId: US } })) } };
        }
      }
    });
    const result = await owner.read({ context: await context.capture(US), fba: identities, signal: new AbortController().signal });
    expect(result.coverage).toBe("partial");
    expect(result.rows[1]).toMatchObject({ availability: "complete", status: "observed" });
    expect(result.rows[20]).toMatchObject({ availability: "unavailable" });
  });

  it("bounds public segments per product and marks truncated evidence partial", async () => {
    const context = contextAdapter();
    const response = summary();
    const option = response.body.featuredBuyingOptions[0]!;
    const offer = option.segmentedFeaturedOffers[0]!;
    offer.featuredOfferSegments = Array.from({ length: 100 }, () => ({ customerMembership: "PRIME", segmentDetails: {} }));
    option.segmentedFeaturedOffers = [offer, offer, offer];
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own", payload: { responses: [response] } }) } });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result.coverage).toBe("partial");
    expect(result.rows[0]!.segments).toHaveLength(200);
  });

  it("does not treat an own merchant-fulfilled featured offer as confirmed own FBA featured evidence", async () => {
    const context = contextAdapter();
    const response = summary("B000000001", "fixture-own");
    response.body.featuredBuyingOptions[0]!.segmentedFeaturedOffers[0]!.fulfillmentType = "MFN";
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own", payload: { responses: [response] } }) } });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", rows: [{ availability: "partial", status: "insufficient-evidence", featuredObservation: "unknown" }] });
  });

  it.each(["wrong-marketplace", "unrequested-asin", "duplicate-response"])("rejects %s instead of guessing batch response order", async variant => {
    const context = contextAdapter();
    const response = summary();
    if (variant === "wrong-marketplace") Object.assign(response.body, { marketplaceId: "A1VC38T7YXB528" });
    if (variant === "unrequested-asin") response.body.asin = "B000000099";
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own", payload: { responses: variant === "duplicate-response" ? [response, response] : [response] } }) } });
    await expect(owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal })).rejects.toMatchObject({ code: "PRICE_HEALTH_IDENTITY_MISMATCH" });
  });

  it("keeps missing batch items, wrong-currency reference amounts and absent own identity unknown", async () => {
    const context = contextAdapter();
    const response = summary();
    response.body.referencePrices[0]!.price.currencyCode = "JPY";
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: null, payload: { responses: [response] } }) } });
    const result = await owner.read({ context: await context.capture(US), fba: [...fba, { sellerSku: "TEST-FBA-2", asin: "B000000002" }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", findings: [], rows: [
      { status: "insufficient-evidence", featuredObservation: "unknown", referencePrices: [{ price: null }] },
      { availability: "unavailable", referencePrices: [], currentPrice: null },
    ] });
  });

  it("discards successful old-account evidence when the generation changes before completion", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => {
      context.invalidate("credentials-cleared");
      return { ownSellerId: "fixture-own", payload: { responses: [summary()] } };
    } } });
    await expect(owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal })).rejects.toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
  });

  it("keeps duplicate reference-price names ambiguous instead of choosing a threshold", async () => {
    const context = contextAdapter();
    const response = summary("B000000001", "fixture-own");
    response.body.referencePrices.push({ name: "CompetitivePriceThreshold", price: { amount: 14, currencyCode: "USD" } });
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({ ownSellerId: "fixture-own", payload: { responses: [response] } }) } });
    const result = await owner.read({ context: await context.capture(US), fba, signal: new AbortController().signal });
    expect(result.coverage).toBe("partial");
    expect(result.rows[0]!.referencePrices).toEqual([{ name: "CompetitivePriceThreshold", price: null }]);
  });

  it("uses stable opaque finding keys while preserving verified numeric Seller SKUs separately", async () => {
    const context = contextAdapter();
    const owner = new PriceHealthReads({ context, adapter: { readCompetitiveSummary: async () => ({
      ownSellerId: "fixture-own", payload: { responses: [summary()] },
    }) } });
    const input = { context: await context.capture(US), fba: [{ sellerSku: "123456789012", asin: "B000000001" }], signal: new AbortController().signal };
    const first = await owner.read(input);
    const second = await owner.read(input);
    expect(first.findings[0]!.sellerSku).toBe("123456789012");
    expect(first.findings[0]!.key).toMatch(/^price-health-featured:[a-f0-9]{24}$/u);
    expect(first.findings[0]!.key).not.toContain("123456789012");
    expect(second.findings[0]!.key).toBe(first.findings[0]!.key);
    const other = await owner.read({ ...input, fba: [{ sellerSku: "123456789013", asin: "B000000001" }] });
    expect(other.findings[0]!.key).not.toBe(first.findings[0]!.key);
  });
});
