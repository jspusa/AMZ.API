import { mkdtemp, open, readFile, readdir, rename, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { LocalStore, type LocalStoreFileSystem } from "../src/main/local-store";
import { SpApiError } from "../src/main/amazon/sp-api-error";

const filesystem = (): LocalStoreFileSystem => ({ open, rename, mkdir, unlink, platform: process.platform });
const operation = {
  idempotencyKey: "persist-b2b-key",
  operationType: "business_price" as const,
  marketplaceId: "ATVPDKIKX0DER",
  sellerSku: "SAFE-PERSIST-SKU",
  accountScope: "account-persistence-fixture",
  fingerprint: "fixture-operation",
};

async function fixture(fs = filesystem()) {
  const directory = await mkdtemp(join(tmpdir(), "amz-durable-"));
  const path = join(directory, "data.json");
  const store = new LocalStore(path, fs);
  await store.initialize();
  return { store, directory, path, fs };
}

describe("LocalStore persistence commit boundary", () => {
  it.each(["write", "sync", "rename"] as const)("does not publish a failed %s claim or execute Amazon work; a retry succeeds once", async (failure) => {
    const fs = filesystem();
    const { store, directory, path } = await fixture(fs);
    let fail = true;
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (args[1] === "wx") {
        const rejectOnce = () => {
          if (fail && failure !== "rename") {
            fail = false;
            throw Object.assign(new Error("disk full fixture"), { code: "ENOSPC" });
          }
        };
        if (failure === "sync") {
          const original = handle.sync.bind(handle);
          handle.sync = async () => { rejectOnce(); return original(); };
        } else {
          const original = handle.writeFile.bind(handle);
          handle.writeFile = async (...values) => { rejectOnce(); return original(...values); };
        }
      }
      return handle;
    };
    fs.rename = async (...args) => {
      if (fail && failure === "rename") {
        fail = false;
        throw Object.assign(new Error("rename fixture"), { code: "EIO" });
      }
      return rename(...args);
    };
    const send = vi.fn(async () => ({ fixture: "verified" }));
    await expect(store.runIdempotentOperation({ ...operation, execute: send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(await store.inspectIdempotentOperations({ ...operation, operationTypes: ["business_price"] })).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
    await expect(store.runIdempotentOperation({ ...operation, execute: send })).resolves.toEqual({ fixture: "verified" });
    const reopened = new LocalStore(path);
    await reopened.initialize();
    await reopened.runIdempotentOperation({ ...operation, execute: send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the durable pending claim after accepted-result persistence fails and never resends after restart", async () => {
    const fs = filesystem();
    const { store, path } = await fixture(fs);
    let writes = 0;
    fs.rename = async (...args) => {
      writes += 1;
      if (writes >= 2) throw Object.assign(new Error("disk offline fixture"), { code: "EIO" });
      return rename(...args);
    };
    const send = vi.fn(async ({ recordAccepted }) => {
      await recordAccepted({ fixture: "accepted" });
      throw new SpApiError("accepted pending", { status: 202, code: "UPDATE_PROCESSING" });
    });
    await expect(store.runIdempotentOperation({ ...operation, execute: send })).rejects.toThrow();
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk.ledger[operation.idempotencyKey].state).toBe("pending");
    expect(onDisk.ledger[operation.idempotencyKey].response).toBeNull();
    const reopened = new LocalStore(path);
    await reopened.initialize();
    await expect(reopened.runIdempotentOperation({ ...operation, execute: send })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flushes file before rename and directory after it before allowing execution", async () => {
    const fs = filesystem();
    fs.platform = "linux";
    const events: string[] = [];
    fs.open = async (...args) => {
      // Model the directory handle at this seam so the ordering assertion also
      // runs on Windows, where native directory handles may be unsupported.
      if (args[1] === "r") return {
        sync: async () => { events.push("directory-sync"); },
        close: async () => undefined,
      } as Awaited<ReturnType<typeof open>>;
      const handle = await open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { events.push("file-sync"); await sync(); };
      return handle;
    };
    fs.rename = async (...args) => { events.push("rename"); await rename(...args); };
    const { store } = await fixture(fs);
    await store.runIdempotentOperation({ ...operation, execute: async () => { events.push("execute"); return {}; } });
    expect(events.slice(0, 4)).toEqual(["file-sync", "rename", "directory-sync", "execute"]);
  });

  it("fails closed after a post-rename directory flush failure instead of publishing or retrying uncertain memory", async () => {
    const fs = filesystem();
    fs.platform = "linux";
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (args[1] === "r") handle.sync = async () => { throw Object.assign(new Error("directory flush failed"), { code: "EIO" }); };
      return handle;
    };
    const { store, path } = await fixture(fs);
    const send = vi.fn(async () => ({}));
    await expect(store.runIdempotentOperation({ ...operation, execute: send })).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
    await expect(store.runIdempotentOperation({ ...operation, execute: send })).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
    expect(send).not.toHaveBeenCalled();
    await expect(store.isolateCorruptedFile()).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
    const reopened = new LocalStore(path);
    await reopened.initialize();
    await expect(reopened.runIdempotentOperation({ ...operation, execute: send })).rejects.toMatchObject({ code: "OPERATION_IN_PROGRESS" });
  });

  it("refuses to quarantine a valid ledger after an initialization persistence failure", async () => {
    const { store: previous, path, directory } = await fixture();
    const now = Date.now();
    const execute = vi.fn(async () => { throw new SpApiError("fixture timeout", { status: 503, code: "UPDATE_STATUS_UNKNOWN" }); });
    await expect(previous.runIdempotentOperation({ ...operation, execute })).rejects.toThrow();
    const expiredCreation = now - 2 * 24 * 60 * 60 * 1_000;
    await previous.saveContentAuditSnapshotEvidence({
      exportId: "fixture-export-id", accountScope: "a".repeat(64), marketplaceId: operation.marketplaceId,
      mode: "live", fetchedAt: new Date(expiredCreation).toISOString(), rowDigests: ["b".repeat(64)],
    }, expiredCreation);
    const fs = filesystem();
    fs.platform = "linux";
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (args[1] === "r") handle.sync = async () => { throw Object.assign(new Error("startup flush fixture"), { code: "EIO" }); };
      return handle;
    };
    const store = new LocalStore(path, fs);
    await expect(store.initialize()).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
    const preserved = await readFile(path, "utf8");
    await expect(store.isolateCorruptedFile()).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
    expect(await readFile(path, "utf8")).toBe(preserved);
    expect((await readdir(directory)).filter((name) => name.includes(".corrupt-"))).toEqual([]);
    const reopened = new LocalStore(path);
    await reopened.initialize();
    expect(await reopened.inspectIdempotentOperations({ ...operation, operationTypes: ["business_price"] }))
      .toEqual([expect.objectContaining({ state: "unknown" })]);
    await expect(reopened.runIdempotentOperation({ ...operation, execute })).rejects.toMatchObject({ code: "UPDATE_STATUS_UNKNOWN" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("only quarantines confirmed malformed data, never valid or unsupported-version ledgers", async () => {
    const { store, path } = await fixture();
    await expect(store.isolateCorruptedFile()).rejects.toThrow();
    await writeFile(path, JSON.stringify({ version: 3, profiles: {}, ledger: {} }));
    await expect(new LocalStore(path).isolateCorruptedFile()).rejects.toMatchObject({ code: "LOCAL_STORE_VERSION_UNSUPPORTED" });
    await writeFile(path, "invalid-json-fixture");
    const corrupted = new LocalStore(path);
    await expect(corrupted.initialize()).rejects.toMatchObject({ code: "LOCAL_STORE_CORRUPTED" });
    const backup = await corrupted.isolateCorruptedFile();
    expect(backup).toBeTruthy();
    expect(await readFile(backup!, "utf8")).toBe("invalid-json-fixture");
  });

  it("allows only the documented Windows directory-handle limitation, not a real I/O error", async () => {
    for (const code of ["EPERM", "EIO"]) {
      const fs = filesystem();
      fs.platform = "win32";
      fs.open = async (...args) => {
        if (args[1] === "r") throw Object.assign(new Error("directory fixture"), { code });
        return open(...args);
      };
      const { store } = await fixture(fs);
      const send = vi.fn(async () => ({}));
      const result = store.runIdempotentOperation({ ...operation, execute: send });
      if (code === "EPERM") await expect(result).resolves.toEqual({});
      else await expect(result).rejects.toMatchObject({ code: "LOCAL_STORE_PERSISTENCE_UNCERTAIN" });
      expect(send).toHaveBeenCalledTimes(code === "EPERM" ? 1 : 0);
    }
  });
});
