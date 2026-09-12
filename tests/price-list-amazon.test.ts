import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PriceListAmazon,
  downloadPriceListImage,
} from "../src/main/price-list-amazon";
import { createScriptedSpExecutionContextAdapter, SpExecutionContextError } from "../src/main/amazon/sp-execution-context";
import type { ApiRequest } from "../src/shared/contracts";
import type { PriceListAmazonSnapshot, PriceListProductRow } from "../src/shared/price-list";
import { readPriceListListing, type PriceListListingFacts } from "../src/main/amazon/price-list-reads";
import { createScriptedListingsReadAdapter, type ScriptedListingsReadStep } from "../src/main/amazon/listings-reads";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import { parsePriceListWorkbook } from "../src/main/price-list-workbook";
const US = "ATVPDKIKX0DER" as const;
const generatedIdentities = [
  { sellerSku: "SKU-ONE", asin: "B000000001" },
  { sellerSku: "SKU-TWO", asin: "B000000002" },
  { sellerSku: "SKU-THREE", asin: "B000000003" },
];
function listingStep(
  index: number,
  summary: Record<string, unknown> = {},
): Extract<ScriptedListingsReadStep, { operation: "item" }> {
  const identity = generatedIdentities[index]!;
  const amount = (value: number) => [{ schedule: [{ value_with_tax: value }] }];
  return {
    operation: "item",
    result: {
      status: 200, requestId: null, retryAfter: null, rateLimit: null, profile: "full",
      envelope: {
        sku: identity.sellerSku,
        summaries: [{
          marketplaceId: US, asin: identity.asin, productType: "PET_FOOD",
          itemName: index === 1 ? "Rejected fixture title" : "Verified fixture title",
          ...summary,
        }],
        attributes: {
          purchasable_offer: [{
            marketplace_id: US, currency: "USD", audience: "ALL",
            our_price: amount(index === 1 ? 777.77 : 19.99),
            minimum_seller_allowed_price: amount(index === 1 ? 666.66 : 12.99),
          }],
          main_product_image_locator: index === 1 ? [{
            marketplace_id: US,
            media_location: "https://m.media-amazon.com/images/I/rejected-fixture.jpg",
          }] : [],
        },
      },
    },
  };
}
const row = (
  key: string,
  asin: string | null,
  keyKind: "seller-sku" | "product-code" = "product-code",
  rowNumber = 4,
): PriceListProductRow => ({
  key,
  asin,
  keyKind,
  sheetName: "Products",
  rowNumber,
  cells: {},
});
const req = (
  method: "GET" | "POST",
  body: Record<string, unknown> = { id: "fixture" },
): ApiRequest => ({
  requestId: "fixture-request",
  method,
  path: "/api/price-list/amazon-refresh",
  headers: {},
  query: method === "GET" ? { id: "fixture" } : {},
  ...(method === "POST"
    ? { body: { kind: "json" as const, value: body } }
    : {}),
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.unstubAllGlobals();
});
function fixture(
  products = [row("internal-code", "B000000001")],
  image?: typeof downloadPriceListImage,
) {
  let accountScope = "fixture-account-a";
  let mode: "live" | "demo" = "live";
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: US,
    mode,
    accountScope,
  }));
  const fba = vi.fn(async () => [{ sellerSku: "SKU-ONE", asin: "B000000001" }]);
  const listing = vi.fn(async (_input: Parameters<typeof readPriceListListing>[1]): Promise<PriceListListingFacts> => ({
    standardPrice: 19.99,
    minimumPrice: 12.99,
    minimumPriceStatus: "set" as const,
    imageUrl: null as string | null,
  }));
  const exportWorkbook = vi.fn(() => new Uint8Array([1, 2, 3]));
  const owner = new PriceListAmazon({
    context,
    fba,
    listing,
    products: () => products,
    export: exportWorkbook,
    image,
  });
  cleanups.push(() => owner.clear());
  return {
    owner,
    fba,
    listing,
    exportWorkbook,
    context,
    changeAccount: () => {
      accountScope = "fixture-account-b";
    },
    changeMode: () => {
      mode = "demo";
    },
  };
}
async function complete(owner: PriceListAmazon, id = "fixture") {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await owner.observe({ ...req("GET"), query: { id } });
    if (
      response.body.kind === "json" &&
      (response.body.value as { state: string }).state !== "running"
    )
      return response.body.value as PriceListAmazonSnapshot;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("fixture did not complete");
}
describe("price list Amazon observation", () => {
  it("generates a populated US price list from current FBA identities without an imported workbook", async () => {
    const app = fixture([]);
    app.fba.mockResolvedValue([
      { sellerSku: "SKU-ONE", asin: "B000000001" },
      { sellerSku: "SKU TWO", asin: "B000000002" },
    ]);
    app.listing.mockResolvedValueOnce({
      standardPrice: 19.99, minimumPrice: null, minimumPriceStatus: "unavailable", imageUrl: null,
    }).mockResolvedValueOnce({
      standardPrice: null, minimumPrice: null, minimumPriceStatus: "not-set", imageUrl: null,
    });
    const started = await app.owner.generate(req("POST", {}));
    expect(started.status).toBe(202);
    const { workbookId } = started.body.kind === "json"
      ? started.body.value as { workbookId: string } : { workbookId: "missing" };
    const result = await complete(app.owner, workbookId);
    expect(result).toMatchObject({ state: "complete", source: "amazon", total: 2 });
    expect(result.rows).toEqual([
      expect.objectContaining({ sellerSku: "SKU-ONE", standardPrice: 19.99 }),
      expect.objectContaining({ sellerSku: "SKU TWO", standardPrice: null }),
    ]);
    const exported = await app.owner.export(req("POST", { id: workbookId, replaceImages: false }));
    expect(exported.status).toBe(200);
    expect(exported.headers["Content-Disposition"]).toContain("AMZ_US_Price_List.xlsx");
    if (exported.body.kind !== "bytes") throw new Error("Expected generated workbook bytes");
    const book = parsePriceListWorkbook({ bytes: exported.body.value, fileName: "generated.xlsx" });
    const cells = book.view.sheets[0]!.cells;
    expect(cells.find((cell) => cell.reference === "A2")?.value).toBe("SKU-ONE");
    expect(cells.find((cell) => cell.reference === "A3")?.value).toBe("SKU TWO");
    expect(cells.find((cell) => cell.reference === "E2")?.value).toBe(19.99);
    expect(cells.find((cell) => cell.reference === "E3")?.value).toBe("未回報");
    expect(cells.find((cell) => cell.reference === "F2")?.value).toBe("未回報");
    expect(cells.find((cell) => cell.reference === "F3")?.value).toBe("未設定");
    expect(app.exportWorkbook).not.toHaveBeenCalled();
    expect(JSON.stringify(started)).not.toContain("fixture-account");
  });
  it.each([
    ["missing product type", { productType: undefined }],
    ["missing ASIN", { asin: undefined }],
    ["foreign response marketplace", { marketplaceId: "A2EUQ1WTGCTBG2" }],
  ])("exports good/bad/good FBA rows while rejecting all facts from a Listing with %s", async (_reason, summary) => {
    const image = vi.fn<typeof downloadPriceListImage>();
    const app = fixture([], image);
    app.fba.mockResolvedValue(generatedIdentities);
    const adapter = createScriptedListingsReadAdapter([
      listingStep(0), listingStep(1, summary), listingStep(2),
    ]);
    app.listing.mockImplementation((input) => readPriceListListing(adapter, input));
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    const result = await complete(app.owner, id);
    expect(result).toMatchObject({ state: "complete", source: "amazon", completed: 3, total: 3 });
    expect(result.rows[1]).toMatchObject({
      sellerSku: "SKU-TWO", asin: "B000000002", status: "incomplete",
      standardPrice: null, minimumPrice: null, minimumPriceStatus: "unavailable",
      imageUrl: null, issueCode: "LISTING_IDENTITY_MISMATCH",
    });
    expect(result.rows[1]!.title).toBeUndefined();
    expect(result.rows.map((item) => item.standardPrice)).toEqual([19.99, null, 19.99]);
    expect(JSON.stringify(result)).not.toContain("Rejected fixture title");
    expect(JSON.stringify(result)).not.toContain("rejected-fixture.jpg");
    const exported = await app.owner.export(req("POST", { id, replaceImages: true }));
    expect(exported.status).toBe(200);
    expect(exported.headers["Content-Disposition"]).toContain("AMZ_US_Price_List.xlsx");
    if (exported.body.kind !== "bytes") throw new Error("Expected generated workbook bytes");
    const book = parsePriceListWorkbook({ bytes: exported.body.value, fileName: "generated.xlsx" });
    expect(book.view.sheets.map((sheet) => sheet.name)).toEqual(["US 價目表", "欄位說明"]);
    const cells = book.view.sheets[0]!.cells;
    const value = (reference: string) => cells.find((cell) => cell.reference === reference)?.value;
    expect([value("A3"), value("D3")]).toEqual(["SKU-TWO", "B000000002"]);
    expect([value("B3"), value("C3"), value("E3"), value("F3")]).toEqual([
      "未回報", "品名未回報", "未回報", "未回報",
    ]);
    expect([value("E2"), value("E4")]).toEqual([19.99, 19.99]);
    expect(value("H3")).toContain("身分不完整");
    expect(book.view.imageCount).toBe(0);
    expect(image).not.toHaveBeenCalled();
    expect(app.exportWorkbook).not.toHaveBeenCalled();
  });
  it.each([
    ["account scope", new SpExecutionContextError("ACCOUNT_SCOPE_CHANGED", "Fixture account changed.")],
    ["mode", new SpExecutionContextError("REPORT_MODE_CHANGED", "Fixture mode changed.")],
    ["generation", new SpExecutionContextError("SP_CONTEXT_INVALIDATED", "Fixture context changed.")],
    ["report identity", new SpApiError("Fixture report mismatch.", { status: 409, code: "REPORT_IDENTITY_MISMATCH" })],
    ["required Listing data", new SpApiError("Fixture required data missing.", { status: 409, code: "LISTINGS_REQUIRED_DATA_UNAVAILABLE" })],
    ["unknown conflict", new SpApiError("Fixture conflict.", { status: 409, code: "FIXTURE_CONFLICT" })],
    ["authentication", new SpApiError("Fixture authentication failure.", { status: 401, code: "UNAUTHORIZED" })],
    ["authorization", new SpApiError("Fixture authorization failure.", { status: 403, code: "UNAUTHORIZED" })],
    ["throttling", new SpApiError("Fixture throttling.", { status: 429, code: "RATE_LIMITED" })],
    ["server", new SpApiError("Fixture server failure.", { status: 500, code: "UPSTREAM_UNAVAILABLE" })],
    ["identity code with wrong status", new SpApiError("Fixture unauthorized identity.", { status: 401, code: "LISTING_IDENTITY_MISMATCH" })],
    ["network", new TypeError("Fixture network failure.")],
  ])("blocks generated export and later Listing reads after a global %s error", async (_reason, failure) => {
    const app = fixture([]);
    app.fba.mockResolvedValue(generatedIdentities);
    const scripted = createScriptedListingsReadAdapter([listingStep(0), listingStep(1), listingStep(2)]);
    const reads: string[] = [];
    app.listing.mockImplementation((input) => readPriceListListing({
      async readItem(plan) {
        reads.push(plan.sellerSku);
        if (plan.sellerSku === "SKU-TWO") throw failure;
        return scripted.readItem(plan);
      },
    }, input));
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    const result = await complete(app.owner, id);
    expect(result).toMatchObject({ state: "failed", completed: 1, total: 3 });
    expect(result.rows.map((item) => item.standardPrice)).toEqual([19.99, null, null]);
    expect(reads).toEqual(["SKU-ONE", "SKU-TWO"]);
    const exported = await app.owner.export(req("POST", { id, replaceImages: false }));
    expect(exported.status).toBe(409);
    expect(exported.body.kind).toBe("json");
  });
  it("keeps adapter request identity mismatch global even when its row envelope is also incomplete", async () => {
    const app = fixture([]);
    app.fba.mockResolvedValue(generatedIdentities);
    const mismatched = listingStep(1, { productType: undefined });
    mismatched.result.identity = {
      operation: "item", intent: "listing", sellerSku: "SKU-TWO", marketplaceId: "A2EUQ1WTGCTBG2",
    };
    const adapter = createScriptedListingsReadAdapter([listingStep(0), mismatched, listingStep(2)]);
    app.listing.mockImplementation((input) => readPriceListListing(adapter, input));
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    expect(await complete(app.owner, id)).toMatchObject({
      state: "failed", completed: 1, errorCode: "UPSTREAM_UNAVAILABLE",
    });
    expect(adapter.requests).toHaveLength(2);
    expect((await app.owner.export(req("POST", { id, replaceImages: false }))).status).toBe(409);
  });
  it.each(["REPORT_IDENTITY_MISMATCH", "LISTING_IDENTITY_MISMATCH"])("does not apply Listing row isolation to FBA source error %s", async (code) => {
    const app = fixture([]);
    app.fba.mockRejectedValue(new SpApiError("Fixture FBA source conflict.", { status: 409, code }));
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    expect(await complete(app.owner, id)).toMatchObject({ state: "failed", stage: "identifying", errorCode: code });
    expect(app.listing).not.toHaveBeenCalled();
    expect((await app.owner.export(req("POST", { id, replaceImages: false }))).status).toBe(409);
  });
  it.each(["account", "mode", "generation"])("invalidates a late incomplete Listing after %s changes before row isolation", async (change) => {
    const app = fixture([]);
    app.fba.mockResolvedValue(generatedIdentities);
    const scripted = createScriptedListingsReadAdapter([
      listingStep(0), listingStep(1, { productType: undefined }), listingStep(2),
    ]);
    let markStarted!: () => void;
    let release!: () => void;
    const startedReading = new Promise<void>((resolve) => { markStarted = resolve; });
    const readingReleased = new Promise<void>((resolve) => { release = resolve; });
    const reads: string[] = [];
    app.listing.mockImplementation((input) => readPriceListListing({
      async readItem(plan) {
        reads.push(plan.sellerSku);
        if (plan.sellerSku === "SKU-TWO") {
          markStarted();
          await readingReleased;
        }
        return scripted.readItem(plan);
      },
    }, input));
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    await startedReading;
    if (change === "account") app.changeAccount();
    else if (change === "mode") app.changeMode();
    else app.context.invalidate("lock-screen");
    release();
    await vi.waitFor(async () => {
      await expect(app.owner.observe({ ...req("GET"), query: { id } })).rejects.toMatchObject({ code: "PRICE_LIST_AMAZON_EXPIRED" });
    });
    await expect(app.owner.export(req("POST", { id, replaceImages: false }))).rejects.toMatchObject({ code: "PRICE_LIST_AMAZON_EXPIRED" });
    expect(reads).toEqual(["SKU-ONE", "SKU-TWO"]);
  });
  it.each(["network", "invalid dimensions"])("embeds available generated main images and keeps the price list on %s failure", async (failure) => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=", "base64"));
    const image = vi.fn(async (url: string) => {
      if (url.endsWith("broken.png")) {
        if (failure === "network") throw new Error("image unavailable");
        return { bytes: new Uint8Array([255, 216, 255, 217]), mediaType: "image/png" as const };
      }
      return { bytes: png, mediaType: "image/png" as const };
    });
    const app = fixture([], image);
    app.fba.mockResolvedValue([
      { sellerSku: "=SKU ONE", asin: "B000000001" },
      { sellerSku: "SKU-TWO", asin: "B000000002" },
    ]);
    app.listing.mockResolvedValueOnce({ title: "First product", standardPrice: 19.99, minimumPrice: null, minimumPriceStatus: "not-set", imageUrl: "https://m.media-amazon.com/images/I/good.png" })
      .mockResolvedValueOnce({ title: "Second product", standardPrice: 9.99, minimumPrice: null, minimumPriceStatus: "not-set", imageUrl: "https://m.media-amazon.com/images/I/broken.png" });
    const start = await app.owner.generate(req("POST", {}));
    const id = (start.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    await complete(app.owner, id);
    const result = await app.owner.export(req("POST", { id, replaceImages: true }));
    if (result.body.kind !== "bytes") throw new Error("Expected workbook");
    const book = parsePriceListWorkbook({ bytes: result.body.value, fileName: "generated.xlsx" });
    expect(book.view.imageCount).toBe(1);
    expect(book.view.formulaCount).toBe(0);
    expect(book.view.sheets[0]!.columnCount).toBe(9);
    expect(book.view.sheets[0]!.cells.find((cell) => cell.reference === "A2")?.value).toBe("=SKU ONE");
    expect(book.view.sheets[0]!.cells.find((cell) => cell.reference === "B2")?.imageId).toBeDefined();
    expect(book.view.sheets[0]!.cells.find((cell) => cell.reference === "B3")?.value).toBe("首圖未下載");
    expect(book.view.sheets[0]!.cells.find((cell) => cell.reference === "C2")?.value).toBe("First product");
  });
  it("uses one generated read and invalidates its observed/exported result after account drift", async () => {
    const app = fixture([]);
    let release!: () => void;
    app.fba.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return [{ sellerSku: "SKU-ONE", asin: "B000000001" }];
    });
    const starts = await Promise.all([
      app.owner.generate(req("POST", {})), app.owner.generate(req("POST", {})),
    ]);
    const id = (starts[0]!.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    expect(starts[1]!.body).toMatchObject({ kind: "json", value: { workbookId: id } });
    expect(app.fba).toHaveBeenCalledOnce();
    await app.owner.observe({ ...req("GET"), query: { id } });
    expect(app.fba).toHaveBeenCalledOnce();
    release();
    await complete(app.owner, id);
    app.changeAccount();
    await expect(app.owner.observe({ ...req("GET"), query: { id } })).rejects.toThrow();
    await expect(app.owner.export(req("POST", { id, replaceImages: false }))).rejects.toThrow();
  });
  it("does not accept renderer-provided generated rows and does not revive generation after clear", async () => {
    const app = fixture([]);
    expect((await app.owner.generate(req("POST", { rows: [{ sellerSku: "FAKE" }] }))).status).toBe(400);
    expect(app.fba).not.toHaveBeenCalled();
    let release!: () => void;
    app.fba.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return [{ sellerSku: "SKU-ONE", asin: "B000000001" }];
    });
    const started = await app.owner.generate(req("POST", {}));
    const id = (started.body as { kind: "json"; value: { workbookId: string } }).value.workbookId;
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
    expect(app.fba).toHaveBeenCalledOnce();
    app.owner.clear();
    release();
    await expect(app.owner.observe({ ...req("GET"), query: { id } })).rejects.toThrow();
    expect(app.listing).not.toHaveBeenCalled();
  });
  it("reports the failed read stage and keeps a reason for each unprocessed workbook row", async () => {
    const app = fixture();
    app.fba.mockRejectedValue(
      new SpApiError("FBA 商品身分報表仍在準備中。", {
        status: 504,
        code: "REPORT_PENDING",
      }),
    );
    await app.owner.start(req("POST"));
    const result = await complete(app.owner);
    expect(result).toMatchObject({
      state: "failed",
      stage: "identifying",
      errorCode: "REPORT_PENDING",
      rows: [
        {
          status: "incomplete",
          standardPrice: null,
          minimumPrice: null,
          issueCode: "REPORT_PENDING",
          message: expect.stringContaining("報表"),
        },
      ],
    });
    expect(app.listing).not.toHaveBeenCalled();
  });
  it.each(["fba", "listing"] as const)(
    "sanitizes unsafe %s error codes before they cross into the observed workbook DTO",
    async (stage) => {
      const app = fixture();
      const privateFixture = "Bearer price-list-fixture-secret";
      const error = new SpApiError("此商品讀取未完成。", {
        status: stage === "fba" ? 504 : 422,
        code: privateFixture,
      });
      app[stage].mockRejectedValue(error);
      await app.owner.start(req("POST"));
      const result = await complete(app.owner);
      expect(JSON.stringify(result)).not.toContain(privateFixture);
      expect(result.rows[0]).toMatchObject({
        issueCode: "UPSTREAM_UNAVAILABLE",
      });
      if (stage === "fba")
        expect(result).toMatchObject({ errorCode: "UPSTREAM_UNAVAILABLE" });
    },
  );
  it("matches an internal code only by unique current FBA ASIN and reuses same SKU reads", async () => {
    const app = fixture([
      row("code-a", "B000000001"),
      row("code-a", "B000000001", "product-code", 8),
    ]);
    expect((await app.owner.start(req("POST"))).status).toBe(202);
    const result = await complete(app.owner);
    expect(result.state).toBe("complete");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      standardPrice: 19.99,
      minimumPrice: 12.99,
      status: "matched",
    });
    expect(app.listing).toHaveBeenCalledOnce();
    const exported = await app.owner.export(
      req("POST", { id: "fixture", replaceImages: false }),
    );
    expect(exported.body).toEqual({
      kind: "bytes",
      value: new Uint8Array([1, 2, 3]),
    });
  });
  it("does not guess code aliases, ASIN mismatches or duplicate ASINs", async () => {
    const app = fixture([
      row("SKU-ONE", null),
      row("SKU-ONE", "B000000002", "seller-sku"),
      row("another", "B000000001"),
    ]);
    app.fba.mockResolvedValue([
      { sellerSku: "SKU-ONE", asin: "B000000001" },
      { sellerSku: "SKU-TWO", asin: "B000000001" },
    ]);
    await app.owner.start(req("POST"));
    const result = await complete(app.owner);
    expect(result.rows.map((item) => item.status)).toEqual([
      "unmatched",
      "ambiguous",
      "ambiguous",
    ]);
    expect(result.rows[0]).toMatchObject({
      issueCode: "WORKBOOK_ASIN_MISSING",
      message: expect.stringContaining("補上 ASIN"),
    });
    expect(result.rows[2]).toMatchObject({
      issueCode: "FBA_MATCH_AMBIGUOUS",
      message: expect.stringContaining("多個 Seller SKU"),
    });
    expect(app.listing).not.toHaveBeenCalled();
  });
  it("does not export a completed comparison when no Amazon price was obtained", async () => {
    const app = fixture([row("internal-only", null)]);
    await app.owner.start(req("POST"));
    expect((await complete(app.owner)).state).toBe("complete");
    const result = await app.owner.export(
      req("POST", { id: "fixture", replaceImages: true }),
    );
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      kind: "json",
      value: { code: "PRICE_LIST_NO_PRICES" },
    });
    expect(app.exportWorkbook).not.toHaveBeenCalled();
  });
  it("overlapping starts use one job and observe never starts another read", async () => {
    const app = fixture();
    let release!: () => void;
    app.fba.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return [{ sellerSku: "SKU-ONE", asin: "B000000001" }];
    });
    await app.owner.start(req("POST"));
    await app.owner.start(req("POST"));
    await app.owner.observe(req("GET"));
    expect(app.fba).toHaveBeenCalledOnce();
    release();
    await complete(app.owner);
  });
  it("account drift blocks result and export; clear prevents late completion revival", async () => {
    const app = fixture();
    await app.owner.start(req("POST"));
    await complete(app.owner);
    app.changeAccount();
    await expect(app.owner.observe(req("GET"))).rejects.toThrow();
    await expect(
      app.owner.export(req("POST", { id: "fixture", replaceImages: false })),
    ).rejects.toThrow();
    expect(app.exportWorkbook).not.toHaveBeenCalled();
    app.owner.clear();
    await expect(app.owner.observe(req("GET"))).rejects.toThrow();
  });
  it("does not download arbitrary URLs or follow redirects for image replacement", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      downloadPriceListImage(
        "https://internal.invalid/a.png",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255, 217])),
    );
    const result = await downloadPriceListImage(
      "https://m.media-amazon.com/images/I/sample.jpg",
      new AbortController().signal,
    );
    expect(result.mediaType).toBe("image/jpeg");
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });
  it("bounds concurrent image exports and cancels an export when its context clears", async () => {
    let imageSignal: AbortSignal | undefined;
    const image = vi.fn(async (_url: string, signal: AbortSignal) => {
      imageSignal = signal;
      return await new Promise<{ bytes: Uint8Array; mediaType: "image/jpeg" }>(
        () => undefined,
      );
    });
    const app = fixture(undefined, image);
    app.listing.mockResolvedValue({
      standardPrice: 19.99,
      minimumPrice: 12.99,
      minimumPriceStatus: "set",
      imageUrl: "https://m.media-amazon.com/images/I/sample.jpg",
    });
    await app.owner.start(req("POST"));
    await complete(app.owner);
    const exported = app.owner.export(
      req("POST", { id: "fixture", replaceImages: true }),
    );
    const rejection = expect(exported).rejects.toThrow();
    for (let i = 0; i < 10 && !imageSignal; i++) await Promise.resolve();
    expect(image).toHaveBeenCalledOnce();
    expect(
      (
        await app.owner.export(
          req("POST", { id: "fixture", replaceImages: true }),
        )
      ).status,
    ).toBe(409);
    app.owner.clear();
    await rejection;
    expect(imageSignal?.aborted).toBe(true);
    expect(app.exportWorkbook).not.toHaveBeenCalled();
  });
});
