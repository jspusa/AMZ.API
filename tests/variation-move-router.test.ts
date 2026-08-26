import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { invalidateSpApiCredentialCaches } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-TRKY-4OZ";
const SOURCE_PARENT = "DEMO-US-TURKEY-PARENT";
const TARGET_PARENT = "DEMO-US-CHICKEN-PARENT";
const savedMode = process.env.SP_API_MODE;

function getRequest(): ApiRequest {
  return {
    requestId: "variation-move-get-001",
    method: "GET",
    path: "/api/sp-api/variation-move",
    query: {
      marketplaceId: MARKETPLACE_ID,
      sku: SELLER_SKU,
      targetSku: TARGET_PARENT,
    },
    headers: {},
  };
}

function writeRequest(method: "POST" | "PATCH", body: Record<string, unknown>): ApiRequest {
  return {
    requestId: `variation-move-${method.toLowerCase()}-001`,
    method,
    path: "/api/sp-api/variation-move",
    query: {},
    headers: { "content-type": "application/json" },
    body: { kind: "json", value: body },
  };
}

function detachBody() {
  return {
    action: "detach",
    marketplaceId: MARKETPLACE_ID,
    sellerSku: SELLER_SKU,
    expectedSourceParentSku: SOURCE_PARENT,
    targetParentSku: null,
    variationTheme: null,
    dimensionNames: [],
    dimensionValues: {},
    idempotencyKey: "variation-detach-test-001",
  };
}

describe("variation move preview and Touch ID routes", () => {
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const runIdempotentOperation = vi.fn(async (input: {
    operationType: string;
    execute(control: Readonly<{
      recordAccepted(value: unknown): Promise<void>;
    }>): Promise<unknown>;
  }) => input.execute({ recordAccepted: async () => undefined }));
  const router = new ApiRouter({
    store: { runIdempotentOperation } as unknown as LocalStore,
    vault: {
      getAccountScope: async () => "variation-move-test-scope",
    } as unknown as CredentialVault,
    approveWrite,
  });

  beforeEach(() => {
    process.env.SP_API_MODE = "demo";
    invalidateSpApiCredentialCaches();
    approveWrite.mockReset();
    approveWrite.mockResolvedValue(undefined);
    runIdempotentOperation.mockClear();
    router.dispose();
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.SP_API_MODE;
    else process.env.SP_API_MODE = savedMode;
    invalidateSpApiCredentialCaches();
  });

  it("returns target CHILD PTD-style fields without claiming demo writes", async () => {
    const response = await router.handle(getRequest());

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("json");
    if (response.body.kind !== "json") throw new Error("Expected JSON response");
    expect(response.body.value).toMatchObject({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      sourceParentSku: SOURCE_PARENT,
      targetParentSku: TARGET_PARENT,
      variationTheme: "SIZE_NAME",
      dimensionNames: ["size_name"],
      writable: false,
    });
    expect((response.body.value as { fields: unknown[] }).fields).toHaveLength(1);
  });

  it("reserves the exact preview then invokes native approval and durable detach idempotency", async () => {
    const body = detachBody();
    expect((await router.handle(writeRequest("POST", body))).status).toBe(200);

    const commit = await router.handle(writeRequest("PATCH", body));

    expect(commit.status).toBe(200);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0]?.[0]).toContain(SELLER_SKU);
    expect(approveWrite.mock.calls[0]?.[0]).toContain(SOURCE_PARENT);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
    expect(runIdempotentOperation.mock.calls[0]?.[0]).toMatchObject({
      operationType: "variation_detach",
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
  });

  it("rejects target data smuggled into the detach stage before native approval", async () => {
    const body = detachBody();
    expect((await router.handle(writeRequest("POST", body))).status).toBe(200);

    const commit = await router.handle(writeRequest("PATCH", {
      ...body,
      targetParentSku: TARGET_PARENT,
      variationTheme: "SIZE_NAME",
      dimensionNames: ["size_name"],
      dimensionValues: { size_name: [{ value: "10 oz" }] },
    }));

    expect(commit.status).toBe(400);
    expect(commit.body.kind).toBe("json");
    if (commit.body.kind !== "json") throw new Error("Expected JSON response");
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("releases the reserved preview ticket when Touch ID is cancelled", async () => {
    const body = detachBody();
    approveWrite.mockRejectedValueOnce(new Error("userCancel"));
    expect((await router.handle(writeRequest("POST", body))).status).toBe(200);

    const cancelled = await router.handle(writeRequest("PATCH", body));
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.kind).toBe("json");
    if (cancelled.body.kind !== "json") throw new Error("Expected JSON response");
    expect(cancelled.body.value).toMatchObject({ code: "ACTION_CANCELLED" });
    expect(runIdempotentOperation).not.toHaveBeenCalled();

    const retriedApproval = await router.handle(writeRequest("PATCH", body));
    expect(retriedApproval.status).toBe(200);
    expect(approveWrite).toHaveBeenCalledTimes(2);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
  });

  it("rejects undeclared dimension keys before preview or approval", async () => {
    const response = await router.handle(writeRequest("POST", {
      ...detachBody(),
      dimensionValues: {
        size_name: [{ value: "4 oz" }],
        secret_field: [{ value: "must not pass" }],
      },
    }));

    expect(response.status).toBe(400);
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });
});
