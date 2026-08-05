import { describe, expect, it } from "vitest";
import {
  DEV_RENDERER_ORIGIN,
  REMOTE_CONSOLE_URL,
  isTrustedRendererDocument,
} from "../src/main/renderer-trust";

describe("remote renderer trust boundary", () => {
  it("accepts only the AMZ.API GitHub Pages document", () => {
    expect(isTrustedRendererDocument(REMOTE_CONSOLE_URL, null)).toBe(true);
    expect(
      isTrustedRendererDocument(
        "https://jspusa.github.io/AMZ.API/index.html",
        null,
      ),
    ).toBe(true);
    expect(
      isTrustedRendererDocument("https://jspusa.github.io/3D/", null),
    ).toBe(false);
    expect(
      isTrustedRendererDocument(
        "https://jspusa.github.io/AMZ.API/?action=write",
        null,
      ),
    ).toBe(false);
    expect(
      isTrustedRendererDocument("https://jspusa.github.io.evil.test/AMZ.API/", null),
    ).toBe(false);
  });

  it("allows the fixed loopback origin only during development", () => {
    expect(
      isTrustedRendererDocument(`${DEV_RENDERER_ORIGIN}/`, DEV_RENDERER_ORIGIN),
    ).toBe(true);
    expect(
      isTrustedRendererDocument("http://localhost:5173/", DEV_RENDERER_ORIGIN),
    ).toBe(false);
    expect(
      isTrustedRendererDocument(REMOTE_CONSOLE_URL, DEV_RENDERER_ORIGIN),
    ).toBe(false);
  });
});
