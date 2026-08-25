import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release and desktop platform contracts", () => {
  it("pins the signed macOS release actions and audits before signing or publishing", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/mac-release.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    expect(workflow).toContain(
      "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
    );
    expect(workflow).not.toContain("actions/checkout@v6");
    expect(workflow).not.toContain("actions/setup-node@v6");

    const validate = workflow.indexOf("npm run check");
    const audit = workflow.indexOf("npm audit --omit=dev");
    const signAndPublish = workflow.indexOf("Sign, notarize and upload draft release");
    expect(validate).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(validate);
    expect(signAndPublish).toBeGreaterThan(audit);
  });

  it("uses Node 24 as the repository and lockfile runtime contract", async () => {
    const [packageSource, lockSource, readme] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as { engines: { node: string } };
    const packageLock = JSON.parse(lockSource) as {
      packages: { "": { engines: { node: string } } };
    };

    expect(packageJson.engines.node).toBe("24.x");
    expect(packageLock.packages[""].engines.node).toBe("24.x");
    expect(readme).toContain("需求：Node.js 24");
  });

  it("does not expose the retired operating-system spellchecker bridge", async () => {
    const [main, preload, contracts, spellingRules] = await Promise.all([
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/shared/content-spelling-rules.ts", import.meta.url),
        "utf8",
      ),
    ]);

    expect(main).not.toContain("setSpellCheckerEnabled");
    expect(preload).not.toContain("webFrame");
    expect(preload).not.toContain("isWordMisspelled");
    expect(preload).not.toMatch(/\bspellcheck\s*:/u);
    expect(contracts).not.toContain("SpellcheckWordResult");
    expect(contracts).not.toMatch(/\bspellcheck\s*:/u);
    expect(spellingRules).toContain("createNSpell");
    expect(spellingRules).not.toContain("../renderer/");
  });

  it("has no unused bundled-renderer protocol or obsolete launcher implementation", async () => {
    const main = await readFile(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8",
    );

    expect(main).not.toContain('scheme: "fba-app"');
    expect(main).not.toContain('protocol.handle("fba-app"');
    expect(main).not.toContain("registerSchemesAsPrivileged");
    expect(main).not.toContain("registerAppProtocol");
    expect(main).toContain('url.protocol === "amz-api:"');
    expect(main).toContain("createdWindow.loadURL(REMOTE_CONSOLE_URL)");
    for (const obsoletePath of ["index.html", "script.js", "styles.css"]) {
      await expect(
        access(new URL(`../launcher/${obsoletePath}`, import.meta.url)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
