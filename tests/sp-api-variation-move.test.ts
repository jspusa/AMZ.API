import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import {
  getVariationMovePreparation,
  invalidateSpApiCredentialCaches,
  previewVariationMove,
  updateVariationMove,
  type VariationMoveInput,
} from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import { LocalStore } from "../src/main/local-store";
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

function childPayload(
  sku: string,
  parentSku: string | null,
  size: string,
) {
  return {
    sku,
    summaries: [{
      marketplaceId: MARKETPLACE_ID,
      asin: `ASIN-${sku}`,
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
  commitStatus?: 200 | 401 | 429;
  readbackFailure?: "forbidden" | "rate_limited" | "transport";
  readbackFailureAfterDetachedReads?: number;
  conflictingSourceParent?: boolean;
  preCommitPreviewFailureStatus?: 429 | 500;
  initialState?: RelationshipState;
  relationshipOnlyOldParentWhenDetached?: boolean;
};

function installDetachSafetyWire(options: SafetyWireOptions = {}) {
  let state: RelationshipState = options.initialState ?? "old";
  let commitPatches = 0;
  let previewPatches = 0;
  let detachedReads = 0;
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
      }, "SCHEMA");
    }
    if (url.pathname.includes("/definitions/2020-09-01/productTypes/")) {
      return jsonResponse(200, {
        schema: {
          checksum: "child-schema-checksum",
          link: { resource: "https://schema.example/child.json" },
        },
        productType: "PET_FOOD",
      }, "PTD");
    }
    if (method === "PATCH") {
      const preview = url.searchParams.get("mode") === "VALIDATION_PREVIEW";
      if (preview) {
        previewPatches += 1;
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
      const status = options.commitStatus ?? 200;
      if (status === 200) state = "detached";
      return status === 200
        ? jsonResponse(200, { status: "ACCEPTED", submissionId: "SUB-COMMIT", issues: [] }, "PATCH-COMMIT")
        : jsonResponse(status, { errors: [{ code: `HTTP_${status}`, message: "commit rejected" }] }, `PATCH-${status}`);
    }
    if (url.searchParams.has("variationParentSku")) {
      const parentSku = url.searchParams.get("variationParentSku");
      return jsonResponse(200, {
        items: parentSku === OLD_PARENT
          ? (state === "old" ? [childPayload(SOURCE_SKU, OLD_PARENT, "4 oz")] : [])
          : [childPayload(TARGET_CHILD, TARGET_PARENT, "10 oz")],
        pagination: {},
      }, `SEARCH-${parentSku}`);
    }
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.endsWith(`/${SOURCE_SKU}`)) {
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
        state === "old" ? OLD_PARENT : null,
        "4 oz",
      );
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
      return jsonResponse(200, parentPayload(TARGET_PARENT, [TARGET_CHILD]), "TARGET-PARENT");
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    commitPatchCount: () => commitPatches,
    previewPatchCount: () => previewPatches,
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

async function durableVariationRouter(): Promise<ApiRouter> {
  const directory = await mkdtemp(join(tmpdir(), "amz-api-variation-precommit-"));
  const store = new LocalStore(join(directory, "store.json"));
  await store.initialize();
  return new ApiRouter({
    store,
    vault: {
      getAccountScope: async () => "variation-precommit-test-scope",
    } as unknown as CredentialVault,
    approveWrite: async () => undefined,
  });
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

  it("never refreshes or resends a commit PATCH after HTTP 401", async () => {
    const wire = installDetachSafetyWire({ commitStatus: 401 });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(wire.commitPatchCount()).toBe(1);
  });

  it("treats a commit HTTP 429 as unknown and never resends the PATCH", async () => {
    const wire = installDetachSafetyWire({ commitStatus: 429 });

    await expect(updateVariationMove(input("detach"))).rejects.toMatchObject({
      status: 429,
      code: "UPDATE_STATUS_UNKNOWN",
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
