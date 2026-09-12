import { describe, expect, it, vi } from "vitest";
import { VineProgressOwner } from "../src/main/vine-progress";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import type { ApiRequest, ApiResponse } from "../src/shared/contracts";
import { vinePage, vinePageRow } from "./fixtures/vine-page";
import type { VineSnapshot } from "../src/shared/vine";
const US = "ATVPDKIKX0DER" as const;
const NOW = Date.parse("2026-09-12T01:00:00Z"); // US is still September 11.
const header = "enrollmentDate,sellerSku,asin,enrolled,claimed,reviews,status";
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
  it("saves pasted ASIN enrollments without SKU, retains old ongoing rows and removes explicit terminal updates", async () => {
    const app = fixture();
    const imported = body(await app.owner.import(req(vinePage(vinePageRow(), vinePageRow({ asin: "B000000002", status: "已結束", date: "4/12/2026" })))));
    expect(imported.rows).toHaveLength(1);
    expect(imported.rows[0]).toMatchObject({ asin: "B000000001", enrollmentDate: "2026-06-16", reviews: 22, enrolled: 30, sellerSku: null });
    expect(imported.importResult).toEqual({ accepted: 2, rejected: [] });
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toHaveLength(1);
    const ended = body(await app.owner.import(req(vinePage(vinePageRow({ status: "已結束", reviews: "23" })))));
    expect(ended.rows).toEqual([]);
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toEqual([]);
    expect(app.store.write).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(app.saved())).not.toContain("產品網站上線日期");
    expect(JSON.stringify(app.saved())).not.toContain("fixture-vine-account-a");
  });

  it.each(["已取消", "cancelled", "canceled"])("retires existing active enrollment after explicit cancelled status %s", async (status) => {
    const app = fixture();
    await app.owner.import(req(vinePage(vinePageRow())));
    const cancelled = body(await app.owner.import(req(vinePage(vinePageRow({ status })))));
    expect(cancelled.importResult).toEqual({ accepted: 1, rejected: [] });
    expect(cancelled.rows).toEqual([]);
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toEqual([]);
  });

  it("retires a previously verified enrollment even after it leaves the current FBA catalog", async () => {
    const app = fixture();
    await app.owner.import(req(vinePage(vinePageRow())));
    app.fba.mockRejectedValue(new Error("catalog unavailable"));
    const ended = body(await app.owner.import(req(vinePage(vinePageRow({ status: "已結束" })))));
    expect(ended.rows).toEqual([]);
    expect(ended.importResult).toEqual({ accepted: 1, rejected: [] });
    expect(app.fba).toHaveBeenCalledOnce();
  });

  it("preserves prior active evidence for unknown source rows and rows absent from this page", async () => {
    const app = fixture();
    await app.owner.import(req(vinePage(vinePageRow())));
    const updated = body(await app.owner.import(req(vinePage(vinePageRow({ status: "狀態未知", reviews: "0" }), vinePageRow({ asin: "B000000002", date: "9/2/2026", reviews: "1" })))));
    expect(updated.rows).toHaveLength(2);
    expect(updated.rows.find(row => row.asin === "B000000001")).toMatchObject({ status: "active", reviews: 22 });
    expect(updated.importResult).toMatchObject({ accepted: 1, rejected: [{ message: expect.stringContaining("狀態") }] });
    const nextPage = body(await app.owner.import(req(vinePage(vinePageRow({ asin: "B000000002", date: "9/2/2026", reviews: "2" })))));
    expect(nextPage.rows).toHaveLength(2);
    expect(JSON.stringify(app.saved())).not.toContain("狀態未知");
  });

  it("does not persist or revalidate a page containing only unconfirmed source statuses", async () => {
    const app = fixture();
    await app.owner.import(req(vinePage(vinePageRow())));
    const saved = structuredClone(app.saved());
    const rejected = body(await app.owner.import(req(vinePage(vinePageRow({ status: "狀態未知", reviews: "0" })))));
    expect(rejected.rows).toMatchObject([{ status: "active", reviews: 22 }]);
    expect(rejected.importResult).toMatchObject({ accepted: 0, rejected: [{ message: expect.stringContaining("狀態") }] });
    expect(app.saved()).toEqual(saved);
    expect(app.fba).toHaveBeenCalledOnce();
    expect(app.store.write).toHaveBeenCalledOnce();
  });

  it("migrates old encrypted counts as unconfirmed and updates the same ASIN/date without needing the old SKU", async () => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-06-16,SKU-ONE,B000000001,30,29,22,active`));
    const legacy = structuredClone(app.saved()) as { schemaVersion: number; profiles: Record<string, Record<string, unknown>[]> };
    legacy.schemaVersion = 1;
    for (const rows of Object.values(legacy.profiles)) for (const row of rows) { delete row.status; delete row.statusText; delete row.title; }
    const originalRead = app.store.read.getMockImplementation()!;
    app.store.read.mockResolvedValueOnce(legacy);
    const restarted = new VineProgressOwner(app.dependencies);
    const before = body(await restarted.observe(req()));
    expect(before).toMatchObject({ schemaVersion: 2, rows: [], unconfirmedCount: 1 });
    expect(app.store.write).toHaveBeenCalledOnce();
    const confirmed = body(await restarted.import(req(vinePage(vinePageRow({ reviews: "23" })))));
    expect(confirmed).toMatchObject({ unconfirmedCount: 0, rows: [{ sellerSku: null, asin: "B000000001", reviews: 23 }] });
    expect(Object.values((app.saved() as { profiles: Record<string, unknown[]> }).profiles)[0]).toHaveLength(1);
    app.store.read.mockImplementation(originalRead);
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toHaveLength(1);
  });

  it.each(["during-write", "read-already-started"] as const)("preserves committed rows when a %s observation overlaps a failed save", async (ordering) => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7,active`));
    let releaseRead!: () => void, readStarted!: () => void;
    const readPending = new Promise<void>(resolve => { releaseRead = resolve; });
    const reading = new Promise<void>(resolve => { readStarted = resolve; });
    const originalRead = app.store.read.getMockImplementation()!;
    let before: Promise<ApiResponse> | undefined;
    if (ordering === "read-already-started") {
      app.owner.clear();
      app.store.read.mockImplementationOnce(async () => {
        const oldDisk = await originalRead();
        readStarted(); await readPending;
        return oldDisk;
      });
      before = app.owner.observe(req());
      await reading;
    }
    let releaseWrite!: () => void, writeStarted!: () => void;
    const writePending = new Promise<void>(resolve => { releaseWrite = resolve; });
    const writing = new Promise<void>(resolve => { writeStarted = resolve; });
    const originalWrite = app.store.write.getMockImplementation()!;
    app.store.write.mockImplementationOnce(async (value, checkpoint) => {
      writeStarted(); await writePending;
      await originalWrite(value, checkpoint);
      throw new Error("directory sync failed after atomic replacement");
    });
    const importing = app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0,active`)).then(
      () => "unexpected-success",
      (error: { code?: string }) => error.code,
    );
    let during: Promise<ApiResponse> | undefined;
    if (ordering === "read-already-started") {
      // Let an unfenced importer reach its write while the older disk read is
      // pending; a serialized implementation instead waits for that read.
      for (let i = 0; i < 50; i++) await Promise.resolve();
      releaseRead();
      expect(body(await before!).rows).toHaveLength(1);
    }
    await writing;
    if (ordering === "during-write") {
      during = app.owner.observe(req());
      for (let i = 0; i < 50; i++) await Promise.resolve();
    }
    releaseWrite();
    expect(await importing).toBe("VINE_STORAGE_WRITE_FAILED");
    if (during) expect(body(await during).rows).toHaveLength(2);
    expect(body(await app.owner.observe(req())).rows).toHaveLength(2);
    const next = body(await app.owner.import(req(`${header}\n2026-09-11,SKU-ONE,B000000001,30,0,0,active`)));
    expect(next.rows).toHaveLength(3);
    expect(next.rows.some(row => row.asin === "B000000002")).toBe(true);
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toHaveLength(3);
    expect(app.store.write).toHaveBeenCalledTimes(3);
  });

  it("fences an earlier disk read and queued import when the account is cleared", async () => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7,active`));
    app.owner.clear();
    let release!: () => void, started!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    const originalRead = app.store.read.getMockImplementation()!;
    app.store.read.mockImplementationOnce(async () => { const disk = await originalRead(); started(); await pending; return disk; });
    const oldRead = app.owner.observe(req()).then(() => "unexpected-success", error => error.code);
    await reading;
    const oldImport = app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0,active`)).then(() => "unexpected-success", error => error.code);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    app.changeAccount(); app.owner.clear();
    const freshRead = app.owner.observe(req());
    release();
    expect(await oldRead).toBe("ACCOUNT_SCOPE_CHANGED");
    expect(await oldImport).toBe("ACCOUNT_SCOPE_CHANGED");
    expect(body(await freshRead).rows).toEqual([]);
    expect(app.store.write).toHaveBeenCalledOnce();
    expect(app.fba).toHaveBeenCalledOnce();
  });

  it.each(["observe", "import"] as const)("reloads a committed-but-failed save before the next %s and preserves its rows", async (nextOperation) => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7,active`));
    const write = app.store.write.getMockImplementation()!;
    app.store.write.mockImplementationOnce(async (value, checkpoint) => {
      await write(value, checkpoint);
      throw new Error("directory sync failed after atomic replacement");
    });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0,active`))).rejects.toMatchObject({ code: "VINE_STORAGE_WRITE_FAILED" });
    expect(app.store.write).toHaveBeenCalledTimes(2);
    if (nextOperation === "observe") {
      expect(body(await app.owner.observe(req())).rows).toHaveLength(2);
      expect(app.store.write).toHaveBeenCalledTimes(2);
    }
    const next = body(await app.owner.import(req(`${header}\n2026-09-11,SKU-ONE,B000000001,30,0,0,active`)));
    expect(next.rows).toHaveLength(3);
    expect(next.rows.find(row => row.sellerSku === "SKU TWO")).toMatchObject({ enrolled: 2, claimed: 1, reviews: 0 });
    expect(body(await new VineProgressOwner(app.dependencies).observe(req())).rows).toHaveLength(3);
    expect(app.store.write).toHaveBeenCalledTimes(3);
  });

  it.each(["PRIVATE_LOCAL_READ_FAILED", "PRIVATE_LOCAL_UNAVAILABLE"])("blocks reread and further imports when an uncertain save cannot be reconciled: %s", async (failure) => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7,active`));
    const write = app.store.write.getMockImplementation()!;
    const read = app.store.read.getMockImplementation()!;
    app.store.write.mockImplementationOnce(async (value, checkpoint) => {
      await write(value, checkpoint);
      throw new Error("directory sync failed after atomic replacement");
    });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU TWO,B000000002,2,1,0,active`))).rejects.toMatchObject({ code: "VINE_STORAGE_WRITE_FAILED" });
    app.store.read.mockRejectedValue(new Error(failure));
    await expect(app.owner.observe(req())).rejects.toMatchObject({ code: "VINE_STORAGE_UNREADABLE" });
    await expect(app.owner.import(req(`${header}\n2026-09-11,SKU-ONE,B000000001,30,0,0,active`))).rejects.toMatchObject({ code: "VINE_STORAGE_UNREADABLE" });
    expect(app.store.write).toHaveBeenCalledTimes(2);
    app.store.read.mockImplementation(read);
    expect(body(await app.owner.observe(req())).rows).toHaveLength(2);
    expect(app.store.write).toHaveBeenCalledTimes(2);
  });

  it("keeps exact Vine counts, scopes encrypted data and keeps ongoing enrollments beyond 60 US Marketplace Days", async () => {
    const app = fixture();
    const imported = await app.owner.import(req(`${header}\n2026-07-14,SKU-ONE,B000000001,30,15,7,active\n2026-07-13,SKU-ONE,B000000001,30,30,30,active\n2026-09-11,SKU TWO,B000000002,2,,0,active`));
    expect(imported.status).toBe(200);
    expect(body(imported)).toMatchObject({ source: "seller-central-manual", storage: "encrypted-local", asOfDate: "2026-09-11", unconfirmedCount: 0, importResult: { accepted: 3, rejected: [] } });
    expect(body(imported).rows).toHaveLength(3);
    expect(body(imported).rows.find((row) => row.sellerSku === "SKU TWO")).toMatchObject({ enrolled: 2, claimed: null, reviews: 0 });
    expect(JSON.stringify(app.saved())).not.toContain("fixture-vine-account-a");
    const restarted = new VineProgressOwner(app.dependencies);
    expect(body(await restarted.observe(req())).rows).toHaveLength(3);
    expect(app.fba).toHaveBeenCalledOnce();
  });
  it("updates the exact enrollment, isolates invalid rows and preserves missing progress", async () => {
    const app = fixture();
    await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,15,7,active`));
    const result = body(await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,16,8,active\n2026-09-11,SKU TWO,B000000002,2,,0,active\n2026-09-11,NOT-FBA,B000000003,30,15,0,active\n2026-09-11,SKU-ONE,B000000001,30,31,0,active`)));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.sellerSku === "SKU-ONE")).toMatchObject({ claimed: 16, reviews: 8 });
    expect(result.importResult).toMatchObject({ accepted: 2, rejected: [{ line: 4 }, { line: 5 }] });
    expect(JSON.stringify(app.saved())).not.toContain("NOT-FBA");
  });
  it("accepts quoted TSV and keeps duplicate enrollment rows out of updates", async () => {
    const app = fixture();
    const result = body(await app.owner.import(req('註冊日期\tSeller SKU\tASIN\t登記名額\t已領取\t已評論\t狀態\n2026-09-10\t"SKU TWO"\tB000000002\t2\t1\t2\tactive\n2026-09-10\tSKU-ONE\tB000000001\t30\t2\t1\tactive\n2026-09-10\tSKU-ONE\tB000000001\t30\t3\t2\tactive')));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ sellerSku: "SKU TWO", claimed: 1, reviews: 2 });
    expect(result.importResult).toMatchObject({ accepted: 1, rejected: [{ line: 3 }, { line: 4 }] });
  });
  it("keeps corruption closed and uses a clearly marked session when encryption is unavailable", async () => {
    const app = fixture();
    app.store.read.mockResolvedValue({ schemaVersion: 999, profiles: {} });
    await expect(app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0,active`))).rejects.toMatchObject({ code: "VINE_STORAGE_INVALID" });
    expect(app.store.write).not.toHaveBeenCalled();
    app.owner.clear();
    app.store.read.mockRejectedValue(new Error("PRIVATE_LOCAL_UNAVAILABLE"));
    const result = body(await app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0,active`)));
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
    let release!: () => void, started!: () => void;
    const starting = new Promise<void>(resolve => { started = resolve; });
    app.fba.mockImplementation(async () => {
      started();
      await new Promise<void>((resolve) => { release = resolve; });
      return [{ sellerSku: "SKU-ONE", asin: "B000000001" }];
    });
    const importing = app.owner.import(req(`${header}\n2026-09-10,SKU-ONE,B000000001,30,0,0,active`));
    await starting;
    expect(app.fba).toHaveBeenCalledOnce();
    app.changeAccount();
    release();
    await expect(importing).rejects.toMatchObject({ code: "ACCOUNT_SCOPE_CHANGED" });
    expect(app.store.write).not.toHaveBeenCalled();
    expect(body(await app.owner.observe(req())).rows).toHaveLength(0);
  });

});
