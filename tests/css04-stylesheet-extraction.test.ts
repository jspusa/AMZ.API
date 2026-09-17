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
  "styles/operations-intelligence.css",
  "styles/workspace-redesign.css",
  "styles/audit-suite-redesign.css",
  "styles/sales-redesign.css",
  "styles/bulletin-redesign.css",
  "styles/home-layout.css",
  "styles/variation-workspace.css",
  "styles/price-list.css",
  "styles/vine.css",
  "styles/usability-polish.css",
  "styles/audit-detail-reading.css",
  "styles/content-audit-focus.css",
  "styles/chart-compact.css",
  "styles/workflow-efficiency.css",
  "styles/inventory-health.css",
  "styles/audit-review.css",
  "styles/appearance.css",
  "styles/dark-palette.generated.css",
  "styles/dark-surfaces.css",
] as const;

// Current composed source includes intentional feature styles after the preserved epochs.
const ACCEPTED_SOURCE_TEXT_FINGERPRINT =
  "2c410f8fed35c7c7cde054d963abf53a5415010fb90ee364c9d3c2bd4e83be15";
const ACCEPTED_CSS04_PAYLOAD_FINGERPRINT =
  "c546c8192a299a526fd66c4655491eadb51a7acb731be9387f8001466d10a253";
const RETIRED_STYLESHEET = ["app", "css"].join(".");

const CSS04_PAYLOAD_EVIDENCE = [
  {
    path: "styles/image-home-audits.css",
    bytes: 24370,
    sha256: "1b85086d87610c40847caa87bc8728cc757cbc3ae647ee0bfd112875f1b017dc",
  },
  {
    path: "styles/operations-bulletin.css",
    bytes: 21_580,
    sha256: "2bed542b3790256bffc1aa762f7bda3fcbd1a26515fa35317a16cf475c235b55",
  },
  {
    path: "styles/audit-workspace.css",
    bytes: 6301,
    sha256: "609282f2ab6d946b54c4b16bf8fdfba6eb3703126e2130a0aca493d74a9e014d",
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
    expect(Buffer.byteLength(css04Payload)).toBe(120253);
    expect(createHash("sha256").update(css04Payload).digest("hex")).toBe(
      ACCEPTED_CSS04_PAYLOAD_FINGERPRINT,
    );

    const normalizedComposition = normalizeNewlines(composition.css);
    expect((normalizedComposition.match(/\n/gu) ?? []).length).toBe(29897);
    expect(Buffer.byteLength(normalizedComposition)).toBe(885819);
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
