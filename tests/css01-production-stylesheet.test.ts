import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyRendererStylesheetBuild } from "../scripts/verify-renderer-stylesheet-build.mjs";

const temporaryDirectories: string[] = [];
const TWO_RULE_FINGERPRINT =
  "01ebc53fa12e8215f8d9e93328698f47fedc8c26f4b4550f3dd74f06e8dcd991";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createProductionFixture(options?: {
  readonly builtCss?: string;
  readonly stylesheetLinks?: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), "amz-api-css01-build-"));
  temporaryDirectories.push(directory);
  const sourceRoot = join(directory, "src");
  const outDirectory = join(directory, "out");
  await Promise.all([
    mkdir(join(sourceRoot, "styles"), { recursive: true }),
    mkdir(join(outDirectory, "assets"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(sourceRoot, "styles", "index.css"),
      '@import "../first.css";\n@import "../second.css";\n',
    ),
    writeFile(join(sourceRoot, "first.css"), "a { color: red; }\n"),
    writeFile(join(sourceRoot, "second.css"), "b { color: blue; }\n"),
    writeFile(
      join(outDirectory, "index.html"),
      `<!doctype html><html><head>${
        options?.stylesheetLinks ??
        '<link rel="stylesheet" href="./assets/index.css">'
      }</head><body></body></html>`,
    ),
    writeFile(
      join(outDirectory, "assets", "index.css"),
      options?.builtCss ?? "a { color: red; }\nb { color: blue; }\n",
    ),
  ]);
  return { outDirectory, sourceRoot };
}

describe("CSS01 production stylesheet parity", () => {
  it("proves the built asset resolves to the pinned source rule stream", async () => {
    const fixture = await createProductionFixture();

    const result = await verifyRendererStylesheetBuild({
      expectedFingerprint: TWO_RULE_FINGERPRINT,
      expectedSourceFiles: [
        "styles/index.css",
        "first.css",
        "second.css",
      ],
      rendererOutDirectory: fixture.outDirectory,
      sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
      sourceRootDirectory: fixture.sourceRoot,
    });

    expect(result.builtCssFile).toBe("assets/index.css");
    expect(result.fingerprint).toBe(TWO_RULE_FINGERPRINT);
  });

  it("rejects multiple production stylesheets", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<link rel="stylesheet" href="./assets/index.css"><link href="./assets/other.css" rel="stylesheet">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/exactly one local stylesheet link/u);
  });

  it("does not let a text less-than sign hide an earlier stylesheet", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '2 < 3 <link rel="stylesheet" href="./assets/shadow.css"><link rel="stylesheet" href="./assets/index.css">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/exactly one local stylesheet link/u);
  });

  it.each([
    '<title><link rel="stylesheet" href="./assets/index.css"></title>',
    '<textarea><link rel="stylesheet" href="./assets/index.css"></textarea>',
  ])("does not treat raw-text content as an applied stylesheet: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/renderer HTML|exactly one local stylesheet link/u);
  });

  it.each([
    '<script></script\u00a0><link rel="stylesheet" href="./assets/index.css">',
    '<script></ſcript><link rel="stylesheet" href="./assets/index.css">',
    '<title></title\u00a0><link rel="stylesheet" href="./assets/index.css">',
  ])("does not treat non-HTML whitespace as a raw-text closing delimiter: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/unterminated <(?:script|title)>/u);
  });

  it.each([
    '<script></SCRIPT><link rel="stylesheet" href="./assets/shadow.css"><script></script><link rel="stylesheet" href="./assets/index.css">',
    '<title></TITLE><link rel="stylesheet" href="./assets/shadow.css"><title></title><link rel="stylesheet" href="./assets/index.css">',
  ])("rejects a non-canonical raw-text closer before it can hide a stylesheet: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/non-canonical <\/(?:script|title)>/u);
  });

  it("rejects inline script content that can change HTML tokenizer state", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<script><!--<script></script><link rel="stylesheet" href="./assets/index.css">--></script>',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/inline script content/u);
  });

  it("rejects HTML comments that could hide stylesheet-like markup", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<!-- <link rel="stylesheet" href="./assets/shadow.css"> --><link rel="stylesheet" href="./assets/index.css">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/HTML comments/u);
  });

  it("ignores exact data-* stylesheet lookalike attributes", async () => {
    const stylesheetLinks =
      '<link data-rel="stylesheet" data-href="./assets/shadow.css"><link rel="stylesheet" href="./assets/index.css">';
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).resolves.toMatchObject({
      builtCssFile: "assets/index.css",
      fingerprint: TWO_RULE_FINGERPRINT,
    });
  });

  it("rejects a character reference that hides a second applied stylesheet", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<link rel="style&#x73;heet" href="./assets/shadow.css"><link rel="stylesheet" href="./assets/index.css">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/character references/u);
  });

  it.each([
    '<link rel="stylesheet" disabled href="./assets/index.css">',
    '<link rel="stylesheet" media="print" href="./assets/index.css">',
    '<link rel="alternate stylesheet" href="./assets/index.css">',
    '<link rel="\u00a0stylesheet\u00a0" href="./assets/index.css">',
    '<link rel="stylesheet" media="\u00a0all\u00a0" href="./assets/index.css">',
  ])("rejects a stylesheet the browser does not apply unconditionally: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(
      /unconditional active stylesheet|exactly one local stylesheet link|unsupported stylesheet-link attribute/u,
    );
  });

  it.each([
    '<link rel="stylesheet" type="text/plain" href="./assets/index.css">',
    '<link rel="stylesheet" integrity="sha256-invalid" href="./assets/index.css">',
  ])("rejects an unverified stylesheet-link attribute: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/unsupported stylesheet-link attribute/u);
  });

  it("rejects an unverified inline stylesheet in the renderer document", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<style>body { color: red; }</style><link rel="stylesheet" href="./assets/index.css">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/inline stylesheet/u);
  });

  it("rejects a renderer CSP that blocks the verified stylesheet", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<meta http-equiv="Content-Security-Policy" content="style-src \'none\'"><link rel="stylesheet" href="./assets/index.css">',
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/Content-Security-Policy/u);
  });

  it("rejects a built rule stream that differs from source", async () => {
    const fixture = await createProductionFixture({
      builtCss: "b { color: blue; }\na { color: red; }\n",
    });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/ordered rule-stream fingerprint changed/u);
  });

  it.each([
    '<link rel="stylesheet" href="https://example.com/index.css">',
    '<link rel="stylesheet" href="/assets/index.css">',
    '<link rel="stylesheet" href="./assets/index.css?v=1">',
  ])("rejects a non-local production stylesheet: %s", async (stylesheetLinks) => {
    const fixture = await createProductionFixture({ stylesheetLinks });

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/local relative CSS asset/u);
  });

  it("rejects percent-encoded dot segments before filesystem resolution", async () => {
    const fixture = await createProductionFixture({
      stylesheetLinks:
        '<link rel="stylesheet" href="./assets/%2e%2e/index.css">',
    });
    const literalDirectory = join(
      fixture.outDirectory,
      "assets",
      "%2e%2e",
    );
    await mkdir(literalDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        join(literalDirectory, "index.css"),
        "a { color: red; }\nb { color: blue; }\n",
      ),
      writeFile(
        join(fixture.outDirectory, "index.css"),
        "body { color: black; }\n",
      ),
    ]);

    await expect(
      verifyRendererStylesheetBuild({
        expectedFingerprint: TWO_RULE_FINGERPRINT,
        expectedSourceFiles: [
          "styles/index.css",
          "first.css",
          "second.css",
        ],
        rendererOutDirectory: fixture.outDirectory,
        sourceEntryPath: join(fixture.sourceRoot, "styles", "index.css"),
        sourceRootDirectory: fixture.sourceRoot,
      }),
    ).rejects.toThrow(/safe ASCII local CSS asset/u);
  });
});
