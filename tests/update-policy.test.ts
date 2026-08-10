import { describe, expect, it } from "vitest";
import { desktopUpdatePolicy } from "../src/main/update-policy";

describe("desktop updater platform policy", () => {
  it("keeps the existing packaged macOS updater enabled", () => {
    expect(desktopUpdatePolicy({ platform: "darwin", packaged: true })).toEqual({
      enabled: true,
      message: null,
    });
  });

  it("blocks the unsigned Windows channel from checking or installing updates", () => {
    const policy = desktopUpdatePolicy({ platform: "win32", packaged: true });
    expect(policy.enabled).toBe(false);
    expect(policy.message).toContain("內部未簽章版");
    expect(policy.message).toContain("App 內更新已停用");
    expect(policy.message).toContain("notebook-key-windows");
    expect(policy.message).toContain("SHA-256");
  });

  it("does not run the updater from development or unsupported platforms", () => {
    expect(desktopUpdatePolicy({ platform: "win32", packaged: false })).toEqual({
      enabled: false,
      message: "開發版不執行自動更新。",
    });
    expect(desktopUpdatePolicy({ platform: "linux", packaged: true }).enabled).toBe(false);
  });
});
