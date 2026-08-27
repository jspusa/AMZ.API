import { describe, expect, it, vi } from "vitest";
import type { FbaCatalogExport } from
  "../src/main/amazon/catalog-report-reads";
import type { ListingsExportCapture } from
  "../src/main/amazon/listings-export";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type {
  OpaqueAccountScope,
  SpExecutionContext,
} from "../src/main/amazon/sp-execution-context";
import {
  ListingsExportRoutes,
  type ListingsExportRoutesDependencies,
} from "../src/main/listings-export-routes";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const JSON_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const CONTEXT = Object.freeze({
  marketplaceId: US,
  region: "na",
  mode: "demo",
  accountScope: "opaque-c01-listings-account" as OpaqueAccountScope,
  generation: 7,
}) satisfies SpExecutionContext;
const LISTINGS = Object.freeze({
  fetchedAt: "2026-08-27T00:00:00.000Z",
  rows: [],
  errors: [],
}) satisfies FbaCatalogExport;
const CAPTURED = Object.freeze({
  exportId: "00000000-0000-4000-8000-000000000104",
  context: CONTEXT,
  snapshot: LISTINGS,
}) satisfies ListingsExportCapture;
const READY = Object.freeze({
  mode: "demo" as const,
  ready: true,
  reportId: "c01-report",
  documentId: "c01-document",
  status: "DONE" as const,
  notice: "Amazon 報表已就緒。",
});
const PENDING = Object.freeze({
  ...READY,
  ready: false,
  documentId: null,
  status: "IN_QUEUE" as const,
  notice: "Amazon 正在準備報表。",
});
type ContentSnapshot = Awaited<ReturnType<
  ListingsExportRoutesDependencies["contentAudit"]["captureFromListings"]
>>;
type ImageSnapshot = Awaited<ReturnType<
  ListingsExportRoutesDependencies["imageAudit"]["captureFromListings"]
>>;
const CONTENT_SNAPSHOT = Object.freeze({
  kind: "content-audit",
}) as unknown as ContentSnapshot;
const IMAGE_SNAPSHOT = Object.freeze({
  kind: "image-audit",
}) as unknown as ImageSnapshot;
const LISTINGS_DOWNLOAD: ApiResponse = {
  status: 200,
  headers: { "content-type": "application/listings-xlsx" },
  body: { kind: "bytes", value: new Uint8Array([1]) },
};
const CONTENT_DOWNLOAD: ApiResponse = {
  status: 200,
  headers: { "content-type": "application/content-audit-xlsx" },
  body: { kind: "bytes", value: new Uint8Array([2]) },
};
const IMAGE_DOWNLOAD: ApiResponse = {
  status: 200,
  headers: { "content-type": "application/image-audit-xlsx" },
  body: { kind: "bytes", value: new Uint8Array([3]) },
};

function request(
  method: "GET" | "POST",
  query: Record<string, string> = {},
  body?: ApiRequest["body"],
): ApiRequest {
  return {
    requestId: `c01-listings-${method.toLowerCase()}-001`,
    method,
    path: "/api/sp-api/listing-content/export",
    query,
    headers: {},
    ...(body ? { body } : {}),
  };
}

function harness() {
  const start = vi.fn<
    ListingsExportRoutesDependencies["listingsExport"]["start"]
  >(async () => READY);
  const status = vi.fn<
    ListingsExportRoutesDependencies["listingsExport"]["status"]
  >(async () => READY);
  const capture = vi.fn<
    ListingsExportRoutesDependencies["listingsExport"]["capture"]
  >(async () => CAPTURED);
  const listingsDownload = vi.fn<
    ListingsExportRoutesDependencies["listingsExport"]["download"]
  >(async () => LISTINGS_DOWNLOAD);
  const contentCapture = vi.fn<
    ListingsExportRoutesDependencies["contentAudit"]["captureFromListings"]
  >(async () => CONTENT_SNAPSHOT);
  const contentDownload = vi.fn<
    ListingsExportRoutesDependencies["contentAudit"]["download"]
  >(async () => CONTENT_DOWNLOAD);
  const imageCapture = vi.fn<
    ListingsExportRoutesDependencies["imageAudit"]["captureFromListings"]
  >(async () => IMAGE_SNAPSHOT);
  const imageDownload = vi.fn<
    ListingsExportRoutesDependencies["imageAudit"]["download"]
  >(async () => IMAGE_DOWNLOAD);
  const routes = new ListingsExportRoutes({
    listingsExport: {
      start,
      status,
      capture,
      download: listingsDownload,
    },
    contentAudit: {
      captureFromListings: contentCapture,
      download: contentDownload,
    },
    imageAudit: {
      captureFromListings: imageCapture,
      download: imageDownload,
    },
  });
  return {
    routes,
    start,
    status,
    capture,
    listingsDownload,
    contentCapture,
    contentDownload,
    imageCapture,
    imageDownload,
  };
}

describe("C01 Listings export route owner", () => {
  it.each([
    [READY, 200],
    [PENDING, 202],
  ] as const)("preserves start readiness as HTTP %s", async (receipt, httpStatus) => {
    const subject = harness();
    subject.start.mockResolvedValueOnce(receipt);

    const response = await subject.routes.start(request("POST", {}, {
      kind: "json",
      value: { marketplaceId: US },
    }));

    expect(subject.start).toHaveBeenCalledWith({ marketplaceId: US });
    expect(response).toEqual({
      status: httpStatus,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: { ...receipt, message: receipt.notice },
      },
    });
  });

  it("rejects an invalid start body before calling the report owner", async () => {
    const subject = harness();

    const response = await subject.routes.start(request("POST", {}, {
      kind: "json",
      value: { marketplaceId: "not-a-marketplace" },
    }));

    expect(subject.start).not.toHaveBeenCalled();
    expect(response).toEqual({
      status: 400,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: {
          code: "INVALID_INPUT",
          message: "請選擇要匯出的 Amazon 站點。",
        },
      },
    });
  });

  it("preserves status lookup inputs and receipt JSON", async () => {
    const subject = harness();

    const response = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      reportId: READY.reportId,
    }));

    expect(subject.status).toHaveBeenCalledWith({
      marketplaceId: US,
      reportId: READY.reportId,
    });
    expect(response).toEqual({
      status: 200,
      headers: JSON_HEADERS,
      body: {
        kind: "json",
        value: { ...READY, message: READY.notice },
      },
    });
  });

  it.each([
    ["audit", CONTENT_DOWNLOAD],
    ["imageAudit", IMAGE_DOWNLOAD],
  ] as const)("downloads a stored %s snapshot without reading a report", async (
    auditFlag,
    expected,
  ) => {
    const subject = harness();

    const response = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      [auditFlag]: "1",
      download: "1",
      exportId: CAPTURED.exportId,
    }));

    const owner = auditFlag === "audit"
      ? subject.contentDownload
      : subject.imageDownload;
    expect(owner).toHaveBeenCalledWith({
      marketplaceId: US,
      exportId: CAPTURED.exportId,
    });
    expect(subject.capture).not.toHaveBeenCalled();
    expect(response).toBe(expected);
  });

  it.each([
    ["audit", CONTENT_SNAPSHOT],
    ["imageAudit", IMAGE_SNAPSHOT],
  ] as const)("projects the captured Listings snapshot through %s", async (
    auditFlag,
    expected,
  ) => {
    const subject = harness();

    const response = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      reportId: READY.reportId,
      documentId: READY.documentId,
      [auditFlag]: "1",
    }));

    expect(subject.capture).toHaveBeenCalledWith({
      marketplaceId: US,
      reportId: READY.reportId,
      documentId: READY.documentId,
    });
    const owner = auditFlag === "audit"
      ? subject.contentCapture
      : subject.imageCapture;
    expect(owner).toHaveBeenCalledWith({
      context: CONTEXT,
      marketplaceId: US,
      listings: LISTINGS,
    });
    expect(response).toEqual({
      status: 200,
      headers: JSON_HEADERS,
      body: { kind: "json", value: expected },
    });
  });

  it("downloads an ordinary export only through its captured opaque id", async () => {
    const subject = harness();

    const response = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      reportId: READY.reportId,
      documentId: READY.documentId,
      download: "1",
    }));

    expect(subject.listingsDownload).toHaveBeenCalledWith({
      marketplaceId: US,
      exportId: CAPTURED.exportId,
    });
    expect(response).toBe(LISTINGS_DOWNLOAD);
  });

  it("preserves public SP-API error metadata and retry headers", async () => {
    const subject = harness();
    subject.start.mockRejectedValueOnce(new SpApiError("Amazon throttled.", {
      status: 429,
      code: "RATE_LIMITED",
      requestId: "request-safe-104",
      retryAfter: "3",
    }));

    const response = await subject.routes.start(request("POST", {}, {
      kind: "json",
      value: { marketplaceId: US },
    }));

    expect(response).toEqual({
      status: 429,
      headers: { ...JSON_HEADERS, "retry-after": "3" },
      body: {
        kind: "json",
        value: {
          code: "RATE_LIMITED",
          message: "Amazon throttled.",
          requestId: "request-safe-104",
          issues: [],
          operation: null,
          upstreamCode: null,
        },
      },
    });
  });

  it("rejects conflicting audits and malformed identifiers before any owner call", async () => {
    const subject = harness();

    const conflict = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      audit: "1",
      imageAudit: "1",
    }));
    const malformed = await subject.routes.observe(request("GET", {
      marketplaceId: US,
      reportId: "../private-report",
    }));

    expect(conflict).toMatchObject({
      status: 400,
      body: {
        kind: "json",
        value: { message: "一次只能執行一種全站健檢。" },
      },
    });
    expect(malformed).toMatchObject({
      status: 400,
      body: {
        kind: "json",
        value: { message: "報表查詢資訊無效，請重新匯出。" },
      },
    });
    expect(subject.status).not.toHaveBeenCalled();
    expect(subject.capture).not.toHaveBeenCalled();
  });
});
