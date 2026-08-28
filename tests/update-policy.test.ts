import { describe, expect, it } from "vitest";
import {
  desktopUpdateChannelFromPackageMetadata,
  desktopUpdatePolicy,
} from "../src/main/update-policy";

describe("desktop updater platform policy", () => {
  it("accepts only the exact signed-channel marker from packaged metadata", () => {
    expect(desktopUpdateChannelFromPackageMetadata({
      amzApiUpdateChannel: "publisher-signed-v1",
    })).toBe("publisher-signed-v1");
    expect(desktopUpdateChannelFromPackageMetadata({
      amzApiUpdateChannel: "publisher-signed-v2",
    })).toBe("disabled");
    expect(desktopUpdateChannelFromPackageMetadata(null)).toBe("disabled");
  });

  it("enables updater only for a publisher-signed packaged macOS build", () => {
    expect(desktopUpdatePolicy({
      platform: "darwin",
      packaged: true,
      updateChannel: "publisher-signed-v1",
    })).toEqual({
      enabled: true,
      message: null,
    });
    expect(desktopUpdatePolicy({
      platform: "darwin",
      packaged: true,
      updateChannel: "disabled",
    }).enabled).toBe(false);
  });

  it("enables updater only for a publisher-signed packaged Windows build", () => {
    expect(desktopUpdatePolicy({
      platform: "win32",
      packaged: true,
      updateChannel: "publisher-signed-v1",
    })).toEqual({ enabled: true, message: null });

    const policy = desktopUpdatePolicy({
      platform: "win32",
      packaged: true,
      updateChannel: "disabled",
    });
    expect(policy.enabled).toBe(false);
    expect(policy.message).toContain("內部未簽章版");
    expect(policy.message).toContain("App 內更新已停用");
    expect(policy.message).toContain("notebook-key-windows");
    expect(policy.message).toContain("SHA-256");
  });

  it("does not run the updater from development or unsupported platforms", () => {
    expect(desktopUpdatePolicy({
      platform: "win32",
      packaged: false,
      updateChannel: "publisher-signed-v1",
    })).toEqual({
      enabled: false,
      message: "開發版不執行自動更新。",
    });
    expect(desktopUpdatePolicy({
      platform: "linux",
      packaged: true,
      updateChannel: "publisher-signed-v1",
    }).enabled).toBe(false);
  });
});
