import { describe, expect, it, vi } from "vitest";
import type {
  BusinessPriceUpdateResult,
  BusinessPriceValidationResult,
  BusinessPricingListingSnapshot,
  UpdateBusinessPriceInput,
} from "../src/main/amazon/business-pricing-types";
import { BusinessPricingMutations } from
  "../src/main/business-pricing-mutations";
import { SpApiError, SpApiPreCommitError } from
  "../src/main/amazon/sp-api-error";
import { SpExecutionContextError } from
  "../src/main/amazon/sp-execution-context";
import type {
  MainWriteGateExecuteInput,
  MainWriteGateInspectInput,
  MainWriteGatePort,
  MainWriteGateSession,
  WriteBinding,
} from "../src/main/write-gate";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const AUDIT_JOB_ID = "11111111-1111-4111-8111-111111111111";
const AUDIT_CONTEXT_ID = "22222222-2222-4222-8222-222222222222";

function proposal(sellerSku: string): UpdateBusinessPriceInput & {
  idempotencyKey: string;
} {
  return {
    marketplaceId: MARKETPLACE_ID,
    sellerSku,
    expectedStandardPrice: 30,
    expectedBusinessPrice: 28,
    newBusinessPrice: 27,
    idempotencyKey: `batch-${sellerSku}-001`,
  };
}

function batchProposal(sellerSku: string): Record<string, unknown> {
  return {
    ...proposal(sellerSku),
    newBusinessPrice: 29,
    quantityDiscountTiers: [
      { lowerBound: 5, percent: 5 },
      { lowerBound: 10, percent: 10 },
      { lowerBound: 15, percent: 15 },
      { lowerBound: 20, percent: 20 },
    ],
  };
}

function validation(
  input: UpdateBusinessPriceInput,
  stage: "business_price" | "minimum_price" = "business_price",
): BusinessPriceValidationResult {
  const lowersMinimumPrice = stage === "minimum_price";
  return {
    mode: "live",
    status: "VALID",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: `B0${input.sellerSku.padEnd(8, "0").slice(0, 8)}`,
    productType: "PET_FOOD",
    standardPrice: { amount: 30, currencyCode: "USD" },
    previousBusinessPrice: { amount: 28, currencyCode: "USD" },
    requestedBusinessPrice: { amount: 27, currencyCode: "USD" },
    previousMinimumPrice: lowersMinimumPrice
      ? { amount: 29, currencyCode: "USD" }
      : null,
    requestedMinimumPrice: lowersMinimumPrice
      ? { amount: 25, currencyCode: "USD" }
      : null,
    lowestTierUnitPrice: lowersMinimumPrice
      ? { amount: 25, currencyCode: "USD" }
      : null,
    minimumPriceChange: lowersMinimumPrice ? "lower" : "preserve",
    minimumPriceProtectedHash: lowersMinimumPrice ? "m".repeat(64) : null,
    minimumPriceCanonicalPatchHash: lowersMinimumPrice
      ? "n".repeat(64)
      : null,
    businessPriceValidation: lowersMinimumPrice
      ? "deferred-until-minimum-price"
      : "validated",
    previousQuantityDiscountPlan: null,
    previousQuantityDiscountPlanHash: null,
    requestedQuantityDiscountPlan: null,
    quantityDiscountPlanPresence: "absent",
    quantityDiscountPlanChange: "preserve",
    businessOfferGuardHash: "a".repeat(64),
    businessOfferProtectedHash: "b".repeat(64),
    schemaChecksum: "seller-schema-checksum",
    fbaEvidenceHash: "c".repeat(64),
    canonicalPatchHash: "d".repeat(64),
    validationIssuesHash: "e".repeat(64),
    validatedAt: "2026-09-04T00:00:00.000Z",
    issues: [],
    notice: "fixture",
  };
}

function accepted(
  evidence: BusinessPriceValidationResult,
): BusinessPriceUpdateResult {
  return {
    mode: "live",
    status: "ACCEPTED",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    productType: evidence.productType,
    standardPrice: evidence.standardPrice,
    previousBusinessPrice: evidence.previousBusinessPrice,
    requestedBusinessPrice: evidence.requestedBusinessPrice,
    previousMinimumPrice: evidence.previousMinimumPrice,
    requestedMinimumPrice: evidence.requestedMinimumPrice,
    lowestTierUnitPrice: evidence.lowestTierUnitPrice,
    minimumPriceChange: evidence.minimumPriceChange,
    minimumPriceProtectedHash: evidence.minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash: evidence.minimumPriceCanonicalPatchHash,
    businessPriceValidation: "validated",
    previousQuantityDiscountPlan: evidence.previousQuantityDiscountPlan,
    previousQuantityDiscountPlanHash:
      evidence.previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan: evidence.requestedQuantityDiscountPlan,
    quantityDiscountPlanChange: evidence.quantityDiscountPlanChange,
    businessOfferGuardHash: evidence.businessOfferGuardHash,
    businessOfferProtectedHash: evidence.businessOfferProtectedHash,
    schemaChecksum: evidence.schemaChecksum,
    acceptedAt: "2026-09-04T00:00:01.000Z",
    submissionId: `submission-${evidence.sellerSku}`,
    requestId: `request-${evidence.sellerSku}`,
    issues: [],
    notice: "accepted",
  };
}

function snapshot(
  evidence: BusinessPriceValidationResult,
  visible = true,
): BusinessPricingListingSnapshot {
  return {
    mode: "live",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    asin: evidence.asin,
    title: "fixture",
    productType: evidence.productType,
    status: ["BUYABLE"],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    standardPrice: evidence.standardPrice,
    effectivePrice: evidence.standardPrice,
    minimumPrice: evidence.minimumPriceChange === "lower" && visible
      ? evidence.requestedMinimumPrice
      : evidence.previousMinimumPrice,
    minimumPricePresence: evidence.minimumPriceChange === "lower"
      ? "canonical"
      : "absent",
    maximumPrice: null,
    purchasableOfferPresence: "present",
    discountedPrice: null,
    discountedPricePresence: "absent",
    hasDiscountedPrice: false,
    hasAutomatedPricing: false,
    fetchedAt: "2026-09-04T00:00:02.000Z",
    requestId: `read-${evidence.sellerSku}`,
    issues: [],
    fulfillmentAvailability: [{
      channelCode: "AMAZON_NA",
      quantity: 10,
      fulfillment: "FBA",
      editable: false,
    }],
    notice: null,
    businessPrice: visible
      ? evidence.requestedBusinessPrice
      : evidence.previousBusinessPrice,
    businessOfferPresence: "present",
    businessPricingManagedByAutomation: false,
    quantityDiscountPlan: evidence.requestedQuantityDiscountPlan,
    quantityDiscountPlanPresence: "absent",
    quantityDiscountPlanHash: null,
    businessOfferGuardHash: evidence.businessOfferGuardHash,
    businessOfferProtectedHash: evidence.businessOfferProtectedHash,
    businessPricingCapability: {
      supported: true,
      editable: true,
      reason: null,
      quantityDiscountsSupported: true,
      quantityDiscountsEditable: true,
      quantityDiscountsReason: null,
      schemaChecksum: evidence.schemaChecksum,
    },
  };
}

function request(
  method: "GET" | "POST" | "PATCH",
  value: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: `business-pricing-batch-${method}`,
    method,
    path: "/api/sp-api/business-pricing/batch",
    query: method === "GET"
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [
          key,
          String(entry),
        ]))
      : {},
    headers: { "content-type": "application/json" },
    ...(method === "GET"
      ? {}
      : { body: { kind: "json" as const, value } }),
  };
}

function batchPreviewBody(items: readonly Record<string, unknown>[]) {
  return {
    jobId: AUDIT_JOB_ID,
    contextId: AUDIT_CONTEXT_ID,
    items,
  };
}

function value(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json") throw new Error("Expected JSON body");
  return response.body.value as Record<string, unknown>;
}

function harness(
  stages: Readonly<Record<string, "business_price" | "minimum_price">>,
  canonicalVisible = true,
  reconciliationDelaysMs: readonly number[] | null = [1, 2],
) {
  const staged: WriteBinding[] = [];
  const approvals: string[] = [];
  const scheduled: Array<Readonly<{ delay: number; run(): Promise<void> }>> = [];
  const events: string[] = [];
  const evidence = new Map<string, BusinessPriceValidationResult>();
  const preview = vi.fn(async (input: UpdateBusinessPriceInput) => {
    events.push(`preview:${input.sellerSku}`);
    const result = validation(input, stages[input.sellerSku]);
    evidence.set(input.sellerSku, result);
    return result;
  });
  const commit = vi.fn(async (input: UpdateBusinessPriceInput) => {
    events.push(`business:start:${input.sellerSku}`);
    await Promise.resolve();
    events.push(`business:end:${input.sellerSku}`);
    return accepted(evidence.get(input.sellerSku)!);
  });
  const commitMinimumPrice = vi.fn(async (input: UpdateBusinessPriceInput) => {
    events.push(`minimum:start:${input.sellerSku}`);
    await Promise.resolve();
    events.push(`minimum:end:${input.sellerSku}`);
    const current = evidence.get(input.sellerSku)!;
    return {
      ...accepted(current),
      previousMinimumPrice: current.previousMinimumPrice!,
      requestedMinimumPrice: current.requestedMinimumPrice!,
      lowestTierUnitPrice: current.lowestTierUnitPrice!,
      minimumPriceProtectedHash: current.minimumPriceProtectedHash!,
      minimumPriceCanonicalPatchHash:
        current.minimumPriceCanonicalPatchHash!,
    };
  });
  const read = vi.fn(async (identity: { sellerSku: string }) => {
    const stored = evidence.get(identity.sellerSku);
    const current = stored ?? validation(
      proposal(identity.sellerSku),
      stages[identity.sellerSku],
    );
    return snapshot(current, stored !== undefined && canonicalVisible);
  });
  const reconcile = vi.fn(async () => undefined);
  const verifiedSellerSkus = new Set<string>();
  const inspect = vi.fn(async (input: {
    sellerSku: string;
  }) => {
    if (!verifiedSellerSkus.has(input.sellerSku)) return [];
    const current = evidence.get(input.sellerSku)!;
    return [{
      writeStatus: {
        mode: "live",
        status: "VERIFIED",
        stage: stages[input.sellerSku],
        marketplaceId: current.marketplaceId,
        sellerSku: current.sellerSku,
        asin: current.asin,
        productType: current.productType,
        acceptedAt: "2026-09-04T00:00:01.000Z",
        verifiedAt: "2026-09-04T00:00:02.000Z",
        requestId: `request-${current.sellerSku}`,
        submissionId: `submission-${current.sellerSku}`,
        verified: true,
        authoritative: true,
        canResend: false,
        businessPriceSubmitted: stages[input.sellerSku] === "business_price",
        previousBusinessPrice: current.previousBusinessPrice,
        requestedBusinessPrice: current.requestedBusinessPrice,
        previousMinimumPrice: current.previousMinimumPrice,
        requestedMinimumPrice: current.requestedMinimumPrice,
        lowestTierUnitPrice: current.lowestTierUnitPrice,
        previousQuantityDiscountPlan: current.previousQuantityDiscountPlan,
        requestedQuantityDiscountPlan: current.requestedQuantityDiscountPlan,
        quantityDiscountPlanChange: current.quantityDiscountPlanChange,
        notice: "fixture verified",
      },
    }];
  });
  const getBatchAuditJob = vi.fn(async () => ({
    ready: true as const,
    status: "completed" as const,
    jobId: AUDIT_JOB_ID,
    contextId: AUDIT_CONTEXT_ID,
    kind: "businessPricing" as const,
    marketplaceId: MARKETPLACE_ID,
    mode: "live" as const,
    snapshot: {
      mode: "live" as const,
      marketplaceId: MARKETPLACE_ID,
      fetchedAt: "2026-09-04T00:00:00.000Z",
      rows: Object.keys(stages).map((sellerSku) => ({
        sellerSku,
        asin: validation(proposal(sellerSku)).asin,
        title: "fixture",
        productType: "PET_FOOD",
        standardPrice: { amount: 30, currencyCode: "USD" },
        businessPrice: { amount: 28, currencyCode: "USD" },
        businessOfferPresence: "present" as const,
        quantityDiscountPlan: null,
        quantityDiscountPlanPresence: "absent" as const,
        recommendedPriceMismatch: true,
        recommendedQuantityDiscountMismatch: true,
        status: "configured" as const,
        editable: false as const,
        reason: "fixture",
      })),
      summary: {
        totalFbaSkuCount: Object.keys(stages).length,
        configured: Object.keys(stages).length,
        aboveStandard: 0,
        missing: 0,
        unsupported: 0,
        incomplete: 0,
        recommendedPriceMismatch: Object.keys(stages).length,
        recommendedQuantityDiscountMismatch: Object.keys(stages).length,
      },
      notice: "fixture",
      exportId: "33333333-3333-4333-8333-333333333333",
    },
  }));
  const execute = vi.fn();
  const writeGate: MainWriteGatePort = {
    stagePreview: async (binding) => {
      staged.push(binding);
    },
    execute: async <T>(input: MainWriteGateExecuteInput<T>): Promise<T> => {
      execute(input);
      await input.beforeApproval?.();
      approvals.push(
        typeof input.approvalReason === "function"
          ? input.approvalReason("654321")
          : input.approvalReason,
      );
      const session: MainWriteGateSession = {
        attempt: async (attempt) => attempt.execute({
          recordDurableEvidence: async () => undefined,
          recordAccepted: async () => undefined,
          assertCurrent: async () => undefined,
        }),
      };
      return input.run(session);
    },
    reconcile,
    inspect: async <TResult>(input: MainWriteGateInspectInput<TResult>) =>
      inspect(input) as unknown as readonly TResult[],
    clearEphemeral: () => undefined,
  };
  const owner = new BusinessPricingMutations({
    context: {
      capture: async (marketplaceId) => ({
        marketplaceId,
        region: "na",
        mode: "live",
        accountScope: "business-pricing-batch-scope" as never,
        generation: 0,
      }),
      assertCurrent: async () => undefined,
      invalidate: () => undefined,
    },
    writeGate,
    operations: {
      read,
      preview,
      commit,
      commitMinimumPrice,
      minimumPriceReadbackDecision: (result, canonical) =>
        canonical.minimumPrice?.amount === result.requestedMinimumPrice?.amount
          ? "verified"
          : "pending",
    },
    priceObserver: { observeCanonical: async () => undefined },
    getBatchAuditJob,
    ...(reconciliationDelaysMs === null ? {} : { reconciliationDelaysMs }),
    scheduleReconciliation: (run, delay) => {
      scheduled.push({ delay, run });
    },
  });
  return {
    owner,
    approvals,
    commit,
    commitMinimumPrice,
    events,
    execute,
    getBatchAuditJob,
    inspect,
    markVerified: (sellerSku: string) => verifiedSellerSkus.add(sellerSku),
    preview,
    read,
    reconcile,
    scheduled,
    staged,
  };
}

describe("Business Pricing batch mutations", () => {
  it("requires the exact completed audit job and snapshot-proven recommendation before any Amazon read or Preview", async () => {
    const kit = harness({ A: "business_price" });

    const missingJob = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", { items: [batchProposal("A")] }),
    });
    expect(missingJob.status).toBe(400);

    const staleJob = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", {
        ...batchPreviewBody([batchProposal("A")]),
        jobId: "stale-business-pricing-job",
      }),
    });
    expect(staleJob.status).toBe(409);

    const changedRecommendation = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([{
        ...batchProposal("A"),
        newBusinessPrice: 27,
      }])),
    });
    expect(changedRecommendation.status).toBe(409);
    expect(value(changedRecommendation)).toMatchObject({
      code: "BATCH_AUDIT_EVIDENCE_MISMATCH",
    });
    expect(kit.getBatchAuditJob).toHaveBeenLastCalledWith({
      kind: "businessPricing",
      marketplaceId: MARKETPLACE_ID,
      mode: "live",
      jobId: AUDIT_JOB_ID,
      contextId: AUDIT_CONTEXT_ID,
    });
    expect(kit.read).not.toHaveBeenCalled();
    expect(kit.preview).not.toHaveBeenCalled();
  });

  it("rejects an ASIN rebound after the completed audit before staging any write", async () => {
    const kit = harness({ A: "business_price" });
    kit.preview.mockImplementation(async (input) => ({
      ...validation(input),
      asin: "B0DRIFT000",
    }));

    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });

    expect(previewed.status).toBe(409);
    expect(value(previewed)).toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(kit.staged).toHaveLength(0);
    expect(kit.approvals).toHaveLength(0);
    expect(kit.commit).not.toHaveBeenCalled();
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();
  });

  it("rejects a Product Type rebound after the completed audit before staging any write", async () => {
    const kit = harness({ A: "business_price" });
    kit.preview.mockImplementation(async (input) => ({
      ...validation(input),
      productType: "ANIMAL_FOOD",
    }));

    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });

    expect(previewed.status).toBe(409);
    expect(value(previewed)).toMatchObject({
      code: "LISTING_IDENTITY_MISMATCH",
    });
    expect(kit.staged).toHaveLength(0);
    expect(kit.approvals).toHaveLength(0);
    expect(kit.commit).not.toHaveBeenCalled();
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();
  });

  it("previews and writes only selected items, with one approval and strict serial PATCHes", async () => {
    const kit = harness({ A: "business_price", B: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("A"),
        batchProposal("B"),
      ])),
    });
    expect(previewed.status).toBe(200);
    expect(kit.preview.mock.calls.map(([item]) => item.sellerSku)).toEqual([
      "A",
      "B",
    ]);
    expect(kit.staged).toHaveLength(1);
    expect(kit.staged[0]?.intents.map((intent) => intent.sellerSku)).toEqual([
      "A",
      "B",
    ]);

    const committed = await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    expect(committed.status).toBe(202);
    expect(kit.approvals).toHaveLength(1);
    expect(kit.approvals[0]).toContain("B2B");
    expect(kit.execute).toHaveBeenCalledTimes(1);
    expect(kit.events.filter((event) => event.includes(":"))).toEqual([
      "preview:A",
      "preview:B",
      "preview:A",
      "preview:B",
      "business:start:A",
      "business:end:A",
      "business:start:B",
      "business:end:B",
    ]);
    expect(kit.commit.mock.calls.map(([item]) => item.sellerSku)).toEqual([
      "A",
      "B",
    ]);
    expect(JSON.stringify(value(committed))).not.toContain("UNSELECTED");
  });

  it("keeps minimum-price and B2B work in separate native approvals", async () => {
    const kit = harness({ MIN: "minimum_price", BIZ: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", {
        ...batchPreviewBody([
          {
            ...batchProposal("MIN"),
          },
          batchProposal("BIZ"),
        ]),
      }),
    });
    expect(previewed.status).toBe(200);
    expect(kit.staged).toHaveLength(2);

    const committed = await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    expect(committed.status).toBe(202);
    expect(kit.approvals).toHaveLength(2);
    expect(kit.approvals[0]).toContain("最低價");
    expect(kit.approvals[0]).toContain("B2B 本次不送出");
    expect(kit.approvals[1]).toContain("B2B");
    expect(kit.commitMinimumPrice.mock.calls.map(([item]) => item.sellerSku))
      .toEqual(["MIN"]);
    expect(kit.commit.mock.calls.map(([item]) => item.sellerSku))
      .toEqual(["BIZ"]);
    expect(kit.events).toEqual([
      "preview:MIN",
      "preview:BIZ",
      "preview:MIN",
      "minimum:start:MIN",
      "minimum:end:MIN",
      "preview:BIZ",
      "business:start:BIZ",
      "business:end:BIZ",
    ]);
  });

  it("uses the fixed minimum-price then B2B phase order while preserving selection order inside each phase", async () => {
    const kit = harness({
      BIZ2: "business_price",
      MIN2: "minimum_price",
      BIZ1: "business_price",
      MIN1: "minimum_price",
    });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("BIZ2"),
        batchProposal("MIN2"),
        batchProposal("BIZ1"),
        batchProposal("MIN1"),
      ])),
    });
    expect(previewed.status).toBe(200);

    const committed = await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });

    expect(committed.status).toBe(202);
    expect(kit.approvals).toHaveLength(2);
    expect(kit.approvals[0]).toContain("最低價");
    expect(kit.approvals[1]).toContain("B2B");
    expect(kit.commitMinimumPrice.mock.calls.map(([item]) => item.sellerSku))
      .toEqual(["MIN2", "MIN1"]);
    expect(kit.commit.mock.calls.map(([item]) => item.sellerSku))
      .toEqual(["BIZ2", "BIZ1"]);
  });

  it("fails the whole stage before approval when fresh Validation Preview changes", async () => {
    const kit = harness({ A: "business_price", B: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("A"),
        batchProposal("B"),
      ])),
    });
    kit.preview.mockImplementation(async (input) => ({
      ...validation(input),
      canonicalPatchHash: "f".repeat(64),
    }));

    const committed = await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    expect(committed.status).toBe(409);
    expect(value(committed)).toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(kit.approvals).toHaveLength(0);
    expect(kit.commit).not.toHaveBeenCalled();
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();
  });

  it("stops unsent rows for auth precommit failures but continues only an allowlisted row-local rejection", async () => {
    const blocked = harness({ A: "business_price", B: "business_price" });
    const blockedPreview = await blocked.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("A"),
        batchProposal("B"),
      ])),
    });
    blocked.commit.mockRejectedValueOnce(new SpApiPreCommitError(
      new SpApiError("Amazon authorization changed.", {
        status: 403,
        code: "ACCESS_DENIED",
      }),
    ));
    const blockedResult = await blocked.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", {
        previewId: value(blockedPreview).previewId,
      }),
    });
    expect(blocked.commit.mock.calls.map(([item]) => item.sellerSku)).toEqual([
      "A",
    ]);
    expect(value(blockedResult).rows).toMatchObject([
      { sellerSku: "A", state: "unknown" },
      { sellerSku: "B", state: "not-started" },
    ]);

    const isolated = harness({ A: "business_price", B: "business_price" });
    const isolatedPreview = await isolated.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("A"),
        batchProposal("B"),
      ])),
    });
    isolated.commit.mockRejectedValueOnce(new SpApiPreCommitError(
      new SpApiError("This row did not pass Validation Preview.", {
        status: 422,
        code: "VALIDATION_FAILED",
      }),
    ));
    const isolatedResult = await isolated.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", {
        previewId: value(isolatedPreview).previewId,
      }),
    });
    expect(isolated.commit.mock.calls.map(([item]) => item.sellerSku)).toEqual([
      "A",
      "B",
    ]);
    expect(value(isolatedResult).rows).toMatchObject([
      { sellerSku: "A", state: "rejected" },
      { sellerSku: "B", state: "processing" },
    ]);
  });

  it.each([
    ["throttling", () => new SpApiPreCommitError(new SpApiError(
      "Amazon throttled this request.",
      { status: 429, code: "QUOTA_EXCEEDED" },
    ))],
    ["server", () => new SpApiPreCommitError(new SpApiError(
      "Amazon is unavailable.",
      { status: 503, code: "SERVICE_UNAVAILABLE" },
    ))],
    ["network", () => new Error("socket closed")],
    ["context", () => new SpExecutionContextError(
      "SP_CONTEXT_INVALIDATED",
      "Amazon execution context changed.",
    )],
  ] as const)(
    "stops every unsent row after a %s failure",
    async (_label, failure) => {
      const kit = harness({ A: "business_price", B: "business_price" });
      const previewed = await kit.owner.handle({
        operation: "batchPreview",
        request: request("POST", batchPreviewBody([
          batchProposal("A"),
          batchProposal("B"),
        ])),
      });
      kit.commit.mockRejectedValueOnce(failure());

      const result = await kit.owner.handle({
        operation: "batchCommit",
        request: request("PATCH", {
          previewId: value(previewed).previewId,
        }),
      });

      expect(kit.commit.mock.calls.map(([item]) => item.sellerSku)).toEqual([
        "A",
      ]);
      expect(value(result).rows).toMatchObject([
        { sellerSku: "A", state: "unknown" },
        { sellerSku: "B", state: "not-started" },
      ]);
      expect(String(value(result).notice)).not.toContain(
        "Amazon 真實價格沒有變更",
      );
      expect(String(value(result).notice)).toContain("禁止重送");
    },
  );

  it("stops later authorization stages after one non-row-local failure", async () => {
    const kit = harness({ MIN: "minimum_price", BIZ: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("MIN"),
        batchProposal("BIZ"),
      ])),
    });
    kit.commitMinimumPrice.mockRejectedValueOnce(new SpApiPreCommitError(
      new SpApiError("Amazon is unavailable.", {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      }),
    ));

    const result = await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", {
        previewId: value(previewed).previewId,
      }),
    });

    expect(kit.commitMinimumPrice.mock.calls.map(([item]) => item.sellerSku))
      .toEqual(["MIN"]);
    expect(kit.commit).not.toHaveBeenCalled();
    expect(value(result).rows).toMatchObject([
      { sellerSku: "MIN", state: "unknown" },
      { sellerSku: "BIZ", state: "not-started" },
    ]);
  });

  it("continues GET-only reconciliation until durable authoritative verification is observable", async () => {
    const kit = harness({ A: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });
    kit.read.mockClear();
    await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    expect(kit.scheduled.map((job) => job.delay)).toEqual([1]);
    expect(kit.read).not.toHaveBeenCalled();

    await kit.scheduled.shift()!.run();
    expect(kit.read).toHaveBeenCalledTimes(1);
    expect(kit.reconcile).toHaveBeenCalledTimes(1);
    expect(kit.inspect).toHaveBeenCalledTimes(1);
    expect(kit.scheduled.map((job) => job.delay)).toEqual([2]);

    kit.markVerified("A");
    await kit.scheduled.shift()!.run();
    expect(kit.read).toHaveBeenCalledTimes(2);
    expect(kit.reconcile).toHaveBeenCalledTimes(2);
    expect(kit.inspect).toHaveBeenCalledTimes(2);
    expect(kit.commit).toHaveBeenCalledTimes(1);
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();
    expect(kit.scheduled).toHaveLength(0);
  });

  it("does not start accepted-row observers before every serial stage result is installed", async () => {
    const kit = harness({ A: "business_price", B: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([
        batchProposal("A"),
        batchProposal("B"),
      ])),
    });
    const originalCommit = kit.commit.getMockImplementation()!;
    let releaseSecond!: () => void;
    const holdSecond = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondStarted!: () => void;
    const secondReached = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    kit.commit.mockImplementation(async (input) => {
      if (input.sellerSku === "B") {
        secondStarted();
        await holdSecond;
      }
      return originalCommit(input);
    });

    const committing = kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    await secondReached;

    expect(kit.scheduled).toHaveLength(0);
    releaseSecond();
    await committing;
    expect(kit.scheduled).toHaveLength(2);
  });

  it("recovers batch status from durable inspect without issuing an Amazon read or PATCH", async () => {
    const kit = harness({ A: "business_price" });
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });
    const previewId = String(value(previewed).previewId);
    await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId }),
    });
    kit.read.mockClear();
    kit.commit.mockClear();
    kit.markVerified("A");

    const status = await kit.owner.handle({
      operation: "batchRead",
      request: request("GET", {
        marketplaceId: MARKETPLACE_ID,
        jobId: AUDIT_JOB_ID,
        contextId: AUDIT_CONTEXT_ID,
        previewId,
      }),
    });

    expect(status.status).toBe(200);
    expect(value(status)).toMatchObject({
      previewId,
      marketplaceId: MARKETPLACE_ID,
      acceptedCount: 1,
      verifiedCount: 1,
      verified: true,
      canResend: false,
      rows: [{ sellerSku: "A", state: "verified" }],
    });
    expect(kit.inspect).toHaveBeenCalledTimes(1);
    expect(kit.read).not.toHaveBeenCalled();
    expect(kit.commit).not.toHaveBeenCalled();
  });

  it("stops GET-only reconciliation after the bounded backoff window", async () => {
    const kit = harness({ A: "business_price" }, false);
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });
    kit.read.mockClear();
    await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });

    expect(kit.scheduled.map((job) => job.delay)).toEqual([1]);
    await kit.scheduled.shift()!.run();
    expect(kit.scheduled.map((job) => job.delay)).toEqual([2]);
    await kit.scheduled.shift()!.run();
    expect(kit.scheduled).toHaveLength(0);
    expect(kit.read).toHaveBeenCalledTimes(2);
    expect(kit.reconcile).toHaveBeenCalledTimes(2);
    expect(kit.commit).toHaveBeenCalledTimes(1);
  });

  it("keeps the default GET-only reconciliation window close to ten minutes", async () => {
    const kit = harness({ A: "business_price" }, false, null);
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", batchPreviewBody([batchProposal("A")])),
    });
    kit.read.mockClear();
    await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });

    const delays: number[] = [];
    while (kit.scheduled.length > 0) {
      const job = kit.scheduled.shift()!;
      delays.push(job.delay);
      expect(delays.length).toBeLessThan(20);
      await job.run();
    }

    const totalDelayMs = delays.reduce((total, delay) => total + delay, 0);
    expect(totalDelayMs).toBeGreaterThanOrEqual(9 * 60_000);
    expect(totalDelayMs).toBeLessThanOrEqual(10 * 60_000);
    expect(kit.read).toHaveBeenCalledTimes(delays.length);
    expect(kit.reconcile).toHaveBeenCalledTimes(delays.length);
    expect(kit.commit).toHaveBeenCalledTimes(1);
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();
  });

  it("limits canonical reconciliation to two global GETs when rows are accepted together", async () => {
    const kit = harness({
      A: "business_price",
      B: "business_price",
      C: "business_price",
    }, false);
    const previewed = await kit.owner.handle({
      operation: "batchPreview",
      request: request("POST", {
        ...batchPreviewBody([
          batchProposal("A"),
          batchProposal("B"),
          batchProposal("C"),
        ]),
      }),
    });
    await kit.owner.handle({
      operation: "batchCommit",
      request: request("PATCH", { previewId: value(previewed).previewId }),
    });
    kit.read.mockClear();

    let activeReads = 0;
    let maxActiveReads = 0;
    const releaseReads: Array<() => void> = [];
    kit.read.mockImplementation(async (identity) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise<void>((resolve) => releaseReads.push(resolve));
      activeReads -= 1;
      return snapshot(validation(proposal(identity.sellerSku)), false);
    });

    const firstAttempts = kit.scheduled.splice(0);
    expect(firstAttempts).toHaveLength(3);
    const flights = firstAttempts.map((job) => job.run());
    for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();

    expect(kit.read).toHaveBeenCalledTimes(2);
    expect(activeReads).toBe(2);
    expect(maxActiveReads).toBe(2);
    expect(kit.commit).toHaveBeenCalledTimes(3);
    expect(kit.commitMinimumPrice).not.toHaveBeenCalled();

    releaseReads.shift()!();
    for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
    expect(kit.read).toHaveBeenCalledTimes(3);
    expect(maxActiveReads).toBe(2);

    for (const release of releaseReads.splice(0)) release();
    await Promise.all(flights);
    expect(kit.reconcile).toHaveBeenCalledTimes(3);
    expect(kit.commit).toHaveBeenCalledTimes(3);
  });
});
