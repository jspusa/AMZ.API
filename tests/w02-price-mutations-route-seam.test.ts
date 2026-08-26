import { describe, expect, it, vi } from "vitest";
import { ApiRouter } from "../src/main/api-router";
import type { CredentialVault } from "../src/main/credential-vault";
import type { LocalStore } from "../src/main/local-store";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";

type PriceMutationCommand =
  | Readonly<{
      family: "standard-price";
      operation: "read" | "preview" | "commit";
      request: ApiRequest;
    }>
  | Readonly<{
      family: "sale-price";
      operation: "preview" | "commit";
      request: ApiRequest;
    }>;

type WithoutRequest<T> = T extends { request: ApiRequest }
  ? Omit<T, "request">
  : never;

type RouteCase = Readonly<{
  label: string;
  request: ApiRequest;
  expected: WithoutRequest<PriceMutationCommand>;
}>;

const INVALID_PRICE_BODY: ApiRequest["body"] = {
  kind: "json",
  value: { marketplaceId: "invalid" },
};

const CASES: readonly RouteCase[] = [
  {
    label: "standard price read",
    request: {
      requestId: "w02-standard-read-001",
      method: "GET",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
    },
    expected: { family: "standard-price", operation: "read" },
  },
  {
    label: "standard price preview",
    request: {
      requestId: "w02-standard-preview-001",
      method: "POST",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: INVALID_PRICE_BODY,
    },
    expected: { family: "standard-price", operation: "preview" },
  },
  {
    label: "standard price commit",
    request: {
      requestId: "w02-standard-commit-001",
      method: "PATCH",
      path: "/api/sp-api/listings",
      query: {},
      headers: {},
      body: INVALID_PRICE_BODY,
    },
    expected: { family: "standard-price", operation: "commit" },
  },
  {
    label: "sale price preview",
    request: {
      requestId: "w02-sale-preview-001",
      method: "POST",
      path: "/api/sp-api/sale-price",
      query: {},
      headers: {},
      body: INVALID_PRICE_BODY,
    },
    expected: { family: "sale-price", operation: "preview" },
  },
  {
    label: "sale price commit",
    request: {
      requestId: "w02-sale-commit-001",
      method: "PATCH",
      path: "/api/sp-api/sale-price",
      query: {},
      headers: {},
      body: INVALID_PRICE_BODY,
    },
    expected: { family: "sale-price", operation: "commit" },
  },
];

describe("W02 price mutation public route seam", () => {
  it.each(CASES)("delegates $label to the price mutation owner", async ({
    request,
    expected,
  }) => {
    const sentinel: ApiResponse = {
      status: 207,
      headers: { "x-w02-owner": "price-mutations" },
      body: { kind: "json", value: { delegated: true } },
    };
    const handle = vi.fn(async (_command: PriceMutationCommand) => sentinel);
    const priceMutations = { handle };
    const router = new ApiRouter({
      store: {} as LocalStore,
      vault: {} as CredentialVault,
      approveWrite: async () => undefined,
      priceMutations,
    } as unknown as ConstructorParameters<typeof ApiRouter>[0]);

    const response = await router.handle(request);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ ...expected, request });
    expect(handle.mock.calls[0]?.[0].request).toBe(request);
    expect(response).toBe(sentinel);
  });
});
