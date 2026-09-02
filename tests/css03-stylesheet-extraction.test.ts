import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "../scripts/stylesheet-composition.mjs";

const CSS03_ORDERED_PREFIX = [
  "styles/index.css",
  "styles/foundation.css",
  "styles/legacy-shell-drawers.css",
  "styles/subscription-accounting.css",
  "styles/content.css",
  "styles/business-pricing.css",
  "styles/workspace-sales.css",
  "styles/operations.css",
  "styles/notebook-key-bridge.css",
  "styles/variation.css",
  "styles/experience.css",
] as const;

const ACCEPTED_SOURCE_TEXT_FINGERPRINT =
  "2b0123666ff093e5729b838c003e661d772f5ff1f8a14f61a2d92accd938a78b";

const CSS03_PAYLOAD_EVIDENCE = [
  {
    path: "styles/workspace-sales.css",
    bytes: 21_280,
    sha256: "53055734cf601a8303e6c266e275b4925fb74e7e201e03a403ec576ef3f98685",
  },
  {
    path: "styles/operations.css",
    bytes: 54_287,
    sha256: "89904d95ce60c0c0ca27026ef1f71ae519757dadf9313df826e6c926926aa456",
  },
  {
    path: "styles/notebook-key-bridge.css",
    bytes: 22_162,
    sha256: "afa613f87fc4ae42ad78161711fea658a14fa68535e043005401168979d23ad1",
  },
  {
    path: "styles/variation.css",
    bytes: 13_156,
    sha256: "e9c8a884b44584704438ba428958a498d8e8ae118ed0e382768565248781b1f6",
  },
  {
    path: "styles/experience.css",
    bytes: 16_689,
    sha256: "c3eefc35c6137d7b6b30626cf7adeb111a4bde2cd1b1d1f87764b9217959ca23",
  },
] as const;

describe("CSS03 historical stylesheet extraction", () => {
  it("composes the workspace through experience epochs once in accepted byte order", async () => {
    const rootDirectory = fileURLToPath(
      new URL("../src/renderer/src/", import.meta.url),
    );
    const composition = await verifyStylesheetComposition({
      entryPath: fileURLToPath(
        new URL("../src/renderer/src/styles/index.css", import.meta.url),
      ),
      rootDirectory,
      expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    const orderedFiles = composition.files.map((file) =>
      relative(rootDirectory, file).split(sep).join("/"),
    );
    expect(orderedFiles.slice(0, CSS03_ORDERED_PREFIX.length)).toEqual(
      CSS03_ORDERED_PREFIX,
    );
    expect(
      await Promise.all(
        CSS03_PAYLOAD_EVIDENCE.map(async ({ path }) => {
          const source = (
            await readFile(join(rootDirectory, path), "utf8")
          ).replace(/\r\n?/gu, "\n");
          return {
            path,
            bytes: Buffer.byteLength(source),
            sha256: createHash("sha256").update(source).digest("hex"),
          };
        }),
      ),
    ).toEqual(CSS03_PAYLOAD_EVIDENCE);
    expect(
      createHash("sha256")
        .update(composition.css.replace(/\r\n?/gu, "\n"))
        .digest("hex"),
    ).toBe(ACCEPTED_SOURCE_TEXT_FINGERPRINT);
  });
});
