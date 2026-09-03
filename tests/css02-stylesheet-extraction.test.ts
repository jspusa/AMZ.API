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
  "9e8573bd053bd6bd6d86a64ee1e325571bed963df0f900d042b0b2468cafdc70";

const CSS02_PAYLOAD_EVIDENCE = [
  {
    path: "styles/foundation.css",
    bytes: 16_544,
    sha256: "94d757af80a20d64e204ab2661360b5ae5e91e7120679e2c12067ee1f24a4ce9",
  },
  {
    path: "styles/legacy-shell-drawers.css",
    bytes: 37_904,
    sha256: "91130c6117784d7c2cc96dd12fcdaa9efd6632bf5540826e3643f27373d76842",
  },
  {
    path: "styles/subscription-accounting.css",
    bytes: 10_798,
    sha256: "a64414f03e2429307f2ad106c165b12b56c0aeb3d6b74b347686b032b71ad8cd",
  },
  {
    path: "styles/content.css",
    bytes: 4_847,
    sha256: "bfce82381b3bfa34e4960ca858a3ffee914e32188498d2edb433a079420ae18d",
  },
  {
    path: "styles/business-pricing.css",
    bytes: 20_754,
    sha256: "313733a87b0225276664a6b82209155de5b79ac8d9600bf66fe2678b5471799e",
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
