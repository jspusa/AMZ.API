import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "../scripts/stylesheet-composition.mjs";

const execFileAsync = promisify(execFile);

const CSS04_ORDERED_FILES = [
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
  "styles/image-home-audits.css",
  "styles/operations-bulletin.css",
  "styles/audit-workspace.css",
  "styles/brand-ads.css",
  "styles/desktop-updater.css",
  "styles/reports-reviews.css",
  "styles/final-overrides.css",
  "styles/fba-inbound.css",
] as const;

const ACCEPTED_SOURCE_TEXT_FINGERPRINT =
  "c1f74141c75166f6f0af6e598f5401dceadc9ee501a23a18ebb512fc43135301";
const ACCEPTED_CSS04_PAYLOAD_FINGERPRINT =
  "7963e2e9bd917df3d454dbbae5612203e3008679e674f46cfe8b172dcbd3ef86";
const RETIRED_STYLESHEET = ["app", "css"].join(".");

const CSS04_PAYLOAD_EVIDENCE = [
  {
    path: "styles/image-home-audits.css",
    bytes: 18_935,
    sha256: "515db75ed46655d52a6a6d85a0b1af935d23e29d1972ad12ad48d13647527c38",
  },
  {
    path: "styles/operations-bulletin.css",
    bytes: 21_580,
    sha256: "2bed542b3790256bffc1aa762f7bda3fcbd1a26515fa35317a16cf475c235b55",
  },
  {
    path: "styles/audit-workspace.css",
    bytes: 5_753,
    sha256: "cbe81366ed26700ec92a04afc1e6017bd780c8bc2b22ce439e8d7bd084ccfa39",
  },
  {
    path: "styles/brand-ads.css",
    bytes: 33_920,
    sha256: "4c489fff22c356ae427fcae0125c66c2181a0b3de6653d691fea6cf4d95feb2c",
  },
  {
    path: "styles/reports-reviews.css",
    bytes: 10_861,
    sha256: "ac15d12aef8b0e4609f921941c01fc39d974e73ecf86c8f466357263ecb5e2af",
  },
  {
    path: "styles/final-overrides.css",
    bytes: 5_810,
    sha256: "823683da97a3c2e3884cf0391a8e3c4e68171be6821fcb41c720d63c9856bb26",
  },
  {
    path: "styles/fba-inbound.css",
    bytes: 17_411,
    sha256: "dd728dfdc9d2eb3fc9864799bbeeab73699220011e4e77d14835493b8da9a0da",
  },
] as const;

const normalizeNewlines = (source: string): string =>
  source.replace(/\r\n?/gu, "\n");

describe("CSS04 final stylesheet extraction", () => {
  it("composes every historical epoch once and retires the monolith", async () => {
    const repositoryDirectory = fileURLToPath(new URL("../", import.meta.url));
    const rootDirectory = join(repositoryDirectory, "src/renderer/src");
    const composition = await verifyStylesheetComposition({
      entryPath: join(rootDirectory, "styles/index.css"),
      rootDirectory,
      expectedFiles: CSS04_ORDERED_FILES,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    expect(
      composition.files.map((file) =>
        relative(rootDirectory, file).split(sep).join("/"),
      ),
    ).toEqual(CSS04_ORDERED_FILES);

    const payloads = await Promise.all(
      CSS04_PAYLOAD_EVIDENCE.map(async ({ path }) => {
        const source = normalizeNewlines(
          await readFile(join(rootDirectory, path), "utf8"),
        );
        return {
          path,
          source,
          bytes: Buffer.byteLength(source),
          sha256: createHash("sha256").update(source).digest("hex"),
        };
      }),
    );
    expect(
      payloads.map(({ source: _source, ...evidence }) => evidence),
    ).toEqual(CSS04_PAYLOAD_EVIDENCE);

    const css04Payload = payloads.map(({ source }) => source).join("");
    expect(Buffer.byteLength(css04Payload)).toBe(114_270);
    expect(createHash("sha256").update(css04Payload).digest("hex")).toBe(
      ACCEPTED_CSS04_PAYLOAD_FINGERPRINT,
    );

    const normalizedComposition = normalizeNewlines(composition.css);
    expect((normalizedComposition.match(/\n/gu) ?? []).length).toBe(15_752);
    expect(Buffer.byteLength(normalizedComposition)).toBe(342_111);
    expect(
      createHash("sha256").update(normalizedComposition).digest("hex"),
    ).toBe(ACCEPTED_SOURCE_TEXT_FINGERPRINT);

    await expect(
      stat(join(rootDirectory, RETIRED_STYLESHEET)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", "src/renderer/src", "scripts", "tests"],
      { cwd: repositoryDirectory, encoding: "utf8" },
    );
    const retiredReferences: string[] = [];
    for (const path of stdout.split("\0").filter(Boolean)) {
      if (path === `src/renderer/src/${RETIRED_STYLESHEET}`) continue;
      if (
        (await readFile(join(repositoryDirectory, path), "utf8")).includes(
          RETIRED_STYLESHEET,
        )
      ) {
        retiredReferences.push(path);
      }
    }
    expect(retiredReferences).toEqual([]);
  });
});
