import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import { listingContentGatewayProduction } from "../src/main/amazon/sp-api";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest } from "../src/shared/contracts";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const SELLER_SKU = "AFA-TRKY-4OZ";
const IDEMPOTENCY_KEY = "content-touchid-test-001";
const SP_ENV_KEYS = Object.keys(process.env).filter((key) =>
  key.startsWith("SP_API_"),
);
const savedEnvironment = new Map(
  SP_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function request(
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): ApiRequest {
  return {
    requestId: `content-touchid-${method.toLowerCase()}-001`,
    method,
    path: "/api/sp-api/listing-content",
    query: {},
    headers: { "content-type": "application/json" },
    body: { kind: "json", value: body },
  };
}

async function readListingContentSnapshot(input: Readonly<{
  marketplaceId: "ATVPDKIKX0DER";
  sellerSku: string;
}>) {
  return (await listingContentGatewayProduction.read(input, "read-only"))
    .snapshot;
}

describe("listing content Touch ID commit route", () => {
  const approveWrite = vi.fn(async (_reason: string) => undefined);
  const runIdempotentOperation = vi.fn(async (rawInput: unknown) => {
    const input = rawInput as Readonly<{
      execute(control: Readonly<{
        recordAccepted(response: unknown): Promise<void>;
      }>): Promise<unknown>;
    }>;
    return input.execute({ recordAccepted: async () => undefined });
  });
  const router = new ApiRouter({
    store: { runIdempotentOperation } as unknown as LocalStore,
    vault: {
      getAccountScope: async () => "content-touchid-test-scope",
    } as unknown as CredentialVault,
    approveWrite,
  });

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    approveWrite.mockReset();
    approveWrite.mockResolvedValue(undefined);
    runIdempotentOperation.mockClear();
    router.dispose();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SP_API_")) delete process.env[key];
    }
    for (const [key, value] of savedEnvironment) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("commits after native approval without a confirmationSku field", async () => {
    const listing = await readListingContentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedTitle: listing.title,
      expectedItemHighlight: listing.itemHighlight,
      expectedBulletPoints: listing.bulletPoints,
      expectedProductDescription: listing.productDescription,
      expectedIngredients: listing.ingredients,
      title: `${listing.title} Touch ID test`,
      itemHighlight: listing.itemHighlight,
      bulletPoints: listing.bulletPoints,
      productDescription: listing.productDescription,
      ingredients: listing.ingredients,
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const preview = await router.handle(request("POST", body));
    expect(preview.status).toBe(200);

    const commit = await router.handle(request("PATCH", body));
    expect(commit.status).toBe(200);
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(approveWrite.mock.calls[0]?.[0]).toContain(SELLER_SKU);
    expect(runIdempotentOperation).toHaveBeenCalledOnce();
  });

  it("rejects content changed after preview before requesting native approval", async () => {
    const listing = await readListingContentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedTitle: listing.title,
      expectedItemHighlight: listing.itemHighlight,
      expectedBulletPoints: listing.bulletPoints,
      expectedProductDescription: listing.productDescription,
      expectedIngredients: listing.ingredients,
      title: `${listing.title} previewed`,
      itemHighlight: listing.itemHighlight,
      bulletPoints: listing.bulletPoints,
      productDescription: listing.productDescription,
      ingredients: listing.ingredients,
      idempotencyKey: `${IDEMPOTENCY_KEY}-tamper`,
    };

    expect((await router.handle(request("POST", body))).status).toBe(200);
    const commit = await router.handle(
      request("PATCH", { ...body, title: `${listing.title} tampered` }),
    );

    expect(commit.status).toBe(409);
    expect(commit.body.kind).toBe("json");
    if (commit.body.kind !== "json") throw new Error("Expected JSON response");
    expect(commit.body.value).toMatchObject({ code: "PREVIEW_CHANGED" });
    expect(approveWrite).not.toHaveBeenCalled();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });

  it("does not commit when native approval is cancelled", async () => {
    const listing = await readListingContentSnapshot({
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
    });
    const body = {
      marketplaceId: MARKETPLACE_ID,
      sellerSku: SELLER_SKU,
      expectedTitle: listing.title,
      expectedItemHighlight: listing.itemHighlight,
      expectedBulletPoints: listing.bulletPoints,
      expectedProductDescription: listing.productDescription,
      expectedIngredients: listing.ingredients,
      title: `${listing.title} cancelled`,
      itemHighlight: listing.itemHighlight,
      bulletPoints: listing.bulletPoints,
      productDescription: listing.productDescription,
      ingredients: listing.ingredients,
      idempotencyKey: `${IDEMPOTENCY_KEY}-cancel`,
    };
    approveWrite.mockRejectedValueOnce(new Error("userCancel"));

    expect((await router.handle(request("POST", body))).status).toBe(200);
    const commit = await router.handle(request("PATCH", body));

    expect(commit.status).toBe(409);
    expect(commit.body.kind).toBe("json");
    if (commit.body.kind !== "json") throw new Error("Expected JSON response");
    expect(commit.body.value).toMatchObject({ code: "ACTION_CANCELLED" });
    expect(approveWrite).toHaveBeenCalledOnce();
    expect(runIdempotentOperation).not.toHaveBeenCalled();
  });
});
