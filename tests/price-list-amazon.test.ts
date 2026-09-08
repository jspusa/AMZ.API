import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PriceListAmazon,
  downloadPriceListImage,
} from "../src/main/price-list-amazon";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { ApiRequest } from "../src/shared/contracts";
import type { PriceListProductRow } from "../src/shared/price-list";
const US = "ATVPDKIKX0DER" as const;
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
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: US,
    mode: "live",
    accountScope,
  }));
  const fba = vi.fn(async () => [{ sellerSku: "SKU-ONE", asin: "B000000001" }]);
  const listing = vi.fn(async () => ({
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
  };
}
async function complete(owner: PriceListAmazon) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await owner.observe(req("GET"));
    if (
      response.body.kind === "json" &&
      (response.body.value as { state: string }).state !== "running"
    )
      return response.body.value as {
        state: string;
        rows: {
          status: string;
          standardPrice: number | null;
          minimumPrice: number | null;
        }[];
      };
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("fixture did not complete");
}
describe("price list Amazon observation", () => {
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
    expect(app.listing).not.toHaveBeenCalled();
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
