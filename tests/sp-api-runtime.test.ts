import { describe, expect, it } from "vitest";
import {
  buildSpApiUserAgent,
  spApiUserAgent,
} from "../src/main/amazon/sp-api-runtime";

describe("SP-API runtime identity", () => {
  it.each([
    ["darwin", "macOS"],
    ["win32", "Windows"],
    ["linux", "Linux"],
  ] as const)("uses the AMZ.API product and actual %s platform", (platform, label) => {
    expect(buildSpApiUserAgent({ platform, version: "0.1.16" })).toBe(
      `AMZ.API/0.1.16 (Language=TypeScript; Platform=${label})`,
    );
  });

  it("rejects an unsafe version token", () => {
    expect(() => buildSpApiUserAgent({
      platform: "darwin",
      version: "0.1.16\r\nX-Test: injected",
    })).toThrow("SP-API User-Agent 版本無效");
  });

  it("does not allow process-global environment text to override runtime identity", () => {
    const previous = process.env.SP_API_USER_AGENT;
    process.env.SP_API_USER_AGENT = "Other.Product/9.9 (Platform=Other)";
    try {
      expect(spApiUserAgent()).toBe(buildSpApiUserAgent({
        platform: process.platform,
        version: "0.1.22",
      }));
    } finally {
      if (previous === undefined) delete process.env.SP_API_USER_AGENT;
      else process.env.SP_API_USER_AGENT = previous;
    }
  });
});
