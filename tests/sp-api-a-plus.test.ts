import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAplusContentDocumentAsinRelationsPage,
  getAplusContentDocumentsPage,
  getAplusContentPublishRecordsPage,
  invalidateSpApiCredentialCaches,
} from "../src/main/amazon/sp-api";

const US = "ATVPDKIKX0DER" as const;
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

function configure(mode: "live" | "demo"): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SP_API_")) delete process.env[key];
  }
  process.env.SP_API_MODE = mode;
  if (mode === "live") {
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_APLUS_CLIENT";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_APLUS_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_APLUS_REFRESH";
  }
  invalidateSpApiCredentialCaches();
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({
    access_token: "fake-a-plus-token",
    expires_in: 3_600,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("A+ Content publish-record SP-API gateway", () => {
  beforeEach(() => configure("live"));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("requests the official exact marketplace, ASIN and opaque page token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/auth/o2/token")) return tokenResponse();
      return new Response(JSON.stringify({
        publishRecordList: [{
          marketplaceId: US,
          asin: "B000000001",
          contentReferenceKey: "opaque-record-key",
          contentType: "EBC",
          locale: "en-US",
        }],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-requestid": "request-a-plus-1",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: "opaque-next-page",
      expectedMode: "live",
    })).resolves.toMatchObject({
      status: 200,
      payload: {
        publishRecordList: [expect.objectContaining({ asin: "B000000001" })],
      },
      requestId: "request-a-plus-1",
    });

    const apiRequest = requests.find(({ url }) => url.includes("/aplus/2020-11-01/"));
    expect(apiRequest).toBeDefined();
    const url = new URL(apiRequest!.url);
    expect(url.pathname).toBe("/aplus/2020-11-01/contentPublishRecords");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: "opaque-next-page",
    });
    expect(apiRequest!.init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(new Headers(apiRequest!.init?.headers).get("x-amz-access-token"))
      .toBe("fake-a-plus-token");
  });

  it("returns deterministic demo records without any network request", async () => {
    configure("demo");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000002",
      expectedMode: "demo",
    });

    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ publishRecordList: expect.any(Array) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests official content-document and ASIN-relation pages with fixed GET routes", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/auth/o2/token")) return tokenResponse();
      if (url.includes("/asins?")) {
        return new Response(JSON.stringify({
          asinMetadataSet: [{
            asin: "B000000001",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: ["reference/segment?query#fragment"],
          }],
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "request-a-plus-relations",
          },
        });
      }
      return new Response(JSON.stringify({
        contentMetadataRecords: [{
          contentReferenceKey: "reference/segment?query#fragment",
          contentMetadata: {
            name: "A+ document",
            marketplaceId: US,
            status: "APPROVED",
            badgeSet: ["STANDARD"],
            updateTime: "2026-08-23T08:00:00Z",
          },
        }],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-requestid": "request-a-plus-documents",
        },
      });
    }));

    await expect(getAplusContentDocumentsPage({
      marketplaceId: US,
      pageToken: "documents-next-page",
      expectedMode: "live",
    })).resolves.toMatchObject({
      status: 200,
      payload: { contentMetadataRecords: expect.any(Array) },
      requestId: "request-a-plus-documents",
    });
    await expect(getAplusContentDocumentAsinRelationsPage({
      marketplaceId: US,
      contentReferenceKey: "reference/segment?query#fragment",
      pageToken: "relations-next-page",
      expectedMode: "live",
    })).resolves.toMatchObject({
      status: 200,
      payload: { asinMetadataSet: expect.any(Array) },
      requestId: "request-a-plus-relations",
    });

    const apiRequests = requests.filter(({ url }) =>
      url.includes("/aplus/2020-11-01/"));
    expect(apiRequests).toHaveLength(2);
    const documentsUrl = new URL(apiRequests[0]!.url);
    expect(documentsUrl.pathname).toBe("/aplus/2020-11-01/contentDocuments");
    expect(Object.fromEntries(documentsUrl.searchParams)).toEqual({
      marketplaceId: US,
      pageToken: "documents-next-page",
    });
    expect(apiRequests[0]!.init).toMatchObject({ method: "GET", cache: "no-store" });

    const relationsUrl = new URL(apiRequests[1]!.url);
    expect(relationsUrl.pathname).toBe(
      "/aplus/2020-11-01/contentDocuments/reference%2Fsegment%3Fquery%23fragment/asins",
    );
    expect(Object.fromEntries(relationsUrl.searchParams)).toEqual({
      marketplaceId: US,
      includedDataSet: "METADATA",
      pageToken: "relations-next-page",
    });
    expect(apiRequests[1]!.init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("returns deterministic schema-shaped demo document pages without network access", async () => {
    configure("demo");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const documentsInput = {
      marketplaceId: US,
      expectedMode: "demo" as const,
    };
    const firstDocuments = await getAplusContentDocumentsPage(documentsInput);
    const secondDocuments = await getAplusContentDocumentsPage(documentsInput);
    expect(secondDocuments).toEqual(firstDocuments);
    expect(firstDocuments).toEqual({
      status: 200,
      payload: {
        contentMetadataRecords: [{
          contentReferenceKey: `demo-a-plus-document-${US}`,
          contentMetadata: {
            name: "AMZ.API Demo A+ Content",
            marketplaceId: US,
            status: "APPROVED",
            badgeSet: ["STANDARD"],
            updateTime: "2026-01-01T00:00:00Z",
          },
        }],
      },
      requestId: null,
    });

    const relationInput = {
      marketplaceId: US,
      contentReferenceKey: `demo-a-plus-document-${US}`,
      expectedMode: "demo" as const,
    };
    const firstRelations = await getAplusContentDocumentAsinRelationsPage(relationInput);
    const secondRelations = await getAplusContentDocumentAsinRelationsPage(relationInput);
    expect(secondRelations).toEqual(firstRelations);
    expect(firstRelations).toEqual({
      status: 200,
      payload: {
        asinMetadataSet: [{
          asin: "B000000002",
          badgeSet: ["CONTENT_PUBLISHED"],
          contentReferenceKeySet: [`demo-a-plus-document-${US}`],
        }],
      },
      requestId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("paces concurrent live A+ request starts across operations in the shared regional queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1_000);
    const apiStarts: number[] = [];
    const controlledWaitHeartbeats: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    });
    const second = getAplusContentDocumentsPage({
      marketplaceId: US,
      expectedMode: "live",
      onControlledWait: () => controlledWaitHeartbeats.push(Date.now()),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_049);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(1_050);
    expect(controlledWaitHeartbeats).toEqual([
      apiStarts[0],
      apiStarts[1],
    ]);
  });

  it("honors the complete Retry-After delay instead of capping Amazon's instruction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    const controlledWaitHeartbeats: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      if (apiStarts.length === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 429,
          headers: { "retry-after": "12" },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000003",
      expectedMode: "live",
      onControlledWait: () => controlledWaitHeartbeats.push(Date.now()),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(12_000);
    expect(controlledWaitHeartbeats).toEqual([
      new Date("2026-08-23T08:00:00.000Z").getTime(),
      new Date("2026-08-23T08:00:12.000Z").getTime(),
    ]);
  });

  it("honors an HTTP-date Retry-After value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      if (apiStarts.length === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 503,
          headers: {
            "retry-after": new Date(Date.now() + 9_000).toUTCString(),
          },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000006",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(9_000);
  });

  it("fails closed instead of scheduling a Retry-After beyond the active job lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    let apiCalls = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiCalls += 1;
      if (apiCalls === 1) {
        return new Response(JSON.stringify({ errors: [] }), {
          status: 429,
          headers: { "retry-after": "1801" },
        });
      }
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000007",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(1_801_000);
    const result = await request;

    expect(result.status).toBe(429);
    expect(apiCalls).toBe(1);
  });

  it("updates future per-region pacing from Amazon's rate-limit header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-RateLimit-Limit": "0.5",
        },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000004",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(apiStarts).toHaveLength(1);

    const second = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000005",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(apiStarts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(apiStarts).toHaveLength(2);
    expect(apiStarts[1] - apiStarts[0]).toBeGreaterThanOrEqual(2_000);
  });

  it("rejects an extreme rate-limit header instead of creating an infinite timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const apiStarts: number[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return tokenResponse();
      apiStarts.push(Date.now());
      return new Response(JSON.stringify({ publishRecordList: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-amzn-RateLimit-Limit": "1e-320",
        },
      });
    }));

    const first = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000008",
      expectedMode: "live",
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;

    const controller = new AbortController();
    const second = getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000009",
      expectedMode: "live",
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1_050);
    const starts = [...apiStarts];
    controller.abort();
    await second.catch(() => null);

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_050);
  });

  it("refreshes once on 401 and bounds retryable failures for new document reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    const accessTokens: string[] = [];
    let tokenCalls = 0;
    let apiCalls = 0;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(JSON.stringify({
          access_token: `fake-a-plus-token-${tokenCalls}`,
          expires_in: 3_600,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      accessTokens.push(new Headers(init?.headers).get("x-amz-access-token") ?? "");
      apiCalls += 1;
      if (apiCalls === 1) return new Response(null, { status: 401 });
      if (apiCalls <= 3) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({ contentMetadataRecords: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const request = getAplusContentDocumentsPage({
      marketplaceId: US,
      expectedMode: "live",
    });
    await vi.runAllTimersAsync();
    const result = await request;

    expect(result.status).toBe(200);
    expect(tokenCalls).toBe(2);
    expect(apiCalls).toBe(4);
    expect(accessTokens).toEqual([
      "fake-a-plus-token-1",
      "fake-a-plus-token-2",
      "fake-a-plus-token-2",
      "fake-a-plus-token-2",
    ]);
  });

  it("turns a new document-read timeout into the controlled A+ timeout error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T08:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) return Promise.resolve(tokenResponse());
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }));

    const request = getAplusContentDocumentAsinRelationsPage({
      marketplaceId: US,
      contentReferenceKey: "timeout-reference",
      expectedMode: "live",
    });
    const rejection = expect(request).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
      operation: "getAplusContentDocumentAsinRelations",
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });

  it("rejects unsafe identity, token and live-demo drift before dispatch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "bad-asin",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      pageToken: " unsafe ",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_PAGINATION_INVALID" });
    await expect(getAplusContentDocumentsPage({
      marketplaceId: "UNSAFE" as typeof US,
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "LISTING_IDENTITY_MISMATCH" });
    await expect(getAplusContentDocumentsPage({
      marketplaceId: US,
      pageToken: " unsafe ",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_PAGINATION_INVALID" });
    await expect(getAplusContentDocumentAsinRelationsPage({
      marketplaceId: US,
      contentReferenceKey: " unsafe-reference ",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_CONTENT_REFERENCE_INVALID" });
    await expect(getAplusContentDocumentAsinRelationsPage({
      marketplaceId: US,
      contentReferenceKey: "unsafe\nreference",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_CONTENT_REFERENCE_INVALID" });
    await expect(getAplusContentDocumentAsinRelationsPage({
      marketplaceId: US,
      contentReferenceKey: "..",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "A_PLUS_CONTENT_REFERENCE_INVALID" });
    process.env.SP_API_MODE = "demo";
    await expect(getAplusContentPublishRecordsPage({
      marketplaceId: US,
      asin: "B000000001",
      expectedMode: "live",
    })).rejects.toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
