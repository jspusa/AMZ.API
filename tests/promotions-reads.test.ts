import { describe, expect, it } from "vitest";
import { PromotionsReads, type PromotionsReadAdapter } from "../src/main/amazon/promotions-reads";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;
const context = () => createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: "promotions-fixture-account" }));
const unused = async (): Promise<unknown> => { throw new Error("Unexpected external operation"); };
const item = { sku: "SKU-ONE", asin: "B000000001" };
const revision = (overrides: Record<string, unknown> = {}) => ({
  promotionId: "fixture-promotion-one", marketplaceId: US, promotionTitle: "Autumn coupon", promotionType: "COUPON",
  status: "RUNNING", schedule: { startDate: "2026-09-01T00:00:00Z", endDate: "2026-09-30T23:59:59Z" },
  selection: { type: "ITEMS", selectionId: "fixture-selection-one", revisionId: 1 }, issues: [], ...overrides,
});

describe("PromotionsReads", () => {
  it("distinguishes a verified empty Amazon search from an unavailable source", async () => {
    const ctx = context();
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async () => ({ totalResults: 0, promotions: [] }),
      getPromotion: unused,
      getSelection: unused,
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({
      context: await ctx.capture(US), fba: [], signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ marketplaceId: US, mode: "live", coverage: "complete", promotions: [], reportedTotal: 0, findings: [] });
  });

  it("reads selection pages and keeps a failed latest revision separate from the published running coupon", async () => {
    const ctx = context();
    const raw = revision({ latestRevision: revision({ status: undefined, revisionStatus: "FAILED", selection: { type: "ITEMS", selectionId: "fixture-selection-one", revisionId: 2 }, issues: [{ code: "INVALID_INPUT", severity: "ERROR", message: "Do not project upstream messages" }] }) });
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async ({ paginationToken }) => paginationToken ? { totalResults: 1, promotions: [raw] } : { totalResults: 1, promotions: [], pagination: { nextToken: "search-cursor" } },
      getPromotion: async () => raw,
      getSelection: async ({ revisionId, paginationToken }) => ({ selection: { type: "ITEMS", selectionId: "fixture-selection-one", revisionId, selectionDetails: { items: paginationToken ? [item] : [], issues: [], ...(!paginationToken ? { pagination: { nextToken: "items-cursor" } } : {}) } } }),
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "complete", promotions: [{ title: "Autumn coupon", published: { status: "RUNNING", items: [{ sellerSku: "SKU-ONE", asin: "B000000001" }] }, latestRevision: { status: "FAILED", issues: [{ code: "INVALID_INPUT", severity: "ERROR" }] } }], findings: [{ source: "promotions", severity: "warning" }] });
    expect(JSON.stringify(result)).not.toMatch(/fixture-promotion|fixture-selection|items-cursor|upstream messages/);
  });

  it("does not turn permission failures into empty success or forward upstream secrets", async () => {
    const ctx = context();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => { throw new SpApiError("access_token=fixture-private-material", { status: 403, code: "ACCESS_DENIED" }); }, getPromotion: unused, getSelection: unused };
    const read = new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [], signal: new AbortController().signal });
    await expect(read).rejects.toMatchObject({ status: 403, code: "ACCESS_DENIED" });
    await expect(read).rejects.not.toThrow("fixture-private-material");
  });

  it("redacts private promotion identifiers embedded in otherwise ordinary titles", async () => {
    const ctx = context();
    const raw = revision({ promotionTitle: "Promotion fixture-promotion-one" });
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [item], issues: [] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(JSON.stringify(result)).not.toContain("fixture-promotion-one");
  });
  it.each(["published", "latest"] as const)("redacts a %s purchase-selection identifier embedded in a promotion title", async (source) => {
    const ctx = context();
    const purchaseSelectionId = `fixture-${source}-purchase-selection`;
    const purchaseRequirements = { selection: { type: "ITEMS", selectionId: purchaseSelectionId, revisionId: 1 } };
    const raw = revision({
      promotionType: "BASKET_BUILDING",
      promotionTitle: `Autumn offer ${purchaseSelectionId}`,
      ...(source === "published" ? { purchaseRequirements } : {
        latestRevision: revision({ status: undefined, revisionStatus: "PROCESSING", purchaseRequirements }),
      }),
    });
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }),
      getPromotion: async () => raw,
      getSelection: async ({ selectionId, revisionId }) => ({ selection: {
        type: "ITEMS", selectionId, revisionId, selectionDetails: { items: [item], issues: [] },
      } }),
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result.coverage).toBe("complete");
    expect(result.promotions[0]?.title).toBe("Amazon 促銷（名稱已隱去）");
    expect(JSON.stringify(result)).not.toContain(purchaseSelectionId);
  });
  it("never admits an unproven SKU whose ASIN was omitted and retains incomplete coverage", async () => {
    const ctx = context();
    const raw = revision();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [item, { sku: "FBM-NOT-PROVEN" }], issues: [] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", promotions: [{ published: { items: [{ sellerSku: "SKU-ONE", asin: "B000000001" }], coverage: "partial" } }] });
    expect(JSON.stringify(result)).not.toContain("FBM-NOT-PROVEN");
  });
  it("retains verified promotion issues when selection issues are missing", async () => {
    const ctx = context();
    const raw = revision({ issues: [{ code: "INVALID_INPUT", severity: "ERROR", message: "Fixture issue" }] });
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [item] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", promotions: [{ published: { issues: [{ code: "INVALID_INPUT", severity: "ERROR" }] } }], findings: [{ source: "promotions" }] });
  });
  it.each(["published", "latest"] as const)("preserves missing %s promotion issues as unknown when selection issues are empty", async (source) => {
    const ctx = context();
    const raw = revision(source === "published" ? { issues: undefined } : {
      latestRevision: revision({ status: undefined, revisionStatus: "PROCESSING", issues: undefined }),
    });
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }),
      getPromotion: async () => raw,
      getSelection: async ({ selectionId, revisionId }) => ({ selection: {
        type: "ITEMS", selectionId, revisionId, selectionDetails: { items: [item], issues: [] },
      } }),
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    const observed = source === "published" ? result.promotions[0]?.published : result.promotions[0]?.latestRevision;
    expect(observed).toMatchObject({ coverage: "partial", issues: null });
    expect(result.coverage).toBe("partial");
  });
  it("retains positive selection issues across empty pages when promotion issues are missing", async () => {
    const ctx = context();
    const raw = revision({ issues: undefined });
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }),
      getPromotion: async () => raw,
      getSelection: async ({ selectionId, revisionId, paginationToken }) => ({ selection: {
        type: "ITEMS", selectionId, revisionId,
        selectionDetails: paginationToken ? { items: [], issues: [] } : {
          items: [item],
          issues: [{ identifier: item, code: "INVALID_SKU", severity: "ERROR", message: "Fixture issue" }],
          pagination: { nextToken: "fixture-final-issues-page" },
        },
      } }),
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({
      coverage: "partial",
      promotions: [{ published: { coverage: "partial", issues: [{ code: "INVALID_SKU", severity: "ERROR" }] } }],
      findings: [{ source: "promotions", severity: "warning" }],
    });
  });
  it("does not diagnose a non-FBA item issue as an issue with the projected FBA items", async () => {
    const ctx = context(); const raw = revision();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [item], issues: [{ identifier: { sku: "FBM-OUTSIDE", asin: "B000000099" }, code: "INVALID_SKU", severity: "ERROR", message: "Fixture only" }] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", findings: [], promotions: [{ published: { issues: [] } }] });
    expect(JSON.stringify(result)).not.toContain("FBM-OUTSIDE");
  });
  it("keeps a bounded opaque cursor intact even when longer than an identifier", async () => {
    const ctx = context(); const cursor = "fixture-cursor-".repeat(50);
    const adapter: PromotionsReadAdapter = { searchPromotions: async ({ paginationToken }) => {
      if (paginationToken === undefined) return { totalResults: 0, promotions: [], pagination: { nextToken: cursor } };
      if (paginationToken !== cursor) throw new Error("Cursor was modified");
      return { totalResults: 0, promotions: [] };
    }, getPromotion: unused, getSelection: unused };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "complete", promotions: [] });
  });
  it("preserves a proven SKU containing an ordinary internal space without aliasing", async () => {
    const ctx = context(); const raw = revision(); const withSpace = { sku: "SKU ONE", asin: "B000000001" };
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [withSpace], issues: [] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: "SKU ONE", asin: withSpace.asin }], signal: new AbortController().signal });
    expect(result.promotions[0]?.published.items).toEqual([{ sellerSku: "SKU ONE", asin: "B000000001" }]);
  });
  it("preserves a proven numeric SKU without treating the item identity as a report identifier", async () => {
    const ctx = context(); const raw = revision();
    const numericItem = { sku: "123456789012", asin: "B000000001" };
    const adapter: PromotionsReadAdapter = {
      searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }),
      getPromotion: async () => raw,
      getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [numericItem], issues: [] } } }),
    };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: numericItem.sku, asin: numericItem.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "complete", promotions: [{ published: {
      items: [{ sellerSku: "123456789012", asin: "B000000001" }],
    } }] });
  });
  it("rejects a calendar rollover date rather than placing an event on a invented day", async () => {
    const ctx = context(); const raw = revision({ schedule: { startDate: "2026-02-31T00:00:00Z", endDate: "2026-09-30T00:00:00Z" } });
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => ({ selection: { ...raw.selection, selectionDetails: { items: [item], issues: [] } } }) };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", promotions: [{ published: { startDate: null } }] });
  });
  it("isolates catalog promotions as aggregate incomplete scope without manufacturing SKU membership", async () => {
    const ctx = context(); const raw = revision({ selection: { type: "CATALOG" }, promotionTitle: "PRIVATE CATALOG TITLE" });
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: unused };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", promotions: [], excludedPromotionCount: 1, findings: [] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE CATALOG TITLE");
  });
  it("stops repeated pagination without reporting the source as complete", async () => {
    const ctx = context();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 2, promotions: [], pagination: { nextToken: "same-cursor" } }), getPromotion: unused, getSelection: unused };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "partial", promotions: [], reportedTotal: 2 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("does not merge promotion detail from a different marketplace", async () => {
    const ctx = context(); const raw = revision();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => revision({ marketplaceId: "A1VC38T7YXB528" }), getSelection: unused };
    await expect(new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [], signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROMOTIONS_INVALID_RESPONSE" });
  });
  it("never publishes a late selection result after account replacement", async () => {
    let scope = "promotions-first-account";
    const ctx = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: scope }));
    const raw = revision();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async () => { scope = "promotions-second-account"; return { selection: { ...raw.selection, selectionDetails: { items: [item], issues: [] } } }; } };
    await expect(new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal })).rejects.toMatchObject({ status: 409, code: "ACCOUNT_SCOPE_CHANGED" });
  });
  it("rejects demo mode rather than using live credentials or a fixture fallback", async () => {
    const ctx = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "demo", accountScope: "promotions-demo-account" }));
    const adapter: PromotionsReadAdapter = { searchPromotions: unused, getPromotion: unused, getSelection: unused };
    await expect(new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [], signal: new AbortController().signal })).rejects.toMatchObject({ code: "DEMO_UNAVAILABLE" });
  });
  it("uses the fixed request binding when the official selection response omits optional echo identifiers", async () => {
    const ctx = context(); const raw = revision();
    const adapter: PromotionsReadAdapter = { searchPromotions: async () => ({ totalResults: 1, promotions: [raw] }), getPromotion: async () => raw, getSelection: async ({ revisionId }) => {
      if (revisionId !== 1) throw new Error("Wrong selection revision");
      return { selection: { type: "ITEMS", selectionDetails: { items: [item], issues: [] } } };
    } };
    const result = await new PromotionsReads({ adapter, context: ctx }).read({ context: await ctx.capture(US), fba: [{ sellerSku: item.sku, asin: item.asin }], signal: new AbortController().signal });
    expect(result).toMatchObject({ coverage: "complete", promotions: [{ published: { items: [{ sellerSku: "SKU-ONE", asin: "B000000001" }] } }] });
  });
});
