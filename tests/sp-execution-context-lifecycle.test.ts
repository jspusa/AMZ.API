import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function block(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

describe("main Amazon execution context lifecycle", () => {
  it("centralizes every credential, lock and suspend invalidation without dropping durable evidence", async () => {
    const source = await readFile(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8",
    );
    const invalidator = block(
      source,
      "function invalidateAmazonSecurityContext",
      "function normalizedExternal",
    );
    expect(invalidator).toContain("apiRouter.invalidateContext(reason)");
    expect(invalidator).toContain(
      "invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true })",
    );
    expect(invalidator).toContain("advertisingApi?.invalidate()");
    expect(invalidator).not.toContain("LocalStore");

    const save = block(
      source,
      'ipcMain.handle("fba:credentials-save"',
      'ipcMain.handle("fba:credentials-editor-close"',
    );
    expect(save).toContain('invalidateAmazonSecurityContext("credentials-saved")');
    expect(save.indexOf("invalidateAmazonSecurityContext")).toBeLessThan(
      save.indexOf("credentialVault.save"),
    );

    const clear = block(
      source,
      'ipcMain.handle("fba:credentials-clear"',
      'ipcMain.handle("fba:credentials-test"',
    );
    expect(clear).toContain('invalidateAmazonSecurityContext("credentials-cleared")');
    expect(clear.indexOf("invalidateAmazonSecurityContext")).toBeLessThan(
      clear.indexOf("credentialVault.clear"),
    );

    const advertisingSave = block(
      source,
      '"fba:ads-credentials-save"',
      'ipcMain.handle("fba:ads-credentials-editor-close"',
    );
    expect(advertisingSave).toContain(
      'invalidateAmazonSecurityContext("advertising-credentials-saved")',
    );
    expect(advertisingSave.indexOf("invalidateAmazonSecurityContext")).toBeLessThan(
      advertisingSave.indexOf("advertisingCredentialVault.save"),
    );
    expect(advertisingSave).not.toContain("advertisingApi.invalidate");
    expect(advertisingSave).not.toContain("dispose()");

    const advertisingClear = block(
      source,
      'ipcMain.handle("fba:ads-credentials-clear"',
      'ipcMain.handle("fba:ads-credentials-test"',
    );
    expect(advertisingClear).toContain(
      'invalidateAmazonSecurityContext("advertising-credentials-cleared")',
    );
    expect(advertisingClear.indexOf("invalidateAmazonSecurityContext")).toBeLessThan(
      advertisingClear.indexOf("advertisingCredentialVault.clear"),
    );
    expect(advertisingClear).not.toContain("advertisingApi.invalidate");
    expect(advertisingClear).not.toContain("dispose()");

    const lock = block(
      source,
      'powerMonitor.on("lock-screen"',
      'powerMonitor.on("suspend"',
    );
    expect(lock).toContain('invalidateAmazonSecurityContext("lock-screen")');

    const suspend = block(
      source,
      'powerMonitor.on("suspend"',
      "await createWindow()",
    );
    expect(suspend).toContain('invalidateAmazonSecurityContext("suspend")');
    expect(source).not.toContain("clearPreviews");
  });
});
