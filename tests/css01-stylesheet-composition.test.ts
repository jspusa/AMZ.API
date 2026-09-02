import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RENDERER_STYLESHEET_CONTRACT } from "../scripts/renderer-stylesheet-contract.mjs";
import { verifyStylesheetComposition } from "../scripts/stylesheet-composition.mjs";

const temporaryDirectories: string[] = [];
const TWO_RULE_FINGERPRINT =
  "01ebc53fa12e8215f8d9e93328698f47fedc8c26f4b4550f3dd74f06e8dcd991";
const MULTILINE_SELECTOR_FINGERPRINT =
  "12e71dfa26f353d10fbac14a99383084f0be86aa69d631738e66fad191b9cf52";
const RETIRED_STYLESHEET = ["app", "css"].join(".");

function byteLengthWithLfLineEndings(source: string): number {
  return Buffer.byteLength(source.replace(/\r\n?/gu, "\n"));
}

async function createFixture(files: Readonly<Record<string, string>>) {
  const directory = await mkdtemp(join(tmpdir(), "amz-api-css01-"));
  temporaryDirectories.push(directory);
  for (const [path, contents] of Object.entries(files)) {
    const filePath = join(directory, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }
  return directory;
}

async function listFiles(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listFiles(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("CSS01 renderer stylesheet composition", () => {
  it("loads renderer styles through one ordered composition entry", async () => {
    const mainSource = await readFile(
      new URL("../src/renderer/src/main.tsx", import.meta.url),
      "utf8",
    );
    const stylesheetImports = Array.from(
      mainSource.matchAll(/^\s*import\s+["']([^"']+\.css)["'];?\s*$/gmu),
      (match) => match[1],
    );

    expect(stylesheetImports).toEqual(["./styles/index.css"]);

    const entrySource = await readFile(
      new URL("../src/renderer/src/styles/index.css", import.meta.url),
      "utf8",
    );
    expect(entrySource.replace(/\r\n?/gu, "\n")).toBe(
      [
        '@import "./foundation.css";',
        '@import "./legacy-shell-drawers.css";',
        '@import "./subscription-accounting.css";',
        '@import "./content.css";',
        '@import "./business-pricing.css";',
        '@import "./workspace-sales.css";',
        '@import "./operations.css";',
        '@import "./notebook-key-bridge.css";',
        '@import "./variation.css";',
        '@import "./experience.css";',
        '@import "./image-home-audits.css";',
        '@import "./operations-bulletin.css";',
        '@import "./audit-workspace.css";',
        '@import "./brand-ads.css";',
        '@import "./desktop-updater.css";',
        '@import "./reports-reviews.css";',
        '@import "./final-overrides.css";',
        '@import "./fba-inbound.css";',
        "",
      ].join("\n"),
    );
  });

  it("recursively composes local styles in order and pins the logical stream", async () => {
    const directory = await createFixture({
      "index.css": '@import "./first.css";\r\n@import "./second.css";\r\n',
      "first.css": "a { color: red; }\r\n",
      "second.css": "b { color: blue; }\n",
    });

    const composition = await verifyStylesheetComposition({
      entryPath: join(directory, "index.css"),
      rootDirectory: directory,
      expectedFiles: ["index.css", "first.css", "second.css"],
      expectedFingerprint: TWO_RULE_FINGERPRINT,
    });

    expect(composition.files.map((file) => basename(file))).toEqual([
      "index.css",
      "first.css",
      "second.css",
    ]);
    expect(composition.css).toBe("a { color: red; }\r\nb { color: blue; }\n");
    expect(composition.fingerprint).toBe(TWO_RULE_FINGERPRINT);
  });

  it("treats checkout line endings as formatting in the logical stream", async () => {
    const directory = await createFixture({
      "index.css": '@import "./payload.css";\r\n',
      "payload.css": "button,\r\ninput { color: red; }\r\n",
    });

    const composition = await verifyStylesheetComposition({
      entryPath: join(directory, "index.css"),
      rootDirectory: directory,
      expectedFiles: ["index.css", "payload.css"],
      expectedFingerprint: MULTILINE_SELECTOR_FINGERPRINT,
    });

    expect(composition.fingerprint).toBe(MULTILINE_SELECTOR_FINGERPRINT);
  });

  it("pins the accepted current renderer rule stream through the ordered modules", async () => {
    const rootDirectory = fileURLToPath(
      new URL("../src/renderer/src/", import.meta.url),
    );
    const composition = await verifyStylesheetComposition({
      entryPath: join(rootDirectory, "styles", "index.css"),
      rootDirectory,
      expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    expect(
      composition.files.map((file) =>
        relative(rootDirectory, file).split(sep).join("/"),
      ),
    ).toEqual(RENDERER_STYLESHEET_CONTRACT.expectedFiles);
    expect(composition.canonicalJson).toHaveLength(489_139);
    expect(byteLengthWithLfLineEndings(composition.css)).toBe(329_664);
    expect(composition.fingerprint).toBe(
      RENDERER_STYLESHEET_CONTRACT.fingerprint,
    );
  });

  it("keeps the logical renderer fingerprint stable across Git checkout line endings", async () => {
    const rendererRoot = fileURLToPath(
      new URL("../src/renderer/src/", import.meta.url),
    );
    const toCrLf = (source: string) => source.replace(/\r?\n/gu, "\r\n");
    const crLfFiles = Object.fromEntries(
      await Promise.all(
        RENDERER_STYLESHEET_CONTRACT.expectedFiles.map(async (path) => [
          path,
          toCrLf(await readFile(join(rendererRoot, path), "utf8")),
        ]),
      ),
    );
    const directory = await createFixture(crLfFiles);

    const composition = await verifyStylesheetComposition({
      entryPath: join(directory, "styles", "index.css"),
      rootDirectory: directory,
      expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });

    expect(composition.css).toContain("\r\n");
    expect(Buffer.byteLength(composition.css)).toBe(344_885);
    expect(byteLengthWithLfLineEndings(composition.css)).toBe(329_664);
    expect(composition.fingerprint).toBe(
      RENDERER_STYLESHEET_CONTRACT.fingerprint,
    );
  });

  it("keeps every renderer stylesheet reachable through the entry and bans bypasses", async () => {
    const projectRoot = fileURLToPath(new URL("../", import.meta.url));
    const rootDirectory = join(projectRoot, "src", "renderer", "src");
    const composition = await verifyStylesheetComposition({
      entryPath: join(rootDirectory, "styles", "index.css"),
      rootDirectory,
      expectedFiles: RENDERER_STYLESHEET_CONTRACT.expectedFiles,
      expectedFingerprint: RENDERER_STYLESHEET_CONTRACT.fingerprint,
    });
    const relativeCompositionFiles = composition.files
      .map((file) => relative(rootDirectory, file).split(sep).join("/"))
      .sort();
    const rendererFiles = (await listFiles(rootDirectory)).filter(
      (file) => !basename(file).includes(" 2."),
    );
    const rendererCssFiles = rendererFiles
      .filter((file) => file.endsWith(".css"))
      .map((file) => relative(rootDirectory, file).split(sep).join("/"))
      .sort();
    expect(relativeCompositionFiles).toEqual(rendererCssFiles);

    const rendererCssImports: string[] = [];
    for (const file of rendererFiles.filter((path) => /\.tsx?$/u.test(path))) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(
        /^\s*import\s+["']([^"']+\.css)["'];?\s*$/gmu,
      )) {
        rendererCssImports.push(
          `${relative(rootDirectory, file).split(sep).join("/")}:${match[1]}`,
        );
      }
    }
    expect(rendererCssImports).toEqual(["main.tsx:./styles/index.css"]);

    const testDirectory = join(projectRoot, "tests");
    const bypasses: string[] = [];
    const currentTestPath = fileURLToPath(import.meta.url);
    const retirementContractPath = join(
      testDirectory,
      "css04-stylesheet-extraction.test.ts",
    );
    for (const file of (await listFiles(testDirectory)).filter(
      (path) =>
        /\.tsx?$/u.test(path) &&
        !basename(path).includes(" 2.") &&
        path !== currentTestPath &&
        path !== retirementContractPath,
    )) {
      if ((await readFile(file, "utf8")).includes(RETIRED_STYLESHEET)) {
        bypasses.push(relative(testDirectory, file).split(sep).join("/"));
      }
    }
    expect(bypasses).toEqual([]);
  });

  it("rejects an ordering change against the pinned logical stream", async () => {
    const directory = await createFixture({
      "index.css": '@import "./second.css";\n@import "./first.css";\n',
      "first.css": "a { color: red; }\n",
      "second.css": "b { color: blue; }\n",
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "index.css"),
        rootDirectory: directory,
        expectedFiles: ["index.css", "first.css", "second.css"],
        expectedFingerprint: TWO_RULE_FINGERPRINT,
      }),
    ).rejects.toThrow(/ordered stylesheet files changed/u);
  });

  it("rejects reordered empty manifests even when the rule stream is unchanged", async () => {
    const directory = await createFixture({
      "index.css": '@import "./second.css";\n@import "./first.css";\n',
      "first.css": "/* first */\n",
      "second.css": "/* second */\n",
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "index.css"),
        rootDirectory: directory,
        expectedFiles: ["index.css", "first.css", "second.css"],
        expectedFingerprint: "43ffb9945d12475f43f42a283dce7fb1c10065f317c2d3a1e92a610b8b9b7d2f",
      }),
    ).rejects.toThrow(/ordered stylesheet files changed/u);
  });

  it("rejects direct and transitive duplicate imports", async () => {
    const direct = await createFixture({
      "index.css": '@import "./shared.css";\n@import "./shared.css";\n',
      "shared.css": "a { color: red; }\n",
    });
    const transitive = await createFixture({
      "index.css": '@import "./first.css";\n@import "./second.css";\n',
      "first.css": '@import "./shared.css";\n',
      "second.css": '@import "./shared.css";\n',
      "shared.css": "a { color: red; }\n",
    });

    for (const directory of [direct, transitive]) {
      await expect(
        verifyStylesheetComposition({
          entryPath: join(directory, "index.css"),
          rootDirectory: directory,
          expectedFingerprint: "0".repeat(64),
        }),
      ).rejects.toThrow(/duplicate import/u);
    }
  });

  it("rejects import cycles before treating the active file as a duplicate", async () => {
    const directory = await createFixture({
      "index.css": '@import "./first.css";\n',
      "first.css": '@import "./second.css";\n',
      "second.css": '@import "./first.css";\n',
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "index.css"),
        rootDirectory: directory,
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/import cycle/u);
  });

  it("rejects missing imports", async () => {
    const directory = await createFixture({
      "index.css": '@import "./missing.css";\n',
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "index.css"),
        rootDirectory: directory,
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/imported stylesheet is missing/u);
  });

  it.each([
    '@import "https://example.com/theme.css";\n',
    '@import url("./theme.css");\n',
    '@import "/theme.css";\n',
    '@import "data:text/css,a{}";\n',
    '@import "theme.css";\n',
    '@import "./theme.css?version=1";\n',
    '@import "./theme.css#fragment";\n',
    '@import "./theme.css" screen;\n',
    '@import "./theme.css" layer(base);\n',
  ])("rejects an external or qualified import: %s", async (manifest) => {
    const directory = await createFixture({
      "index.css": manifest,
      "theme.css": "a { color: red; }\n",
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "index.css"),
        rootDirectory: directory,
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/@import/u);
  });

  it("rejects an import that escapes the stylesheet root", async () => {
    const directory = await createFixture({
      "root/index.css": '@import "../outside.css";\n',
      "outside.css": "a { color: red; }\n",
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(directory, "root", "index.css"),
        rootDirectory: join(directory, "root"),
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/import escapes the stylesheet root/u);
  });

  it("rejects nested imports and imports mixed with CSS rules", async () => {
    const nested = await createFixture({
      "index.css": '@media screen { @IMPORT "./theme.css"; }\n',
      "theme.css": "a { color: red; }\n",
    });
    const mixed = await createFixture({
      "index.css": 'a { color: red; }\n@import "./theme.css";\n',
      "theme.css": "b { color: blue; }\n",
    });

    await expect(
      verifyStylesheetComposition({
        entryPath: join(nested, "index.css"),
        rootDirectory: nested,
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/nested @import/u);
    await expect(
      verifyStylesheetComposition({
        entryPath: join(mixed, "index.css"),
        rootDirectory: mixed,
        expectedFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow(/composition manifest must contain only comments and @import rules/u);
  });
});
