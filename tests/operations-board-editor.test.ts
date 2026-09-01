import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  OPERATIONS_BOARD_EDITOR_HTML,
  isOperationsBoardEditorFrame,
  operationsBoardEditorDataUrl,
} from "../src/main/operations-board-editor";

describe("local-only operations board editor", () => {
  it("accepts only the exact local modal frame", () => {
    const localFrame = { url: operationsBoardEditorDataUrl() };
    const contents = { mainFrame: localFrame };
    const editor = { isDestroyed: () => false, webContents: contents };
    const event = { sender: contents, senderFrame: localFrame };
    expect(isOperationsBoardEditorFrame(event as never, editor as never)).toBe(true);
    expect(isOperationsBoardEditorFrame({
      sender: contents,
      senderFrame: { url: "https://jspusa.github.io/AMZ.API/" },
    } as never, editor as never)).toBe(false);
  });

  it("has no network, starts with API as the local test username, and clears password fields", () => {
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("default-src 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("connect-src 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("form-action 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).toMatch(/id="username"[^>]*value="API"/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).toMatch(/id="password"[^>]*type="password"/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("defaultPassword");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("clearSecrets");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("fbaOperationsBoardEditor");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("state.nativeUnlockAvailable");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain('id="admin-form"');
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("bridge.changeAdmin");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("尚未發布的公告編輯仍保留在畫面上");
  });

  it("uses a cool gray-white editor background without the old pale yellow", () => {
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("#fbf8ee");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("#f7f9fb");
  });

  it("keeps all mutations out of the Pages preload and gates every local editor channel", async () => {
    const [remotePreload, localPreload, mainSource, contracts] = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/credential-editor.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
    ]);

    expect(remotePreload).toContain('ipcRenderer.invoke("fba:operations-board-open-editor")');
    expect(remotePreload).toContain('ipcRenderer.on("fba:operations-board-updated"');
    for (const privileged of ["editor-enroll", "editor-unlock-password", "editor-unlock-native", "editor-change-admin", "editor-save"]) {
      expect(remotePreload).not.toContain(`fba:operations-board-${privileged}`);
      expect(localPreload).toContain(`fba:operations-board-${privileged}`);
    }
    expect(localPreload).toContain('exposeInMainWorld("fbaOperationsBoardEditor"');
    expect(contracts).toMatch(/operationsBoard:\s*\{[\s\S]*openEditor\(\): Promise<void>;[\s\S]*onUpdated/u);

    for (const channel of [
      "fba:operations-board-editor-state",
      "fba:operations-board-editor-enroll",
      "fba:operations-board-editor-unlock-password",
      "fba:operations-board-editor-unlock-native",
      "fba:operations-board-editor-change-admin",
      "fba:operations-board-editor-save",
      "fba:operations-board-editor-close",
    ]) {
      const start = mainSource.indexOf(`ipcMain.handle("${channel}"`);
      expect(start, channel).toBeGreaterThan(-1);
      const next = mainSource.indexOf("ipcMain.handle(", start + 20);
      const handler = mainSource.slice(start, next < 0 ? undefined : next);
      expect(handler, channel).toContain("isOperationsBoardEditorFrame");
      expect(handler, channel).toContain("UNTRUSTED_OPERATIONS_BOARD_EDITOR");
    }

    const saveStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-save"');
    const saveEnd = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-close"', saveStart);
    const saveHandler = mainSource.slice(saveStart, saveEnd);
    expect(saveHandler).toContain("operationsBoardEditorUnlocked");
    expect(saveHandler).not.toContain("confirmSensitiveAction");
    expect(saveHandler.indexOf("assertOperationsBoardEditorStillAuthorized"))
      .toBeLessThan(saveHandler.indexOf("operationsBoard.replace"));
    expect(saveHandler).toContain("operations-board-updated");
    const enrollStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-enroll"');
    const enrollEnd = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-unlock-password"', enrollStart);
    const enrollHandler = mainSource.slice(enrollStart, enrollEnd);
    expect(enrollHandler).toContain("operationsBoard.isStorageConfigured()");
    expect(enrollHandler.indexOf("operationsBoard.isStorageConfigured()"))
      .toBeLessThan(enrollHandler.indexOf("operationsBoardAdminVault.enroll"));
    expect(enrollHandler).toContain("assertOperationsBoardEditorSession");
    expect(enrollHandler).not.toContain("confirmSensitiveAction");
    const nativeStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-unlock-native"');
    const nativeEnd = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-change-admin"', nativeStart);
    const nativeHandler = mainSource.slice(nativeStart, nativeEnd);
    expect(nativeHandler).toContain("confirmOperationsBoardNativeUnlock");
    expect(nativeHandler).not.toContain("confirmSensitiveAction");
    expect(nativeHandler).toContain("assertOperationsBoardEditorSession");
    const rotateStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-change-admin"');
    const rotateEnd = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-save"', rotateStart);
    const rotateHandler = mainSource.slice(rotateStart, rotateEnd);
    expect(rotateHandler).toContain("operationsBoardAdminVault.verify");
    expect(rotateHandler).not.toContain("confirmSensitiveAction");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain('id="save" class="primary" type="button">確認並發布</button>');
    expect(mainSource).toMatch(/showMessageFallback:\s*async \(\) => false/u);
    expect(mainSource).toMatch(/powerMonitor\.on\("lock-screen"[\s\S]*closeOperationsBoardEditor\(\)/u);
    expect(mainSource).toMatch(/powerMonitor\.on\("suspend"[\s\S]*closeOperationsBoardEditor\(\)/u);
  });
});
