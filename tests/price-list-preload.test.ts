import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiRequest, DesktopBridge } from "../src/shared/contracts";
const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => ({})),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("electron", () => ({ contextBridge: electron, ipcRenderer: electron }));
let bridge: DesktopBridge;
beforeAll(async () => {
  await import("../src/preload/index");
  bridge = electron.exposeInMainWorld.mock.calls[0]![1] as DesktopBridge;
});
const request = (path: string, size: number): ApiRequest => ({
  requestId: "fixture-request",
  method: "POST",
  path,
  query: {},
  headers: {},
  body: {
    kind: "multipart",
    fields: {},
    file: {
      name: "Price.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array(size),
    },
  },
});
describe("price-list bounded upload bridge", () => {
  it("accepts the actual workbook size only on the local price-list import route", async () => {
    await expect(
      bridge.api.request(request("/api/price-list/import", 18_593_339)),
    ).resolves.toEqual({});
    await expect(
      bridge.api.request(
        request("/api/sp-api/listing-content/import", 18_593_339),
      ),
    ).rejects.toThrow("15 MB");
    await expect(
      bridge.api.request(request("/api/uploads/listing-images", 18_593_339)),
    ).rejects.toThrow("15 MB");
  });
  it("does not allow a suffix or oversized price-list upload to broaden the limit", async () => {
    await expect(
      bridge.api.request(request("/api/price-list/import-extra", 18_593_339)),
    ).rejects.toThrow("15 MB");
    await expect(
      bridge.api.request(
        request("/api/price-list/import", 25 * 1024 * 1024 + 1),
      ),
    ).rejects.toThrow("25 MB");
  });
});
