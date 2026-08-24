import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function block(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

describe("main SP execution context lifecycle", () => {
  it("centralizes credential, lock and suspend invalidation without dropping durable evidence", async () => {
    const source = await readFile(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8",
    );
    const invalidator = block(
      source,
      "function invalidateAmazonSecurityContext",
      "function normalizedExternal",
    );
    expect(invalidator).toContain("apiRouter.invalidateSpExecutionContext(reason)");
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
  });
});
