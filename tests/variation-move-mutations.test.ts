import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type {
  VariationMoveAttachDescriptor,
  VariationMoveCanonicalObservation,
  VariationMoveCommitReceipt,
  VariationMoveDescriptor,
  VariationMoveGateway,
  VariationMoveGatewayPreparation,
  VariationMoveObservation,
  VariationMovePtdEvidence,
  VariationMovePrepareRequest,
  VariationMoveSourceEvidence,
  VariationMoveTargetEvidence,
  VariationMoveValidationReceipt,
} from "../src/main/amazon/variation-move-gateway";
import type { VariationMoveInput } from
  "../src/main/amazon/variation-move-types";
import type { ListingWriteExecutionFence } from
  "../src/main/amazon/listing-write-execution-fence";
import { variationDimensionSignature } from
  "../src/main/amazon/variation-update";
import {
  createScriptedSpExecutionContextAdapter,
  type SpExecutionContextAdapter,
} from "../src/main/amazon/sp-execution-context";
import { LocalStore } from "../src/main/local-store";
import {
  createVariationMoveMutations,
  type VariationMoveMutationsPort,
} from "../src/main/variation-move-mutations";
import {
  MainWriteGate,
  type MainWriteGatePort,
} from "../src/main/write-gate";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SOURCE_SKU = "MOVE-SOURCE-4OZ";
const OLD_PARENT = "MOVE-PARENT-OLD";
const TARGET_PARENT = "MOVE-PARENT-NEW";
const SOURCE_ASIN = "B000000001";
const TARGET_ASIN = "B000000002";

type RelationshipState = "old" | "standalone" | "new";

function sourceEvidence(): VariationMoveSourceEvidence {
  return Object.freeze({}) as VariationMoveSourceEvidence;
}

function targetEvidence(): VariationMoveTargetEvidence {
  return Object.freeze({}) as VariationMoveTargetEvidence;
}

function ptdEvidence(): VariationMovePtdEvidence {
  return Object.freeze({}) as VariationMovePtdEvidence;
}

class ScriptedVariationMoveGateway implements VariationMoveGateway {
  readonly commitDescriptors: VariationMoveDescriptor[] = [];
  readonly validationDescriptors: VariationMoveDescriptor[] = [];
  readonly readbackDelays: number[] = [];
  modeValue: "live" | "demo" = "live";
  state: RelationshipState = "old";
  autoApply = true;
  sourcePatch: Record<string, unknown> = {};
  targetPatch: Record<string, unknown> = {};
  targetChildren: Array<{
    sellerSku: string;
    dimensionValues: Record<string, unknown>;
  }> = [{
    sellerSku: "TARGET-10OZ",
    dimensionValues: {
      size_name: [{ value: "10 oz", marketplace_id: MARKETPLACE_ID }],
    },
  }];
  validationReceipts: VariationMoveValidationReceipt[] = [];
  commitReceipts: VariationMoveCommitReceipt[] = [];
  observeError: unknown = null;
  observePatch: Record<string, unknown> = {};
  observeCalls = 0;
  demoMutationCalls = 0;
  validationHook: (() => void | Promise<void>) | null = null;
  demoMutationHook: (() => void | Promise<void>) | null = null;

  mode(): "live" | "demo" {
    return this.modeValue;
  }

  async readCanonical(): Promise<VariationMoveCanonicalObservation> {
    const role = this.state === "standalone" ? "standalone" : "child";
    const parentSku = this.state === "old"
      ? OLD_PARENT
      : this.state === "new"
        ? TARGET_PARENT
        : null;
    const dimensionNames = role === "child" ? ["size_name"] : [];
    return {
      mode: this.modeValue,
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      asin: SOURCE_ASIN,
      productType: "PET_FOOD",
      fulfillment: "FBA",
      role,
      parentSku,
      parentageLevel: role === "child" ? "child" : null,
      attributeParentSku: role === "child" ? parentSku : null,
      relationshipType: role === "child" ? "variation" : null,
      variationTheme: role === "child" ? "SIZE_NAME" : null,
      relationshipAttributesAbsent: role === "standalone",
      dimensionNames,
      dimensionSignature: role === "child"
        ? variationDimensionSignature({
            marketplaceId: MARKETPLACE_ID,
            dimensionNames,
            dimensionValues: {
              size_name: [{
                value: "4 oz",
                marketplace_id: MARKETPLACE_ID,
              }],
            },
          })
        : null,
      explicitStandalone: role === "standalone",
      familyComplete: true,
      parentAsin: this.state === "new" ? TARGET_ASIN : null,
      parentProductType: this.state === "new" ? "PET_FOOD" : null,
      ...this.observePatch,
    } as VariationMoveCanonicalObservation;
  }

  async prepare(
    input: VariationMovePrepareRequest,
  ): Promise<VariationMoveGatewayPreparation> {
    const sourceRole = this.state === "standalone" ? "standalone" : "child";
    const sourceParent = this.state === "old"
      ? OLD_PARENT
      : this.state === "new"
        ? TARGET_PARENT
        : null;
    const sourceTheme = sourceRole === "child" ? "SIZE_NAME" : null;
    const source = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      asin: SOURCE_ASIN,
      productType: "PET_FOOD",
      fulfillment: "FBA" as const,
      role: sourceRole,
      parentSku: sourceParent,
      relationshipType: sourceRole === "child" ? "variation" : null,
      variationTheme: sourceTheme,
      explicitStandalone: sourceRole === "standalone",
      familyComplete: true,
      sourceEvidence: sourceEvidence(),
      ...this.sourcePatch,
    };
    if (input.action === "detach") {
      return {
        action: "detach",
        mode: this.modeValue,
        source,
        requestIds: ["REQ-PREPARE-SOURCE"],
      } as VariationMoveGatewayPreparation;
    }
    return {
      action: "attach",
      mode: this.modeValue,
      source,
      target: {
        marketplaceId: MARKETPLACE_ID,
        sellerSku: TARGET_PARENT,
        asin: TARGET_ASIN,
        productType: "PET_FOOD",
        role: "parent",
        variationTheme: "SIZE_NAME",
        dimensionNames: ["size_name"],
        familyComplete: true,
        targetEvidence: targetEvidence(),
        childSchema: {
          type: "object",
          properties: {
            size_name: {
              type: "array",
              items: {
                type: "object",
                required: ["value"],
                properties: {
                  value: { type: "string" },
                  marketplace_id: { type: "string" },
                },
              },
            },
          },
        },
        childSchemaChecksum: "child-schema-checksum",
        ptdEvidence: ptdEvidence(),
        sourceDimensionValues: {
          size_name: [{ value: "4 oz", marketplace_id: MARKETPLACE_ID }],
        },
        children: this.targetChildren,
        ...this.targetPatch,
      },
      requestIds: ["REQ-PREPARE-SOURCE", "REQ-PREPARE-TARGET", "REQ-PTD"],
    } as VariationMoveGatewayPreparation;
  }

  async validationPreview(
    descriptor: VariationMoveDescriptor,
  ): Promise<VariationMoveValidationReceipt> {
    this.validationDescriptors.push(descriptor);
    await this.validationHook?.();
    return this.validationReceipts.shift() ?? {
      status: "VALID",
      requestId: "REQ-PREVIEW",
      issues: [],
    };
  }

  async commitOnce(
    descriptor: VariationMoveDescriptor,
    _fence: ListingWriteExecutionFence,
    recordDispatch: () => Promise<void>,
  ): Promise<VariationMoveCommitReceipt> {
    await recordDispatch();
    this.commitDescriptors.push(descriptor);
    const receipt = this.commitReceipts.shift() ?? {
      status: "ACCEPTED",
      submissionId: "SUBMISSION-1",
      requestId: "REQ-COMMIT",
      issues: [],
    };
    if (receipt.status === "ACCEPTED" && this.autoApply) {
      this.state = descriptor.action === "detach" ? "standalone" : "new";
    }
    return receipt;
  }

  async observe(
    descriptor: VariationMoveDescriptor,
  ): Promise<VariationMoveObservation> {
    this.observeCalls += 1;
    if (this.observeError) throw this.observeError;
    const role = this.state === "standalone" ? "standalone" : "child";
    const parentSku = this.state === "old"
      ? OLD_PARENT
      : this.state === "new"
        ? TARGET_PARENT
        : null;
    const attach = descriptor.action === "attach"
      ? descriptor as VariationMoveAttachDescriptor
      : null;
    return {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      asin: SOURCE_ASIN,
      productType: "PET_FOOD",
      fulfillment: "FBA",
      role,
      parentSku,
      parentageLevel: role === "child" ? "child" : null,
      attributeParentSku: role === "child" ? parentSku : null,
      relationshipType: role === "child" ? "variation" : null,
      variationTheme: role === "child" ? "SIZE_NAME" : null,
      relationshipAttributesAbsent: role === "standalone",
      dimensionSignature: attach && this.state === "new"
        ? variationDimensionSignature({
            marketplaceId: MARKETPLACE_ID,
            dimensionNames: [...attach.dimensionNames],
            dimensionValues: { ...attach.dimensionValues },
          })
        : null,
      explicitStandalone: role === "standalone",
      ...this.observePatch,
    } as VariationMoveObservation;
  }

  async replaceDemoRelationship(
    descriptor: VariationMoveDescriptor,
    fence: { assertCurrent(): Promise<void> },
  ): Promise<void> {
    await this.demoMutationHook?.();
    await fence.assertCurrent();
    this.demoMutationCalls += 1;
    this.state = descriptor.action === "detach" ? "standalone" : "new";
  }
}

function detachInput(): Extract<VariationMoveInput, { action: "detach" }> {
  return {
    action: "detach",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SOURCE_SKU,
    expectedSourceParentSku: OLD_PARENT,
    targetParentSku: null,
    variationTheme: null,
    dimensionNames: [],
    dimensionValues: {},
  };
}

function attachInput(): Extract<VariationMoveInput, { action: "attach" }> {
  return {
    action: "attach",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SOURCE_SKU,
    expectedSourceParentSku: null,
    targetParentSku: TARGET_PARENT,
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    dimensionValues: {
      size_name: [{ value: "4 oz", marketplace_id: MARKETPLACE_ID }],
    },
  };
}

function request(
  method: "POST" | "PATCH",
  input: VariationMoveInput,
  idempotencyKey: string,
): ApiRequest {
  return {
    requestId: `${method}-${idempotencyKey}`,
    method,
    path: "/api/sp-api/variation-move",
    query: {},
    headers: { "content-type": "application/json" },
    body: {
      kind: "json",
      value: { ...input, idempotencyKey },
    },
  };
}

function bodyValue(response: ApiResponse): Record<string, unknown> {
  expect(response.body.kind).toBe("json");
  if (response.body.kind !== "json" ||
      typeof response.body.value !== "object" ||
      response.body.value === null ||
      Array.isArray(response.body.value)) {
    throw new Error("Expected JSON object response.");
  }
  return response.body.value as Record<string, unknown>;
}

async function harness(
  gateway: ScriptedVariationMoveGateway,
  existingStorePath?: string,
): Promise<Readonly<{
  owner: VariationMoveMutationsPort;
  approveWrite: ReturnType<typeof vi.fn>;
  context: SpExecutionContextAdapter;
  storePath: string;
}>> {
  const storePath = existingStorePath ?? join(
    await mkdtemp(join(tmpdir(), "amz-api-w04-domain-")),
    "store.json",
  );
  const store = new LocalStore(storePath);
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: MARKETPLACE_ID,
    mode: gateway.modeValue,
    accountScope: "w04-domain-account",
  }));
  const approveWrite = vi.fn(async () => undefined);
  const writeGate = new MainWriteGate({
    store,
    context,
    approveWrite,
  });
  const owner = createVariationMoveMutations({
    context,
    writeGate,
    gateway,
    readbackDelay: async (milliseconds) => {
      gateway.readbackDelays.push(milliseconds);
    },
  });
  return { owner, approveWrite, context, storePath };
}

async function preview(
  owner: VariationMoveMutationsPort,
  input: VariationMoveInput,
  key: string,
) {
  return owner.handle({ operation: "preview", request: request("POST", input, key) });
}

async function commit(
  owner: VariationMoveMutationsPort,
  input: VariationMoveInput,
  key: string,
) {
  return owner.handle({ operation: "commit", request: request("PATCH", input, key) });
}

describe("complete W04 Variation Move mutation domain", () => {
  it("executes detach and attach as two independent approvals and durable operations", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    const { owner, approveWrite } = await harness(gateway);
    const detachKey = "w04-detach-independent";
    const attachKey = "w04-attach-independent";

    expect((await preview(owner, detachInput(), detachKey)).status).toBe(200);
    const detached = await commit(owner, detachInput(), detachKey);
    expect(detached.status).toBe(200);
    expect(gateway.state).toBe("standalone");

    expect((await preview(owner, attachInput(), attachKey)).status).toBe(200);
    const attached = await commit(owner, attachInput(), attachKey);
    expect(attached.status).toBe(200);
    expect(gateway.state).toBe("new");

    expect(approveWrite).toHaveBeenCalledTimes(2);
    expect(gateway.commitDescriptors.map(({ action }) => action)).toEqual([
      "detach",
      "attach",
    ]);
    expect(Object.keys(bodyValue(attached)).sort()).toEqual([
      "action",
      "completedAt",
      "issues",
      "marketplaceId",
      "mode",
      "notice",
      "requestId",
      "sellerSku",
      "sourceParentSku",
      "status",
      "submissionId",
      "targetParentSku",
      "variationTheme",
      "verified",
    ].sort());
    expect(JSON.stringify(bodyValue(attached))).not.toContain("_writeEvidence");
  });

  it("rejects reuse of a detach idempotency key for attach without a second PATCH", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    const { owner } = await harness(gateway);
    const key = "w04-cross-stage-key";

    await preview(owner, detachInput(), key);
    expect((await commit(owner, detachInput(), key)).status).toBe(200);
    await preview(owner, attachInput(), key);
    const conflict = await commit(owner, attachInput(), key);

    expect(conflict.status).toBe(409);
    expect(bodyValue(conflict)).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(gateway.commitDescriptors).toHaveLength(1);
  });

  it("keeps an unknown commit durable and blocks replay of the PATCH", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.commitReceipts.push({
      status: "UNKNOWN",
      submissionId: null,
      requestId: "REQ-UNKNOWN",
      issues: [],
    });
    const { owner } = await harness(gateway);
    const key = "w04-unknown-commit";

    await preview(owner, detachInput(), key);
    const unknown = await commit(owner, detachInput(), key);
    expect(unknown.status).toBe(503);
    expect(bodyValue(unknown)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    await preview(owner, detachInput(), key);
    const replay = await commit(owner, detachInput(), key);
    expect(replay.status).toBe(409);
    expect(bodyValue(replay)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(gateway.commitDescriptors).toHaveLength(1);
  });

  it("reconciles an unknown receipt after canonical detach convergence", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.commitReceipts.push({
      status: "UNKNOWN",
      submissionId: null,
      requestId: "REQ-UNKNOWN-DETACH",
      issues: [],
    });
    const { owner } = await harness(gateway);

    await preview(owner, detachInput(), "w04-unknown-detach");
    expect(
      (await commit(owner, detachInput(), "w04-unknown-detach")).status,
    ).toBe(503);

    // Amazon may have applied the detach even though the receipt was unknown.
    gateway.state = "standalone";
    gateway.autoApply = true;
    expect(
      (await preview(owner, attachInput(), "w04-after-unknown-attach")).status,
    ).toBe(200);
    const attached = await commit(
      owner,
      attachInput(),
      "w04-after-unknown-attach",
    );

    expect(attached.status).toBe(200);
    expect(gateway.commitDescriptors.map(({ action }) => action)).toEqual([
      "detach",
      "attach",
    ]);
  });

  it("releases only an explicit INVALID commit so the same proposal can be retried", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.commitReceipts.push(
      {
        status: "INVALID",
        submissionId: null,
        requestId: "REQ-INVALID",
        issues: [{
          code: "INVALID_RELATIONSHIP",
          severity: "ERROR",
          message: "Amazon rejected the relationship.",
          attributeNames: ["parentage_level"],
        }],
      },
      {
        status: "ACCEPTED",
        submissionId: "SUBMISSION-RETRY",
        requestId: "REQ-RETRY",
        issues: [],
      },
    );
    const { owner } = await harness(gateway);
    const key = "w04-known-invalid";

    await preview(owner, detachInput(), key);
    const rejected = await commit(owner, detachInput(), key);
    expect(rejected.status).toBe(422);
    expect(bodyValue(rejected)).toMatchObject({ code: "UPDATE_REJECTED" });

    await preview(owner, detachInput(), key);
    expect((await commit(owner, detachInput(), key)).status).toBe(200);
    expect(gateway.commitDescriptors).toHaveLength(2);
  });

  it("records ACCEPTED plus ERROR before seven exact mismatch reads and blocks replay", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.autoApply = false;
    gateway.commitReceipts.push({
      status: "ACCEPTED",
      submissionId: "SUBMISSION-ERROR",
      requestId: "REQ-ACCEPTED-ERROR",
      issues: [{
        code: "RELATIONSHIP_WARNING",
        severity: "ERROR",
        message: "Amazon accepted but returned an issue.",
        attributeNames: ["variation_theme"],
      }],
    });
    const { owner } = await harness(gateway);
    const key = "w04-accepted-error";

    await preview(owner, detachInput(), key);
    const result = await commit(owner, detachInput(), key);
    expect(result.status).toBe(409);
    expect(bodyValue(result)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(gateway.observeCalls).toBe(7);
    expect(gateway.readbackDelays).toEqual([
      1_000,
      1_300,
      1_600,
      1_900,
      2_000,
      2_000,
    ]);

    await preview(owner, detachInput(), key);
    expect((await commit(owner, detachInput(), key)).status).toBe(409);
    expect(gateway.commitDescriptors).toHaveLength(1);
  });

  it("reconciles an accepted detach after canonical convergence and permits attach", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.autoApply = false;
    const { owner } = await harness(gateway);

    await preview(owner, detachInput(), "w04-reconcile-detach");
    const unknown = await commit(
      owner,
      detachInput(),
      "w04-reconcile-detach",
    );
    expect(unknown.status).toBe(409);
    expect(bodyValue(unknown)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    gateway.state = "standalone";
    gateway.autoApply = true;
    expect(
      (await preview(owner, attachInput(), "w04-after-reconcile-attach")).status,
    ).toBe(200);
    expect(
      (await commit(owner, attachInput(), "w04-after-reconcile-attach")).status,
    ).toBe(200);
    expect(gateway.commitDescriptors.map(({ action }) => action)).toEqual([
      "detach",
      "attach",
    ]);
  });

  it("keeps an unknown attach unresolved when the live target parent ASIN drifts", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.state = "standalone";
    gateway.autoApply = false;
    const { owner, storePath } = await harness(gateway);
    const key = "w04-attach-target-asin-drift";

    await preview(owner, attachInput(), key);
    const unknown = await commit(owner, attachInput(), key);
    expect(unknown.status).toBe(409);
    expect(bodyValue(unknown)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

    gateway.state = "new";
    gateway.observePatch = { parentAsin: "B000000099" };
    await preview(owner, attachInput(), "w04-attach-target-asin-drift-probe");

    const stored = JSON.parse(await readFile(storePath, "utf8")) as {
      ledger: Record<string, { state: string }>;
    };
    expect(stored.ledger[key]?.state).toBe("unknown");
    expect(gateway.commitDescriptors).toHaveLength(1);
  });

  it.each([
    [
      "detach leaves a current-market parentage attribute",
      "old",
      detachInput(),
      { parentageLevel: "child", relationshipAttributesAbsent: false },
    ],
    [
      "attach omits the current-market parentage attribute",
      "standalone",
      attachInput(),
      { parentageLevel: null },
    ],
  ] as const)("keeps the accepted write unknown when %s", async (
    _label,
    initialState,
    mutation,
    observationPatch,
  ) => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.state = initialState;
    gateway.observePatch = { ...observationPatch };
    const { owner } = await harness(gateway);
    const key = `w04-relationship-readback-${mutation.action}`;

    await preview(owner, mutation, key);
    const result = await commit(owner, mutation, key);

    expect(result.status).toBe(409);
    expect(bodyValue(result)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(gateway.observeCalls).toBe(7);
    expect(gateway.commitDescriptors).toHaveLength(1);
  });

  it("stops after the first canonical read error once Amazon accepted", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.observeError = new Error("read unavailable");
    const { owner } = await harness(gateway);
    const key = "w04-readback-error";

    await preview(owner, detachInput(), key);
    const result = await commit(owner, detachInput(), key);
    expect(result.status).toBe(503);
    expect(bodyValue(result)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(gateway.observeCalls).toBe(1);
    expect(gateway.readbackDelays).toEqual([]);
  });

  it.each([
    ["source ASIN missing", "source", { asin: null }],
    ["source is not FBA", "source", { fulfillment: "OTHER" }],
    ["source family incomplete", "source", { familyComplete: false }],
    ["source is still bound", "source", {
      role: "child",
      parentSku: OLD_PARENT,
      relationshipType: "variation",
      variationTheme: "SIZE_NAME",
      explicitStandalone: false,
    }],
    ["target marketplace changed", "target", { marketplaceId: "A1VC38T7YXB528" }],
    ["target ASIN missing", "target", { asin: null }],
    ["target product type changed", "target", { productType: "PET_SUPPLIES" }],
    ["target family incomplete", "target", { familyComplete: false }],
    ["target theme missing", "target", { variationTheme: null }],
    ["target dimensions missing", "target", { dimensionNames: [] }],
    ["CHILD PTD checksum missing", "target", { childSchemaChecksum: null }],
  ] as const)(
    "fails closed before Validation Preview when %s",
    async (_label, location, patch) => {
      const gateway = new ScriptedVariationMoveGateway();
      gateway.state = "standalone";
      if (location === "source") gateway.sourcePatch = { ...patch };
      else gateway.targetPatch = { ...patch };
      const { owner } = await harness(gateway);

      const result = await preview(owner, attachInput(), `w04-drift-${_label.length}`);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(gateway.validationDescriptors).toHaveLength(0);
      expect(gateway.commitDescriptors).toHaveLength(0);
    },
  );

  it("rejects a duplicate target dimension before Validation Preview", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.state = "standalone";
    gateway.targetChildren = [{
      sellerSku: "TARGET-DUPLICATE",
      dimensionValues: attachInput().dimensionValues,
    }];
    const { owner } = await harness(gateway);

    const result = await preview(owner, attachInput(), "w04-duplicate-dimension");
    expect(result.status).toBe(409);
    expect(bodyValue(result)).toMatchObject({
      code: "VARIATION_DUPLICATE_DIMENSIONS",
    });
    expect(gateway.validationDescriptors).toHaveLength(0);
  });

  it("requires the final live fence after commit revalidation and sends no PATCH", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    const { owner, context } = await harness(gateway);
    gateway.validationHook = () => {
      if (gateway.validationDescriptors.length === 2) {
        context.invalidate("account-changed");
      }
    };
    const key = "w04-final-live-fence";

    expect((await preview(owner, detachInput(), key)).status).toBe(200);
    const result = await commit(owner, detachInput(), key);
    expect(result.status).toBe(409);
    expect(gateway.commitDescriptors).toHaveLength(0);
  });

  it("requires the final demo fence before changing demo relationship state", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    gateway.modeValue = "demo";
    const { owner, context } = await harness(gateway);
    gateway.demoMutationHook = () => context.invalidate("account-changed");
    const key = "w04-final-demo-fence";

    expect((await preview(owner, detachInput(), key)).status).toBe(200);
    const result = await commit(owner, detachInput(), key);
    expect(result.status).toBe(409);
    expect(gateway.demoMutationCalls).toBe(0);
    expect(gateway.state).toBe("old");
  });

  it("sanitizes hostile receipt metadata and never exposes opaque durable evidence", async () => {
    const gateway = new ScriptedVariationMoveGateway();
    const hostile = "https://evil.example/?refresh_token=secret";
    gateway.commitReceipts.push({
      status: "ACCEPTED",
      submissionId: "seller_id=PRIVATE",
      requestId: hostile,
      issues: [{
        code: "BAD",
        severity: "WARNING",
        message: hostile,
        attributeNames: ["variation_theme"],
      }],
    });
    const { owner, storePath } = await harness(gateway);
    const key = "w04-hostile-metadata";

    await preview(owner, detachInput(), key);
    const result = await commit(owner, detachInput(), key);
    expect(result.status).toBe(200);
    const value = bodyValue(result);
    expect(value.requestId).toBeNull();
    expect(value.submissionId).toBeNull();
    expect(value.issues).toEqual([]);
    expect(JSON.stringify(value)).not.toContain("_writeEvidence");
    expect(JSON.stringify(value)).not.toContain("refresh_token");

    const durable = await readFile(storePath, "utf8");
    expect(durable).toContain("_writeEvidence");
    expect(durable).toContain('"fulfillment": "FBA"');
    expect(durable).not.toContain("refresh_token");
    expect(durable).not.toContain("seller_id=PRIVATE");
  });

  it("projects cached results exactly and rejects tampered durable evidence", async () => {
    const key = "w04-hostile-cached-result";
    const initialGateway = new ScriptedVariationMoveGateway();
    const initial = await harness(initialGateway);
    await preview(initial.owner, detachInput(), key);
    expect((await commit(initial.owner, detachInput(), key)).status).toBe(200);

    const hostile = "Bearer cached-secret";
    const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
      ledger: Record<string, { response: Record<string, unknown> }>;
    };
    const entry = stored.ledger[key];
    if (!entry) throw new Error("Expected completed Variation Move ledger row.");
    entry.response.rendererSecret = hostile;
    await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

    const replayGateway = new ScriptedVariationMoveGateway();
    const replay = await harness(replayGateway, initial.storePath);
    await preview(replay.owner, detachInput(), key);
    const projected = await commit(replay.owner, detachInput(), key);
    expect(projected.status).toBe(200);
    expect(JSON.stringify(bodyValue(projected))).not.toContain(hostile);
    expect(replayGateway.commitDescriptors).toHaveLength(0);

    const evidence = entry.response._writeEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      throw new Error("Expected durable Variation Move evidence.");
    }
    (evidence as Record<string, unknown>).adapterSecret = hostile;
    await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

    const tamperedGateway = new ScriptedVariationMoveGateway();
    const tampered = await harness(tamperedGateway, initial.storePath);
    await preview(tampered.owner, detachInput(), key);
    const rejected = await commit(tampered.owner, detachInput(), key);
    expect(rejected.status).toBe(503);
    expect(bodyValue(rejected)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(JSON.stringify(bodyValue(rejected))).not.toContain(hostile);
    expect(tamperedGateway.commitDescriptors).toHaveLength(0);
  });

  it.each(["detach", "attach"] as const)(
    "rejects a cached %s result whose required parent is null",
    async (action) => {
      const key = `w04-null-required-parent-${action}`;
      const initialGateway = new ScriptedVariationMoveGateway();
      const mutation = action === "detach" ? detachInput() : attachInput();
      if (action === "attach") initialGateway.state = "standalone";
      const initial = await harness(initialGateway);
      await preview(initial.owner, mutation, key);
      expect((await commit(initial.owner, mutation, key)).status).toBe(200);

      const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
        ledger: Record<string, { response: Record<string, unknown> }>;
      };
      const entry = stored.ledger[key];
      if (!entry) throw new Error("Expected completed Variation Move ledger row.");
      const requiredParent = action === "detach"
        ? "sourceParentSku"
        : "targetParentSku";
      entry.response[requiredParent] = null;
      const evidence = entry.response._writeEvidence;
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        throw new Error("Expected durable Variation Move evidence.");
      }
      (evidence as Record<string, unknown>)[requiredParent] = null;
      await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

      const replayGateway = new ScriptedVariationMoveGateway();
      if (action === "attach") replayGateway.state = "standalone";
      const replay = await harness(replayGateway, initial.storePath);
      expect((await preview(replay.owner, mutation, key)).status).toBe(200);
      const rejected = await commit(replay.owner, mutation, key);

      expect(rejected.status).toBe(503);
      expect(bodyValue(rejected)).toMatchObject({
        code: "UPDATE_STATUS_UNKNOWN",
      });
      expect(replayGateway.commitDescriptors).toHaveLength(0);
    },
  );

  it.each([
    ["demo", "live"],
    ["live", "demo"],
  ] as const)(
    "binds a completed %s operation so it cannot replay in %s mode",
    async (initialMode, replayMode) => {
      const key = `w04-mode-binding-${initialMode}-${replayMode}`;
      const initialGateway = new ScriptedVariationMoveGateway();
      initialGateway.modeValue = initialMode;
      const initial = await harness(initialGateway);
      await preview(initial.owner, detachInput(), key);
      expect((await commit(initial.owner, detachInput(), key)).status).toBe(200);

      const replayGateway = new ScriptedVariationMoveGateway();
      replayGateway.modeValue = replayMode;
      const replay = await harness(replayGateway, initial.storePath);
      expect((await preview(replay.owner, detachInput(), key)).status).toBe(200);
      const rejected = await commit(replay.owner, detachInput(), key);

      expect(rejected.status).toBe(503);
      expect(bodyValue(rejected)).toMatchObject({
        code: "UPDATE_STATUS_UNKNOWN",
      });
      expect(replayGateway.commitDescriptors).toHaveLength(0);
    },
  );

  it("requires a terminal current-context fence before projecting a cached result", async () => {
    const key = "w04-cached-terminal-context";
    const initialGateway = new ScriptedVariationMoveGateway();
    const initial = await harness(initialGateway);
    await preview(initial.owner, detachInput(), key);
    expect((await commit(initial.owner, detachInput(), key)).status).toBe(200);
    const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
      ledger: Record<string, { response: unknown }>;
    };
    const cached = stored.ledger[key]?.response;
    if (!cached) throw new Error("Expected cached Variation Move result.");

    const replayGateway = new ScriptedVariationMoveGateway();
    const context = createScriptedSpExecutionContextAdapter(() => ({
      marketplaceId: MARKETPLACE_ID,
      mode: replayGateway.modeValue,
      accountScope: "w04-domain-account",
    }));
    const writeGate: MainWriteGatePort = {
      stagePreview: async () => undefined,
      execute: async <T>() => {
        context.invalidate("account-changed");
        return structuredClone(cached) as T;
      },
      reconcile: async () => undefined,
      clearEphemeral: () => undefined,
    };
    const owner = createVariationMoveMutations({
      context,
      writeGate,
      gateway: replayGateway,
      readbackDelay: async () => undefined,
    });

    const rejected = await commit(owner, detachInput(), key);
    expect(rejected.status).toBe(409);
    expect(bodyValue(rejected)).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(replayGateway.commitDescriptors).toHaveLength(0);
  });

  it("revalidates a pre-W04 completed ledger result before exact replay", async () => {
    const key = "w04-legacy-completed";
    const initialGateway = new ScriptedVariationMoveGateway();
    const initial = await harness(initialGateway);
    await preview(initial.owner, detachInput(), key);
    expect((await commit(initial.owner, detachInput(), key)).status).toBe(200);

    const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
      ledger: Record<string, {
        fingerprint: string;
        response: Record<string, unknown>;
      }>;
    };
    const entry = stored.ledger[key];
    if (!entry) throw new Error("Expected completed Variation Move ledger row.");
    const originProposal = createHash("sha256").update(JSON.stringify([
      "detach",
      MARKETPLACE_ID,
      SOURCE_SKU,
      OLD_PARENT,
      null,
      null,
      [],
      {},
    ])).digest("hex");
    const originGateFingerprint = createHash("sha256")
      .update(JSON.stringify(["w04-domain-account", originProposal]))
      .digest("hex");
    expect(entry.fingerprint).toBe(
      createHash("sha256").update(originGateFingerprint).digest("hex"),
    );
    delete entry.response._writeEvidence;
    await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

    const replayGateway = new ScriptedVariationMoveGateway();
    const replay = await harness(replayGateway, initial.storePath);
    expect((await preview(replay.owner, detachInput(), key)).status).toBe(200);
    replayGateway.state = "standalone";
    const result = await commit(replay.owner, detachInput(), key);

    expect(result.status).toBe(200);
    expect(bodyValue(result)).toMatchObject({
      action: "detach",
      status: "ACCEPTED",
      verified: true,
    });
    expect(replayGateway.commitDescriptors).toHaveLength(0);
  });

  it("rejects a stale pre-W04 demo completion after in-memory state resets", async () => {
    const key = "w04-legacy-demo-reset";
    const initialGateway = new ScriptedVariationMoveGateway();
    initialGateway.modeValue = "demo";
    const initial = await harness(initialGateway);
    await preview(initial.owner, detachInput(), key);
    expect((await commit(initial.owner, detachInput(), key)).status).toBe(200);

    const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
      ledger: Record<string, { response: Record<string, unknown> }>;
    };
    const entry = stored.ledger[key];
    if (!entry) throw new Error("Expected completed Variation Move ledger row.");
    delete entry.response._writeEvidence;
    await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

    const replayGateway = new ScriptedVariationMoveGateway();
    replayGateway.modeValue = "demo";
    const replay = await harness(replayGateway, initial.storePath);
    expect((await preview(replay.owner, detachInput(), key)).status).toBe(200);
    const rejected = await commit(replay.owner, detachInput(), key);

    expect(rejected.status).toBe(503);
    expect(bodyValue(rejected)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(replayGateway.demoMutationCalls).toBe(0);
  });

  it("rejects a pre-W04 attach completion when current parent ASIN is missing", async () => {
    const key = "w04-legacy-attach-parent-drift";
    const initialGateway = new ScriptedVariationMoveGateway();
    initialGateway.state = "standalone";
    const initial = await harness(initialGateway);
    await preview(initial.owner, attachInput(), key);
    expect((await commit(initial.owner, attachInput(), key)).status).toBe(200);

    const stored = JSON.parse(await readFile(initial.storePath, "utf8")) as {
      ledger: Record<string, { response: Record<string, unknown> }>;
    };
    const entry = stored.ledger[key];
    if (!entry) throw new Error("Expected completed Variation Move ledger row.");
    delete entry.response._writeEvidence;
    await writeFile(initial.storePath, JSON.stringify(stored), "utf8");

    const replayGateway = new ScriptedVariationMoveGateway();
    replayGateway.state = "standalone";
    const replay = await harness(replayGateway, initial.storePath);
    expect((await preview(replay.owner, attachInput(), key)).status).toBe(200);
    replayGateway.state = "new";
    replayGateway.observePatch = { parentAsin: null };
    const rejected = await commit(replay.owner, attachInput(), key);

    expect(rejected.status).toBe(503);
    expect(bodyValue(rejected)).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(replayGateway.commitDescriptors).toHaveLength(0);
  });
});
