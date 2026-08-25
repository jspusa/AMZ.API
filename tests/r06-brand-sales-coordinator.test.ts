import { describe, expect, it, vi } from "vitest";
import {
  BrandSalesCoordinator,
} from "../src/main/brand-sales-coordinator";
import { FbaRevenueReportsError } from
  "../src/main/amazon/fba-revenue-reports";
import { SpApiError } from "../src/main/amazon/sp-api-error";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const VIEW = {
  jobId: "brand.job_001",
  mode: "live",
  marketplaceId: US,
  startDate: "2026-08-01",
  endDate: "2026-08-07",
  expiresAt: "2026-08-26T01:00:00.000Z",
  ready: false,
  status: "IN_PROGRESS",
  message: "Amazon 正在產生品牌營收報表。",
} as const;

function request(input: Readonly<{
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}>): ApiRequest {
  return {
    requestId: input.method === "POST"
      ? "r06-brand-direct-start-001"
      : "r06-brand-direct-observe-001",
    method: input.method,
    path: "/api/sp-api/brand-sales",
    query: input.query ?? {},
    headers: {},
    body: input.body ? { kind: "json", value: input.body } : undefined,
  };
}

function harness(input: Readonly<{
  begin?: () => Promise<typeof VIEW>;
  get?: () => Promise<{ view: typeof VIEW; snapshot: never | null }>;
}> = {}) {
  const reports = {
    begin: vi.fn(input.begin ?? (async () => VIEW)),
    get: vi.fn(input.get ?? (async () => ({ view: VIEW, snapshot: null }))),
    clear: vi.fn(),
  };
  return {
    coordinator: new BrandSalesCoordinator(reports),
    reports,
  };
}

describe("R06 Brand Sales coordinator", () => {
  it("owns start validation and forwards only the immutable selection", async () => {
    const subject = harness();
    const response = await subject.coordinator.start(request({
      method: "POST",
      body: {
        marketplaceId: US,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        retry: true,
        reportType: "unsafe-caller-value",
        options: { fulfillmentChannel: "MFN" },
        host: "https://example.invalid",
      },
    }));

    expect(subject.reports.begin).toHaveBeenCalledOnce();
    expect(subject.reports.begin).toHaveBeenCalledWith({
      marketplaceId: US,
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      explicitRetry: true,
    });
    expect(response).toMatchObject({
      status: 202,
      body: { kind: "json", value: VIEW },
    });
  });

  it("owns observe validation, status polling, and data selection", async () => {
    const snapshot = { schemaVersion: 2, source: "fixture" } as never;
    const subject = harness({
      get: async () => ({ view: VIEW, snapshot }),
    });
    const response = await subject.coordinator.observe(request({
      method: "GET",
      query: {
        marketplaceId: US,
        jobId: "brand.job_001",
        data: "1",
        reportId: "caller-must-not-control-this",
      },
    }));

    expect(subject.reports.get).toHaveBeenCalledOnce();
    expect(subject.reports.get).toHaveBeenCalledWith({
      marketplaceId: US,
      jobId: "brand.job_001",
      includeData: true,
    });
    expect(response).toMatchObject({
      status: 200,
      body: { kind: "json", value: snapshot },
    });
  });

  it("preserves the pending observe status when data is not requested", async () => {
    const subject = harness();
    const response = await subject.coordinator.observe(request({
      method: "GET",
      query: { marketplaceId: US, jobId: "brand.job_001" },
    }));

    expect(subject.reports.get).toHaveBeenCalledWith({
      marketplaceId: US,
      jobId: "brand.job_001",
      includeData: false,
    });
    expect(response.status).toBe(202);
  });

  it("rejects malformed start and observe inputs before touching state", async () => {
    const subject = harness();
    const [badStart, badObserve] = await Promise.all([
      subject.coordinator.start(request({
        method: "POST",
        body: {
          marketplaceId: US,
          startDate: "2026-02-30",
          endDate: "2026-08-07",
          retry: false,
        },
      })),
      subject.coordinator.observe(request({
        method: "GET",
        query: { marketplaceId: US, jobId: "unsafe/job" },
      })),
    ]);

    expect(badStart).toMatchObject({
      status: 400,
      body: {
        kind: "json",
        value: {
          code: "INVALID_INPUT",
          message: "品牌營收需要有效站點與完整 YYYY-MM-DD 日期範圍。",
        },
      },
    });
    expect(badObserve).toMatchObject({
      status: 400,
      body: {
        kind: "json",
        value: {
          code: "INVALID_INPUT",
          message: "品牌營收工作資訊無效，請重新同步。",
        },
      },
    });
    expect(subject.reports.begin).not.toHaveBeenCalled();
    expect(subject.reports.get).not.toHaveBeenCalled();
  });

  it("keeps semantic errors minimal, sanitized, and retry-aware", async () => {
    const subject = harness({
      begin: async () => {
        throw new FbaRevenueReportsError(
          "報表暫時受到 Amazon 速率限制。",
          429,
          "REPORT_RATE_LIMITED",
          "5",
        );
      },
    });
    const response = await subject.coordinator.start(request({
      method: "POST",
      body: {
        marketplaceId: US,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      },
    }));

    expect(response).toMatchObject({
      status: 429,
      headers: { "retry-after": "5" },
      body: {
        kind: "json",
        value: {
          code: "REPORT_RATE_LIMITED",
          message: "報表暫時受到 Amazon 速率限制。",
        },
      },
    });
    expect((response.body as { value: unknown }).value).toEqual({
      code: "REPORT_RATE_LIMITED",
      message: "報表暫時受到 Amazon 速率限制。",
    });
  });

  it("fails hostile semantic error metadata closed at its public seam", async () => {
    const hostile = [
      "Bearer example-access-value",
      "accountScope=example-private-scope",
      "reportId=example-private-report",
      "https://example.invalid/private?client_secret=example-secret",
    ].join(" ");
    const subject = harness({
      begin: async () => {
        throw new FbaRevenueReportsError(
          hostile,
          302,
          "BAD\nCODE",
          "-1\r\nx-private: example",
        );
      },
    });

    const response = await subject.coordinator.start(request({
      method: "POST",
      body: {
        marketplaceId: US,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      },
    }));

    expect(response).toMatchObject({
      status: 500,
      body: {
        kind: "json",
        value: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "開始整理 FBA 品牌營收時發生未預期的錯誤。",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("Bearer");
    expect(JSON.stringify(response)).not.toContain("client_secret");
    expect(response.headers).not.toHaveProperty("retry-after");
  });

  it("uses the canonical rich SP error sanitizer and hides unknown failures", async () => {
    const spSubject = harness({
      get: async () => {
        throw new SpApiError("Amazon 報表暫時無法使用。", {
          status: 503,
          code: "UPSTREAM_UNAVAILABLE",
          requestId: "request.safe:001",
          retryAfter: "4",
        });
      },
    });
    const unknownSubject = harness({
      begin: async () => {
        throw new Error("private accountScope and signed URL");
      },
    });

    const spResponse = await spSubject.coordinator.observe(request({
      method: "GET",
      query: { marketplaceId: US, jobId: "brand.job_001" },
    }));
    const unknownResponse = await unknownSubject.coordinator.start(request({
      method: "POST",
      body: {
        marketplaceId: US,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      },
    }));

    expect(spResponse).toMatchObject({
      status: 503,
      headers: { "retry-after": "4" },
      body: {
        kind: "json",
        value: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Amazon 報表暫時無法使用。",
          requestId: "request.safe:001",
        },
      },
    });
    expect(unknownResponse).toMatchObject({
      status: 500,
      body: {
        kind: "json",
        value: {
          code: "INTERNAL_ERROR",
          message: "開始整理 FBA 品牌營收時發生未預期的錯誤。",
        },
      },
    });
    expect(JSON.stringify(unknownResponse)).not.toContain("accountScope");
    expect(JSON.stringify(unknownResponse)).not.toContain("signed URL");
  });

  it("clears the same private reports engine used by start and observe", () => {
    const subject = harness();

    subject.coordinator.clear();

    expect(subject.reports.clear).toHaveBeenCalledOnce();
  });

});
