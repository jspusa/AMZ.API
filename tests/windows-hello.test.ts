import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseWindowsHelloManifest,
  parseWindowsHelloToken,
  preflightWindowsHelloAddon,
  requestWindowsHello,
  type WindowsHelloAdapter,
} from "../src/main/windows-hello";

function adapter(token: string, overrides: Partial<WindowsHelloAdapter> = {}): WindowsHelloAdapter {
  return {
    platform: "win32",
    nativeWindowHandle: vi.fn(() => Buffer.alloc(8, 1)),
    verifyForWindow: vi.fn(async () => token),
    ...overrides,
  };
}

describe("Windows Hello verifier", () => {
  it("loads and validates the packaged addon without opening a Hello prompt", async () => {
    const bytes = Buffer.alloc(1_024, 7);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const verifyForWindow = vi.fn(async () => "verified");
    const loadModule = vi.fn(() => ({ verifyForWindow }));
    const readText = vi.fn(async () =>
      JSON.stringify({ file: "windows-hello.node", sha256: hash }),
    );
    const readBytes = vi.fn(async () => bytes);
    const fileInfo = vi.fn(async () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
    }));

    const appPath = resolve("app", "resources", "app.asar");
    const resourcesPath = resolve("app", "resources");
    await preflightWindowsHelloAddon(
      {
        platform: "win32",
        appPath,
        resourcesPath,
        packaged: true,
      },
      { readText, readBytes, fileInfo, loadModule },
    );

    expect(readText).toHaveBeenCalledWith(
      resolve(appPath, "out", "main", "windows-hello-manifest.json"),
    );
    expect(loadModule).toHaveBeenCalledWith(
      resolve(
        resourcesPath,
        "app.asar.unpacked",
        "out",
        "main",
        "native",
        "windows-hello.node",
      ),
    );
    expect(verifyForWindow).not.toHaveBeenCalled();
  });

  it("fails the load-only preflight before require when the addon hash differs", async () => {
    const loadModule = vi.fn(() => ({ verifyForWindow: vi.fn() }));
    await expect(
      preflightWindowsHelloAddon(
        {
          platform: "win32",
          appPath: "/app/resources/app.asar",
          resourcesPath: "/app/resources",
          packaged: true,
        },
        {
          readText: async () => JSON.stringify({
            file: "windows-hello.node",
            sha256: "0".repeat(64),
          }),
          readBytes: async () => Buffer.alloc(1_024, 1),
          fileInfo: async () => ({
            isFile: () => true,
            isSymbolicLink: () => false,
          }),
          loadModule,
        },
      ),
    ).rejects.toThrow("WINDOWS_HELLO_ADDON_INTEGRITY_FAILED");
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("accepts only the exact packaged addon manifest", () => {
    const hash = "a".repeat(64);
    expect(
      parseWindowsHelloManifest(
        JSON.stringify({ file: "windows-hello.node", sha256: hash }),
      ),
    ).toEqual({ file: "windows-hello.node", sha256: hash });
    expect(() =>
      parseWindowsHelloManifest(
        JSON.stringify({ file: "windows-hello.node", sha256: hash, path: "other" }),
      ),
    ).toThrow("WINDOWS_HELLO_MANIFEST_INVALID");
    expect(() =>
      parseWindowsHelloManifest(
        JSON.stringify({ file: "windows-hello.node", sha256: hash.toUpperCase() }),
      ),
    ).toThrow("WINDOWS_HELLO_MANIFEST_INVALID");
    expect(() => parseWindowsHelloManifest("not-json")).toThrow(
      "WINDOWS_HELLO_MANIFEST_INVALID",
    );
  });

  it("accepts only the addon's fixed output vocabulary", () => {
    expect(parseWindowsHelloToken("verified")).toBe("verified");
    expect(parseWindowsHelloToken("not-configured")).toBe("not-configured");
    expect(parseWindowsHelloToken("verified\n")).toBeNull();
    expect(parseWindowsHelloToken('{"verified":true}')).toBeNull();
  });

  it("binds verification to the active Electron HWND and main reason", async () => {
    const handle = Buffer.alloc(8, 7);
    const current = adapter("verified", {
      nativeWindowHandle: vi.fn(() => handle),
    });
    await expect(requestWindowsHello("確認更新商品內容", current)).resolves.toBe("verified");
    expect(current.verifyForWindow).toHaveBeenCalledWith(handle, "確認更新商品內容");
  });

  it("allows native fallback only when Hello is absent or unavailable by policy", async () => {
    for (const token of [
      "device-not-present",
      "not-configured",
      "disabled-by-policy",
      "unsupported",
    ]) {
      await expect(requestWindowsHello("確認更新", adapter(token))).resolves.toBe("unavailable");
    }
    await expect(requestWindowsHello("確認更新", adapter("canceled"))).rejects.toThrow("WINDOWS_HELLO_CANCELED");
    await expect(requestWindowsHello("確認更新", adapter("device-busy"))).rejects.toThrow("WINDOWS_HELLO_DEVICE_BUSY");
    await expect(requestWindowsHello("確認更新", adapter("retries-exhausted"))).rejects.toThrow("WINDOWS_HELLO_RETRIES_EXHAUSTED");
  });

  it("fails closed for invalid window handles and unknown native results", async () => {
    const verifyForWindow = vi.fn(async () => "verified");
    await expect(requestWindowsHello("確認更新", adapter("verified", {
      nativeWindowHandle: vi.fn(() => Buffer.alloc(4)),
      verifyForWindow,
    }))).rejects.toThrow("WINDOWS_HELLO_WINDOW_UNAVAILABLE");
    expect(verifyForWindow).not.toHaveBeenCalled();

    await expect(requestWindowsHello("確認更新", adapter("verified\n"))).rejects.toThrow(
      "WINDOWS_HELLO_VERIFICATION_FAILED",
    );
  });

  it("rejects control characters before showing a system-owned prompt", async () => {
    const current = adapter("verified");
    await expect(requestWindowsHello("確認更新\n另一筆操作", current)).rejects.toThrow(
      "WINDOWS_HELLO_REASON_INVALID",
    );
    expect(current.nativeWindowHandle).not.toHaveBeenCalled();
    expect(current.verifyForWindow).not.toHaveBeenCalled();
  });

  it("does not load the Windows addon on another platform", async () => {
    const current = adapter("verified", { platform: "darwin" });
    await expect(requestWindowsHello("確認更新", current)).resolves.toBe("unavailable");
    expect(current.nativeWindowHandle).not.toHaveBeenCalled();
    expect(current.verifyForWindow).not.toHaveBeenCalled();
  });
});
