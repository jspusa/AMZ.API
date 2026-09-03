import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release and desktop platform contracts", () => {
  it("uses one pinned publisher-signed release workflow for both desktop platforms", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/desktop-release.yml", import.meta.url),
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

    await expect(
      access(new URL("../.github/workflows/mac-release.yml", import.meta.url)),
    ).rejects.toMatchObject({ code: "ENOENT" });
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

  it("keeps the Pages console compatible with a pre-bootstrap Notebook Key", async () => {
    const [contracts, connectionPanel] = await Promise.all([
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/renderer/src/connection-panel.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(contracts).toContain("current?(): Promise<UpdateStatus>");
    expect(connectionPanel).toContain(
      'typeof window.fbaOS.updates.current === "function"',
    );
    expect(connectionPanel).toContain("需先安裝簽章版");
    expect(connectionPanel).toContain("完成最後一次安全安裝");
    expect(connectionPanel).toContain('status.state === "error"');
    expect(connectionPanel).toContain(
      'currentBusy === "update" ? null : currentBusy',
    );
  });

  it("closes protected IPC operations before handing off an update install", async () => {
    const main = await readFile(
      new URL("../src/main/index.ts", import.meta.url),
      "utf8",
    );

    expect(main).toContain("desktopInstallGate.begin()");
    const trustedFrame = main.slice(
      main.indexOf("function assertTrustedFrame"),
      main.indexOf("async function confirmSensitiveAction"),
    );
    expect(trustedFrame).toContain("desktopInstallGate.assertOperationAllowed();");
    for (const channel of [
      "fba:credentials-save",
      "fba:ads-credentials-save",
      "fba:operations-board-editor-state",
      "fba:operations-board-editor-login",
      "fba:operations-board-editor-save",
      "fba:operations-board-editor-close",
    ]) {
      const start = main.indexOf(`\"${channel}\"`);
      const next = main.indexOf("ipcMain.handle(", start + channel.length + 2);
      expect(start, channel).toBeGreaterThan(-1);
      expect(main.slice(start, next < 0 ? undefined : next), channel)
        .toContain("desktopInstallGate.assertOperationAllowed();");
    }
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
