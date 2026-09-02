import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createR2OperationsBoardRemoteStore,
  OPERATIONS_BOARD_OBJECT_KEY,
  OperationsBoard,
  operationsBoardPutFailure,
  parseOperationsBoardSnapshot,
  type OperationsBoardRemoteStorePort,
} from "../src/main/operations-board";

const STORAGE = {
  accountId: "a".repeat(32),
  accessKeyId: "writer-key",
  secretAccessKey: "writer-secret",
  bucket: "amz-api-assets",
  publicBaseUrl: "https://assets.example.com/public",
};
const PUBLIC_BASE_URL = STORAGE.publicBaseUrl;

function vaultWith(input: {
  publicBaseUrl?: string | null;
  storage?: typeof STORAGE | null;
}) {
  return {
    getOperationsBoardPublicBaseUrl: vi.fn(async () =>
      input.publicBaseUrl === undefined ? PUBLIC_BASE_URL : input.publicBaseUrl),
    getImageStorage: vi.fn(async () =>
      input.storage === undefined ? STORAGE : input.storage),
  };
}

const SNAPSHOT = {
  schemaVersion: 1 as const,
  revision: 3,
  updatedAt: "2026-09-01T04:00:00.000Z",
  items: [
    {
      id: "8a9f0a88-e3e1-4fe9-9056-6b06fb990105",
      type: "expiry" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      note: "Holiday stock",
    },
    {
      id: "eb7acbb8-a35b-4e52-9180-069153976f0e",
      type: "promotion" as const,
      date: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "Prepare coupons",
      countdown: true,
    },
  ],
};

function remoteWith(
  value: Awaited<ReturnType<OperationsBoardRemoteStorePort["read"]>>,
): OperationsBoardRemoteStorePort {
  return {
    read: vi.fn(async () => value),
    put: vi.fn(async () => undefined),
  };
}

describe("shared operations bulletin board", () => {
  it("accepts only the bounded exact v1 schema", () => {
    expect(parseOperationsBoardSnapshot(SNAPSHOT)).toEqual(SNAPSHOT);
    expect(() => parseOperationsBoardSnapshot({ ...SNAPSHOT, secret: "no" }))
      .toThrow("不支援的欄位");
    expect(() => parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: [{ ...SNAPSHOT.items[0], expiryDate: "2026-02-30" }],
    })).toThrow("日期");
    expect(() => parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: Array.from({ length: 101 }, (_, index) => ({
        ...SNAPSHOT.items[0],
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })),
    })).toThrow("100");
    expect(() => parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: [{ ...SNAPSHOT.items[0], sellerSku: "S".repeat(41) }],
    })).toThrow("Seller SKU");

    const multiline = parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: [{ ...SNAPSHOT.items[0], note: "第一行\r\n第二行\t待確認" }],
    });
    expect(multiline.items[0]).toMatchObject({ note: "第一行\n第二行\t待確認" });
    expect(() => parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: [{ ...SNAPSHOT.items[0], note: "看似正常\u2066文字" }],
    })).toThrow("備註");
    expect(() => parseOperationsBoardSnapshot({
      ...SNAPSHOT,
      items: [{ ...SNAPSHOT.items[1], title: "Prime\u061c大檔" }],
    })).toThrow("促銷名稱");
  });

  it("streams the public document through the real byte limit and disables SDK retries", async () => {
    let pulls = 0;
    const request = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulls >= 1_000) controller.close();
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const remote = createR2OperationsBoardRemoteStore(request as typeof fetch);

    await expect(remote.read({
      key: OPERATIONS_BOARD_OBJECT_KEY,
      publicUrl: `https://assets.example.com/public/${OPERATIONS_BOARD_OBJECT_KEY}`,
    })).rejects.toMatchObject({ code: "OPERATIONS_BOARD_TOO_LARGE" });
    expect(pulls).toBeLessThan(200);

    const source = await readFile(
      new URL("../src/main/operations-board.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("maxAttempts: 1");
  });

  it("maps conditional conflicts and unknown write outcomes without leaking SDK errors", () => {
    const conflict = operationsBoardPutFailure(
      Object.assign(new Error("raw sdk endpoint detail"), {
        $metadata: { httpStatusCode: 412 },
      }),
      false,
    );
    expect(conflict).toMatchObject({ code: "OPERATIONS_BOARD_CONFLICT" });
    expect(conflict.message).not.toContain("raw sdk");

    const rejected = operationsBoardPutFailure(
      Object.assign(new Error("AccessDenied secret detail"), {
        $metadata: { httpStatusCode: 403 },
      }),
      false,
    );
    expect(rejected).toMatchObject({ code: "OPERATIONS_BOARD_WRITE_REJECTED" });
    expect(rejected.message).not.toContain("AccessDenied");

    const unknown = operationsBoardPutFailure(new Error("socket reset"), false);
    expect(unknown).toMatchObject({ code: "OPERATIONS_BOARD_WRITE_UNKNOWN" });
    expect(unknown.message).toContain("不會自動重送");
    expect(unknown.message).not.toContain("socket reset");
  });

  it("reads only the fixed GitHub Pages object even if a retired R2 URL remains", async () => {
    const remote = remoteWith({ snapshot: SNAPSHOT, etag: '"v3"' });
    const vault = vaultWith({});
    const board = new OperationsBoard({
      vault,
      remote,
    });

    await expect(board.read()).resolves.toMatchObject({
      snapshot: SNAPSHOT,
      source: "shared",
      stale: false,
      status: "ready",
    });
    expect(remote.read).toHaveBeenCalledWith(expect.objectContaining({
      key: OPERATIONS_BOARD_OBJECT_KEY,
      publicUrl: `https://jspusa.github.io/AMZ.API/${OPERATIONS_BOARD_OBJECT_KEY}`,
    }));
    expect(vault.getOperationsBoardPublicBaseUrl).not.toHaveBeenCalled();
  });

  it("lets reader devices use only the public base URL without writer credentials", async () => {
    const remote = remoteWith({ snapshot: SNAPSHOT, etag: '"v3"' });
    const vault = vaultWith({ storage: null });
    const board = new OperationsBoard({ vault, remote });

    await expect(board.read()).resolves.toMatchObject({
      snapshot: SNAPSHOT,
      source: "shared",
      status: "ready",
    });
    expect(remote.read).toHaveBeenCalledWith({
      key: OPERATIONS_BOARD_OBJECT_KEY,
      publicUrl: `https://jspusa.github.io/AMZ.API/${OPERATIONS_BOARD_OBJECT_KEY}`,
    });
    expect(vault.getOperationsBoardPublicBaseUrl).not.toHaveBeenCalled();
    expect(vault.getImageStorage).not.toHaveBeenCalled();
    await expect(board.replace({ baseRevision: 3, items: SNAPSHOT.items }))
      .rejects.toMatchObject({ code: "OPERATIONS_BOARD_NOT_CONFIGURED" });
    expect(remote.put).not.toHaveBeenCalled();
  });

  it("uses the published GitHub Pages board when the reader has no R2 settings", async () => {
    const remote = remoteWith({ snapshot: SNAPSHOT, etag: null });
    const vault = vaultWith({ publicBaseUrl: null, storage: null });
    const board = new OperationsBoard({ vault, remote });

    await expect(board.read()).resolves.toMatchObject({
      snapshot: SNAPSHOT,
      source: "shared",
      status: "ready",
    });
    expect(remote.read).toHaveBeenCalledWith({
      key: OPERATIONS_BOARD_OBJECT_KEY,
      publicUrl:
        "https://jspusa.github.io/AMZ.API/operations-board/v1.json",
    });
    expect(vault.getImageStorage).not.toHaveBeenCalled();
  });

  it("reports writer storage ready only when its public URL matches the effective board URL", async () => {
    const matching = new OperationsBoard({
      vault: vaultWith({}),
      remote: remoteWith(null),
    });
    const mismatched = new OperationsBoard({
      vault: vaultWith({ publicBaseUrl: "https://other.example.com/team" }),
      remote: remoteWith(null),
    });

    await expect(matching.isStorageConfigured()).resolves.toBe(true);
    await expect(mismatched.isStorageConfigured()).resolves.toBe(false);
  });

  it("needs no R2 and uses a last-known-good value after a read outage", async () => {
    const missing = new OperationsBoard({
      vault: vaultWith({ publicBaseUrl: null, storage: null }),
      remote: remoteWith(null),
    });
    await expect(missing.read()).resolves.toMatchObject({
      status: "ready",
      source: "empty",
      snapshot: { revision: 0, items: [] },
    });

    const freshEmpty = new OperationsBoard({
      vault: vaultWith({}),
      remote: remoteWith(null),
    });
    await expect(freshEmpty.read()).resolves.toMatchObject({
      status: "ready",
      source: "empty",
      stale: false,
    });
    await expect(freshEmpty.read()).resolves.toMatchObject({
      status: "ready",
      source: "empty",
      stale: false,
    });

    const read = vi.fn()
      .mockResolvedValueOnce({ snapshot: SNAPSHOT, etag: '"v3"' })
      .mockRejectedValueOnce(new Error("offline"));
    const board = new OperationsBoard({
      vault: vaultWith({}),
      remote: { read, put: vi.fn() },
    });
    await board.read();
    await expect(board.read()).resolves.toMatchObject({
      status: "unavailable",
      source: "last-known-good",
      stale: true,
      snapshot: SNAPSHOT,
    });

    const disappears = vi.fn()
      .mockResolvedValueOnce({ snapshot: SNAPSHOT, etag: '"v3"' })
      .mockResolvedValueOnce(null);
    const disappearingBoard = new OperationsBoard({
      vault: vaultWith({}),
      remote: { read: disappears, put: vi.fn() },
    });
    await disappearingBoard.read();
    await expect(disappearingBoard.read()).resolves.toMatchObject({
      status: "unavailable",
      source: "last-known-good",
      stale: true,
      snapshot: SNAPSHOT,
    });

    const invalidLegacy = new OperationsBoard({
      vault: {
        getImageStorage: vi.fn(async () => STORAGE),
        getOperationsBoardPublicBaseUrl: vi.fn(async () => {
          throw new Error("legacy URL no longer accepted");
        }),
      },
      remote: remoteWith(null),
    });
    await expect(invalidLegacy.read()).resolves.toMatchObject({
      status: "ready",
      source: "empty",
      stale: false,
    });
  });

  it("does a fresh revision check and one conditional write without blind retry", async () => {
    const remote = remoteWith({ snapshot: SNAPSHOT, etag: '"v3"' });
    const board = new OperationsBoard({
      vault: vaultWith({}),
      remote,
      now: () => new Date("2026-09-01T05:00:00.000Z"),
    });
    const items = SNAPSHOT.items.slice(0, 1);

    await expect(board.replace({ baseRevision: 3, items })).resolves.toMatchObject({
      revision: 4,
      updatedAt: "2026-09-01T05:00:00.000Z",
      items,
    });
    expect(remote.put).toHaveBeenCalledTimes(1);
    expect(remote.put).toHaveBeenCalledWith(
      expect.objectContaining({ key: OPERATIONS_BOARD_OBJECT_KEY }),
      expect.objectContaining({ ifMatch: '"v3"', ifNoneMatch: undefined }),
    );
    expect(remote.read).toHaveBeenCalledWith({
      key: OPERATIONS_BOARD_OBJECT_KEY,
      publicUrl: `https://assets.example.com/public/${OPERATIONS_BOARD_OBJECT_KEY}`,
    });

    await expect(board.replace({ baseRevision: 2, items }))
      .rejects.toMatchObject({ code: "OPERATIONS_BOARD_CONFLICT" });
    expect(remote.put).toHaveBeenCalledTimes(1);
  });

  it("rejects a valid but oversized UTF-8 snapshot before any remote write", async () => {
    const remote = remoteWith(null);
    const board = new OperationsBoard({ vault: vaultWith({}), remote });
    const items = Array.from({ length: 100 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "expiry" as const,
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "品".repeat(40),
      expiryDate: "2026-12-31",
      note: "備".repeat(500),
    }));

    await expect(board.replace({ baseRevision: 0, items }))
      .rejects.toMatchObject({ code: "OPERATIONS_BOARD_TOO_LARGE" });
    expect(remote.put).not.toHaveBeenCalled();

    const source = await readFile(
      new URL("../src/main/operations-board.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("abortSignal: abort.signal");
    expect(source).toContain("OPERATIONS_BOARD_WRITE_TIMEOUT_MS");
  });
});
