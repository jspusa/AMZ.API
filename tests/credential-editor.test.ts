import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_EDITOR_HTML,
  credentialEditorDataUrl,
  isCredentialEditorFrame,
} from "../src/main/credential-editor";

describe("local-only SP-API/R2/Skill credential editor", () => {
  it("accepts only its exact modal main frame and rejects Pages or another data URL", () => {
    const localFrame = { url: credentialEditorDataUrl() };
    const editorContents = { mainFrame: localFrame };
    const editor = { isDestroyed: () => false, webContents: editorContents };
    const localEvent = { sender: editorContents, senderFrame: localFrame };
    const remoteFrame = { url: "https://jspusa.github.io/AMZ.API/" };
    const remoteContents = { mainFrame: remoteFrame };
    const otherDataFrame = { url: "data:text/html;charset=utf-8,not-the-editor" };

    expect(isCredentialEditorFrame(localEvent as never, editor as never)).toBe(true);
    expect(isCredentialEditorFrame({ sender: remoteContents, senderFrame: remoteFrame } as never, editor as never)).toBe(false);
    expect(isCredentialEditorFrame({ sender: editorContents, senderFrame: otherDataFrame } as never, editor as never)).toBe(false);
    expect(isCredentialEditorFrame(localEvent as never, null)).toBe(false);
  });

  it("has a no-network CSP, all existing credential fields, and clears on cancel/success", () => {
    expect(CREDENTIAL_EDITOR_HTML).toContain("default-src 'none'");
    expect(CREDENTIAL_EDITOR_HTML).toContain("connect-src 'none'");
    expect(CREDENTIAL_EDITOR_HTML).toContain("form-action 'none'");
    expect(CREDENTIAL_EDITOR_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/u);
    for (const id of [
      "lwaClientId", "lwaClientSecret", "naRefreshToken", "naSellerId",
      "feRefreshToken", "feSellerId", "euRefreshToken", "euSellerId",
      "r2AccountId", "r2AccessKeyId", "r2SecretAccessKey", "r2Bucket",
      "r2PublicBaseUrl", "replenishmentSkillUrl",
    ]) {
      expect(CREDENTIAL_EDITOR_HTML).toContain(`id="${id}"`);
    }
    expect(CREDENTIAL_EDITOR_HTML).not.toContain('id="operationsBoardPublicBaseUrl"');
    expect(CREDENTIAL_EDITOR_HTML).not.toContain("共享公布欄唯讀網址");
    expect(CREDENTIAL_EDITOR_HTML).toMatch(/id="lwaClientSecret" type="password"/u);
    expect(CREDENTIAL_EDITOR_HTML).toMatch(/id="naSellerId" type="password"/u);
    expect(CREDENTIAL_EDITOR_HTML).toMatch(/id="r2SecretAccessKey" type="password"/u);
    expect(CREDENTIAL_EDITOR_HTML).toContain("留白代表沿用既有值");
    expect(CREDENTIAL_EDITOR_HTML).toMatch(/cancel[\s\S]*clear\(\); await window\.fbaCredentialEditor\.close/u);
    expect(CREDENTIAL_EDITOR_HTML).toMatch(/await window\.fbaCredentialEditor\.save[\s\S]*clear\(\);[\s\S]*await window\.fbaCredentialEditor\.close/u);
  });

  it("keeps save out of the remote preload and gates the retained IPC channel in main", async () => {
    const [remotePreload, localPreload, mainSource, connectionSource, contracts] = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/credential-editor.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/connection-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
    ]);
    expect(remotePreload).toContain('ipcRenderer.invoke("fba:credentials-open-editor")');
    expect(remotePreload).not.toContain('ipcRenderer.invoke("fba:credentials-save"');
    expect(remotePreload).not.toContain("fbaCredentialEditor");
    expect(localPreload).toContain('ipcRenderer.invoke("fba:credentials-save"');
    expect(localPreload).toContain('exposeInMainWorld("fbaCredentialEditor"');
    const desktopBridge = contracts.slice(
      contracts.indexOf("export type DesktopBridge"),
      contracts.indexOf("export type CredentialEditorBridge"),
    );
    expect(desktopBridge).toMatch(/credentials:\s*\{[\s\S]*openEditor\(\): Promise<void>;[\s\S]*clear\(\)/u);
    expect(desktopBridge).not.toContain("save(input: CredentialInput)");

    const saveHandler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("fba:credentials-save"'),
      mainSource.indexOf('ipcMain.handle("fba:credentials-editor-close"'),
    );
    expect(saveHandler).toContain("isCredentialEditorFrame");
    expect(saveHandler).toContain("UNTRUSTED_CREDENTIAL_EDITOR");
    expect(saveHandler).toContain("apiRequestsInFlight > 0");
    expect(saveHandler).toContain("credentialsChangeInFlight");
    expect(saveHandler).toContain("confirmSensitiveAction");
    expect(saveHandler.indexOf("confirmSensitiveAction")).toBeLessThan(saveHandler.indexOf("credentialVault.save"));
    expect(saveHandler).toContain('invalidateAmazonSecurityContext("credentials-saved")');

    expect(connectionSource).not.toContain("type FormState");
    expect(connectionSource).not.toContain("CredentialInput");
    expect(connectionSource).not.toContain("credentials.save");
    expect(connectionSource).not.toContain("<input");
    expect(connectionSource).toContain("await window.fbaOS.credentials.openEditor()");
    expect(connectionSource).toMatch(/credentials\.openEditor\(\);\s*await refreshSummary\(\);[\s\S]*onConnectionChanged\(\)/u);
  });

  it("uses a sandboxed independent memory session and closes on lock/suspend", async () => {
    const mainSource = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const editorSource = mainSource.slice(
      mainSource.indexOf("async function openCredentialEditor"),
      mainSource.indexOf("async function openAdvertisingCredentialEditor"),
    );
    expect(editorSource).toContain("fba-sp-credential-editor-${crypto.randomUUID()}");
    expect(editorSource).not.toContain("persist:");
    expect(editorSource).toContain("setPermissionCheckHandler(() => false)");
    expect(editorSource).toContain("nodeIntegration: false");
    expect(editorSource).toContain("contextIsolation: true");
    expect(editorSource).toContain("sandbox: true");
    expect(editorSource).toContain("devTools: false");
    expect(editorSource).toContain("credentialEditor.cjs");
    expect(mainSource).toMatch(/powerMonitor\.on\("lock-screen"[\s\S]*closeCredentialEditor\(\)/u);
    expect(mainSource).toMatch(/powerMonitor\.on\("suspend"[\s\S]*closeCredentialEditor\(\)/u);
  });
});
