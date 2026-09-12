import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PrivateLocalJsonStore } from "../src/main/private-local-json";

describe("private operational evidence persistence", () => {
  it("persists encrypted bytes, survives reopen, and fences an update before replacing the prior file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-evidence-")), path = join(directory, "evidence.encrypted");
    const codec = { isAvailable: async () => true, encrypt: async (value: string) => Buffer.from(Buffer.from(value).map(byte => byte ^ 127)), decrypt: async (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 127)).toString() };
    try {
      const store = new PrivateLocalJsonStore({ path, codec });
      await store.write({ sku: "PRIVATE-SKU" }, async () => undefined);
      expect((await readFile(path)).toString()).not.toContain("PRIVATE-SKU");
      expect(await new PrivateLocalJsonStore({ path, codec }).read()).toEqual({ sku: "PRIVATE-SKU" });
      const fence = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Context changed"));
      await expect(store.write({ sku: "REPLACEMENT" }, fence)).rejects.toThrow("Context changed");
      expect(await store.read()).toEqual({ sku: "PRIVATE-SKU" });
      expect(await readdir(directory)).toEqual(["evidence.encrypted"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("never writes plaintext when encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amz-evidence-"));
    try {
      const store = new PrivateLocalJsonStore({ path: join(directory, "data"), codec: { isAvailable: async () => false, encrypt: async () => { throw new Error("unexpected"); }, decrypt: async () => "" } });
      await expect(store.write({ sku: "PRIVATE-SKU" }, async () => undefined)).rejects.toThrow("PRIVATE_LOCAL_UNAVAILABLE");
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
