import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "../scripts/stylesheet-composition.mjs";

const CSS02_ORDERED_FILES = [
  "styles/index.css",
  "styles/foundation.css",
  "styles/legacy-shell-drawers.css",
  "styles/subscription-accounting.css",
  "styles/content.css",
  "styles/business-pricing.css",
  "app" + ".css",
] as const;

const ACCEPTED_SOURCE_TEXT_FINGERPRINT =
  "7ddb84bf404826a4ce1af22a1f2bb7abd43d103d9474be75c6647882173f583c";

describe("CSS02 historical stylesheet extraction", () => {
  it("composes the first historical epochs once in their accepted byte order", async () => {
    const rootDirectory = fileURLToPath(
      new URL("../src/renderer/src/", import.meta.url),
    );
    const composition = await verifyStylesheetComposition({
      entryPath: fileURLToPath(
        new URL("../src/renderer/src/styles/index.css", import.meta.url),
      ),
      rootDirectory,
      expectedFiles: CSS02_ORDERED_FILES,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    expect(
      composition.files.map((file) =>
        relative(rootDirectory, file).split(sep).join("/"),
      ),
    ).toEqual(CSS02_ORDERED_FILES);
    expect(
      createHash("sha256")
        .update(composition.css.replace(/\r\n?/gu, "\n"))
        .digest("hex"),
    ).toBe(ACCEPTED_SOURCE_TEXT_FINGERPRINT);
  });
});
