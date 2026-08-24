import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  reportsAdapterIdentity,
  type ReportsCreateRequest,
  type ReportsDocumentRequest,
  type ReportsIntentPlan,
  type ReportsStatusRequest,
} from "../src/main/amazon/reports-runtime";
import { createReportsRuntimeProductionAdapter } from "../src/main/amazon/reports-runtime-production";
import type { MarketplaceRegion } from "../src/shared/marketplaces";
import {
  publicSpApiError,
  SpApiError,
} from "../src/main/amazon/sp-api-error";

const US = "ATVPDKIKX0DER" as const;
const NOW = new Date("2026-08-24T00:00:00.000Z");

const PLANS = [
  { intent: "all-listings", marketplaceId: US },
  { intent: "active-business-listings", marketplaceId: US },
  { intent: "aged-inventory", marketplaceId: US },
  { intent: "inbound-noncompliance", marketplaceId: US },
  {
    intent: "sales-and-traffic-daily-sku",
    marketplaceId: US,
    startDate: "2026-07-01",
    endDate: "2026-07-30",
  },
  {
    intent: "fba-shipment-sales",
    marketplaceId: US,
    startDate: "2026-07-01",
    endDate: "2026-07-30",
    dataStartTime: "2026-07-01T07:00:00.000Z",
    dataEndTime: "2026-07-31T07:00:00.000Z",
    windowCreatedAt: NOW.getTime(),
  },
] as const satisfies readonly ReportsIntentPlan[];

const EXPECTED_CREATE_BODIES = [
  {
    reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
    marketplaceIds: [US],
    reportOptions: { preferredReportDocumentLocale: "en_US" },
  },
  {
    reportType: "GET_MERCHANT_LISTINGS_DATA",
    marketplaceIds: [US],
    reportOptions: { preferredReportDocumentLocale: "en_US" },
  },
  {
    reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
    marketplaceIds: [US],
  },
  {
    reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
    marketplaceIds: [US],
  },
  {
    reportType: "GET_SALES_AND_TRAFFIC_REPORT",
    marketplaceIds: [US],
    dataStartTime: "2026-07-01",
    dataEndTime: "2026-07-30",
    reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" },
  },
  {
    reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
    marketplaceIds: [US],
    dataStartTime: "2026-07-01T07:00:00.000Z",
    dataEndTime: "2026-07-31T07:00:00.000Z",
  },
] as const;

function createRequest(plan: ReportsIntentPlan): ReportsCreateRequest {
  return {
    ...reportsAdapterIdentity(plan, "live"),
    operation: "create",
    signal: new AbortController().signal,
  };
}

function statusRequest(
  plan: ReportsIntentPlan,
  signal = new AbortController().signal,
): ReportsStatusRequest {
  return {
    ...reportsAdapterIdentity(plan, "live"),
    operation: "status",
    reportId: "1234567890123",
    signal,
  };
}

function documentRequest(
  plan: ReportsIntentPlan,
  signal = new AbortController().signal,
): ReportsDocumentRequest {
  return {
    ...reportsAdapterIdentity(plan, "live"),
    operation: "document",
    reportId: "1234567890123",
    documentId: "amzn1.spdoc.1.2.example",
    signal,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function validStatusPayload(
  plan: ReportsIntentPlan,
  input: Readonly<{ status?: "IN_QUEUE" | "IN_PROGRESS" | "DONE" }> = {},
): Record<string, unknown> {
  const processingStatus = input.status ?? "DONE";
  const base: Record<string, unknown> = {
    reportId: "1234567890123",
    marketplaceIds: [US],
    processingStatus,
    ...(processingStatus === "DONE"
      ? { reportDocumentId: "amzn1.spdoc.1.2.example" }
      : {}),
  };
  switch (plan.intent) {
    case "all-listings":
      return {
        ...base,
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      };
    case "active-business-listings":
      return {
        ...base,
        reportType: "GET_MERCHANT_LISTINGS_DATA",
      };
    case "aged-inventory":
      return { ...base, reportType: "GET_FBA_INVENTORY_PLANNING_DATA" };
    case "inbound-noncompliance":
      return {
        ...base,
        reportType: "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA",
      };
    case "sales-and-traffic-daily-sku":
      return {
        ...base,
        reportType: "GET_SALES_AND_TRAFFIC_REPORT",
        dataStartTime: `${plan.startDate}T00:00:00Z`,
        dataEndTime: `${plan.endDate}T23:59:59Z`,
      };
    case "fba-shipment-sales":
      return {
        ...base,
        reportType: "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA",
        dataStartTime: plan.dataStartTime,
        dataEndTime: plan.dataEndTime,
      };
  }
}

describe("Reports runtime production adapter", () => {
  it("maps all six intents to fixed production POSTs and ignores arbitrary transport fields", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const forceRefreshes: boolean[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        url: new URL(input instanceof Request ? input.url : String(input)),
        init,
      });
      return jsonResponse(202, { reportId: String(1_000_000_000_000 + requests.length) });
    });
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async (_region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return "TOKEN";
      },
      invalidateAccessToken: () => undefined,
      fetchImpl,
      userAgent: () => "AMZ.API/test",
      now: () => new Date(NOW),
    });

    for (const plan of PLANS) {
      const request = {
        ...createRequest(plan),
        path: "/attacker",
        method: "DELETE",
        reportType: "ATTACKER_REPORT",
        reportOptions: { dangerous: "true" },
        url: "https://attacker.invalid/write",
      } as unknown as ReportsCreateRequest;
      await expect(adapter.create(request)).resolves.toMatchObject({
        identity: reportsAdapterIdentity(plan, "live"),
        mode: "live",
        ready: false,
        status: "IN_QUEUE",
        documentId: null,
      });
    }

    expect(requests).toHaveLength(PLANS.length);
    expect(forceRefreshes).toEqual(PLANS.map(() => false));
    requests.forEach(({ url, init }, index) => {
      expect(url.origin).toBe("https://sellingpartnerapi-na.amazon.com");
      expect(url.pathname).toBe("/reports/2021-06-30/reports");
      expect(url.search).toBe("");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(EXPECTED_CREATE_BODIES[index]);
      expect(init?.headers).toMatchObject({
        "x-amz-access-token": "TOKEN",
        "user-agent": "AMZ.API/test",
      });
    });
  });

  it.each([401, 429, 503])(
    "never replays an ambiguous create when Amazon returns %s",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(status, {
        errors: [{ message: "do not expose or replay" }],
      }));
      const invalidateAccessToken = vi.fn();
      const sleep = vi.fn(async () => undefined);
      const adapter = createReportsRuntimeProductionAdapter({
        getAccessToken: async () => "TOKEN",
        invalidateAccessToken,
        fetchImpl,
        sleep,
      });

      await expect(adapter.create(createRequest(PLANS[0]))).rejects.toMatchObject({
        status,
        code: status === 429 ? "RATE_LIMITED" : "REPORT_FAILED",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(invalidateAccessToken).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("allows one status 401 refresh and only two bounded transient retries", async () => {
    const forceRefreshes: boolean[] = [];
    const invalidations: MarketplaceRegion[] = [];
    const delays: number[] = [];
    const responses = [
      jsonResponse(401, {}),
      jsonResponse(429, {}, { "retry-after": "0" }),
      jsonResponse(500, {}),
      jsonResponse(200, validStatusPayload(PLANS[0]), {
        "x-amzn-requestid": "safe-request-id",
      }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!);
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async (_region, forceRefresh) => {
        forceRefreshes.push(forceRefresh);
        return "TOKEN";
      },
      invalidateAccessToken: (region) => invalidations.push(region),
      fetchImpl,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      random: () => 0,
      now: () => new Date(NOW),
    });

    await expect(adapter.status(statusRequest(PLANS[0]))).resolves.toEqual({
      identity: reportsAdapterIdentity(PLANS[0], "live"),
      mode: "live",
      ready: true,
      reportId: "1234567890123",
      documentId: "amzn1.spdoc.1.2.example",
      status: "DONE",
      notice: "Amazon 全商品清單已就緒。",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(forceRefreshes).toEqual([false, true, false, false]);
    expect(invalidations).toEqual(["na"]);
    expect(delays).toEqual([0, 500]);
  });

  it("keeps the control-plane timeout active while a JSON body stalls", async () => {
    vi.useFakeTimers();
    let markBodyStarted: () => void = () => undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const cancel = vi.fn();
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => {
        const readable = new ReadableStream<Uint8Array>({ cancel });
        const getReader = readable.getReader.bind(readable);
        (readable as unknown as {
          getReader(): ReadableStreamDefaultReader<Uint8Array>;
        }).getReader = () => {
          markBodyStarted();
          return getReader();
        };
        return new Response(readable, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      const pending = adapter.status(statusRequest(PLANS[0]));
      const rejected = expect(pending).rejects.toMatchObject({
        status: 504,
        code: "UPSTREAM_UNAVAILABLE",
      });
      await bodyStarted;
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller abort after headers and cancels the JSON reader", async () => {
    let markBodyStarted: () => void = () => undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const cancel = vi.fn();
    const controller = new AbortController();
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => {
        const readable = new ReadableStream<Uint8Array>({ cancel });
        const getReader = readable.getReader.bind(readable);
        (readable as unknown as {
          getReader(): ReadableStreamDefaultReader<Uint8Array>;
        }).getReader = () => {
          markBodyStarted();
          return getReader();
        };
        return new Response(readable, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const reason = new Error("report context changed");
    const pending = adapter.status(statusRequest(PLANS[0], controller.signal));
    const rejected = expect(pending).rejects.toBe(reason);

    await bodyStarted;
    controller.abort(reason);
    await rejected;
    expect(cancel).toHaveBeenCalledWith(reason);
  });

  it("checks report ID, marketplace, options, dates, and immutable shipment window", async () => {
    const mismatches = PLANS.map((plan, index) => {
      const payload = validStatusPayload(plan);
      if (index === 0) payload.reportType = "GET_MERCHANT_LISTINGS_DATA";
      if (index === 1) payload.marketplaceIds = ["A2EUQ1WTGCTBG2"];
      if (index === 2) payload.reportId = "9999999999999";
      if (index === 3) payload.reportOptions = { dangerous: "true" };
      if (index === 4) payload.dataStartTime = "2026-07-02T00:00:00Z";
      if (index === 5) payload.dataEndTime = "2026-08-01T07:00:00.000Z";
      return { plan, payload };
    });

    for (const mismatch of mismatches) {
      const adapter = createReportsRuntimeProductionAdapter({
        getAccessToken: async () => "TOKEN",
        invalidateAccessToken: () => undefined,
        fetchImpl: async () => jsonResponse(200, mismatch.payload),
      });
      await expect(adapter.status(statusRequest(mismatch.plan))).rejects.toMatchObject({
        status: 409,
        code: "REPORT_MISMATCH",
      });
    }
  });

  it.each([PLANS[0], PLANS[1], PLANS[4]])(
    "accepts the official $intent GetReport shape without reportOptions",
    async (plan) => {
      const adapter = createReportsRuntimeProductionAdapter({
        getAccessToken: async () => "TOKEN",
        invalidateAccessToken: () => undefined,
        fetchImpl: async () => jsonResponse(200, validStatusPayload(plan)),
      });

      await expect(adapter.status(statusRequest(plan))).resolves.toMatchObject({
        ready: true,
        status: "DONE",
      });
    },
  );

  it.each([
    [PLANS[0], { preferredReportDocumentLocale: "fr_FR" }],
    [PLANS[1], { preferredReportDocumentLocale: "fr_FR" }],
    [PLANS[4], { dateGranularity: "WEEK", asinGranularity: "SKU" }],
  ] as const)(
    "rejects mismatched optional reportOptions for $0.intent",
    async (plan, reportOptions) => {
      const payload = validStatusPayload(plan);
      payload.reportOptions = reportOptions;
      const adapter = createReportsRuntimeProductionAdapter({
        getAccessToken: async () => "TOKEN",
        invalidateAccessToken: () => undefined,
        fetchImpl: async () => jsonResponse(200, payload),
      });

      await expect(adapter.status(statusRequest(plan))).rejects.toMatchObject({
        status: 409,
        code: "REPORT_MISMATCH",
      });
    },
  );

  it.each([
    "2026-07-01Tgarbage",
    "2026-07-01T24:00:00Z",
    "2026-07-01T00:00:00+14:01",
  ])("rejects a non-canonical report date value: %s", async (dataStartTime) => {
    const payload = validStatusPayload(PLANS[4]);
    payload.dataStartTime = dataStartTime;
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => jsonResponse(200, payload),
    });

    await expect(adapter.status(statusRequest(PLANS[4]))).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MISMATCH",
    });
  });

  it.each([
    "2026-07-01",
    "2026-07-01T00:00:00Z",
  ])("accepts an exact date or canonical RFC3339 value: %s", async (dataStartTime) => {
    const payload = validStatusPayload(PLANS[4]);
    payload.dataStartTime = dataStartTime;
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => jsonResponse(200, payload),
    });

    await expect(adapter.status(statusRequest(PLANS[4]))).resolves.toMatchObject({
      ready: true,
      status: "DONE",
    });
  });

  it("rebuilds the exact shipment window from windowCreatedAt before transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
      now: () => new Date(NOW),
    });
    const plan = {
      ...PLANS[5],
      dataEndTime: "2026-07-31T07:00:01.000Z",
    } satisfies ReportsIntentPlan;

    await expect(adapter.create(createRequest(plan))).rejects.toMatchObject({
      status: 400,
      code: "INVALID_DATE_RANGE",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads only the metadata-owned HTTPS AWS URL, with redirect errors and bounded GZIP", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const signedUrl =
      "https://bucket.s3.amazonaws.com/private/report.tsv.gz?X-Amz-Credential=signed-value";
    const compressed = gzipSync("sku\tquantity\nEXACT-SKU\t2\n");
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push({ url, init });
      return url.hostname === "sellingpartnerapi-na.amazon.com"
        ? jsonResponse(200, { url: signedUrl, compressionAlgorithm: "GZIP" })
        : new Response(compressed, {
            status: 200,
            headers: { "content-length": String(compressed.byteLength) },
          });
    });
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
    });
    const request = {
      ...documentRequest(PLANS[0]),
      path: "/attacker",
      url: "https://attacker.invalid/private",
    } as unknown as ReportsDocumentRequest;

    await expect(adapter.readDocument(request)).resolves.toEqual({
      identity: reportsAdapterIdentity(PLANS[0], "live"),
      reportId: request.reportId,
      documentId: request.documentId,
      text: "sku\tquantity\nEXACT-SKU\t2\n",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url.pathname).toBe(
      "/reports/2021-06-30/documents/amzn1.spdoc.1.2.example",
    );
    expect(calls[1].url.toString()).toBe(signedUrl);
    expect(calls[1].init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
    });
    expect(calls[1].init?.headers).toBeUndefined();
  });

  it("cancels the bounded GZIP reader when the caller aborts decompression", async () => {
    let markReaderStarted: () => void = () => undefined;
    const readerStarted = new Promise<void>((resolve) => {
      markReaderStarted = resolve;
    });
    const cancel = vi.fn();
    class StalledDecompressionStream {
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable = new WritableStream<Uint8Array>();

      constructor() {
        const readable = new ReadableStream<Uint8Array>({ cancel });
        const getReader = readable.getReader.bind(readable);
        (readable as unknown as {
          getReader(): ReadableStreamDefaultReader<Uint8Array>;
        }).getReader = () => {
          markReaderStarted();
          return getReader();
        };
        this.readable = readable;
      }
    }
    vi.stubGlobal("DecompressionStream", StalledDecompressionStream);
    const signedUrl = "https://bucket.s3.amazonaws.com/report.tsv.gz";
    const compressed = gzipSync("sku\tquantity\nEXACT-SKU\t2\n");
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return url.hostname === "sellingpartnerapi-na.amazon.com"
          ? jsonResponse(200, { url: signedUrl, compressionAlgorithm: "GZIP" })
          : new Response(compressed, { status: 200 });
      },
    });
    const controller = new AbortController();
    const reason = new Error("report context changed during decompression");

    try {
      const pending = adapter.readDocument(
        documentRequest(PLANS[0], controller.signal),
      );
      const rejected = expect(pending).rejects.toBe(reason);
      await readerStarted;
      controller.abort(reason);
      await rejected;
      expect(cancel).toHaveBeenCalledWith(reason);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    "http://bucket.s3.amazonaws.com/report.tsv",
    "https://user:password@bucket.s3.amazonaws.com/report.tsv",
    "https://bucket.s3.amazonaws.com:443/report.tsv",
    "https://bucket.s3.amazonaws.com:444/report.tsv",
    "https://attacker.invalid/report.tsv",
  ])("rejects an unsafe signed document URL before fetching it: %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { url }));
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
    });

    await expect(adapter.readDocument(documentRequest(PLANS[0]))).rejects.toMatchObject({
      status: 502,
      code: "REPORT_DOWNLOAD_FAILED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a declared compressed document above 100 MiB before buffering", async () => {
    const signedUrl = "https://bucket.s3.amazonaws.com/report.tsv";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.hostname === "sellingpartnerapi-na.amazon.com"
        ? jsonResponse(200, { url: signedUrl })
        : new Response("small", {
            status: 200,
            headers: { "content-length": String(100 * 1024 * 1024 + 1) },
          });
    });
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
    });

    await expect(adapter.readDocument(documentRequest(PLANS[0]))).rejects.toMatchObject({
      status: 413,
      code: "REPORT_TOO_LARGE",
    });
  });

  it("leaves request-ID sanitization to the canonical public error seam", async () => {
    const privateRequestId = "https://attacker.invalid/?refresh_token=secret";
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl: async () => jsonResponse(403, {}, {
        "x-amzn-requestid": privateRequestId,
      }),
    });

    let thrown: unknown;
    try {
      await adapter.status(statusRequest(PLANS[0]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SpApiError);
    expect((thrown as SpApiError).requestId).toBe(privateRequestId);
    expect(publicSpApiError(thrown as SpApiError, "Amazon 報表查詢失敗。").requestId)
      .toBeNull();
  });

  it("rejects demo requests without touching production transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createReportsRuntimeProductionAdapter({
      getAccessToken: async () => "TOKEN",
      invalidateAccessToken: () => undefined,
      fetchImpl,
    });
    const request = {
      ...reportsAdapterIdentity(PLANS[0], "demo"),
      operation: "create",
      signal: new AbortController().signal,
    } as ReportsCreateRequest;

    await expect(adapter.create(request)).rejects.toMatchObject({
      status: 409,
      code: "REPORT_MODE_CHANGED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
