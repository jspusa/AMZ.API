import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeStorage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(() => true),
  encryptStringAsync: vi.fn(async (value: string) =>
    Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`),
  ),
  decryptStringAsync: vi.fn(async (value: Buffer) => {
    const raw = value.toString();
    return {
      result: Buffer.from(raw.slice("encrypted:".length), "base64").toString(),
      shouldReEncrypt: false,
    };
  }),
}));

vi.mock("electron", () => ({ safeStorage }));

import { AdvertisingCredentialVault } from "../src/main/advertising-credential-vault";

describe("dedicated Amazon Ads credential vault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores only encrypted bytes in its independent ads file and returns a redacted summary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-ads-vault-"));
    const filePath = join(directory, "ads-credentials.enc");
    const vault = new AdvertisingCredentialVault(filePath);
    const input = {
      lwaClientId: "ads-client-id-test",
      lwaClientSecret: "ads-client-secret-test",
      refreshToken: "ads-refresh-token-test",
      oauthRegion: "na" as const,
    };

    const summary = await vault.save(input);
    const bytes = await readFile(filePath);
    const persisted = bytes.toString();

    expect(summary).toMatchObject({
      configured: true,
      lwaConfigured: true,
      refreshTokenConfigured: true,
      oauthRegion: "na",
    });
    expect(summary).not.toHaveProperty("lwaClientId");
    expect(summary).not.toHaveProperty("lwaClientSecret");
    expect(summary).not.toHaveProperty("refreshToken");
    expect(persisted).not.toContain(input.lwaClientId);
    expect(persisted).not.toContain(input.lwaClientSecret);
    expect(persisted).not.toContain(input.refreshToken);
    expect(filePath.endsWith("ads-credentials.enc")).toBe(true);
  });

  it("rejects an empty or partial first save instead of creating a misleading vault", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-ads-vault-"));
    const vault = new AdvertisingCredentialVault(join(directory, "ads-credentials.enc"));

    await expect(vault.save({ oauthRegion: "eu" })).rejects.toThrow("必須全部填寫");
    await expect(vault.save({ lwaClientId: "only-one-field" })).rejects.toThrow("必須全部填寫");
  });

  it("clears only the Ads vault summary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-ads-vault-"));
    const vault = new AdvertisingCredentialVault(join(directory, "ads-credentials.enc"));
    await vault.save({
      lwaClientId: "ads-client-id-test",
      lwaClientSecret: "ads-client-secret-test",
      refreshToken: "ads-refresh-token-test",
      oauthRegion: "fe",
    });

    await expect(vault.clear()).resolves.toMatchObject({
      hasVault: false,
      configured: false,
      oauthRegion: "na",
    });
  });
});
