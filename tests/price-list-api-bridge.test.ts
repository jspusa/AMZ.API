import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("price list renderer file bridge", () => {
  it("passes the real workbook size through only the exact price-list import intent", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: { kind: "json", value: { imported: true } },
    }));
    vi.stubGlobal("window", {
      location: { href: "https://jspusa.github.io/AMZ.API/" },
      fbaOS: { api: { request } },
    });
    const { installApiBridge } = await import("../src/renderer/src/api-bridge");
    installApiBridge();
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(18_593_339)], "synthetic.xlsx"),
    );
    expect(
      (await fetch("/api/price-list/import", { method: "POST", body: form }))
        .status,
    ).toBe(200);
    expect(request).toHaveBeenCalledOnce();
    for (const path of [
      "/api/uploads/listing-images",
      "/api/sp-api/listing-content/import",
      "/api/price-list/import-extra",
    ]) {
      await expect(fetch(path, { method: "POST", body: form })).rejects.toThrow(
        "15 MB",
      );
    }
    await expect(
      fetch("/api/price-list/import", { method: "PUT", body: form }),
    ).rejects.toThrow("15 MB");
    const oversized = new FormData();
    oversized.append(
      "file",
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.xlsx"),
    );
    await expect(
      fetch("/api/price-list/import", { method: "POST", body: oversized }),
    ).rejects.toThrow("25 MB");
    expect(request).toHaveBeenCalledOnce();
  });
});
