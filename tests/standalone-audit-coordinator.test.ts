import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  StandaloneAuditCoordinator,
  type StandaloneAuditCoordinatorDependencies,
} from "../src/main/standalone-audit-coordinator";
import type { FbaCatalogExport } from
  "../src/main/amazon/catalog-report-reads";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;
const OPAQUE_ACCOUNT_SCOPE = "opaque-standalone-coordinator-account";

function request(
  method: "GET" | "POST",
  input: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method,
    path: "/api/sp-api/standalone-audit",
    query: method === "GET" ? input as Record<string, string> : {},
    headers: {},
    ...(method === "POST"
      ? { body: { kind: "json" as const, value: input } }
      : {}),
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  return response.body.value as Record<string, unknown>;
}

function observeRequest(receipt: Record<string, unknown>): ApiRequest {
  return request("GET", {
    kind: String(receipt.kind),
    marketplaceId: String(receipt.marketplaceId),
    mode: String(receipt.mode),
    jobId: String(receipt.jobId),
    contextId: String(receipt.contextId),
  });
}

async function terminal(
  coordinator: StandaloneAuditCoordinator,
  started: ApiResponse,
): Promise<ApiResponse> {
  const receipt = jsonValue(started);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const observed = await coordinator.observe(observeRequest(receipt));
    if (observed.status !== 202) return observed;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Standalone audit did not reach a terminal receipt.");
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function semanticHarness(input: Readonly<{
  context?: SpExecutionContextAdapter;
  listingsRun?: StandaloneAuditCoordinatorDependencies[
    "listingsExport"
  ]["runStandalone"];
}> = {}) {
  const context = input.context ?? createScriptedSpExecutionContextAdapter(
    (marketplaceId) => ({
      marketplaceId,
      mode: "demo",
      accountScope: OPAQUE_ACCOUNT_SCOPE,
    }),
  );
  const listingContext = await context.capture(US);
  const listingSnapshot: FbaCatalogExport = {
    fetchedAt: "2030-01-02T03:04:05.000Z",
    rows: [],
    errors: [],
  };
  const subscription = vi.fn<
    StandaloneAuditCoordinatorDependencies["subscription"]["runStandalone"]
  >(async () => ({ offers: [] } as never));
  const agedInventory = vi.fn<
    StandaloneAuditCoordinatorDependencies["agedInventory"]["runStandalone"]
  >(async () => ({ kind: "agedInventory", rows: [] } as never));
  const listingsExport = vi.fn<
    StandaloneAuditCoordinatorDependencies["listingsExport"]["runStandalone"]
  >(input.listingsRun ?? (async () => ({
    exportId: "11111111-1111-4111-8111-111111111111",
    context: listingContext,
    snapshot: listingSnapshot,
  })));
  const content = vi.fn<
    StandaloneAuditCoordinatorDependencies["content"][
      "captureStandaloneFromListings"
    ]
  >(async () => ({ kind: "content", rows: [] } as never));
  const image = vi.fn<
    StandaloneAuditCoordinatorDependencies["image"][
      "captureStandaloneFromListings"
    ]
  >(async () => ({ kind: "image", rows: [] } as never));
  const variation = vi.fn<
    StandaloneAuditCoordinatorDependencies["variation"]["runStandalone"]
  >(async () => ({ kind: "variation", rows: [] } as never));
  const businessPricing = vi.fn<
    StandaloneAuditCoordinatorDependencies[
      "businessPricing"
    ]["runStandalone"]
  >(async () => ({ kind: "businessPricing", rows: [] } as never));
  const advertising = vi.fn<
    StandaloneAuditCoordinatorDependencies["advertising"]["runStandalone"]
  >(async () => ({ kind: "advertising", rows: [] }));
  const coordinator = new StandaloneAuditCoordinator({
    context,
    subscription: { runStandalone: subscription },
    agedInventory: { runStandalone: agedInventory },
    listingsExport: { runStandalone: listingsExport },
    content: { captureStandaloneFromListings: content },
    image: { captureStandaloneFromListings: image },
    variation: { runStandalone: variation },
    businessPricing: { runStandalone: businessPricing },
    advertising: { runStandalone: advertising },
  });
  return {
    coordinator,
    listingContext,
    listingSnapshot,
    subscription,
    agedInventory,
    listingsExport,
    content,
    image,
    variation,
    businessPricing,
    advertising,
  };
}

describe("StandaloneAuditCoordinator", () => {
  it("preserves the exact route allowlists and pending/terminal response contract", async () => {
    const { coordinator } = await semanticHarness();
    const invalidInputs = [
      { kind: "content", marketplaceId: US, mode: "demo", accountScope: "x" },
      { kind: "unknown", marketplaceId: US, mode: "demo" },
      { kind: "content", marketplaceId: "BAD", mode: "demo" },
      { kind: "content", marketplaceId: US, mode: "preview" },
      { kind: "subscription", marketplaceId: US, mode: "demo", options: [] },
      {
        kind: "subscription",
        marketplaceId: US,
        mode: "demo",
        options: { months: 6, sellerId: "must-not-pass" },
      },
      {
        kind: "subscription",
        marketplaceId: US,
        mode: "demo",
        options: { months: 7 },
      },
    ];
    for (const input of invalidInputs) {
      expect((await coordinator.start(request("POST", input))).status).toBe(400);
    }

    const started = await coordinator.start(request("POST", {
      kind: "subscription",
      marketplaceId: US,
      mode: "demo",
      options: { months: 23 },
    }));
    expect(started).toMatchObject({
      status: 202,
      headers: { "retry-after": "1" },
    });
    expect(jsonValue(started)).toMatchObject({
      kind: "subscription",
      marketplaceId: US,
      mode: "demo",
      options: { months: 23 },
      ready: false,
    });

    const completed = await terminal(coordinator, started);
    expect(completed.status).toBe(200);
    expect(completed.headers).not.toHaveProperty("retry-after");
    expect(jsonValue(completed)).toMatchObject({
      kind: "subscription",
      ready: true,
      status: "completed",
    });
    expect((await coordinator.observe(request("GET", {
      kind: "subscription",
      marketplaceId: US,
      mode: "demo",
      jobId: "",
      contextId: "",
    }))).status).toBe(400);
    coordinator.clear();
  });

  it("delegates all seven kinds to only the existing narrow semantic owners", async () => {
    const harness = await semanticHarness();
    const selections = [
      { kind: "content" },
      { kind: "image" },
      { kind: "variation" },
      { kind: "subscription", options: { months: 12 } },
      { kind: "businessPricing" },
      { kind: "advertising" },
      { kind: "agedInventory" },
    ] as const;
    for (const selection of selections) {
      const started = await harness.coordinator.start(request("POST", {
        ...selection,
        marketplaceId: US,
        mode: "demo",
      }));
      expect((await terminal(harness.coordinator, started)).status).toBe(200);
    }

    expect(harness.subscription).toHaveBeenCalledTimes(1);
    expect(harness.subscription).toHaveBeenCalledWith(expect.objectContaining({
      marketplaceId: US,
      months: 12,
      signal: expect.any(AbortSignal),
      expectedContext: expect.objectContaining({
        marketplaceId: US,
        mode: "demo",
        accountScope: OPAQUE_ACCOUNT_SCOPE,
      }),
    }));
    expect(harness.agedInventory).toHaveBeenCalledTimes(1);
    expect(harness.variation).toHaveBeenCalledTimes(1);
    expect(harness.businessPricing).toHaveBeenCalledTimes(1);
    expect(harness.advertising).toHaveBeenCalledTimes(1);
    expect(harness.listingsExport).toHaveBeenCalledTimes(2);
    expect(harness.content).toHaveBeenCalledTimes(1);
    expect(harness.image).toHaveBeenCalledTimes(1);
    expect(harness.content).toHaveBeenCalledWith(expect.objectContaining({
      context: harness.listingContext,
      marketplaceId: US,
      listings: harness.listingSnapshot,
      signal: expect.any(AbortSignal),
    }));
    expect(harness.image).toHaveBeenCalledWith(expect.objectContaining({
      context: harness.listingContext,
      marketplaceId: US,
      listings: harness.listingSnapshot,
      signal: expect.any(AbortSignal),
    }));
    harness.coordinator.clear();
  });

  it("fences a late abort-ignoring Listings result before calling Content", async () => {
    const gate = deferred<Readonly<{
      exportId: string;
      context: SpExecutionContext;
      snapshot: FbaCatalogExport;
    }>>();
    let listingsSignal: AbortSignal | undefined;
    const harness = await semanticHarness({
      listingsRun: async (input) => {
        listingsSignal = input.signal;
        return gate.promise;
      },
    });
    const started = await harness.coordinator.start(request("POST", {
      kind: "content",
      marketplaceId: US,
      mode: "demo",
    }));
    for (let attempt = 0; attempt < 100 && !listingsSignal; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(listingsSignal).toBeDefined();

    harness.coordinator.clear();
    expect(listingsSignal?.aborted).toBe(true);
    gate.resolve({
      exportId: "22222222-2222-4222-8222-222222222222",
      context: harness.listingContext,
      snapshot: harness.listingSnapshot,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.content).not.toHaveBeenCalled();

    const expired = await harness.coordinator.observe(
      observeRequest(jsonValue(started)),
    );
    expect(expired.status).toBe(410);
    expect(jsonValue(expired)).toMatchObject({
      code: "STANDALONE_AUDIT_JOB_EXPIRED",
    });
  });

  it("keeps coordinator errors local and sanitizes hostile context details", async () => {
    const hostile = [
      "Bearer example-access-token",
      "accountScope=private-account",
      "reportId=private-report",
      "documentId=private-document",
      "https://example.invalid/private?client_secret=example-secret",
      "hostile-text\u202e\u0000",
    ].join(" ");
    const context: SpExecutionContextAdapter = {
      async capture() {
        throw new SpExecutionContextError("ACCOUNT_SCOPE_CHANGED", hostile);
      },
      async assertCurrent() {
        throw new Error("Capture failure must stop before assertion.");
      },
      invalidate() {},
    };
    const base = await semanticHarness();
    const coordinator = new StandaloneAuditCoordinator({
      context,
      subscription: { runStandalone: base.subscription },
      agedInventory: { runStandalone: base.agedInventory },
      listingsExport: { runStandalone: base.listingsExport },
      content: { captureStandaloneFromListings: base.content },
      image: { captureStandaloneFromListings: base.image },
      variation: { runStandalone: base.variation },
      businessPricing: { runStandalone: base.businessPricing },
      advertising: { runStandalone: base.advertising },
    });
    base.coordinator.clear();

    const response = await coordinator.start(request("POST", {
      kind: "advertising",
      marketplaceId: US,
      mode: "demo",
    }));
    const serialized = JSON.stringify(response);
    expect(response.status).toBe(409);
    expect(jsonValue(response)).toEqual({
      code: "ACCOUNT_SCOPE_CHANGED",
      message: "開始單項健檢時發生未預期的錯誤。",
    });
    expect(serialized).not.toMatch(
      /Bearer|access.?token|client.?secret|accountScope|reportId|documentId|https?:|hostile-text|[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/iu,
    );
    coordinator.clear();
  });

  it("fails closed before delegation when the context adapter returns another marketplace", async () => {
    const caContext = await createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: CA,
      mode: "demo",
      accountScope: OPAQUE_ACCOUNT_SCOPE,
    })).capture(CA);
    const context: SpExecutionContextAdapter = {
      async capture() {
        return caContext;
      },
      async assertCurrent() {},
      invalidate() {},
    };
    const harness = await semanticHarness({ context });

    const response = await harness.coordinator.start(request("POST", {
      kind: "subscription",
      marketplaceId: US,
      mode: "demo",
    }));
    expect(response.status).toBe(409);
    expect(jsonValue(response)).toMatchObject({
      code: "SP_CONTEXT_INVALIDATED",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.subscription).not.toHaveBeenCalled();
    harness.coordinator.clear();
  });

  it("does not own report lifecycle, child cleanup, or a second job store", () => {
    const source = readFileSync(
      new URL("../src/main/standalone-audit-coordinator.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /FixedReportBroker|ReportsRuntime|DurableReportLifecycle|FbaCatalogReports/u,
    );
    expect(source).not.toMatch(
      /credential-vault|local-store|listing-write-readback|variation-update|src\/renderer|src\/preload/u,
    );
    expect(source).not.toMatch(
      /this\.(?:subscription|agedInventory|listingsExport|content|image|variation|businessPricing|advertising)\.clear\(/u,
    );
    expect(source).not.toContain("new Map<");
    expect(source).not.toMatch(
      /private readonly (?:selections|runnerTimers|expiryTimers|snapshots|snapshotStore)\b/u,
    );
    expect(source).toContain("new StandaloneAuditJobCoordinator({");
  });
});
