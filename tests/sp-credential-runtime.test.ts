import { describe, expect, it, vi } from "vitest";
import { createSpCredentialRuntime } from
  "../src/main/amazon/sp-credential-runtime";

const US_MARKETPLACE_ID = "ATVPDKIKX0DER" as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configuredEnvironment(): Map<string, string> {
  return new Map([
    ["SP_API_LWA_CLIENT_ID", "FAKE_CLIENT_ID"],
    ["SP_API_LWA_CLIENT_SECRET", "FAKE_CLIENT_SECRET"],
    ["SP_API_REFRESH_TOKEN_NA", "FAKE_REFRESH_TOKEN_NA"],
    ["SP_API_SELLER_ID_NA", "FAKE_MERCHANT_TOKEN_NA"],
  ]);
}

describe("SP-API credential runtime", () => {
  it("resolves call-time regional configuration and the exact demo-mode rules", () => {
    const environment = new Map<string, string>();
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
    });

    expect(runtime.isConfiguredForMarketplace(US_MARKETPLACE_ID)).toBe(false);
    expect(runtime.usesDemoMode(US_MARKETPLACE_ID)).toBe(true);
    expect(runtime.replenishmentSkillConnected()).toBe(false);

    environment.set("AMAZON_REPLENISHMENT_SKILL_URL", "   ");
    expect(runtime.replenishmentSkillConnected()).toBe(false);
    environment.set(
      "AMAZON_REPLENISHMENT_SKILL_URL",
      "https://skills.example.test/replenishment",
    );
    expect(runtime.replenishmentSkillConnected()).toBe(true);

    environment.set("SP_API_LWA_CLIENT_ID", "FAKE_CLIENT_ID");
    environment.set("SP_API_LWA_CLIENT_SECRET", "FAKE_CLIENT_SECRET");
    environment.set("SP_API_REFRESH_TOKEN", "FAKE_SHARED_REFRESH_TOKEN");
    environment.set("SP_API_SELLER_ID", "FAKE_SHARED_MERCHANT_TOKEN");

    expect(runtime.isConfiguredForMarketplace(US_MARKETPLACE_ID)).toBe(true);
    expect(runtime.usesDemoMode(US_MARKETPLACE_ID)).toBe(false);
    expect(runtime.getSellerId("na")).toBe("FAKE_SHARED_MERCHANT_TOKEN");

    environment.set("SP_API_SELLER_ID_NA", "FAKE_REGIONAL_MERCHANT_TOKEN");
    environment.set("SP_API_MODE", "DeMo");

    expect(runtime.getSellerId("na")).toBe("FAKE_REGIONAL_MERCHANT_TOKEN");
    expect(runtime.usesDemoMode(US_MARKETPLACE_ID)).toBe(true);
  });

  it.each([
    {
      sellerId: US_MARKETPLACE_ID,
      message:
        "目前保存的 Seller ID 是 Marketplace ID；請在 Seller Central 重新貼入 Merchant Token。",
    },
    {
      sellerId: "FAKE MERCHANT TOKEN",
      message:
        "目前保存的 Seller ID 含有空白或不可見字元；請重新複製 Merchant Token。",
    },
  ])("rejects invalid Seller ID '$sellerId'", ({ sellerId, message }) => {
    const environment = configuredEnvironment();
    environment.set("SP_API_SELLER_ID_NA", sellerId);
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
    });

    expect(() => runtime.getSellerId("na")).toThrowError(message);
    try {
      runtime.getSellerId("na");
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        code: "INVALID_SELLER_ID",
      });
    }
  });

  it("does not confuse inherited object names with Marketplace IDs", () => {
    const environment = configuredEnvironment();
    environment.set("SP_API_SELLER_ID_NA", "constructor");
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
    });

    expect(runtime.getSellerId("na")).toBe("constructor");
  });

  it("single-flights, caches, invalidates and clears regional LWA tokens", async () => {
    const environment = configuredEnvironment();
    let currentTime = 1_000;
    let releaseFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => firstResponse)
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "FAKE_ACCESS_TOKEN_2",
        expires_in: 3_600,
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: "FAKE_ACCESS_TOKEN_3",
        expires_in: 3_600,
      }));
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
      fetch,
      now: () => currentTime,
    });

    const first = runtime.requestAccessToken("na");
    const joined = runtime.requestAccessToken("na");
    expect(fetch).toHaveBeenCalledTimes(1);

    releaseFirst?.(jsonResponse(200, {
      access_token: "FAKE_ACCESS_TOKEN_1",
      expires_in: 3_600,
    }));
    await expect(Promise.all([first, joined])).resolves.toEqual([
      "FAKE_ACCESS_TOKEN_1",
      "FAKE_ACCESS_TOKEN_1",
    ]);
    await expect(runtime.requestAccessToken("na"))
      .resolves.toBe("FAKE_ACCESS_TOKEN_1");
    expect(fetch).toHaveBeenCalledTimes(1);

    runtime.invalidateAccessToken("na");
    await expect(runtime.requestAccessToken("na"))
      .resolves.toBe("FAKE_ACCESS_TOKEN_2");
    expect(fetch).toHaveBeenCalledTimes(2);

    currentTime += 1;
    expect(runtime.credentialGeneration()).toBe(0);
    runtime.clearCredentialCaches();
    expect(runtime.credentialGeneration()).toBe(1);
    await expect(runtime.requestAccessToken("na"))
      .resolves.toBe("FAKE_ACCESS_TOKEN_3");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails closed when credentials change during an LWA request", async () => {
    const environment = configuredEnvironment();
    let release: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => pendingResponse);
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
      fetch,
    });

    const stale = runtime.requestAccessToken("na");
    expect(fetch).toHaveBeenCalledTimes(1);
    runtime.clearCredentialCaches();
    release?.(jsonResponse(200, {
      access_token: "FAKE_STALE_ACCESS_TOKEN",
      expires_in: 3_600,
    }));

    await expect(stale).rejects.toMatchObject({
      status: 409,
      code: "CREDENTIALS_CHANGED",
      message: "Amazon 憑證已在連線期間更新，請重新執行這次查詢。",
    });
  });

  it("aborts LWA after the exact timeout and preserves its public error", async () => {
    const environment = configuredEnvironment();
    let timeoutHandler: (() => void) | undefined;
    const setTimeout = vi.fn((handler: () => void, delay?: number) => {
      timeoutHandler = handler;
      expect(delay).toBe(10_000);
      return 7 as unknown as ReturnType<typeof globalThis.setTimeout>;
    });
    const clearTimeout = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }));
    const runtime = createSpCredentialRuntime({
      readEnvironment: (key) => environment.get(key),
      fetch,
      setTimeout,
      clearTimeout,
    });

    const token = runtime.requestAccessToken("na");
    expect(setTimeout).toHaveBeenCalledTimes(1);
    timeoutHandler?.();

    await expect(token).rejects.toMatchObject({
      status: 504,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Amazon LWA 驗證逾時，請稍後再試。",
    });
    expect(clearTimeout).toHaveBeenCalledWith(7);
  });
});
