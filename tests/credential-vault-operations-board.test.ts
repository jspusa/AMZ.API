import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeStorage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(() => true),
  encryptStringAsync: vi.fn(async (value: string) =>
    Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`)),
  decryptStringAsync: vi.fn(async (value: Buffer) => {
    const raw = value.toString();
    return {
      result: Buffer.from(raw.slice("encrypted:".length), "base64").toString(),
      shouldReEncrypt: false,
    };
  }),
}));

const fsFault = vi.hoisted(() => ({ unlinkPath: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: vi.fn(async (filePath: string) => {
      if (filePath === fsFault.unlinkPath) {
        throw Object.assign(new Error("simulated main vault unlink failure"), {
          code: "EACCES",
        });
      }
      return actual.unlink(filePath);
    }),
  };
});

vi.mock("electron", () => ({ safeStorage }));

import { CredentialVault } from "../src/main/credential-vault";

function encrypted(value: unknown): Buffer {
  return Buffer.from(`encrypted:${Buffer.from(JSON.stringify(value)).toString("base64")}`);
}

describe("operations board reader configuration", () => {
  beforeEach(() => {
    fsFault.unlinkPath = null;
    vi.clearAllMocks();
  });

  it("stores a standalone public board URL without creating R2 writer credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-reader-vault-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);

    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });

    await expect(vault.getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/team");
    await expect(vault.getImageStorage()).resolves.toBeNull();
    expect((await readFile(filePath)).toString()).not.toContain("assets.example.com");
    expect((await readFile(vault.operationsBoardFilePath)).toString())
      .not.toContain("assets.example.com");
  });

  it("keeps credentials.enc byte-schema readable by the v0.1.47 backup after a board URL save", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-downgrade-vault-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);

    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });

    const decrypted = await safeStorage.decryptStringAsync(await readFile(filePath));
    const oldReader = JSON.parse(decrypted.result) as Record<string, unknown>;
    expect(Object.keys(oldReader).sort()).toEqual([
      "imageStorage",
      "lwaClientId",
      "lwaClientSecret",
      "regions",
      "replenishmentSkillUrl",
      "updatedAt",
      "version",
    ]);
    expect(oldReader).not.toHaveProperty("operationsBoardPublicBaseUrl");
    await expect(new CredentialVault(filePath).getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/team");
  });

  it("does not resurrect an orphaned board URL after a v0.1.47 clear", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-legacy-clear-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });

    await unlink(filePath);

    await expect(new CredentialVault(filePath).getOperationsBoardPublicBaseUrl())
      .resolves.toBeNull();
    await expect(readFile(vault.operationsBoardFilePath)).resolves.toBeInstanceOf(Buffer);
  });

  it("rejects a stale board sidecar after a v0.1.47 credential save", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-legacy-resave-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });
    await writeFile(filePath, encrypted({
      version: 1,
      lwaClientId: "replacement-client",
      lwaClientSecret: "replacement-secret",
      regions: {
        na: { refreshToken: "", sellerId: "" },
        fe: { refreshToken: "", sellerId: "" },
        eu: { refreshToken: "", sellerId: "" },
      },
      imageStorage: null,
      replenishmentSkillUrl: "",
      updatedAt: "2026-09-02T00:00:00.000Z",
    }));

    await expect(new CredentialVault(filePath).getOperationsBoardPublicBaseUrl())
      .resolves.toBeNull();
  });

  it("preserves a current board URL when a later credential save omits it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-current-resave-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });

    await vault.save({
      lwaClientId: "updated-client",
      lwaClientSecret: "updated-secret",
    });

    await expect(new CredentialVault(filePath).getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/team");
  });

  it("does not let a corrupt optional board sidecar block Amazon credential saves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-corrupt-sidecar-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({ operationsBoardPublicBaseUrl: "https://assets.example.com/team" });
    await writeFile(vault.operationsBoardFilePath, encrypted({ invalid: true }));

    await expect(vault.save({
      lwaClientId: "updated-client",
      lwaClientSecret: "updated-secret",
    })).resolves.toMatchObject({ lwaConfigured: true });
    await expect(new CredentialVault(filePath).getSummary())
      .resolves.toMatchObject({ lwaConfigured: true });
  });

  it("does not silently switch to the writer URL when the board sidecar is corrupt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-corrupt-reader-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({
      imageStorage: {
        accountId: "a".repeat(32),
        accessKeyId: "writer-key",
        secretAccessKey: "writer-secret",
        bucket: "amz-api-assets",
        publicBaseUrl: "https://writer.example.com/public",
      },
      operationsBoardPublicBaseUrl: "https://reader.example.com/team",
    });
    await writeFile(vault.operationsBoardFilePath, encrypted({ invalid: true }));

    await expect(new CredentialVault(filePath).getOperationsBoardPublicBaseUrl())
      .rejects.toThrow("公布欄唯讀設定");
  });

  it("restores the board sidecar when clearing the main vault fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-clear-rollback-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({
      lwaClientId: "saved-client",
      lwaClientSecret: "saved-secret",
      operationsBoardPublicBaseUrl: "https://assets.example.com/team",
    });
    const credentialsBefore = await readFile(filePath);
    const readerBefore = await readFile(vault.operationsBoardFilePath);
    fsFault.unlinkPath = filePath;

    await expect(vault.clear()).rejects.toThrow("simulated main vault unlink failure");

    expect(await readFile(filePath)).toEqual(credentialsBefore);
    expect(await readFile(vault.operationsBoardFilePath)).toEqual(readerBefore);
    await expect(vault.getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/team");
  });

  it("does not replace the Amazon vault when staging the reader sidecar fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-atomic-vault-"));
    const filePath = join(directory, "credentials.enc");
    const vault = new CredentialVault(filePath);
    await vault.save({
      lwaClientId: "old-client",
      lwaClientSecret: "old-secret",
      operationsBoardPublicBaseUrl: "https://assets.example.com/old",
    });
    const before = await readFile(filePath);
    safeStorage.encryptStringAsync
      .mockImplementationOnce(async (value: string) =>
        Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`))
      .mockRejectedValueOnce(new Error("sidecar staging failed"));

    await expect(vault.save({
      lwaClientId: "new-client",
      lwaClientSecret: "new-secret",
      operationsBoardPublicBaseUrl: "https://assets.example.com/new",
    })).rejects.toThrow("sidecar staging failed");

    expect(await readFile(filePath)).toEqual(before);
    const decrypted = await safeStorage.decryptStringAsync(await readFile(filePath));
    expect(JSON.parse(decrypted.result)).toMatchObject({
      lwaClientId: "old-client",
      lwaClientSecret: "old-secret",
    });
    await expect(vault.getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/old");
  });

  it("falls back to the writer storage public URL on editor devices", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-writer-vault-"));
    const vault = new CredentialVault(join(directory, "credentials.enc"));
    await vault.save({
      imageStorage: {
        accountId: "a".repeat(32),
        accessKeyId: "writer-key",
        secretAccessKey: "writer-secret",
        bucket: "amz-api-assets",
        publicBaseUrl: "https://assets.example.com/public",
      },
    });

    await expect(vault.getOperationsBoardPublicBaseUrl())
      .resolves.toBe("https://assets.example.com/public");
  });

  it("loads legacy encrypted vaults that predate the standalone board URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-legacy-vault-"));
    const filePath = join(directory, "credentials.enc");
    await writeFile(filePath, encrypted({
      version: 1,
      lwaClientId: "",
      lwaClientSecret: "",
      regions: {
        na: { refreshToken: "", sellerId: "" },
        fe: { refreshToken: "", sellerId: "" },
        eu: { refreshToken: "", sellerId: "" },
      },
      imageStorage: null,
      replenishmentSkillUrl: "",
      updatedAt: "2026-08-31T00:00:00.000Z",
    }));
    const vault = new CredentialVault(filePath);

    await expect(vault.getOperationsBoardPublicBaseUrl()).resolves.toBeNull();
    await expect(vault.getSummary()).resolves.toMatchObject({ hasVault: true });
  });

  it("rejects board URLs with mutable query, fragment, credentials, or a custom port", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-url-vault-"));
    const vault = new CredentialVault(join(directory, "credentials.enc"));

    for (const publicBaseUrl of [
      "https://assets.example.com/team?key=other",
      "https://assets.example.com/team#other",
      "https://user:pass@assets.example.com/team",
      "https://assets.example.com:8443/team",
    ]) {
      await expect(vault.save({ operationsBoardPublicBaseUrl: publicBaseUrl }))
        .rejects.toThrow("公布欄");
    }
  });
});
