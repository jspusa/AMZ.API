import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ADS_CREDENTIAL_EDITOR_HTML,
  advertisingCredentialEditorDataUrl,
  isAdvertisingCredentialEditorFrame,
} from "../src/main/ads-credential-editor";

describe("local-only Ads credential editor", () => {
  it("accepts only the exact modal main frame and rejects the remote Pages frame", () => {
    const localFrame = { url: advertisingCredentialEditorDataUrl() };
    const editorContents = { mainFrame: localFrame };
    const editor = { isDestroyed: () => false, webContents: editorContents };
    const localEvent = { sender: editorContents, senderFrame: localFrame };
    const remoteFrame = { url: "https://jspusa.github.io/AMZ.API/" };
    const remoteContents = { mainFrame: remoteFrame };
    const remoteEvent = { sender: remoteContents, senderFrame: remoteFrame };

    expect(isAdvertisingCredentialEditorFrame(localEvent as never, editor as never)).toBe(true);
    expect(isAdvertisingCredentialEditorFrame(remoteEvent as never, editor as never)).toBe(false);
    expect(isAdvertisingCredentialEditorFrame(localEvent as never, null)).toBe(false);
  });

  it("has a no-network CSP and contains no credential in its static data URL", () => {
    expect(ADS_CREDENTIAL_EDITOR_HTML).toContain("default-src 'none'");
    expect(ADS_CREDENTIAL_EDITOR_HTML).toContain("connect-src 'none'");
    expect(ADS_CREDENTIAL_EDITOR_HTML).toContain("img-src 'none'");
    expect(ADS_CREDENTIAL_EDITOR_HTML).toContain("font-src 'none'");
    expect(ADS_CREDENTIAL_EDITOR_HTML).toContain("media-src 'none'");
    expect(ADS_CREDENTIAL_EDITOR_HTML).not.toMatch(/https?:\/\//iu);
    expect(ADS_CREDENTIAL_EDITOR_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/u);
    expect(advertisingCredentialEditorDataUrl()).not.toContain("refresh_token=");
  });

  it("keeps Ads secret state/save payload out of Pages and refreshes after the sheet closes", async () => {
    const [source, mainSource, remotePreload, localPreload] = await Promise.all([
      readFile(new URL("../src/renderer/src/connection-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/credential-editor.ts", import.meta.url), "utf8"),
    ]);
    expect(source).not.toContain("adsLwaClientId");
    expect(source).not.toContain("adsLwaClientSecret");
    expect(source).not.toContain("adsRefreshToken");
    expect(source).not.toContain("advertisingCredentialEditor.save");
    expect(source).not.toContain("advertisingCredentials.save");
    expect(remotePreload).not.toContain('ipcRenderer.invoke("fba:ads-credentials-save"');
    expect(localPreload).toContain('ipcRenderer.invoke("fba:ads-credentials-save"');
    expect(source).toContain("await window.fbaOS.advertisingCredentials.openEditor()");
    expect(source).toMatch(/openEditor\(\);\s*await refreshSummary\(\)/u);
    const saveHandler = mainSource.slice(
      mainSource.indexOf('"fba:ads-credentials-save"'),
      mainSource.indexOf('"fba:ads-credentials-editor-close"'),
    );
    expect(saveHandler).toContain("isAdvertisingCredentialEditorFrame");
    expect(saveHandler).toContain("UNTRUSTED_ADS_CREDENTIAL_EDITOR");
    expect(saveHandler).toContain("confirmSensitiveAction");
  });
});
