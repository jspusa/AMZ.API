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

  it("has no direct network access and clears the password after every attempt", () => {
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("default-src 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("connect-src 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("form-action 'none'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).toMatch(/id="username"[^>]*value="API"/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).toMatch(/id="password"[^>]*type="password"/u);
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("defaultPassword");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("clearSecret");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("bridge.login");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("password-confirm");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("native-unlock");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("admin-form");
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("R2 五個欄位");
  });

  it("supports pending create, focused edit, and an explicit delete confirmation", () => {
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("state.pendingDraft");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("state.focusItemId");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("pendingDraftApplied");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("card.scrollIntoView");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("確定要刪除這筆公布項目嗎？");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("remove.textContent = '刪除'");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain('id="save" class="primary" type="button">確認並發布</button>');
  });

  it("uses a cool gray-white editor background without the old pale yellow", () => {
    expect(OPERATIONS_BOARD_EDITOR_HTML).not.toContain("#fbf8ee");
    expect(OPERATIONS_BOARD_EDITOR_HTML).toContain("#f7f9fb");
  });

  it("keeps login and mutations out of the Pages preload and frame-gates the local bridge", async () => {
    const [remotePreload, localPreload, mainSource, contracts] = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/preload/credential-editor.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
    ]);

    for (const privileged of ["editor-login", "editor-save"]) {
      expect(remotePreload).not.toContain(`fba:operations-board-${privileged}`);
      expect(localPreload).toContain(`fba:operations-board-${privileged}`);
    }
    for (const retired of ["editor-enroll", "editor-unlock-password", "editor-unlock-native", "editor-change-admin"]) {
      expect(remotePreload).not.toContain(`fba:operations-board-${retired}`);
      expect(localPreload).not.toContain(`fba:operations-board-${retired}`);
      expect(mainSource).not.toContain(`fba:operations-board-${retired}`);
    }
    expect(localPreload).toContain('exposeInMainWorld("fbaOperationsBoardEditor"');
    expect(remotePreload).toContain('ipcRenderer.on("fba:operations-board-updated"');
    const publicBoardBridge = contracts.slice(
      contracts.indexOf("operationsBoard: {"),
      contracts.indexOf("app: {", contracts.indexOf("operationsBoard: {")),
    );
    expect(publicBoardBridge).not.toContain("login");
    expect(publicBoardBridge).not.toContain("save");
    expect(publicBoardBridge).toContain("publish(");
    expect(publicBoardBridge).toContain("manage(");

    for (const channel of [
      "fba:operations-board-editor-state",
      "fba:operations-board-editor-login",
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

    const loginStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-login"');
    const saveStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-save"');
    const closeStart = mainSource.indexOf('ipcMain.handle("fba:operations-board-editor-close"');
    const loginHandler = mainSource.slice(loginStart, saveStart);
    const saveHandler = mainSource.slice(saveStart, closeStart);
    expect(loginHandler).toContain("operationsBoard.login(input)");
    expect(loginHandler).not.toContain("confirmSensitiveAction");
    expect(saveHandler).toContain("assertOperationsBoardEditorStillAuthorized");
    expect(saveHandler.indexOf("assertOperationsBoardEditorStillAuthorized"))
      .toBeLessThan(saveHandler.indexOf("operationsBoard.replace"));
    expect(saveHandler).toContain("operations-board-updated");
    expect(mainSource).toMatch(/powerMonitor\.on\("lock-screen"[\s\S]*operationsBoard\?\.logout\(\)/u);
    expect(mainSource).toMatch(/powerMonitor\.on\("suspend"[\s\S]*operationsBoard\?\.logout\(\)/u);
  });
});
