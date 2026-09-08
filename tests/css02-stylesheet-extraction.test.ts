import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "../scripts/stylesheet-composition.mjs";

const CSS02_ORDERED_PREFIX = [
  "styles/index.css",
  "styles/foundation.css",
  "styles/legacy-shell-drawers.css",
  "styles/subscription-accounting.css",
  "styles/content.css",
  "styles/business-pricing.css",
] as const;

const ACCEPTED_SOURCE_TEXT_FINGERPRINT =
  "3b60b71a5a472454366da126f0390cc857848b5e43c43a6c00b839b1abce7047";

const CSS02_PAYLOAD_EVIDENCE = [
  {
    path: "styles/foundation.css",
    bytes: 17068,
    sha256: "2a5878bdead450ea43ace815738f988d5f16df09f915e859c9c13a36167addb1",
  },
  {
    path: "styles/legacy-shell-drawers.css",
    bytes: 37_975,
    sha256: "2d8ff41b73a4fec8e7182374c52d2a16ec607d9dc00a7b71ae126020340fb669",
  },
  {
    path: "styles/subscription-accounting.css",
    bytes: 10_798,
    sha256: "a64414f03e2429307f2ad106c165b12b56c0aeb3d6b74b347686b032b71ad8cd",
  },
  {
    path: "styles/content.css",
    bytes: 7355,
    sha256: "e80e4fd38e16dd2fc75bc267c53f02b19f4afea59ba966bc722fc10712b8954a",
  },
  {
    path: "styles/business-pricing.css",
    bytes: 31117,
    sha256: "704ec17f48d414d94b47f2283bb3c19923c5a2cc767c13bc7b4986a67dea0e29",
  },
] as const;

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
      expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    const orderedFiles = composition.files.map((file) =>
      relative(rootDirectory, file).split(sep).join("/"),
    );
    expect(orderedFiles.slice(0, CSS02_ORDERED_PREFIX.length)).toEqual(
      CSS02_ORDERED_PREFIX,
    );
    expect(
      await Promise.all(
        CSS02_PAYLOAD_EVIDENCE.map(async ({ path }) => {
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
    ).toEqual(CSS02_PAYLOAD_EVIDENCE);
    expect(
      createHash("sha256")
        .update(composition.css.replace(/\r\n?/gu, "\n"))
        .digest("hex"),
    ).toBe(ACCEPTED_SOURCE_TEXT_FINGERPRINT);
  });
});
