import { afterEach, describe, expect, it, vi } from "vitest";
import { marketplaceByCode } from "../src/shared/marketplaces";
import {
  createListingsWriteProduction,
} from "../src/main/amazon/listings-write-production";
import { SpApiPreCommitError } from "../src/main/amazon/sp-api-error";

const US = marketplaceByCode("US");

function response(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fixed Listings Items write production transport", () => {
  it("refreshes 401 once and retries only bounded preview transients", async () => {
    const accessTokenCalls: Array<readonly [string, boolean | undefined]> = [];
    const invalidations: string[] = [];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(401, { errors: [] }))
      .mockResolvedValueOnce(response(503, { errors: [] }, { "retry-after": "0" }))
      .mockResolvedValueOnce(response(429, { errors: [] }, { "retry-after": "0" }))
      .mockResolvedValueOnce(response(200, {
        status: "VALID",
        identifiers: [{ marketplaceId: US.id, asin: "B000TEST01" }],
      }, { "x-amzn-requestid": "preview-request" }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createListingsWriteProduction({
      getAccessToken: async (region, forceRefresh) => {
        accessTokenCalls.push([region, forceRefresh]);
        return forceRefresh ? "fresh-token" : "cached-token";
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      getSellerId: () => "SELLER123",
    });

    const receipt = await transport.validationPreview({
      marketplaceId: US.id,
      sellerSku: "SKU / ONE",
      patchBody: { productType: "PET_SUPPLIES", patches: [] },
      includeIdentifiers: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(accessTokenCalls).toEqual([
      ["na", false],
      ["na", true],
      ["na", false],
      ["na", false],
    ]);
    expect(invalidations).toEqual(["na"]);
    const [rawUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe(
      "/listings/2021-08-01/items/SELLER123/SKU%20%2F%20ONE",
    );
    expect(url.searchParams.get("marketplaceIds")).toBe(US.id);
    expect(url.searchParams.get("issueLocale")).toBe("en_US");
    expect(url.searchParams.get("includedData")).toBe("identifiers,issues");
    expect(url.searchParams.get("mode")).toBe("VALIDATION_PREVIEW");
    expect(init).toMatchObject({
      method: "PATCH",
      cache: "no-store",
      redirect: "error",
    });
    expect(receipt).toMatchObject({
      ok: true,
      status: 200,
      requestId: "preview-request",
      retryAfter: null,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("records dispatch between two final fences and never retries a commit", async () => {
    const order: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () => {
      order.push("fetch");
      return response(503, { errors: [{ code: "TEMPORARY" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = createListingsWriteProduction({
      getAccessToken: async () => {
        order.push("token");
        return "token";
      },
      invalidateAccessToken: () => order.push("invalidate"),
      getSellerId: () => "SELLER123",
    });

    const receipt = await transport.commitOnce({
      marketplaceId: US.id,
      sellerSku: "SKU-1",
      patchBody: { productType: "PET_SUPPLIES", patches: [] },
      assertBeforeSend: async () => {
        order.push("fence");
      },
      recordBeforeSend: async () => {
        order.push("record");
      },
    });

    expect(order).toEqual(["token", "fence", "record", "fence", "fetch"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({ ok: false, status: 503 });
  });

  it("wraps a dispatch-record failure and sends no PATCH", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const transport = createListingsWriteProduction({
      getAccessToken: async () => "token",
      invalidateAccessToken: () => undefined,
      getSellerId: () => "SELLER123",
    });

    await expect(transport.commitOnce({
      marketplaceId: US.id,
      sellerSku: "SKU-1",
      patchBody: { productType: "PET_SUPPLIES", patches: [] },
      assertBeforeSend: async () => undefined,
      recordBeforeSend: async () => {
        throw new Error("disk unavailable");
      },
    })).rejects.toBeInstanceOf(SpApiPreCommitError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds captured commit responses and preserves unknown status", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () =>
      response(200, { padding: "x".repeat(1_048_576) })
    ));
    const transport = createListingsWriteProduction({
      getAccessToken: async () => "token",
      invalidateAccessToken: () => undefined,
      getSellerId: () => "SELLER123",
    });

    await expect(transport.commitOnce({
      marketplaceId: US.id,
      sellerSku: "SKU-1",
      patchBody: { productType: "PET_SUPPLIES", patches: [] },
      assertBeforeSend: async () => undefined,
    })).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
      operation: "patchListingsItem",
    });
  });
});
