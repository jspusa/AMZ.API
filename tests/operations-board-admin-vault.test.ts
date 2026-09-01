import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeStorage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(() => true),
  encryptStringAsync: vi.fn(async (value: string) =>
    Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({
    result: Buffer.from(value.toString().slice("encrypted:".length), "base64").toString(),
    shouldReEncrypt: false,
  })),
}));

vi.mock("electron", () => ({ safeStorage }));

import { OperationsBoardAdminVault } from "../src/main/operations-board-admin-vault";

describe("operations board local administrator vault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores an encrypted salted verifier, never the password, and verifies in constant-time form", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-admin-"));
    const filePath = join(directory, "operations-board-admin.enc");
    const vault = new OperationsBoardAdminVault(filePath);
    const password = "local-test-password";

    await expect(vault.enroll({ username: "API", password }))
      .resolves.toMatchObject({ configured: true, username: "API" });
    const persisted = (await readFile(filePath)).toString();
    expect(persisted).not.toContain(password);
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledOnce();
    const encryptedInput = safeStorage.encryptStringAsync.mock.calls[0]?.[0] ?? "";
    expect(encryptedInput).not.toContain(password);
    expect(JSON.parse(encryptedInput)).toMatchObject({ version: 1, username: "API" });
    expect(JSON.parse(encryptedInput).salt).not.toBe(JSON.parse(encryptedInput).verifier);
    await expect(vault.verify({ username: "API", password })).resolves.toBe(true);
    await expect(vault.verify({ username: "API", password: "wrong-password" })).resolves.toBe(false);
    await expect(vault.verify({ username: "OTHER", password })).resolves.toBe(false);
  });

  it("fails closed when system encryption is unavailable and refuses a second enrollment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-admin-"));
    const vault = new OperationsBoardAdminVault(join(directory, "operations-board-admin.enc"));
    safeStorage.isAsyncEncryptionAvailable.mockReturnValueOnce(false);
    await expect(vault.enroll({ username: "API", password: "long-enough-password" }))
      .rejects.toThrow("安全儲存區");

    await vault.enroll({ username: "API", password: "long-enough-password" });
    await expect(vault.enroll({ username: "API", password: "different-password" }))
      .rejects.toThrow("已設定");
  });

  it("rotates the local username and salted verifier only after current credentials match", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-api-board-admin-"));
    const filePath = join(directory, "operations-board-admin.enc");
    const vault = new OperationsBoardAdminVault(filePath);
    const oldPassword = "old-local-password";
    const newPassword = "new-local-password";
    await vault.enroll({ username: "API", password: oldPassword });

    await expect(vault.rotate({
      currentUsername: "API",
      currentPassword: "incorrect-password",
      newUsername: "OPS",
      newPassword,
    })).rejects.toThrow("目前的管理帳號或密碼不正確");
    await expect(vault.verify({ username: "API", password: oldPassword })).resolves.toBe(true);

    await expect(vault.rotate({
      currentUsername: "API",
      currentPassword: oldPassword,
      newUsername: "OPS",
      newPassword,
    })).resolves.toEqual({ configured: true, username: "OPS" });
    await expect(vault.verify({ username: "API", password: oldPassword })).resolves.toBe(false);
    await expect(vault.verify({ username: "OPS", password: newPassword })).resolves.toBe(true);
    const persisted = (await readFile(filePath)).toString();
    expect(persisted).not.toContain(oldPassword);
    expect(persisted).not.toContain(newPassword);
  });
});
