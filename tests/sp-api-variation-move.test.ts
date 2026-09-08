import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  invalidateSpApiCredentialCaches,
  variationMoveGatewayProduction,
} from "../src/main/amazon/sp-api";
import type { VariationMoveInput } from
  "../src/main/amazon/variation-move-types";
import type { ListingWriteExecutionFence } from
  "../src/main/amazon/listing-write-execution-fence";
import {
  createScriptedSpExecutionContextAdapter,
  SpExecutionContextError,
} from "../src/main/amazon/sp-execution-context";
import {
  createVariationMoveMutations,
} from "../src/main/variation-move-mutations";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
import type {
  MainWriteGateExecuteInput,
  MainWriteGatePort,
  MainWriteGateSession,
} from "../src/main/write-gate";
import { MainWriteGate } from "../src/main/write-gate";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER" as const;
const SELLER_ID = "FAKE_VARIATION_MOVE_SELLER";
const SOURCE_SKU = "CHILD-MOVE-4OZ";
const OLD_PARENT = "PARENT-OLD";
const TARGET_PARENT = "PARENT-NEW";
const TARGET_CHILD = "TARGET-10OZ";
const savedEnvironment = new Map(
  Object.keys(process.env)
    .filter((key) => key.startsWith("SP_API_"))
    .map((key) => [key, process.env[key]]),
);

let operationSequence = 0;

function wireOwner(
  fence: ListingWriteExecutionFence = {
    assertCurrent: async () => undefined,
  },
  recordDurableEvidence: () => Promise<void> = async () => undefined,
) {
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    accountScope: "variation-wire-account",
  }));
  const writeGate: MainWriteGatePort = {
    stagePreview: async () => undefined,
    execute: async <T>(input: MainWriteGateExecuteInput<T>): Promise<T> => {
      const session: MainWriteGateSession = {
        attempt: async (attempt) => attempt.execute({
          recordDurableEvidence,
          recordAccepted: async () => undefined,
          assertCurrent: fence.assertCurrent,
        }),
      };
      return input.run(session);
    },
    reconcile: async () => undefined,
    clearEphemeral: () => undefined,
  };
  return createVariationMoveMutations({
    context,
    writeGate,
    gateway: variationMoveGatewayProduction,
    readbackDelay: async () => undefined,
  });
}

function responseValue<T>(response: Awaited<ReturnType<ReturnType<typeof wireOwner>["handle"]>>): T {
  if (response.body.kind !== "json") throw new Error("Expected JSON response.");
  if (response.status >= 400) {
    const value = response.body.value as Record<string, unknown>;
    throw Object.assign(
      new Error(typeof value.message === "string" ? value.message : "Route failed."),
      { status: response.status },
      value,
    );
  }
  return response.body.value as T;
}

async function getVariationMovePreparation(input: {
  marketplaceId: typeof MARKETPLACE_ID;
  sellerSku: string;
  targetParentSku: string;
}) {
  const owner = wireOwner();
  return responseValue(await owner.handle({
    operation: "prepare",
    request: {
      requestId: `variation-prepare-${++operationSequence}`,
      method: "GET",
      path: "/api/sp-api/variation-move",
      query: {
        marketplaceId: input.marketplaceId,
        sku: input.sellerSku,
        targetSku: input.targetParentSku,
      },
      headers: {},
    },
  }));
}

async function previewVariationMove(value: VariationMoveInput) {
  const owner = wireOwner();
  return responseValue<{ status: string; changes: Array<{name: string; before: unknown; after: unknown}> }>(await owner.handle({
    operation: "preview",
    request: variationRouteRequest("POST", {
      ...value,
      idempotencyKey: `wire-preview-${++operationSequence}`,
    }),
  }));
}

async function updateVariationMove(
  value: VariationMoveInput,
  fence: ListingWriteExecutionFence = {
    assertCurrent: async () => undefined,
  },
) {
  const owner = wireOwner(fence);
  return responseValue(await owner.handle({
    operation: "commit",
    request: variationRouteRequest("PATCH", {
      ...value,
      idempotencyKey: `wire-commit-${++operationSequence}`,
    }),
  }));
}

type RelationshipState = "old" | "detached" | "new";

function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-amzn-requestid": requestId,
      ...headers,
    },
  });
}

function asinForSku(sku: string): string {
  let value = 0;
  for (const character of sku) {
    value = (value * 31 + character.codePointAt(0)!) % 1_000_000_000;
  }
  return `B${String(value).padStart(9, "0")}`;
}

function childPayload(
  sku: string,
  parentSku: string | null,
  size: string,
) {
  return {
    sku,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: asinForSku(sku),
      productType: "PET_FOOD",
      status: ["BUYABLE"],
      itemName: `Listing ${sku}`,
    }],
    productTypes: [{ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" }],
    attributes: {
      ...(parentSku ? {
        parentage_level: [{ value: "child", marketplace_id: MARKETPLACE_ID }],
        child_parent_sku_relationship: [{
          parent_sku: parentSku,
          child_relationship_type: "variation",
          marketplace_id: MARKETPLACE_ID,
        }],
        variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }],
      } : {}),
      size_name: [{ value: size, language_tag: "en_US", marketplace_id: MARKETPLACE_ID }],
    },
    relationships: parentSku ? [{
      marketplaceId: MARKETPLACE_ID,
      relationships: [{
        parentSkus: [parentSku],
        variationTheme: { theme: "SIZE_NAME", attributes: ["size_name"] },
      }],
    }] : [],
    fulfillmentAvailability: [{ fulfillmentChannelCode: "AMAZON_NA", quantity: 7 }],
    issues: [],
  };
}

function parentPayload(parentSku: string, children: string[]) {
  return {
    sku: parentSku,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: asinForSku(parentSku),
      productType: "PET_FOOD",
      itemName: `Parent ${parentSku}`,
    }],
    productTypes: [{ marketplaceId: MARKETPLACE_ID, productType: "PET_FOOD" }],
    attributes: {
      parentage_level: [{ value: "parent", marketplace_id: MARKETPLACE_ID }],
      variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }],
    },
    relationships: [{
      marketplaceId: MARKETPLACE_ID,
      relationships: [{
        childSkus: children,
        variationTheme: { theme: "SIZE_NAME", attributes: ["size_name"] },
      }],
    }],
    fulfillmentAvailability: [],
    issues: [],
  };
}

function input(action: "detach"): Extract<VariationMoveInput, { action: "detach" }>;
function input(action: "attach"): Extract<VariationMoveInput, { action: "attach" }>;
function input(action: "detach" | "attach"): VariationMoveInput {
  if (action === "detach") {
    return {
      action,
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      expectedSourceParentSku: OLD_PARENT,
      targetParentSku: null,
      variationTheme: null,
      dimensionNames: [],
      dimensionValues: {},
    };
  }
  return {
    action,
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SOURCE_SKU,
    expectedSourceParentSku: null,
    targetParentSku: TARGET_PARENT,
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    dimensionValues: {
      size_name: [{
        value: "4 oz",
        language_tag: "en_US",
        marketplace_id: MARKETPLACE_ID,
      }],
    },
  };
}

type SafetyWireOptions = {
  sourceAttributes?: Record<string, unknown>;
  immutableSize?: "readOnly" | "editable" | "invalid";
  sourceSizeValues?: unknown;
  attachedSizeValues?: unknown;
  requiredLiquid?: boolean;
  amazonRequiredLiquid?: boolean;
  existingLiquid?: boolean;
  omitRequiredReadback?: boolean;
  commitStatus?: 200 | 401 | 403 | 429;
  commitPayload?: unknown;
  readbackFailure?: "forbidden" | "rate_limited" | "transport";
  readbackFailureAfterDetachedReads?: number;
  conflictingSourceParent?: boolean;
  preCommitPreviewFailureStatus?: 429 | 500;
  initialState?: RelationshipState;
  commitResultState?: Extract<RelationshipState, "detached" | "new">;
  relationshipOnlyOldParentWhenDetached?: boolean;
  residualParentageWhenDetached?: boolean;
  omitParentageWhenNew?: boolean;
  mixedMarketplaceDimensions?: boolean;
  rootRefChildSchema?: boolean;
  failCommitTokenOnce?: boolean;
  stallCommitBody?: boolean;
  oversizedCommitBody?: boolean;
  commitRedirect?: boolean;
};

function installDetachSafetyWire(options: SafetyWireOptions = {}) {
  let state: RelationshipState = options.initialState ?? "old";
  let commitPatches = 0;
  let factValues: Record<string, unknown> = options.existingLiquid === undefined ? {} : { contains_liquid: [{ value: options.existingLiquid, marketplace_id: MARKETPLACE_ID }] };
  const patchBodies: Array<{ patches: Array<{ path: string; value?: unknown }> }> = [];
  let previewPatches = 0;
  let detachedReads = 0;
  let sourceItemReads = 0;
  let targetChildSearchReads = 0;
  let commitRedirectMode: RequestRedirect | null = null;
  let commitTokenFailed = false;
  let schemaChecksum = "child-schema-checksum";
  const fetchMock = vi.fn<typeof fetch>(async (rawInput, init) => {
    const url = new URL(rawInput instanceof Request ? rawInput.url : String(rawInput));
    const method = init?.method ?? "GET";
    if (url.origin === "https://api.amazon.com") {
      if (
        options.failCommitTokenOnce &&
        previewPatches >= 2 &&
        commitPatches === 0 &&
        !commitTokenFailed
      ) {
        commitTokenFailed = true;
        return jsonResponse(500, { error: "temporarily_unavailable" }, "TOKEN-FAIL");
      }
      return jsonResponse(
        200,
        {
          access_token: "FAKE_ACCESS",
          expires_in: options.failCommitTokenOnce ? 60 : 3_600,
        },
        "TOKEN",
      );
    }
    if (url.origin === "https://schema.example") {
      const childSchema = {
        type: "object",
        ...(options.requiredLiquid ? { required: ["size_name", "contains_liquid"] } : {}),
        ...(options.amazonRequiredLiquid ? { allOf: [{ if: { amazonConstraint: true }, then: { required: ["contains_liquid"] } }] } : {}),
        properties: {
          ...(options.requiredLiquid || options.amazonRequiredLiquid ? {
            contains_liquid: {
              title: "Contains Liquid",
              type: "array",
              items: {
                type: "object", required: ["value"],
                properties: { value: { type: "boolean" }, marketplace_id: { type: "string" } },
              },
            },
          } : {}),
          size_name: {
            type: "array",
            ...(options.immutableSize === "readOnly" ? { readOnly: true } : {}),
            ...(options.immutableSize === "editable" ? { editable: false } : {}),
            ...(options.immutableSize === "invalid" ? { readOnly: "yes" } : {}),
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
      };
      return jsonResponse(
        200,
        options.rootRefChildSchema
          ? { $ref: "#/$defs/child", $defs: { child: childSchema } }
          : childSchema,
        "SCHEMA",
      );
    }
    if (url.pathname.includes("/definitions/2020-09-01/productTypes/")) {
      return jsonResponse(200, {
        schema: {
          checksum: schemaChecksum,
          link: { resource: "https://schema.example/child.json" },
        },
        productType: "PET_FOOD",
        marketplaceIds: [MARKETPLACE_ID],
      }, "PTD");
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      patchBodies.push(body);
      const preview = url.searchParams.get("mode") === "VALIDATION_PREVIEW";
      if (preview) {
        previewPatches += 1;
        if (options.amazonRequiredLiquid && !body.patches.some((patch: { path: string }) => patch.path === "/attributes/contains_liquid")) {
          return jsonResponse(200, { status: "INVALID", issues: [{ code: "90220", severity: "ERROR", message: "contains_liquid is required but not supplied", attributeNames: ["contains_liquid"] }] }, "PATCH-MISSING-LIQUID");
        }
        if (
          options.preCommitPreviewFailureStatus &&
          previewPatches >= 2 &&
          previewPatches <= 4
        ) {
          const status = options.preCommitPreviewFailureStatus;
          return jsonResponse(
            status,
            { errors: [{ code: `PRECOMMIT_${status}`, message: "preview unavailable" }] },
            `PRECOMMIT-${status}-${previewPatches}`,
            { "retry-after": "0" },
          );
        }
        return jsonResponse(200, { status: "VALID", issues: [] }, "PATCH-PREVIEW");
      }
      commitPatches += 1;
      commitRedirectMode = init?.redirect ?? null;
      if (options.commitRedirect) {
        throw new TypeError("redirect mode is error");
      }
      const status = options.commitStatus ?? 200;
      if (status === 200) {
        state = options.commitResultState ?? "detached";
        if (!options.omitRequiredReadback) for (const patch of body.patches) if (patch.path === "/attributes/contains_liquid") factValues.contains_liquid = patch.value;
      }
      if (status === 200 && options.stallCommitBody) {
        return new Response(new ReadableStream<Uint8Array>({
          start: () => undefined,
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-amzn-requestid": "PATCH-COMMIT-STALL",
          },
        });
      }
      if (status === 200 && options.oversizedCommitBody) {
        return new Response(
          JSON.stringify({ padding: "x".repeat(1_048_576) }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-amzn-requestid": "PATCH-COMMIT-OVERSIZED",
            },
          },
        );
      }
      return status === 200
        ? jsonResponse(
            200,
            options.commitPayload !== undefined ? options.commitPayload : {
              status: "ACCEPTED",
              submissionId: "SUB-COMMIT",
              issues: [],
            },
            "PATCH-COMMIT",
          )
        : jsonResponse(status, { errors: [{ code: `HTTP_${status}`, message: "commit rejected" }] }, `PATCH-${status}`);
    }
    if (url.searchParams.has("variationParentSku")) {
      const parentSku = url.searchParams.get("variationParentSku");
      if (parentSku === TARGET_PARENT) targetChildSearchReads += 1;
      return jsonResponse(200, {
        items: parentSku === OLD_PARENT
          ? (state === "old" ? [childPayload(SOURCE_SKU, OLD_PARENT, "4 oz")] : [])
          : [
              childPayload(TARGET_CHILD, TARGET_PARENT, "10 oz"),
              ...(state === "new" ? [childPayload(SOURCE_SKU, TARGET_PARENT, "4 oz")] : []),
            ],
        pagination: {},
      }, `SEARCH-${parentSku}`);
    }
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.endsWith(`/${SOURCE_SKU}`)) {
      sourceItemReads += 1;
      if (state === "detached") detachedReads += 1;
      const failDetachedRead =
        state === "detached" &&
        detachedReads >= (options.readbackFailureAfterDetachedReads ?? 1);
      if (failDetachedRead && options.readbackFailure === "transport") {
        throw new TypeError("socket closed after accepted commit");
      }
      if (failDetachedRead && options.readbackFailure === "forbidden") {
        return jsonResponse(403, { errors: [{ code: "Forbidden" }] }, "READBACK-403");
      }
      if (failDetachedRead && options.readbackFailure === "rate_limited") {
        return jsonResponse(
          429,
          { errors: [{ code: "QuotaExceeded" }] },
          "READBACK-429",
          { "retry-after": "0" },
        );
      }
      const payload = childPayload(
        SOURCE_SKU,
        state === "old" ? OLD_PARENT : state === "new" ? TARGET_PARENT : null,
        "4 oz",
      );
      Object.assign(payload.attributes, factValues, options.sourceAttributes);
      if (options.sourceSizeValues !== undefined) Object.assign(payload.attributes, { size_name: options.sourceSizeValues });
      if (state === "new" && options.attachedSizeValues !== undefined) Object.assign(payload.attributes, { size_name: options.attachedSizeValues });
      if (options.mixedMarketplaceDimensions) {
        (payload.attributes.size_name as Array<{
          value: string;
          language_tag: string;
          marketplace_id: string;
        }>).push({
          value: "Japan-only size",
          language_tag: "ja_JP",
          marketplace_id: "A1VC38T7YXB528",
        });
      }
      if (
        state === "detached" &&
        options.relationshipOnlyOldParentWhenDetached
      ) {
        payload.relationships = [{
          marketplaceId: MARKETPLACE_ID,
          relationships: [{
            parentSkus: [OLD_PARENT],
            variationTheme: {
              theme: "SIZE_NAME",
              attributes: ["size_name"],
            },
          }],
        }];
      }
      if (state === "detached" && options.residualParentageWhenDetached) {
        payload.attributes.parentage_level = [{
          value: "child",
          marketplace_id: MARKETPLACE_ID,
        }];
      }
      if (state === "new" && options.omitParentageWhenNew) {
        delete payload.attributes.parentage_level;
      }
      if (options.conflictingSourceParent) {
        payload.attributes.child_parent_sku_relationship = [{
          parent_sku: "PARENT-ATTR-CONFLICT",
          child_relationship_type: "variation",
          marketplace_id: MARKETPLACE_ID,
        }];
      }
      return jsonResponse(200, payload, `SOURCE-${state}`);
    }
    if (decodedPath.endsWith(`/${OLD_PARENT}`)) {
      return jsonResponse(200, parentPayload(OLD_PARENT, state === "old" ? [SOURCE_SKU] : []), "OLD-PARENT");
    }
    if (decodedPath.endsWith(`/${TARGET_PARENT}`)) {
      return jsonResponse(200, parentPayload(TARGET_PARENT, [
        TARGET_CHILD, ...(state === "new" ? [SOURCE_SKU] : []),
      ]), "TARGET-PARENT");
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    patchBodies,
    setSchemaChecksum: (value: string) => { schemaChecksum = value; },
    setSourceAttributes: (value: Record<string, unknown>) => { options.sourceAttributes = value; },
    setSourceSizeValues: (value: unknown) => { options.sourceSizeValues = value; },
    commitPatchCount: () => commitPatches,
    previewPatchCount: () => previewPatches,
    sourceItemReadCount: () => sourceItemReads,
    targetChildSearchReadCount: () => targetChildSearchReads,
    lastCommitRedirectMode: () => commitRedirectMode,
  };
}

function variationRouteRequest(
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: `variation-precommit-${method.toLowerCase()}-${Date.now()}`,
    method,
    path: "/api/sp-api/variation-move",
    query: {},
    headers: { "content-type": "application/json" },
    body: { kind: "json", value: body },
  };
}

async function durableVariationRouter(approveWrite: (reason: string) => Promise<void> = async () => undefined): Promise<ApiRouter> {
  const directory = await mkdtemp(join(tmpdir(), "amz-api-variation-precommit-"));
  const store = new LocalStore(join(directory, "store.json"));
  await store.initialize();
  return new ApiRouter({
    store,
    vault: {
      getAccountScope: async () => "variation-precommit-test-scope",
    } as unknown as CredentialVault,
    approveWrite,
  });
}

async function durableWireOwner() {
  const directory = await mkdtemp(join(tmpdir(), "amz-api-variation-readback-"));
  const storePath = join(directory, "store.json");
  const store = new LocalStore(storePath);
  await store.initialize();
  const context = createScriptedSpExecutionContextAdapter(() => ({
    marketplaceId: MARKETPLACE_ID,
    mode: "live",
    accountScope: "variation-wire-account",
  }));
  const owner = createVariationMoveMutations({
    context,
    writeGate: new MainWriteGate({
      store,
      context,
      approveWrite: async () => undefined,
    }),
    gateway: variationMoveGatewayProduction,
    readbackDelay: async () => undefined,
  });
  return { owner, storePath };
}

describe("live variation detach and attach wire safety", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    process.env.SP_API_MODE = "live";
    process.env.SP_API_LWA_CLIENT_ID = "FAKE_VARIATION_MOVE_CLIENT";
    process.env.SP_API_LWA_CLIENT_SECRET = "FAKE_VARIATION_MOVE_SECRET";
    process.env.SP_API_REFRESH_TOKEN_NA = "FAKE_VARIATION_MOVE_REFRESH";
    process.env.SP_API_SELLER_ID_NA = SELLER_ID;
    invalidateSpApiCredentialCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateSpApiCredentialCaches();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it.each(["readOnly", "editable"] as const)("preserves an unchanged immutable variation dimension (%s) while attaching the relationship", async (immutableSize) => {
    const wire = installDetachSafetyWire({ immutableSize, initialState: "detached", commitResultState: "new" });
    const prepared = await getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT });
    expect(prepared).toMatchObject({ writable: true, fields: [expect.objectContaining({ name: "size_name", editable: false })] });
    await expect(previewVariationMove(input("attach"))).resolves.toMatchObject({ status: "VALID" });
    await expect(updateVariationMove(input("attach"))).resolves.toMatchObject({ verified: true });
    expect(wire.commitPatchCount()).toBe(1);
    for (const body of wire.patchBodies) expect(body.patches.map((patch) => patch.path)).toEqual([
      "/attributes/parentage_level", "/attributes/child_parent_sku_relationship", "/attributes/variation_theme",
    ]);
  });

  it.each([
    [{ value: "8 oz", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }],
    [{ value: "4 oz", language_tag: "fr_CA", marketplace_id: MARKETPLACE_ID }],
    [],
  ].map((value) => ({ value })))("rejects an altered or missing immutable dimension proposal before preview %#", async ({ value }) => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached" });
    await expect(previewVariationMove({ ...input("attach"), dimensionValues: { size_name: value } })).rejects.toMatchObject({ code: value.length ? "VARIATION_FIELD_READ_ONLY" : "VARIATION_FIELD_REQUIRED" });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it.each([
    [],
    [{ marketplace_id: MARKETPLACE_ID }],
    [{ value: "4 oz", marketplace_id: MARKETPLACE_ID }, { value: "8 oz", marketplace_id: MARKETPLACE_ID }],
  ].map((sourceSizeValues) => ({ sourceSizeValues })))("blocks missing, partial or ambiguous immutable source facts before preparation %#", async ({ sourceSizeValues }) => {
    const wire = installDetachSafetyWire({ immutableSize: "editable", initialState: "detached", sourceSizeValues });
    await expect(getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT })).rejects.toMatchObject({ code: "VARIATION_FIELD_READ_ONLY" });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("blocks immutable old-value drift before native approval", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached" });
    const approve = vi.fn(async () => undefined);
    const router = await durableVariationRouter(approve);
    const body = { ...input("attach"), idempotencyKey: "immutable-dimension-value-drift" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    wire.setSourceSizeValues([{ value: "8 oz", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }]);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "VARIATION_FIELD_READ_ONLY" } });
    expect(approve).not.toHaveBeenCalled();
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("does not treat malformed PTD editability as permission to preserve an immutable dimension", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "invalid", initialState: "detached" });
    await expect(getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT })).rejects.toMatchObject({ code: "VARIATION_SCHEMA_MISMATCH" });
    expect(wire.previewPatchCount()).toBe(0);
  });

  it("does not discard malformed source values to make an immutable dimension look unambiguous", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached", sourceSizeValues: [
      { value: "4 oz", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }, null,
    ] });
    await expect(getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT })).rejects.toMatchObject({ code: "VARIATION_TARGET_DIMENSIONS_INCOMPLETE" });
    expect(wire.previewPatchCount()).toBe(0);
  });

  it("invalidates an immutable-dimension preview when the CHILD PTD changes before native approval", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "editable", initialState: "detached", commitResultState: "new" });
    const approve = vi.fn(async () => undefined);
    const router = await durableVariationRouter(approve);
    const body = { ...input("attach"), idempotencyKey: "immutable-dimension-schema-drift" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    wire.setSchemaChecksum("changed-immutable-dimension-schema");
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "PREVIEW_CHANGED" } });
    expect(approve).not.toHaveBeenCalled();
    expect(wire.commitPatchCount()).toBe(0);
  });

  it.each([
    { attachedSizeValues: [{ value: "4 oz", language_tag: "fr_CA", marketplace_id: MARKETPLACE_ID }] },
    { attachedSizeValues: [{ value: "4 oz", language_tag: "en_US" }] },
  ])("requires immutable dimension selectors to remain exact in canonical readback %#", async ({ attachedSizeValues }) => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached", commitResultState: "new",
      attachedSizeValues,
    });
    await expect(updateVariationMove(input("attach"))).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(wire.commitPatchCount()).toBe(1);
    expect(wire.patchBodies.flatMap((body) => body.patches).some((patch) => patch.path === "/attributes/size_name")).toBe(false);
  });

  it("revalidates immutable PTD evidence again after native approval and before dispatch", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached" });
    const approve = vi.fn(async () => { wire.setSchemaChecksum("schema-changed-during-native-approval"); });
    const router = await durableVariationRouter(approve);
    const body = { ...input("attach"), idempotencyKey: "immutable-dimension-post-approval-drift" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "PREVIEW_CHANGED" } });
    expect(approve).toHaveBeenCalledOnce();
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("keeps a sent immutable relationship attach unknown and never resends it", async () => {
    const wire = installDetachSafetyWire({ immutableSize: "readOnly", initialState: "detached", commitStatus: 403 });
    const router = await durableVariationRouter();
    const body = { ...input("attach"), idempotencyKey: "immutable-dimension-unknown-replay" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "UPDATE_STATUS_UNKNOWN" } });
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "UPDATE_STATUS_UNKNOWN" } });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it.each([false, true])("attaches a standalone PET_FOOD ITEM_SHAPE/SIZE item while preserving its readonly Pretzel shape (retained theme=%s)", async (retainedTheme) => {
    const wire = installDetachSafetyWire({ initialState: "detached", commitResultState: "new" });
    const theme = "ITEM_SHAPE/SIZE";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawInput, init) => {
      const reply = await wire.fetchMock(rawInput, init);
      if ((init?.method ?? "GET") !== "GET") return reply;
      const payload = await reply.json() as Record<string, unknown>;
      const url = new URL(String(rawInput));
      if (url.origin === "https://schema.example") {
        Object.assign(payload.properties as Record<string, unknown>, {
          item_shape: { type: "array", items: { type: "object", required: ["value"], properties: {
            value: { type: "string", editable: false }, language_tag: { type: "string" }, marketplace_id: { type: "string" },
          } } },
        });
      }
      const rewrite = (row: Record<string, unknown>) => {
        const attributes = row.attributes as Record<string, unknown>;
        if (!attributes) return;
        attributes.item_shape = [{ value: "Pretzel", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }];
        if (row.sku === SOURCE_SKU) attributes.size_name = [{ value: "4 Count (Pack of 1)", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }];
        if (attributes.variation_theme || retainedTheme && row.sku === SOURCE_SKU) attributes.variation_theme = [{ name: theme, marketplace_id: MARKETPLACE_ID }];
        for (const group of row.relationships as Array<{ relationships: Array<{ variationTheme: unknown }> }> ?? []) {
          for (const relationship of group.relationships) relationship.variationTheme = { theme, attributes: ["item_shape", "size_name"] };
        }
      };
      rewrite(payload);
      for (const row of payload.items as Array<Record<string, unknown>> ?? []) rewrite(row);
      return new Response(JSON.stringify(payload), { status: reply.status, headers: reply.headers });
    }));
    const preparation = await getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT });
    expect(preparation).toMatchObject({ writable: true, variationTheme: theme, fields: expect.arrayContaining([
      expect.objectContaining({ name: "item_shape", editable: false, values: [{ value: "Pretzel", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }] }),
    ]) });
    const proposal = { ...input("attach"), variationTheme: theme, dimensionNames: ["item_shape", "size_name"], dimensionValues: {
      item_shape: [{ value: "Pretzel", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }],
      size_name: [{ value: "4 Count (Pack of 1)", language_tag: "en_US", marketplace_id: MARKETPLACE_ID }],
    } };
    await expect(previewVariationMove(proposal)).resolves.toMatchObject({
      status: "VALID",
      changes: expect.arrayContaining([{ name: "variation_theme", label: "變體主題", before: retainedTheme ? theme : null, after: theme }]),
    });
    await expect(updateVariationMove(proposal)).resolves.toMatchObject({ verified: true });
    expect(wire.commitPatchCount()).toBe(1);
    expect(wire.patchBodies.flatMap((body) => body.patches).some((patch) => patch.path === "/attributes/item_shape")).toBe(false);
    expect(wire.patchBodies.every((body) => body.patches.some((patch) => patch.path === "/attributes/variation_theme") === !retainedTheme)).toBe(true);
  });

  it.each([
    { variation_theme: [{ name: "OTHER_THEME", marketplace_id: MARKETPLACE_ID }] },
    { variation_theme: [{ name: "SIZE_NAME" }] },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: "A1VC38T7YXB528" }] },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }, { name: "SIZE_NAME", marketplace_id: "A1VC38T7YXB528" }] },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }, { name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }] },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }, null] },
    { variation_theme: { name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID } },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }], parentage_level: [{ value: "unknown", marketplace_id: MARKETPLACE_ID }] },
    { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID }], child_parent_sku_relationship: [{}] },
  ])("blocks unsafe retained theme or residual relationship attributes consistently before preview %#", async (sourceAttributes) => {
    const wire = installDetachSafetyWire({ initialState: "detached", sourceAttributes });
    await expect(getVariationMovePreparation({ marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT })).rejects.toMatchObject({ code: "VARIATION_NOT_DETACHED" });
    await expect(previewVariationMove(input("attach"))).rejects.toMatchObject({ code: "VARIATION_NOT_DETACHED" });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it.each(["before-approval", "during-approval"] as const)("invalidates retained theme selector drift %s before any commit PATCH", async (stage) => {
    const sourceAttributes = { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID, language_tag: "en_US" }] };
    const wire = installDetachSafetyWire({ initialState: "detached", sourceAttributes });
    const drift = () => wire.setSourceAttributes({ variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID, language_tag: "fr_CA" }] });
    const approve = vi.fn(async () => { if (stage === "during-approval") drift(); });
    const router = await durableVariationRouter(approve);
    const body = { ...input("attach"), idempotencyKey: `retained-theme-selector-drift-${stage}` };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    if (stage === "before-approval") drift();
    const result = await router.handle(variationRouteRequest("PATCH", body));
    expect(result.body).toMatchObject({ kind: "json", value: { code: "PREVIEW_CHANGED" } });
    expect(approve).toHaveBeenCalledTimes(stage === "before-approval" ? 0 : 1);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it.each([undefined, "fr_CA"])("keeps retained theme selector readback drift (%s) unknown and never resends", async (readbackLanguage) => {
    const sourceAttributes = { variation_theme: [{ name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID, language_tag: "en_US" }] };
    const wire = installDetachSafetyWire({ initialState: "detached", commitResultState: "new", sourceAttributes });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawInput, init) => {
      const reply = await wire.fetchMock(rawInput, init);
      if ((init?.method ?? "GET") === "PATCH" && !new URL(String(rawInput)).searchParams.has("mode")) {
        wire.setSourceAttributes({ variation_theme: [{
          name: "SIZE_NAME", marketplace_id: MARKETPLACE_ID,
          ...(readbackLanguage ? { language_tag: readbackLanguage } : {}),
        }] });
      }
      return reply;
    }));
    const { owner, storePath } = await durableWireOwner();
    const body = { ...input("attach"), idempotencyKey: "retained-theme-unknown-readback" };
    expect((await owner.handle({ operation: "preview", request: variationRouteRequest("POST", body) })).status).toBe(200);
    expect((await owner.handle({ operation: "commit", request: variationRouteRequest("PATCH", body) })).body).toMatchObject({ kind: "json", value: { code: "UPDATE_STATUS_UNKNOWN" } });
    await owner.handle({
      operation: "prepare",
      request: {
        requestId: "retained-theme-reconcile", method: "GET", path: "/api/sp-api/variation-move",
        query: { marketplaceId: MARKETPLACE_ID, sku: SOURCE_SKU, targetSku: TARGET_PARENT }, headers: {},
      },
    });
    expect((await owner.handle({ operation: "commit", request: variationRouteRequest("PATCH", body) })).body).toMatchObject({ kind: "json", value: { code: "PREVIEW_EXPIRED" } });
    const stored = JSON.parse(await readFile(storePath, "utf8"));
    expect(stored.ledger[body.idempotencyKey]).toMatchObject({
      state: "unknown",
      response: { verified: false, _writeEvidence: { retainedVariationThemeSignature: expect.stringMatching(/^[a-f0-9]{64}$/u) } },
    });
    expect(wire.commitPatchCount()).toBe(1);
    expect(wire.patchBodies.every((body) => !body.patches.some((patch) => patch.path === "/attributes/variation_theme"))).toBe(true);
  });

  it("turns Amazon conditional missing-attribute preview feedback into a PTD-proven fillable fact", async () => {
    const wire = installDetachSafetyWire({ amazonRequiredLiquid: true, initialState: "detached" });
    await expect(previewVariationMove(input("attach"))).rejects.toMatchObject({
      code: "VARIATION_FIELD_REQUIRED", requiredFields: [expect.objectContaining({ name: "contains_liquid", editable: true })],
    });
    const proposal = { ...input("attach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] } };
    await expect(previewVariationMove(proposal)).resolves.toMatchObject({ status: "VALID" });
    expect(wire.previewPatchCount()).toBe(2);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("exposes a missing CHILD PTD liquid fact as an unanswered boolean before Amazon preview", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true, initialState: "detached" });
    const preparation = await getVariationMovePreparation({
      marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU, targetParentSku: TARGET_PARENT,
    });
    expect(preparation).toMatchObject({
      action: "attach",
      requiredFields: [expect.objectContaining({
        name: "contains_liquid", values: [],
        leaves: [expect.objectContaining({ path: ["value"], type: "boolean", currentValue: null })],
      })],
    });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("allows an explicitly answered false liquid fact in preview and one commit with canonical readback", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true, initialState: "detached", commitResultState: "new" });
    const proposal = { ...input("attach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] } };
    await expect(previewVariationMove(input("attach"))).rejects.toMatchObject({ code: "VARIATION_FIELD_REQUIRED" });
    const preview = await previewVariationMove(proposal);
    expect(preview.changes).toContainEqual({ name: "contains_liquid", label: "產品是否含液體", before: [], after: [{ value: false, marketplace_id: MARKETPLACE_ID }] });
    await expect(updateVariationMove(proposal)).resolves.toMatchObject({ verified: true });
    expect(wire.commitPatchCount()).toBe(1);
    for (const body of wire.patchBodies) expect(body.patches.map((patch) => patch.path)).toEqual([
      "/attributes/parentage_level", "/attributes/child_parent_sku_relationship", "/attributes/variation_theme", "/attributes/size_name", "/attributes/contains_liquid",
    ]);
  });

  it("binds a supplementary-fact preview to the fresh PTD before native approval", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true });
    const approve = vi.fn(async () => undefined);
    const router = await durableVariationRouter(approve);
    const body = { ...input("detach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] }, idempotencyKey: "variation-required-schema-drift" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    wire.setSchemaChecksum("child-schema-checksum-v2");
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "PREVIEW_CHANGED" } });
    expect(approve).not.toHaveBeenCalled();
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("discloses supplemented facts in the native main-generated confirmation", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true });
    const approve = vi.fn(async (_reason: string) => undefined);
    const router = await durableVariationRouter(approve);
    const body = { ...input("detach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] }, idempotencyKey: "variation-required-native-review" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).status).toBe(200);
    expect(approve).toHaveBeenCalledWith(expect.stringContaining("產品是否含液體"));
    expect(approve).toHaveBeenCalledWith(expect.stringContaining("false"));
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("reads detach required fields without requiring a target and leaves an existing false fact untouched", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true, existingLiquid: false });
    const owner = wireOwner();
    const prepared = responseValue(await owner.handle({ operation: "prepare", request: { requestId: "detach-facts", method: "GET", path: "/api/sp-api/variation-move", query: { marketplaceId: MARKETPLACE_ID, sku: SOURCE_SKU, action: "detach" }, headers: {} } }));
    expect(prepared).toMatchObject({ action: "detach", targetParentSku: null, fields: [], requiredFields: [] });
    await expect(previewVariationMove(input("detach"))).resolves.toMatchObject({ status: "VALID" });
    expect(wire.patchBodies[0].patches.some((patch) => patch.path === "/attributes/contains_liquid")).toBe(false);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("keeps a supplementary-fact PATCH unknown and blocks same-key replay after transport rejection", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true, commitStatus: 403 });
    const router = await durableVariationRouter();
    const body = { ...input("detach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] }, idempotencyKey: "variation-required-unknown" };
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "UPDATE_STATUS_UNKNOWN" } });
    expect((await router.handle(variationRouteRequest("POST", body))).status).toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).body).toMatchObject({ kind: "json", value: { code: "UPDATE_STATUS_UNKNOWN" } });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("does not call a relationship complete until supplemented facts also appear in canonical readback", async () => {
    const wire = installDetachSafetyWire({ requiredLiquid: true, omitRequiredReadback: true });
    const proposal = { ...input("detach"), requiredValues: { contains_liquid: [{ value: false, marketplace_id: MARKETPLACE_ID }] } };
    await expect(updateVariationMove(proposal)).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("uses CHILD PTD, exact delete/add patches and one commit per stage with verified readback", async () => {
    let state: RelationshipState = "old";
    const patches: Array<{ preview: boolean; body: Record<string, unknown> }> = [];
    const definitionQueries: URL[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (rawInput, init) => {
      const url = new URL(rawInput instanceof Request ? rawInput.url : String(rawInput));
      const method = init?.method ?? "GET";
      if (url.origin === "https://api.amazon.com") {
        return jsonResponse(200, { access_token: "FAKE_ACCESS", expires_in: 3_600 }, "TOKEN");
      }
      if (url.origin === "https://schema.example") {
        return jsonResponse(200, {
          type: "object",
          properties: {
            size_name: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["value"],
                properties: {
                  value: { type: "string" },
                  language_tag: { type: "string" },
                  marketplace_id: { type: "string" },
                },
              },
            },
          },
        }, "SCHEMA");
      }
      if (url.pathname.includes("/definitions/2020-09-01/productTypes/")) {
        definitionQueries.push(url);
        return jsonResponse(200, {
          schema: {
            checksum: "child-schema-checksum",
            link: { resource: "https://schema.example/child.json" },
          },
          productType: "PET_FOOD",
          marketplaceIds: [MARKETPLACE_ID],
        }, "PTD");
      }
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const preview = url.searchParams.get("mode") === "VALIDATION_PREVIEW";
        patches.push({ preview, body });
        if (!preview) state = state === "old" ? "detached" : "new";
        return jsonResponse(
          200,
          { status: preview ? "VALID" : "ACCEPTED", submissionId: `SUB-${patches.length}`, issues: [] },
          preview ? "PATCH-PREVIEW" : "PATCH-COMMIT",
        );
      }
      if (url.searchParams.has("variationParentSku")) {
        const parentSku = url.searchParams.get("variationParentSku");
        const items = parentSku === OLD_PARENT
          ? (state === "old" ? [childPayload(SOURCE_SKU, OLD_PARENT, "4 oz")] : [])
          : [
              childPayload(TARGET_CHILD, TARGET_PARENT, "10 oz"),
              ...(state === "new" ? [childPayload(SOURCE_SKU, TARGET_PARENT, "4 oz")] : []),
            ];
        return jsonResponse(200, { items, pagination: {} }, `SEARCH-${parentSku}`);
      }
      const decodedPath = decodeURIComponent(url.pathname);
      if (decodedPath.endsWith(`/${SOURCE_SKU}`)) {
        const parent = state === "old" ? OLD_PARENT : state === "new" ? TARGET_PARENT : null;
        return jsonResponse(200, childPayload(SOURCE_SKU, parent, "4 oz"), `SOURCE-${state}`);
      }
      if (decodedPath.endsWith(`/${OLD_PARENT}`)) {
        return jsonResponse(
          200,
          parentPayload(OLD_PARENT, state === "old" ? [SOURCE_SKU] : []),
          "OLD-PARENT",
        );
      }
      if (decodedPath.endsWith(`/${TARGET_PARENT}`)) {
        return jsonResponse(
          200,
          parentPayload(
            TARGET_PARENT,
            [TARGET_CHILD, ...(state === "new" ? [SOURCE_SKU] : [])],
          ),
          "TARGET-PARENT",
        );
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const preparation = await getVariationMovePreparation({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      targetParentSku: TARGET_PARENT,
    });
    expect(preparation).toMatchObject({
      sourceParentSku: OLD_PARENT,
      targetParentSku: TARGET_PARENT,
      variationTheme: "SIZE_NAME",
      dimensionNames: ["size_name"],
      writable: true,
    });
    expect(definitionQueries[0].searchParams.get("parentageLevel")).toBe("CHILD");
    expect(definitionQueries[0].searchParams.get("requirements")).toBe("LISTING");
    expect(definitionQueries[0].searchParams.get("requirementsEnforced")).toBe("ENFORCED");

    expect((await previewVariationMove(input("detach"))).status).toBe("VALID");
    const detached = await updateVariationMove(input("detach"));
    expect(detached).toMatchObject({ action: "detach", status: "ACCEPTED", verified: true });
    expect(state).toBe("detached");

    expect((await previewVariationMove(input("attach"))).status).toBe("VALID");
    const attached = await updateVariationMove(input("attach"));
    expect(attached).toMatchObject({
      action: "attach",
      status: "ACCEPTED",
      verified: true,
      targetParentSku: TARGET_PARENT,
    });
    expect(state).toBe("new");

    const commitPatches = patches.filter((patch) => !patch.preview);
    expect(commitPatches).toHaveLength(2);
    const detachPatches = commitPatches[0].body.patches as Array<Record<string, unknown>>;
    expect(detachPatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "delete", path: "/attributes/parentage_level" }),
      expect.objectContaining({ op: "delete", path: "/attributes/child_parent_sku_relationship" }),
      expect.objectContaining({ op: "delete", path: "/attributes/variation_theme" }),
    ]));
    const attachPatches = commitPatches[1].body.patches as Array<Record<string, unknown>>;
    expect(attachPatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: "add",
        path: "/attributes/child_parent_sku_relationship",
        value: [expect.objectContaining({ parent_sku: TARGET_PARENT })],
      }),
      expect.objectContaining({ path: "/attributes/size_name" }),
    ]));
  });

  it("rejects source and target/PTD evidence spliced across preparations before PATCH", async () => {
    const wire = installDetachSafetyWire({ initialState: "detached" });
    const prepareRequest = {
      action: "attach" as const,
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      targetParentSku: TARGET_PARENT,
      purpose: "mutation" as const,
    };
    const first = await variationMoveGatewayProduction.prepare(prepareRequest);
    const second = await variationMoveGatewayProduction.prepare(prepareRequest);
    if (first.action !== "attach" || second.action !== "attach" ||
        !first.source.asin || !first.source.productType ||
        !second.target.variationTheme ||
        !second.target.childSchemaChecksum) {
      throw new Error("Expected exact attach preparation evidence.");
    }

    await expect(variationMoveGatewayProduction.validationPreview({
      ...input("attach"),
      asin: first.source.asin,
      productType: first.source.productType,
      sourceEvidence: first.source.sourceEvidence,
      targetAsin: second.target.asin,
      targetEvidence: second.target.targetEvidence,
      childSchemaChecksum: second.target.childSchemaChecksum,
      ptdEvidence: second.target.ptdEvidence,
    })).rejects.toMatchObject({
      status: 409,
      code: "VARIATION_TARGET_CHANGED",
    });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("independently rejects a bound relationship at the gateway despite attachable attributes", async () => {
    const wire = installDetachSafetyWire();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (rawInput, init) => {
      const reply = await wire.fetchMock(rawInput, init);
      if ((init?.method ?? "GET") !== "GET" ||
          !decodeURIComponent(new URL(String(rawInput)).pathname).endsWith(`/${SOURCE_SKU}`)) return reply;
      const payload = await reply.json();
      delete payload.attributes.parentage_level;
      delete payload.attributes.child_parent_sku_relationship;
      return jsonResponse(reply.status, payload, "SOURCE-RELATIONSHIP-STILL-BOUND");
    }));
    const prepared = await variationMoveGatewayProduction.prepare({
      action: "attach", marketplaceId: MARKETPLACE_ID, sellerSku: SOURCE_SKU,
      targetParentSku: TARGET_PARENT, purpose: "mutation",
    });
    if (prepared.action !== "attach" || !prepared.source.asin ||
        !prepared.source.productType || !prepared.target.childSchemaChecksum) {
      throw new Error("Expected attach schema evidence without standalone authority.");
    }
    expect(prepared.source.explicitStandalone).toBe(false);
    await expect(variationMoveGatewayProduction.validationPreview({
      ...input("attach"),
      asin: prepared.source.asin,
      productType: prepared.source.productType,
      sourceEvidence: prepared.source.sourceEvidence,
      targetAsin: prepared.target.asin,
      targetEvidence: prepared.target.targetEvidence,
      childSchemaChecksum: prepared.target.childSchemaChecksum,
      ptdEvidence: prepared.target.ptdEvidence,
    })).rejects.toMatchObject({ code: "VARIATION_NOT_DETACHED" });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("binds a reconciliation snapshot to one exact source item read", async () => {
    const wire = installDetachSafetyWire({ initialState: "detached" });

    await expect(variationMoveGatewayProduction.readCanonical({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
    })).resolves.toMatchObject({
      role: "standalone",
      parentSku: null,
      familyComplete: true,
    });
    expect(wire.sourceItemReadCount()).toBe(1);
  });

  it("binds preparation source evidence and family completeness to one exact item read", async () => {
    const wire = installDetachSafetyWire();

    await expect(variationMoveGatewayProduction.prepare({
      action: "attach",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      targetParentSku: TARGET_PARENT,
      purpose: "mutation",
    })).resolves.toMatchObject({
      action: "attach",
      source: {
        sellerSku: SOURCE_SKU,
        parentSku: OLD_PARENT,
        familyComplete: true,
      },
    });
    expect(wire.sourceItemReadCount()).toBe(1);
    expect(wire.targetChildSearchReadCount()).toBe(1);
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("treats a sent HTTP 401 as unknown and never refreshes or resends", async () => {
    const wire = installDetachSafetyWire({ commitStatus: 401 });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 401,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it.each([401, 403] as const)(
    "keeps a durable HTTP %s commit unknown and blocks same-key replay",
    async (status) => {
      const wire = installDetachSafetyWire({ commitStatus: status });
      const router = await durableVariationRouter();
      const body = {
        ...input("detach"),
        idempotencyKey: `variation-sent-http-${status}`,
      };

      expect(
        (await router.handle(variationRouteRequest("POST", body))).status,
      ).toBe(200);
      const first = await router.handle(variationRouteRequest("PATCH", body));
      expect(first.status).toBe(status);
      expect(first.body.kind).toBe("json");
      if (first.body.kind !== "json") throw new Error("Expected JSON response.");
      expect(first.body.value).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });

      expect(
        (await router.handle(variationRouteRequest("POST", body))).status,
      ).toBe(200);
      const replay = await router.handle(variationRouteRequest("PATCH", body));
      expect(replay.status).toBe(409);
      expect(replay.body.kind).toBe("json");
      if (replay.body.kind !== "json") throw new Error("Expected JSON response.");
      expect(replay.body.value).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
      expect(wire.commitPatchCount()).toBe(1);
    },
  );

  it("treats a commit HTTP 429 as unknown and never resends the PATCH", async () => {
    const wire = installDetachSafetyWire({ commitStatus: 429 });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 429,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("rejects commit redirects, preserves durable unknown, and never issues a second PATCH", async () => {
    const wire = installDetachSafetyWire({ commitRedirect: true });
    const router = await durableVariationRouter();
    const body = {
      ...input("detach"),
      idempotencyKey: "variation-commit-redirect",
    };

    expect((await router.handle(variationRouteRequest("POST", body))).status)
      .toBe(200);
    const first = await router.handle(variationRouteRequest("PATCH", body));
    expect(first.status).toBe(502);
    expect(first.body.kind).toBe("json");
    if (first.body.kind !== "json") throw new Error("Expected JSON response.");
    expect(first.body.value).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(wire.lastCommitRedirectMode()).toBe("error");

    expect((await router.handle(variationRouteRequest("POST", body))).status)
      .toBe(200);
    const replay = await router.handle(variationRouteRequest("PATCH", body));
    expect(replay.status).toBe(409);
    expect(replay.body.kind).toBe("json");
    if (replay.body.kind !== "json") throw new Error("Expected JSON response.");
    expect(replay.body.value).toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("bounds a stalled commit response body and keeps the sent PATCH unknown", async () => {
    vi.useFakeTimers();
    try {
      const wire = installDetachSafetyWire({ stallCommitBody: true });
      const pending = updateVariationMove(input("detach"));
      const rejected = expect(pending).rejects.toMatchObject({
        code: "UPDATE_STATUS_UNKNOWN",
      });

      await vi.advanceTimersByTimeAsync(12_001);
      await rejected;
      expect(wire.commitPatchCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps an oversized commit response body and keeps the sent PATCH unknown", async () => {
    const wire = installDetachSafetyWire({ oversizedCommitBody: true });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("stops before PATCH with truthful pre-commit text when durable evidence cannot be saved", async () => {
    const wire = installDetachSafetyWire();
    const owner = wireOwner(
      { assertCurrent: async () => undefined },
      async () => {
        throw new Error("simulated local store failure");
      },
    );
    const response = await owner.handle({
      operation: "commit",
      request: variationRouteRequest("PATCH", {
        ...input("detach"),
        idempotencyKey: "wire-durable-evidence-failure",
      }),
    });

    expect(response.status).toBe(500);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response.");
    expect(response.body.value).toMatchObject({ code: "PRECOMMIT_FAILED" });
    expect(JSON.stringify(response.body.value)).toContain("尚未送出");
    expect(JSON.stringify(response.body.value)).not.toContain("Amazon 已接受");
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("rechecks the final fence after durable evidence persistence and sends no PATCH", async () => {
    let current = true;
    const wire = installDetachSafetyWire();
    const owner = wireOwner(
      {
        assertCurrent: async () => {
          if (!current) {
            throw new SpExecutionContextError(
              "SP_CONTEXT_INVALIDATED",
              "Amazon 執行環境已更新；請重新開始這次操作。",
            );
          }
        },
      },
      async () => {
        current = false;
      },
    );
    const response = await owner.handle({
      operation: "commit",
      request: variationRouteRequest("PATCH", {
        ...input("detach"),
        idempotencyKey: "wire-post-evidence-final-fence",
      }),
    });

    expect(response.status).toBe(409);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response.");
    expect(response.body.value).toMatchObject({ code: "SP_CONTEXT_INVALIDATED" });
    expect(wire.commitPatchCount()).toBe(0);
  });

  it.each([
    ["null payload", null],
    ["malformed issues", { status: "ACCEPTED", issues: "not-an-array" }],
    ["unknown status", { status: "MYSTERY", issues: [] }],
    ["malformed INVALID", {
      status: "INVALID",
      issues: [{ severity: "ERROR" }],
    }],
  ])("treats a 2xx %s as unknown after exactly one commit PATCH", async (
    _label,
    commitPayload,
  ) => {
    const wire = installDetachSafetyWire({ commitPayload });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("treats an exact 2xx INVALID as a known rejection", async () => {
    const wire = installDetachSafetyWire({
      commitPayload: { status: "INVALID", issues: [] },
    });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 422,
      code: "UPDATE_REJECTED",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("does not misclassify a well-formed ACCEPTED plus ERROR as rejection", async () => {
    const wire = installDetachSafetyWire({
      commitPayload: {
        status: "ACCEPTED",
        submissionId: "SUB-ACCEPTED-ERROR",
        issues: [{
          code: "RELATIONSHIP_WARNING",
          severity: "ERROR",
          message: "Amazon accepted this write with an issue.",
          attributeNames: ["variation_theme"],
          categories: [],
          marketplaceIds: [MARKETPLACE_ID],
        }],
      },
    });

    await expect(updateVariationMove(input("detach"))).resolves.toMatchObject({
      status: "ACCEPTED",
      verified: true,
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it.each([
    { status: 429 as const, code: "RATE_LIMITED" },
    { status: 500 as const, code: "UPSTREAM_UNAVAILABLE" },
  ])(
    "releases the durable claim when the pre-commit preview returns $status",
    async ({ status, code }) => {
      const wire = installDetachSafetyWire({
        preCommitPreviewFailureStatus: status,
      });
      const router = await durableVariationRouter();
      const body = {
        ...input("detach"),
        idempotencyKey: `variation-precommit-${status}`,
      };

      expect(
        (await router.handle(variationRouteRequest("POST", body))).status,
      ).toBe(200);
      const firstCommit = await router.handle(
        variationRouteRequest("PATCH", body),
      );
      expect(firstCommit.status).toBe(status);
      expect(firstCommit.body.kind).toBe("json");
      if (firstCommit.body.kind !== "json") throw new Error("Expected JSON response");
      expect(firstCommit.body.value).toMatchObject({ code });
      expect(JSON.stringify(firstCommit.body.value)).toContain(
        "正式 commit PATCH 尚未送出",
      );
      expect(wire.previewPatchCount()).toBe(4);
      expect(wire.commitPatchCount()).toBe(0);

      expect(
        (await router.handle(variationRouteRequest("POST", body))).status,
      ).toBe(200);
      const retriedCommit = await router.handle(
        variationRouteRequest("PATCH", body),
      );
      expect(retriedCommit.status).toBe(200);
      expect(wire.commitPatchCount()).toBe(1);
    },
  );

  it("releases the durable claim when LWA token acquisition fails before commit fetch", async () => {
    const wire = installDetachSafetyWire({ failCommitTokenOnce: true });
    const router = await durableVariationRouter();
    const body = {
      ...input("detach"),
      idempotencyKey: "variation-precommit-token",
    };

    expect((await router.handle(variationRouteRequest("POST", body))).status)
      .toBe(200);
    const firstCommit = await router.handle(variationRouteRequest("PATCH", body));
    expect(firstCommit.status).toBe(500);
    expect(firstCommit.body.kind).toBe("json");
    if (firstCommit.body.kind !== "json") throw new Error("Expected JSON response.");
    expect(firstCommit.body.value).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(JSON.stringify(firstCommit.body.value)).toContain(
      "正式 commit PATCH 尚未送出",
    );
    expect(wire.commitPatchCount()).toBe(0);

    expect((await router.handle(variationRouteRequest("POST", body))).status)
      .toBe(200);
    expect((await router.handle(variationRouteRequest("PATCH", body))).status)
      .toBe(200);
    expect(wire.commitPatchCount()).toBe(1);
  });

  it.each(["forbidden", "rate_limited", "transport"] as const)(
    "turns an accepted commit followed by %s readback failure into unknown",
    async (readbackFailure) => {
      const wire = installDetachSafetyWire({ readbackFailure });

      await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
        status: 503,
        code: "UPDATE_STATUS_UNKNOWN",
        operation: "getListingsItem",
      });
      expect(wire.commitPatchCount()).toBe(1);
    },
  );

  it("keeps the durable claim unknown when context changes after the commit PATCH", async () => {
    const wire = installDetachSafetyWire();
    const directory = await mkdtemp(join(tmpdir(), "amz-api-variation-context-"));
    const store = new LocalStore(join(directory, "store.json"));
    await store.initialize();
    const operation = () => store.runIdempotentOperation({
      idempotencyKey: "variation-context-after-accepted",
      operationType: "variation_detach" as const,
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SOURCE_SKU,
      accountScope: "variation-context-account",
      fingerprint: "variation-context-fingerprint",
      execute: () => updateVariationMove(input("detach"), {
        assertCurrent: async () => {
          if (wire.commitPatchCount() > 0) {
            throw new SpExecutionContextError(
              "SP_CONTEXT_INVALIDATED",
              "Amazon 執行環境已更新；請重新開始這次操作。",
            );
          }
        },
      }),
    });

    await expect(operation()).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);

    await expect(operation()).rejects.toMatchObject({
      status: 409,
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("blocks attach before preview when relationships still name the old parent", async () => {
    const wire = installDetachSafetyWire({
      initialState: "detached",
      relationshipOnlyOldParentWhenDetached: true,
    });

    await expect(previewVariationMove(input("attach"))).rejects.toMatchObject({
      status: 409,
      code: "VARIATION_NOT_DETACHED",
    });
    expect(wire.previewPatchCount()).toBe(0);
    expect(wire.commitPatchCount()).toBe(0);
  });

  it("does not verify detach from empty attributes while normalized relationships remain bound", async () => {
    const wire = installDetachSafetyWire({
      relationshipOnlyOldParentWhenDetached: true,
      readbackFailure: "transport",
      readbackFailureAfterDetachedReads: 2,
    });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 503,
      code: "UPDATE_STATUS_UNKNOWN",
      operation: "getListingsItem",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("does not verify detach while the current-market parentage attribute remains", async () => {
    const wire = installDetachSafetyWire({
      residualParentageWhenDetached: true,
    });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("does not verify attach when the current-market parentage attribute is missing", async () => {
    const wire = installDetachSafetyWire({
      initialState: "detached",
      commitResultState: "new",
      omitParentageWhenNew: true,
    });

    await expect(updateVariationMove(input("attach"))).rejects.toMatchObject({
      code: "UPDATE_STATUS_UNKNOWN",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("ignores non-current-market dimension values during attach and readback", async () => {
    const wire = installDetachSafetyWire({
      initialState: "detached",
      commitResultState: "new",
      mixedMarketplaceDimensions: true,
    });

    await expect(updateVariationMove(input("attach"))).resolves.toMatchObject({
      action: "attach",
      verified: true,
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("accepts a supported root-ref CHILD PTD without requiring top-level properties", async () => {
    const wire = installDetachSafetyWire({
      initialState: "detached",
      commitResultState: "new",
      rootRefChildSchema: true,
    });

    await expect(updateVariationMove(input("attach"))).resolves.toMatchObject({
      action: "attach",
      verified: true,
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("fails closed before preview when relationships and attributes name different parents", async () => {
    const wire = installDetachSafetyWire({ conflictingSourceParent: true });

    await expect(
      getVariationMovePreparation({
        marketplaceId: MARKETPLACE_ID,
        sellerSku: SOURCE_SKU,
        targetParentSku: TARGET_PARENT,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VARIATION_RELATIONSHIP_CONFLICT",
    });
    expect(wire.commitPatchCount()).toBe(0);
  });
});
