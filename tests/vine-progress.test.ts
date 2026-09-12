import { describe, expect, it, vi } from "vitest";
import { VineProgressOwner } from "../src/main/vine-progress";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import type { VineSnapshot } from "../src/shared/vine";
const US = "ATVPDKIKX0DER" as const;
const NOW = Date.parse("2026-09-12T01:00:00Z"); // US is still September 11.
const header = "enrollmentDate,sellerSku,asin,enrolled,claimed,reviews";
const req = (text?: string): ApiRequest => ({ requestId: "vine-fixture", method: text === undefined ? "GET" : "POST", path: text === undefined ? "/api/vine" : "/api/vine/import", query: {}, headers: {}, ...(text === undefined ? {} : { body: { kind: "json", value: { text } } }) });
const body = (response: ApiResponse): VineSnapshot => {
  if (response.body.kind !== "json") throw new Error("Expected JSON");
  return response.body.value as VineSnapshot;
};
function fixture() {
  let scope = "fixture-vine-account-a";
  let persisted: unknown = null;
  const context = createScriptedSpExecutionContextAdapter(() => ({ marketplaceId: US, mode: "live", accountScope: scope }));
  const store = { read: vi.fn(async () => structuredClone(persisted)), write: vi.fn(async (value: unknown, checkpoint: () => Promise<void>) => { await checkpoint(); persisted = structuredClone(value); }) };
  const fba = vi.fn(async () => [{ sellerSku: "SKU-ONE", asin: "B000000001" }, { sellerSku: "SKU TWO", asin: "B000000002" }]);
  const dependencies = { context, fba, store, now: () => NOW };
  return { owner: new VineProgressOwner(dependencies), dependencies, fba, store, changeAccount: () => { scope = "fixture-vine-account-b"; }, saved: () => persisted };
}
describe("Vine progress local ownership", () => {
  it.each(["observe", "import"] as const)("reloads a committed-but-failed save before the next %s and preserves its rows", async (nextOperation) => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7`));
    const write = app.store.write.getMockImplementation()!;
    app.store.write.mockImplementationOnce(async (value, checkpoint) => {
      await write(value, checkpoint);
      throw new Error("directory sync failed after atomic replacement");
    });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0`))).rejects.toMatchObject({ code: "VINE_STORAGE_WRITE_FAILED" });
    expect(app.store.write).toHaveBeenCalledTimes(2);
    if (nextOperation === "observe") {
      expect(body(await app.owner.observe(req())).rows).toHaveLength(2);
      expect(app.store.write).toHaveBeenCalledTimes(2);
    }
    const next = body(await app.owner.import(req(`${header}\n2026-09-11,SKU-ONE,B000000001,30,0,0`)));
    expect(next.rows).toHaveLength(3);
    expect(next.rows.find(row => row.sellerSku === "SKU TWO")).toMatchObject({ enrolled: 2, claimed: 1, reviews: 0 });
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toHaveLength(3);
    expect(app.store.write).toHaveBeenCalledTimes(3);
  });

  it.each(["PRIVATE_LOCAL_READ_FAILED", "PRIVATE_LOCAL_UNAVAILABLE"])("blocks reread and further imports when an uncertain save cannot be reconciled: %s", async (failure) => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7`));
    const write = app.store.write.getMockImplementation()!;
    const read = app.store.read.getMockImplementation()!;
    app.store.write.mockImplementationOnce(async (value, checkpoint) => {
      await write(value, checkpoint);
      throw new Error("directory sync failed after atomic replacement");
    });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0`))).rejects.toMatchObject({ code: "VINE_STORAGE_WRITE_FAILED" });
    app.store.read.mockRejectedValue(new Error(failure));
    await expect(app.owner.observe(req())).rejects.toMatchObject({ code: "VINE_STORAGE_UNREADABLE" });
    await expect(app.owner.import(req(`${header}\n2026-09-11,SKU-ONE,B000000001,30,0,0`))).rejects.toMatchObject({ code: "VINE_STORAGE_UNREADABLE" });
    expect(app.store.write).toHaveBeenCalledTimes(2);
    app.store.read.mockImplementation(read);
    expect(body(await app.owner.observe(req())).rows).toHaveLength(2);
    expect(app.store.write).toHaveBeenCalledTimes(2);
  });

  it("keeps exact Vine counts, scopes encrypted data and filters 60 US Marketplace Days", async () => {
    const app = fixture();
    const imported = await app.owner.import(req(`${header}\n2026-07-14,SKU-ONE,B000000001,30,15,7\n2026-07-13,SKU-ONE,B000000001,30,30,30\n2026-09-11,SKU TWO,B000000002,2,,0`));
    expect(imported.status).toBe(200);
    expect(body(imported)).toMatchObject({ source: "seller-central-manual", storage: "encrypted-local", window: { startDate: "2026-07-14", endDate: "2026-09-11" }, importResult: { accepted: 3, rejected: [] } });
    expect(body(imported).rows).toHaveLength(2);
    expect(body(imported).rows.find((row) => row.sellerSku === "SKU TWO")).toMatchObject({ enrolled: 2, claimed: null, reviews: 0 });
    expect(JSON.stringify(app.saved())).not.toContain("fixture-vine-account-a");
    const restarted = new VineProgressOwner(app.dependencies);
    expect(body(await restarted.observe(req())).rows).toHaveLength(2);
    expect(app.fba).toHaveBeenCalledOnce();
  });
  it("updates the exact enrollment, isolates invalid rows and preserves missing progress", async () => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7`));
    const result = body(await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,16,8\n2026-09-11,SKU TWO,B000000002,2,,0\n2026-09-11,NOT-FBA,B000000003,30,15,0\n2026-09-11,SKU-ONE,B000000001,30,31,0`)));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.sellerSku === "SKU-ONE")).toMatchObject({ claimed: 16, reviews: 8 });
    expect(result.importResult).toMatchObject({ accepted: 2, rejected: [{ line: 4 }, { line: 5 }] });
    expect(JSON.stringify(app.saved())).not.toContain("NOT-FBA");
  });
  it("accepts quoted TSV and keeps duplicate enrollment rows out of updates", async () => {
    const app = fixture();
    const result = body(await app.owner.import(req('註冊日期\tSeller SKU\tASIN\t登記名額\t已領取\t已評論\n2026-09-10\t"SKU TWO"\tB000000002\t2\t1\t2\n2026-09-10\tSKU-ONE\tB000000001\t30\t2\t1\n2026-09-10\tSKU-ONE\tB000000001\t30\t3\t2')));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ sellerSku: "SKU TWO", claimed: 1, reviews: 2 });
    expect(result.importResult).toMatchObject({ accepted: 1, rejected: [{ line: 3 }, { line: 4 }] });
  });
  it("keeps corruption closed and uses a clearly marked session when encryption is unavailable", async () => {
    const app = fixture();
    app.store.read.mockResolvedValue({ schemaVersion: 999, profiles: {} });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0`))).rejects.toMatchObject({ code: "VINE_STORAGE_INVALID" });
    expect(app.store.write).not.toHaveBeenCalled();
    app.owner.clear();
    app.store.read.mockRejectedValue(new Error("PRIVATE_LOCAL_UNAVAILABLE"));
    const result = body(await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0`)));
    expect(result.storage).toBe("session-only");
    expect(result.storageNotice).toContain("此工作階段");
    expect(app.store.write).not.toHaveBeenCalled();
    expect(body(await app.owner.observe(req())).rows).toHaveLength(1);
    app.owner.clear();
    expect(body(await app.owner.observe(req())).rows).toHaveLength(0);
  });
  it("rejects malformed stored rows without overwriting the encrypted file", async () => {
    const app = fixture();
    app.store.read.mockResolvedValue({ schemaVersion: 1, profiles: { ["a".repeat(64)]: [null] } });
    await expect(app.owner.observe(req())).rejects.toMatchObject({ code: "VINE_STORAGE_INVALID" });
    expect(app.store.write).not.toHaveBeenCalled();
    expect(app.fba).not.toHaveBeenCalled();
  });
  it("does not publish or persist delayed FBA validation after account drift", async () => {
    const app = fixture();
    let release!: () => void;
    app.fba.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return [{ sellerSku: "SKU-ONE", asin: "B000000001" }];
    });
    const importing = app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0`));
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    expect(app.fba).toHaveBeenCalledOnce();
    app.changeAccount();
    release();
    await expect(importing).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(app.store.write).not.toHaveBeenCalled();
    expect(body(await app.owner.observe(req())).rows).toHaveLength(0);
  });

});
