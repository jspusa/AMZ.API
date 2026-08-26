import { describe, expect, it, vi } from "vitest";
import {
  AuditSuiteCompatibilityCoordinator,
  type AuditSuiteCompatibilityCoordinatorDependencies,
} from "../src/main/audit-suite-compatibility-coordinator";
import type { AuditSuiteContext } from
  "../src/main/amazon/audit-suite-context";
import {
  createAuditSuiteResourceKey,
} from "../src/main/amazon/audit-suite-coordinator";
import type {
  AuditSuiteGroupingResource,
  AuditSuiteListingsResource,
} from "../src/main/amazon/audit-suite-resources";
import type {
  SpExecutionContext,
  SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const US = "ATVPDKIKX0DER" as const;
const CA = "A2EUQ1WTGCTBG2" as const;
const OPAQUE_ACCOUNT_SCOPE = "opaque-audit-suite-compatibility-account";

function executionContext(
  marketplaceId: typeof US | typeof CA = US,
): SpExecutionContext {
  return {
    marketplaceId,
    region: "na",
    mode: "demo",
    accountScope:
      OPAQUE_ACCOUNT_SCOPE as SpExecutionContext["accountScope"],
    generation: 17,
  };
}

function startRequest(): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/api/sp-api/audit-suite",
    query: {},
    headers: {},
    body: { kind: "json", value: { marketplaceId: US } },
  };
}

function observeRequest(receipt: Record<string, unknown>): ApiRequest {
  return {
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/sp-api/audit-suite",
    query: {
      marketplaceId: String(receipt.marketplaceId),
      runId: String(receipt.runId),
      contextId: String(receipt.contextId),
    },
    headers: {},
  };
}

function jsonValue(response: ApiResponse): Record<string, unknown> {
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  return response.body.value as Record<string, unknown>;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function mustNotRun(label: string): never {
  throw new Error(`${label} must not run in this test.`);
}

function completed(context: AuditSuiteContext) {
  return {
    ...context,
    status: "completed" as const,
    fetchedAt: "2026-08-26T00:00:00.000Z",
    notice: "完成。",
    payload: [],
  };
}

function harness(
  capture: SpExecutionContextAdapter["capture"] = async () =>
    executionContext(),
) {
  const captureMock = vi.fn<SpExecutionContextAdapter["capture"]>(capture);
  const assertCurrent = vi.fn<SpExecutionContextAdapter["assertCurrent"]>(
    async () => undefined,
  );
  const invalidate = vi.fn<SpExecutionContextAdapter["invalidate"]>();
  const context: SpExecutionContextAdapter = {
    capture: captureMock,
    assertCurrent,
    invalidate,
  };

  const sharedBrokerClear = vi.fn();
  const resourcesClear = vi.fn(() => sharedBrokerClear());
  const listings = vi.fn<
    AuditSuiteCompatibilityCoordinatorDependencies["resources"]["listings"]
  >(async () => mustNotRun("resources.listings"));
  const grouping = vi.fn<
    AuditSuiteCompatibilityCoordinatorDependencies["resources"]["grouping"]
  >(async () => mustNotRun("resources.grouping"));
  const resources = Object.assign({ listings, grouping }, {
    clear: resourcesClear,
  });

  const owner = <
    Name extends
      | "content"
      | "image"
      | "aplus"
      | "variation"
      | "subscription"
      | "businessPricing"
      | "advertising",
  >(name: Name) => {
    const clear = vi.fn();
    const runAuditSuite = vi.fn<
      AuditSuiteCompatibilityCoordinatorDependencies[Name]["runAuditSuite"]
    >(async () => mustNotRun(`${name}.runAuditSuite`));
    return {
      port: Object.assign({ runAuditSuite }, { clear }),
      runAuditSuite,
      clear,
    };
  };
  const content = owner("content");
  const image = owner("image");
  const aplus = owner("aplus");
  const variation = owner("variation");
  const subscription = owner("subscription");
  const businessPricing = owner("businessPricing");
  const advertising = owner("advertising");

  const createWorkbook = vi.fn<NonNullable<
    AuditSuiteCompatibilityCoordinatorDependencies["createWorkbook"]
  >>(() => mustNotRun("createWorkbook"));
  const coordinator = new AuditSuiteCompatibilityCoordinator({
    context,
    resources,
    content: content.port,
    image: image.port,
    aplus: aplus.port,
    variation: variation.port,
    subscription: subscription.port,
    businessPricing: businessPricing.port,
    advertising: advertising.port,
    createWorkbook,
  });
  const childWork = [
    listings,
    grouping,
    content.runAuditSuite,
    image.runAuditSuite,
    aplus.runAuditSuite,
    variation.runAuditSuite,
    subscription.runAuditSuite,
    businessPricing.runAuditSuite,
    advertising.runAuditSuite,
    createWorkbook,
  ];

  return {
    coordinator,
    context: { capture: captureMock, assertCurrent, invalidate },
    childWork,
    childClear: {
      sharedBroker: sharedBrokerClear,
      resources: resourcesClear,
      content: content.clear,
      image: image.clear,
      aplus: aplus.clear,
      variation: variation.clear,
      subscription: subscription.clear,
      businessPricing: businessPricing.clear,
      advertising: advertising.clear,
    },
  };
}

function expectNoChildWork(
  calls: readonly ReturnType<typeof vi.fn>[],
): void {
  for (const call of calls) expect(call).not.toHaveBeenCalled();
}

describe("AuditSuiteCompatibilityCoordinator owner composition", () => {
  it("runs all seven semantic owners once while reusing one Listings and grouping load", async () => {
    vi.useFakeTimers();
    try {
      const context: SpExecutionContextAdapter = {
        capture: vi.fn(async () => executionContext()),
        assertCurrent: vi.fn(async () => undefined),
        invalidate: vi.fn(),
      };
      const listingsValue: AuditSuiteListingsResource = {
        reportId: "shared-report",
        documentId: "shared-document",
        data: {
          rows: [],
          errors: [],
          fetchedAt: "2026-08-26T00:00:00.000Z",
        },
      };
      const groupingValue: AuditSuiteGroupingResource = {
        ...listingsValue,
        grouping: {
          marketplaceId: US,
          fetchedAt: "2026-08-26T00:00:00.000Z",
          rows: [],
          notice: "完成。",
        },
      };
      const listingsKey = createAuditSuiteResourceKey<
        AuditSuiteListingsResource
      >("test-shared-listings");
      const groupingKey = createAuditSuiteResourceKey<
        AuditSuiteGroupingResource
      >("test-shared-grouping");
      const loadListings = vi.fn(async () => listingsValue);
      const listings = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["resources"]["listings"]
      >(async (_bound, control) =>
        control.resource(listingsKey, loadListings)
      );
      const loadGrouping = vi.fn(async (
        bound: AuditSuiteContext,
        control: Parameters<
          AuditSuiteCompatibilityCoordinatorDependencies["resources"]["grouping"]
        >[1],
      ) => {
        expect(await listings(bound, control)).toBe(listingsValue);
        return groupingValue;
      });
      const grouping = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["resources"]["grouping"]
      >(async (bound, control) =>
        control.resource(
          groupingKey,
          () => loadGrouping(bound, control),
        )
      );

      const contentRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["content"]["runAuditSuite"]
      >(async ({ context: bound, listings: shared }) => {
        expect(shared).toBe(listingsValue);
        return completed(bound);
      });
      const imageRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["image"]["runAuditSuite"]
      >(async ({ context: bound, listings: shared }) => {
        expect(shared).toBe(listingsValue);
        return completed(bound);
      });
      const aplusRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["aplus"]["runAuditSuite"]
      >(async ({ context: bound, grouping: shared }) => {
        expect(shared).toBe(groupingValue);
        return completed(bound);
      });
      const variationRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["variation"]["runAuditSuite"]
      >(async ({ context: bound, grouping: shared }) => {
        expect(shared).toBe(groupingValue);
        return completed(bound);
      });
      const subscriptionRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["subscription"]["runAuditSuite"]
      >(async (bound) => completed(bound));
      const businessPricingRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["businessPricing"]["runAuditSuite"]
      >(async ({ context: bound, loadListings: loadShared }) => {
        expect(await loadShared()).toBe(listingsValue);
        return completed(bound);
      });
      const advertisingRun = vi.fn<
        AuditSuiteCompatibilityCoordinatorDependencies["advertising"]["runAuditSuite"]
      >(async (bound) => completed(bound));
      const coordinator = new AuditSuiteCompatibilityCoordinator({
        context,
        resources: { listings, grouping },
        content: { runAuditSuite: contentRun },
        image: { runAuditSuite: imageRun },
        aplus: { runAuditSuite: aplusRun },
        variation: { runAuditSuite: variationRun },
        subscription: { runAuditSuite: subscriptionRun },
        businessPricing: { runAuditSuite: businessPricingRun },
        advertising: { runAuditSuite: advertisingRun },
      });

      const started = await coordinator.start(startRequest());
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => {
        for (const run of [
          contentRun,
          imageRun,
          aplusRun,
          variationRun,
          subscriptionRun,
          businessPricingRun,
          advertisingRun,
        ]) expect(run).toHaveBeenCalledOnce();
      });

      expect(loadListings).toHaveBeenCalledOnce();
      expect(loadGrouping).toHaveBeenCalledOnce();
      expect(jsonValue(await coordinator.observe(
        observeRequest(jsonValue(started)),
      ))).toMatchObject({ status: "completed" });
      coordinator.clear();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AuditSuiteCompatibilityCoordinator lifecycle fences", () => {
  it("does not publish a job or child work after clear during deferred capture", async () => {
    const gate = deferred<SpExecutionContext>();
    const test = harness(async () => gate.promise);

    const starting = test.coordinator.start(startRequest());
    expect(test.context.capture).toHaveBeenCalledWith(US);
    test.coordinator.clear();
    gate.resolve(executionContext());

    await expect(starting).rejects.toMatchObject({
      name: "SpExecutionContextError",
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
    expect(test.context.assertCurrent).not.toHaveBeenCalled();
    expectNoChildWork(test.childWork);
  });

  it("fails closed before I/O when the adapter returns another marketplace", async () => {
    const test = harness(async () => executionContext(CA));

    await expect(test.coordinator.start(startRequest())).rejects.toMatchObject({
      name: "SpExecutionContextError",
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });

    expect(test.context.assertCurrent).not.toHaveBeenCalled();
    expectNoChildWork(test.childWork);
    test.coordinator.clear();
  });

  it("projects expired coordinator receipts through the compatibility public seam", async () => {
    const test = harness();

    const response = await test.coordinator.observe(observeRequest({
      marketplaceId: US,
      runId: "unknown-run",
      contextId: "unknown-context",
    }));

    expect(response.status).toBe(410);
    expect(jsonValue(response)).toEqual({
      code: "AUDIT_SUITE_EXPIRED",
      message: "綜合健檢工作已過期或執行 context 不符。",
    });
    expectNoChildWork(test.childWork);
    test.coordinator.clear();
  });

  it("clears only compatibility-owned jobs, not child owners or the broker", () => {
    const test = harness();

    test.coordinator.clear();

    expect(test.context.invalidate).not.toHaveBeenCalled();
    for (const clear of Object.values(test.childClear)) {
      expect(clear).not.toHaveBeenCalled();
    }
    expectNoChildWork(test.childWork);
  });

  it("fences an observe that completes context capture after clear", async () => {
    const gate = deferred<SpExecutionContext>();
    let captureCount = 0;
    const test = harness(async () => {
      captureCount += 1;
      return captureCount === 1 ? executionContext() : gate.promise;
    });
    const started = await test.coordinator.start(startRequest());
    const observing = test.coordinator.observe(observeRequest(jsonValue(started)));
    expect(test.context.capture).toHaveBeenCalledTimes(2);

    test.coordinator.clear();
    gate.resolve(executionContext());

    await expect(observing).rejects.toMatchObject({
      name: "SpExecutionContextError",
      status: 409,
      code: "SP_CONTEXT_INVALIDATED",
    });
    expectNoChildWork(test.childWork);
  });
});
