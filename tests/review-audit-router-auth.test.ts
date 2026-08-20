import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  feedback: vi.fn(),
  mode: "demo" as "demo" | "live",
  candidateCount: 3,
  candidateGate: null as Promise<void> | null,
  candidateStarted: false,
}));

vi.mock("../src/main/amazon/sp-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/amazon/sp-api")>();
  return {
    ...actual,
    usesDemoMode: vi.fn(() => mocks.mode === "demo"),
    startAllListingsReport: vi.fn(async () => ({
      mode: mocks.mode,
      ready: true,
      reportId: "report-live",
      documentId: "document-live",
      status: "DONE" as const,
      notice: "ready",
    })),
    getAllListingsReportStatus: vi.fn(async () => ({
      mode: mocks.mode,
      ready: true,
      reportId: "report-live",
      documentId: "document-live",
      status: "DONE" as const,
      notice: "ready",
    })),
    getFbaReviewAuditCandidates: vi.fn(async () => {
      const mode = mocks.mode;
      mocks.candidateStarted = true;
      await mocks.candidateGate;
      return {
        mode,
        marketplaceId: "ATVPDKIKX0DER" as const,
        sourceCandidateCount: mocks.candidateCount,
        candidates: Array.from({ length: mocks.candidateCount }, (_, offset) => offset + 1)
          .map((index) => ({
          sellerSkus: [`SKU-${index}`],
          asin: `B00000000${index}`,
          title: `Product ${index}`,
          relationshipRole: index % 2 === 0 ? "child" as const : "standalone" as const,
          evidence: "FBA_LISTING_REPORT_RELATIONSHIPS_NON_PARENT_ASIN" as const,
        })),
        relationshipIncompleteRows: [],
        coverage: {
          sourceFbaListings: mocks.candidateCount,
          verifiedNonParentListings: mocks.candidateCount,
          verifiedChildListings: Math.floor(mocks.candidateCount / 2),
          verifiedStandaloneListings:
            mocks.candidateCount - Math.floor(mocks.candidateCount / 2),
          excludedParentContainers: 0,
          relationshipIncomplete: 0,
        },
        notice: "FBA only",
      };
    }),
    getCustomerFeedbackReviewTopics: mocks.feedback,
  };
});

import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER";
const previousMode = process.env.SP_API_MODE;

function request(method: "GET" | "POST", path: string, input: Record<string, unknown>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path,
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST" ? { body: { kind: "json" as const, value: input } } : {}),
  };
}

function jsonValue(response: Awaited<ReturnType<ApiRouter["handle"]>>): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return response.body.value as Record<string, unknown>;
}

describe("review audit role failure fan-out", () => {
  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    mocks.mode = "demo";
    mocks.candidateCount = 3;
    mocks.candidateGate = null;
    mocks.candidateStarted = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = previousMode;
  });

  it("stops after the first 403-equivalent result and marks remaining non-parent ASINs incomplete", async () => {
    mocks.feedback.mockReset();
    mocks.feedback.mockImplementation(async ({ candidate }) => ({
      candidate,
      response: null,
      error: {
        code: "UNAUTHORIZED",
        message: "Selling Partner Insights or Brand Analytics role required.",
        requestId: "request-403",
      },
    }));
    const directory = await mkdtemp(join(tmpdir(), "review-router-store-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request("POST", "/api/sp-api/review-audit", { marketplaceId: US }));
    expect(started.status, JSON.stringify(jsonValue(started))).toBe(202);
    const jobId = jsonValue(started).jobId as string;
    const completed = await router.handle(request("GET", "/api/sp-api/review-audit", { marketplaceId: US, jobId }));
    expect(completed.status).toBe(200);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    expect(jsonValue(completed)).toMatchObject({
      summary: { uniqueFbaNonParentAsins: 3, completed: 0, noTopics: 0, totalIncomplete: 3 },
      rows: [
        { incompleteReason: { code: "CUSTOMER_FEEDBACK_QUERY_FAILED", requestId: "request-403" } },
        { incompleteReason: { code: "CUSTOMER_FEEDBACK_QUERY_FAILED", requestId: "request-403" } },
        { incompleteReason: { code: "CUSTOMER_FEEDBACK_QUERY_FAILED", requestId: "request-403" } },
      ],
    });
  });

  it("continues the main-process job after renderer close/unmount without status polling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 3;
    mocks.feedback.mockReset();
    const callTimes: number[] = [];
    mocks.feedback.mockImplementation(async ({ candidate }) => {
      callTimes.push(Date.now());
      return {
        candidate,
        response: null,
        noContent: true,
      };
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-background-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    expect(jsonValue(started)).toMatchObject({
      capabilityNotice: expect.stringMatching(/星等下降方向的影響值.*不是商品負星等.*不會轉成 0 或絕對值.*背景繼續/u),
    });

    // No renderer GET is issued here: aborting local polling on unmount does
    // not cancel or pause the main-process runner.
    await vi.advanceTimersByTimeAsync(2_125);
    expect(mocks.feedback).toHaveBeenCalledTimes(3);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1_050);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(1_050);
    const completed = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    expect(completed.status).toBe(200);
    expect(jsonValue(completed)).toMatchObject({
      summary: { uniqueFbaNonParentAsins: 3, noTopics: 3 },
    });
    router.clearPreviews();
  });

  it("single-flights concurrent status polls for the same job", async () => {
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 3;
    mocks.feedback.mockReset();
    let releaseFeedback: () => void = () => {
      throw new Error("Feedback gate was not initialized.");
    };
    const feedbackGate = new Promise<void>((resolve) => {
      releaseFeedback = resolve;
    });
    mocks.feedback.mockImplementation(async ({ candidate }) => {
      await feedbackGate;
      return {
        candidate,
        response: null,
        error: { code: "QUERY_FAILED", message: "Test incomplete result." },
      };
    });

    const directory = await mkdtemp(join(tmpdir(), "review-router-single-flight-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const first = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    await vi.waitFor(() => expect(mocks.feedback).toHaveBeenCalledTimes(1));
    const second = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    await vi.waitFor(() => expect(mocks.candidateStarted).toBe(true));
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    releaseFeedback();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(202);
    expect(secondResponse).toEqual(firstResponse);
    expect(jsonValue(firstResponse)).toMatchObject({
      progress: { completed: 1, total: 3 },
    });
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
  });

  it("aborts a standalone review job when lifecycle cleanup clears previews", async () => {
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    let observedSignal: AbortSignal | null = null;
    mocks.feedback.mockImplementation(async ({ signal }) => {
      observedSignal = signal;
      await new Promise<never>((_resolve, reject) => {
        const abortSignal = signal as AbortSignal;
        const onAbort = () => reject(
          abortSignal.reason instanceof Error
            ? abortSignal.reason
            : new Error("review job stopped"),
        );
        abortSignal.addEventListener("abort", onAbort, { once: true });
        if (abortSignal.aborted) onAbort();
      });
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-abort-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const polling = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId: jsonValue(started).jobId as string },
    ));
    await vi.waitFor(() => expect(mocks.feedback).toHaveBeenCalledTimes(1));

    router.clearPreviews();
    await polling;

    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
  });

  it("keeps an active standalone review job beyond its initial 30-minute window", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-08-09T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    mocks.mode = "demo";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    mocks.feedback.mockImplementation(async ({ candidate }) => ({
      candidate,
      response: null,
      noContent: true,
    }));
    let releaseCandidates: () => void = () => {
      throw new Error("Candidate gate was not initialized.");
    };
    mocks.candidateGate = new Promise<void>((resolve) => {
      releaseCandidates = resolve;
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-active-retention-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const firstPoll = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    for (let attempt = 0; attempt < 20 && !mocks.candidateStarted; attempt += 1) {
      await Promise.resolve();
    }
    expect(mocks.candidateStarted).toBe(true);

    vi.setSystemTime(new Date(startedAt.getTime() + 31 * 60 * 1_000));
    const retainedPoll = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    releaseCandidates();

    const [, retained] = await Promise.all([firstPoll, retainedPoll]);
    expect(retained.status).toBe(200);
    expect(jsonValue(retained)).toMatchObject({
      summary: { uniqueFbaNonParentAsins: 1, noTopics: 1 },
    });
    router.clearPreviews();
  });

  it("retains a standalone review snapshot for 30 minutes after a long run completes", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-08-09T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    mocks.mode = "demo";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    mocks.feedback.mockImplementation(async ({ candidate }) => ({
      candidate,
      response: null,
      noContent: true,
    }));
    let releaseCandidates: () => void = () => {
      throw new Error("Candidate gate was not initialized.");
    };
    mocks.candidateGate = new Promise<void>((resolve) => {
      releaseCandidates = resolve;
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-terminal-retention-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const completing = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    for (let attempt = 0; attempt < 20 && !mocks.candidateStarted; attempt += 1) {
      await Promise.resolve();
    }
    expect(mocks.candidateStarted).toBe(true);

    vi.setSystemTime(new Date(startedAt.getTime() + 25 * 60 * 1_000));
    releaseCandidates();
    expect((await completing).status).toBe(200);

    vi.setSystemTime(new Date(startedAt.getTime() + 31 * 60 * 1_000));
    const retained = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    expect(retained.status).toBe(200);
    expect(jsonValue(retained)).toMatchObject({
      summary: { uniqueFbaNonParentAsins: 1, noTopics: 1 },
    });
    router.clearPreviews();
  });

  it("clears and aborts a standalone review job after its terminal retention expires", async () => {
    vi.useFakeTimers();
    const completedAt = new Date("2026-08-09T00:00:00.000Z");
    vi.setSystemTime(completedAt);
    mocks.mode = "demo";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    let observedSignal: AbortSignal | null = null;
    mocks.feedback.mockImplementation(async ({ candidate, signal }) => {
      observedSignal = signal as AbortSignal;
      return {
        candidate,
        response: null,
        noContent: true,
      };
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-terminal-expiry-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const completed = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    expect(completed.status).toBe(200);
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(false);

    vi.setSystemTime(new Date(completedAt.getTime() + 30 * 60 * 1_000 + 1));
    const expired = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));

    expect(expired.status).toBe(410);
    expect(jsonValue(expired)).toMatchObject({ code: "SNAPSHOT_EXPIRED" });
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("paces Customer Feedback globally across parallel jobs", async () => {
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    const callTimes: number[] = [];
    mocks.feedback.mockImplementation(async ({ candidate }) => {
      callTimes.push(Date.now());
      return {
        candidate,
        response: null,
        error: { code: "QUERY_FAILED", message: "Test incomplete result." },
      };
    });

    const directory = await mkdtemp(join(tmpdir(), "review-router-global-pace-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const firstStarted = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const secondStarted = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const firstJobId = jsonValue(firstStarted).jobId as string;
    const secondJobId = jsonValue(secondStarted).jobId as string;
    const first = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId: firstJobId },
    ));
    const second = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId: secondJobId },
    ));

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_049);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const responses = await Promise.all([first, second]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(mocks.feedback).toHaveBeenCalledTimes(2);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1_050);
  });

  it("keeps the global pace boundary after account-scoped jobs are cleared", async () => {
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
    const callTimes: number[] = [];
    mocks.feedback.mockImplementation(async ({ candidate }) => {
      callTimes.push(Date.now());
      return {
        candidate,
        response: null,
        error: { code: "QUERY_FAILED", message: "Test incomplete result." },
      };
    });

    let accountScope = "scope-a";
    const directory = await mkdtemp(join(tmpdir(), "review-router-account-pace-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: {
        getAccountScope: vi.fn(async () => accountScope),
      } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const startAndPoll = async () => {
      const started = await router.handle(request(
        "POST",
        "/api/sp-api/review-audit",
        { marketplaceId: US },
      ));
      return router.handle(request(
        "GET",
        "/api/sp-api/review-audit",
        { marketplaceId: US, jobId: jsonValue(started).jobId as string },
      ));
    };

    const first = await startAndPoll();
    expect(first.status).toBe(200);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    router.clearPreviews();
    accountScope = "scope-b";
    const second = startAndPoll();
    await vi.advanceTimersByTimeAsync(1_049);
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await second).status).toBe(200);

    expect(mocks.feedback).toHaveBeenCalledTimes(2);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(1_050);
  });

  it("rejects a live job after candidates exist if the App changes to demo", async () => {
    process.env.SP_API_MODE = "live";
    mocks.mode = "live";
    mocks.candidateCount = 2;
    mocks.feedback.mockReset();
    mocks.feedback.mockImplementation(async ({ candidate }) => ({
      candidate,
      response: null,
      error: { code: "QUERY_FAILED", message: "Test incomplete result." },
    }));
    const directory = await mkdtemp(join(tmpdir(), "review-router-live-demo-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const first = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    expect(first.status).toBe(202);
    expect(jsonValue(first)).toMatchObject({ progress: { completed: 1, total: 2 } });
    expect(mocks.feedback).toHaveBeenCalledTimes(1);

    mocks.mode = "demo";
    process.env.SP_API_MODE = "demo";
    const rejected = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    expect(rejected.status).toBe(409);
    expect(jsonValue(rejected)).toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
  });

  it("rejects demo candidates if the App changes to live before feedback starts", async () => {
    mocks.mode = "demo";
    mocks.candidateCount = 2;
    mocks.feedback.mockReset();
    let releaseCandidates: () => void = () => {
      throw new Error("Candidate gate was not initialized.");
    };
    mocks.candidateGate = new Promise<void>((resolve) => {
      releaseCandidates = resolve;
    });
    const directory = await mkdtemp(join(tmpdir(), "review-router-demo-live-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const jobId = jsonValue(started).jobId as string;
    const polling = router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId },
    ));
    await Promise.resolve();
    mocks.mode = "live";
    process.env.SP_API_MODE = "live";
    releaseCandidates();

    const rejected = await polling;
    expect(rejected.status).toBe(409);
    expect(jsonValue(rejected)).toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("rejects export when the completed snapshot mode no longer matches", async () => {
    mocks.mode = "demo";
    mocks.candidateCount = 1;
    mocks.feedback.mockReset();
    mocks.feedback.mockImplementation(async ({ candidate }) => ({
      candidate,
      response: null,
      noContent: true,
    }));
    const directory = await mkdtemp(join(tmpdir(), "review-router-export-mode-"));
    const store = new LocalStore(join(directory, "data.json"));
    await store.initialize();
    const router = new ApiRouter({
      store,
      vault: { getAccountScope: vi.fn(async () => "scope") } as unknown as CredentialVault,
      approveWrite: async () => undefined,
    });
    const started = await router.handle(request(
      "POST",
      "/api/sp-api/review-audit",
      { marketplaceId: US },
    ));
    const exportId = jsonValue(started).jobId as string;
    const completed = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit",
      { marketplaceId: US, jobId: exportId },
    ));
    expect(completed.status).toBe(200);

    mocks.mode = "live";
    process.env.SP_API_MODE = "live";
    const rejected = await router.handle(request(
      "GET",
      "/api/sp-api/review-audit/export",
      { marketplaceId: US, exportId },
    ));
    expect(rejected.status).toBe(409);
    expect(jsonValue(rejected)).toMatchObject({ code: "REPORT_MODE_CHANGED" });
    expect(rejected.body.kind).toBe("json");
  });
});
