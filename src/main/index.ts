import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import electronUpdater from "electron-updater";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdvertisingCredentialInput,
  ApiRequest,
  CredentialInput,
  ExternalDestination,
  UpdateStatus,
} from "../shared/contracts";
import { ApiRouter } from "./api-router";
import { AdvertisingApiClient } from "./amazon/ads-api";
import { invalidateSpApiCredentialCaches } from "./amazon/sp-api";
import { isMarketplaceId, usesDemoMode } from "./amazon/sp-api";
import type { SpExecutionContextInvalidationReason } from "./amazon/sp-execution-context";
import { AdvertisingCredentialVault } from "./advertising-credential-vault";
import {
  advertisingCredentialEditorDataUrl,
  isAdvertisingCredentialEditorFrame,
} from "./ads-credential-editor";
import {
  credentialEditorDataUrl,
  isCredentialEditorFrame,
} from "./credential-editor";
import { CredentialVault } from "./credential-vault";
import { LocalStore } from "./local-store";
import { sellerCentralInventoryUrl } from "./seller-central-inventory";
import { NativeConfirmationGate, requestNativeConfirmation } from "./native-confirmation";
import {
  DEV_RENDERER_ORIGIN,
  REMOTE_CONSOLE_URL,
  isTrustedRendererDocument,
} from "./renderer-trust";
import { desktopUpdatePolicy } from "./update-policy";
import {
  createWindowsHelloAdapter,
  preflightWindowsHelloAddon,
  requestWindowsHello,
} from "./windows-hello";

const { autoUpdater } = electronUpdater;

app.enableSandbox();

const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "seller-central": "https://sellercentral.amazon.com/",
  "a-plus-content": "https://sellercentral.amazon.com/enhanced-content/content-manager",
  coupons: "https://sellercentral.amazon.com/",
  "subscribe-save": "https://sellercentral.amazon.com/sns/manage",
  advertising: "https://advertising.amazon.com/",
  github: "https://github.com/jspusa/AMZ.API",
};

const ALLOWED_EXTERNAL_URLS = new Set([
  ...Object.values(EXTERNAL_DESTINATIONS),
  "https://members.helium10.com/",
  "https://advertising.amazon.com/API/docs/en-us/guides/onboarding/apply-for-access",
  "https://sellercentral.amazon.com/sns/manage",
  "https://sellercentral.amazon.co.jp/sns/manage",
  "https://sellercentral.amazon.co.uk/sns/manage",
  "https://sellercentral.amazon.de/sns/manage",
  "https://sellercentral.amazon.com/fba/sendtoamazon",
  "https://sellercentral.amazon.co.jp/fba/sendtoamazon",
  "https://sellercentral.amazon.ca/fba/sendtoamazon",
  "https://sellercentral.amazon.sg/fba/sendtoamazon",
  "https://sellercentral.amazon.com.au/fba/sendtoamazon",
  "https://sellercentral.amazon.co.uk/fba/sendtoamazon",
  "https://sellercentral.amazon.de/fba/sendtoamazon",
  "https://sellercentral.amazon.ca/",
  "https://sellercentral.amazon.sg/",
  "https://sellercentral.amazon.com.au/",
  "https://sellercentral.amazon.co.uk/",
  "https://sellercentral.amazon.de/",
  "https://sellercentral-europe.amazon.com/",
  "https://sellercentral.amazon.com/",
  "https://sellercentral.amazon.co.jp/",
]);

let mainWindow: BrowserWindow | null = null;
let credentialEditorWindow: BrowserWindow | null = null;
let advertisingCredentialEditorWindow: BrowserWindow | null = null;
let apiRouter: ApiRouter | null = null;
let credentialVault: CredentialVault | null = null;
let advertisingCredentialVault: AdvertisingCredentialVault | null = null;
let advertisingApi: AdvertisingApiClient | null = null;
let updateStatus: UpdateStatus = { state: "idle" };
let amazonWritesInFlight = 0;
let apiRequestsInFlight = 0;
let credentialsChangeInFlight = false;
const nativeConfirmationGate = new NativeConfirmationGate();
let appInitialized = false;
let initializationPromise: Promise<void> | null = null;

function invalidateAmazonSecurityContext(
  reason: SpExecutionContextInvalidationReason,
): void {
  if (apiRouter) {
    apiRouter.invalidateSpExecutionContext(reason);
    return;
  }
  invalidateSpApiCredentialCaches({ preserveRateLimitPacing: true });
  advertisingApi?.invalidate();
}

function normalizedExternal(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function developmentRendererUrl(): string | null {
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) return null;
  try {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (
      url.origin !== DEV_RENDERER_ORIGIN ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isTrustedFrame(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    return false;
  }
  try {
    const devUrl = developmentRendererUrl();
    return isTrustedRendererDocument(event.senderFrame.url, devUrl);
  } catch {
    return false;
  }
}

function assertTrustedFrame(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!isTrustedFrame(event)) throw new Error("UNTRUSTED_RENDERER");
}

async function confirmSensitiveAction(reason: string): Promise<void> {
  await nativeConfirmationGate.run(async () => {
    const confirmationWindow =
      credentialEditorWindow && !credentialEditorWindow.isDestroyed()
        ? credentialEditorWindow
        : advertisingCredentialEditorWindow && !advertisingCredentialEditorWindow.isDestroyed()
          ? advertisingCredentialEditorWindow
          : mainWindow;
    await requestNativeConfirmation(reason, {
      biometricMethod: () => {
        if (process.platform === "darwin" && systemPreferences.canPromptTouchID()) {
          return "touch-id";
        }
        if (process.platform === "win32") return "windows-hello";
        return null;
      },
      promptBiometric: async (method, prompt) => {
        if (method === "touch-id") {
          await systemPreferences.promptTouchID(prompt);
          return "verified";
        }
        return requestWindowsHello(
          prompt,
          createWindowsHelloAdapter({
            platform: process.platform,
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath,
            packaged: app.isPackaged,
            nativeWindowHandle: () =>
              confirmationWindow && !confirmationWindow.isDestroyed()
                ? confirmationWindow.getNativeWindowHandle()
                : null,
          }),
        );
      },
      showMessageFallback: async (message) => {
        const options: Electron.MessageBoxOptions = {
          type: "warning",
          title: "確認敏感操作",
          message,
          detail:
            "這份摘要由 Notebook 鑰匙主程序依已驗證的操作內容產生。舊值、預檢票證與防重送確認碼仍會再核對。",
          buttons: ["取消", "確認執行"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const result =
          confirmationWindow && !confirmationWindow.isDestroyed()
            ? await dialog.showMessageBox(confirmationWindow, options)
            : await dialog.showMessageBox(options);
        return result.response === 1;
      },
    });
  });
}

function setUpdateStatus(status: UpdateStatus): UpdateStatus {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fba:update-status", status);
  }
  return status;
}

function configureUpdater(): void {
  const policy = desktopUpdatePolicy({
    platform: process.platform,
    packaged: app.isPackaged,
  });
  if (!policy.enabled) {
    setUpdateStatus({
      state: "not-available",
      version: app.getVersion(),
      message: policy.message ?? undefined,
    });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () =>
    setUpdateStatus({ state: "checking" }),
  );
  autoUpdater.on("update-available", (info) =>
    setUpdateStatus({ state: "available", version: info.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    setUpdateStatus({ state: "not-available", version: info.version }),
  );
  autoUpdater.on("download-progress", (progress) =>
    setUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent),
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    setUpdateStatus({ state: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", () =>
    setUpdateStatus({
      state: "error",
      message: "目前無法檢查更新，既有 App 仍可正常使用。",
    }),
  );
}

function configureMainSession(): void {
  const appSession = session.fromPartition("fba-os-memory");
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
}

async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow();
    return;
  }
  const createdWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    title: "AMZ.API",
    backgroundColor: "#f4f6f8",
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      partition: "fba-os-memory",
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow = createdWindow;
  createdWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  createdWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizedExternal(url);
    if (normalized && ALLOWED_EXTERNAL_URLS.has(normalized)) {
      void shell.openExternal(normalized);
    }
    return { action: "deny" };
  });
  createdWindow.once("ready-to-show", () => createdWindow.show());
  createdWindow.on("closed", () => {
    if (mainWindow === createdWindow) mainWindow = null;
  });

  const devUrl = developmentRendererUrl();
  if (devUrl) {
    await createdWindow.loadURL(devUrl);
    await verifyRendererBridge(createdWindow);
  } else {
    for (;;) {
      try {
        await createdWindow.loadURL(REMOTE_CONSOLE_URL);
        await verifyRendererBridge(createdWindow);
        break;
      } catch {
        const result = await dialog.showMessageBox(createdWindow, {
          type: "warning",
          title: "無法載入 GitHub 控制台",
          message: "AMZ.API Notebook 鑰匙已啟動，但目前無法取得 GitHub 上的最新控制台。",
          detail: "請確認網路連線後重試。API 憑證仍只保存在這台電腦的系統安全儲存區，Amazon 沒有收到任何操作。",
          buttons: ["退出", "重新載入"],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) {
          createdWindow.destroy();
          app.quit();
          throw new Error("REMOTE_CONSOLE_UNAVAILABLE");
        }
      }
    }
  }
}

async function openCredentialEditor(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("APP_NOT_READY");
  if (credentialEditorWindow && !credentialEditorWindow.isDestroyed()) {
    credentialEditorWindow.show();
    credentialEditorWindow.focus();
    await new Promise<void>((resolve) =>
      credentialEditorWindow?.once("closed", () => resolve()),
    );
    return;
  }
  const partition = `fba-sp-credential-editor-${crypto.randomUUID()}`;
  const editorSession = session.fromPartition(partition);
  editorSession.setPermissionCheckHandler(() => false);
  editorSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const editor = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    show: false,
    width: 760,
    height: 900,
    minWidth: 660,
    minHeight: 700,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: "SP-API 本機安全輸入",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/credentialEditor.cjs", import.meta.url)),
      partition,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
    },
  });
  credentialEditorWindow = editor;
  editor.webContents.on("will-navigate", (event) => event.preventDefault());
  editor.webContents.on("will-attach-webview", (event) => event.preventDefault());
  editor.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  editor.once("ready-to-show", () => editor.show());
  editor.on("closed", () => {
    if (credentialEditorWindow === editor) credentialEditorWindow = null;
  });
  try {
    await editor.loadURL(credentialEditorDataUrl());
    await new Promise<void>((resolve) => editor.once("closed", () => resolve()));
  } catch (error) {
    if (!editor.isDestroyed()) editor.destroy();
    throw error;
  }
}

function closeCredentialEditor(): void {
  if (credentialEditorWindow && !credentialEditorWindow.isDestroyed()) {
    credentialEditorWindow.destroy();
  }
  credentialEditorWindow = null;
}

async function openAdvertisingCredentialEditor(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("APP_NOT_READY");
  if (advertisingCredentialEditorWindow && !advertisingCredentialEditorWindow.isDestroyed()) {
    advertisingCredentialEditorWindow.show();
    advertisingCredentialEditorWindow.focus();
    await new Promise<void>((resolve) =>
      advertisingCredentialEditorWindow?.once("closed", () => resolve()),
    );
    return;
  }
  const partition = `fba-ads-credential-editor-${crypto.randomUUID()}`;
  const editorSession = session.fromPartition(partition);
  editorSession.setPermissionCheckHandler(() => false);
  editorSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const editor = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    show: false,
    width: 560,
    height: 700,
    minWidth: 520,
    minHeight: 640,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Amazon Ads 本機安全輸入",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/credentialEditor.cjs", import.meta.url)),
      partition,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: false,
    },
  });
  advertisingCredentialEditorWindow = editor;
  editor.webContents.on("will-navigate", (event) => event.preventDefault());
  editor.webContents.on("will-attach-webview", (event) => event.preventDefault());
  editor.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  editor.once("ready-to-show", () => editor.show());
  editor.on("closed", () => {
    if (advertisingCredentialEditorWindow === editor) {
      advertisingCredentialEditorWindow = null;
    }
  });
  try {
    await editor.loadURL(advertisingCredentialEditorDataUrl());
    await new Promise<void>((resolve) => editor.once("closed", () => resolve()));
  } catch (error) {
    if (!editor.isDestroyed()) editor.destroy();
    throw error;
  }
}

function closeAdvertisingCredentialEditor(): void {
  if (advertisingCredentialEditorWindow && !advertisingCredentialEditorWindow.isDestroyed()) {
    advertisingCredentialEditorWindow.destroy();
  }
  advertisingCredentialEditorWindow = null;
}

async function verifyRendererBridge(window: BrowserWindow): Promise<void> {
  const ready = await window.webContents.executeJavaScript(
    "Boolean(globalThis.fbaOS?.api?.request && globalThis.fbaOS?.credentials?.status && globalThis.fbaOS?.advertisingCredentials?.status)",
    true,
  );
  if (ready !== true) {
    throw new Error("LOCAL_BRIDGE_UNAVAILABLE");
  }
  console.info("AMZ_API_BRIDGE_READY");
}

function registerIpc(): void {
  ipcMain.handle("fba:api-request", async (event, input: ApiRequest) => {
    assertTrustedFrame(event);
    if (!apiRouter) throw new Error("APP_NOT_READY");
    if (credentialsChangeInFlight) {
      throw new Error("本機憑證正在更新；完成後請重新執行查詢。");
    }
    const isAmazonWrite =
      input?.method === "PATCH" &&
      [
        "/api/sp-api/listings",
        "/api/sp-api/listing-content",
        "/api/sp-api/listing-content/import",
        "/api/sp-api/listing-images",
        "/api/sp-api/sale-price",
        "/api/sp-api/business-pricing",
        "/api/sp-api/variation-move",
      ].includes(input.path);
    apiRequestsInFlight += 1;
    if (isAmazonWrite) amazonWritesInFlight += 1;
    try {
      return await apiRouter.handle(input);
    } finally {
      apiRequestsInFlight -= 1;
      if (isAmazonWrite) amazonWritesInFlight -= 1;
    }
  });
  ipcMain.on("fba:api-cancel", (event, requestId: string) => {
    assertTrustedFrame(event);
    if (typeof requestId !== "string" || requestId.length > 100) return;
    // Reads use short upstream timeouts. Writes are never aborted after local
    // approval because their Amazon result could become unknown.
  });
  ipcMain.handle("fba:credentials-status", async (event) => {
    assertTrustedFrame(event);
    if (!credentialVault) throw new Error("APP_NOT_READY");
    return credentialVault.getSummary();
  });
  ipcMain.handle("fba:credentials-open-editor", async (event) => {
    assertTrustedFrame(event);
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    await openCredentialEditor();
  });
  ipcMain.handle("fba:credentials-save", async (event, input: CredentialInput) => {
    if (!isCredentialEditorFrame(event, credentialEditorWindow)) {
      throw new Error("UNTRUSTED_CREDENTIAL_EDITOR");
    }
    if (!credentialVault) throw new Error("APP_NOT_READY");
    if (apiRequestsInFlight > 0) {
      throw new Error("Amazon 查詢或寫入仍在處理；完成後再更新憑證。");
    }
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    credentialsChangeInFlight = true;
    try {
      await confirmSensitiveAction("確認保存 Amazon API 憑證到這台電腦的系統安全儲存區");
      invalidateAmazonSecurityContext("credentials-saved");
      const summary = await credentialVault.save(input);
      return summary;
    } finally {
      credentialsChangeInFlight = false;
    }
  });
  ipcMain.handle("fba:credentials-editor-close", async (event) => {
    if (!isCredentialEditorFrame(event, credentialEditorWindow)) {
      throw new Error("UNTRUSTED_CREDENTIAL_EDITOR");
    }
    closeCredentialEditor();
  });
  ipcMain.handle("fba:credentials-clear", async (event) => {
    assertTrustedFrame(event);
    if (!credentialVault) throw new Error("APP_NOT_READY");
    if (apiRequestsInFlight > 0) {
      throw new Error("Amazon 查詢或寫入仍在處理；完成後再清除憑證。");
    }
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    credentialsChangeInFlight = true;
    try {
      await confirmSensitiveAction("確認清除這台電腦上的 Amazon API 憑證");
      invalidateAmazonSecurityContext("credentials-cleared");
      const summary = await credentialVault.clear();
      return summary;
    } finally {
      credentialsChangeInFlight = false;
    }
  });
  ipcMain.handle("fba:credentials-test", async (event) => {
    assertTrustedFrame(event);
    if (!apiRouter) throw new Error("APP_NOT_READY");
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    apiRequestsInFlight += 1;
    try {
      return await apiRouter.testConnections();
    } finally {
      apiRequestsInFlight -= 1;
    }
  });
  ipcMain.handle("fba:ads-credentials-status", async (event) => {
    assertTrustedFrame(event);
    if (!advertisingCredentialVault) throw new Error("APP_NOT_READY");
    return advertisingCredentialVault.getSummary();
  });
  ipcMain.handle("fba:ads-credentials-open-editor", async (event) => {
    assertTrustedFrame(event);
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    await openAdvertisingCredentialEditor();
  });
  ipcMain.handle(
    "fba:ads-credentials-save",
    async (event, input: AdvertisingCredentialInput) => {
      if (!isAdvertisingCredentialEditorFrame(event, advertisingCredentialEditorWindow)) {
        throw new Error("UNTRUSTED_ADS_CREDENTIAL_EDITOR");
      }
      if (!advertisingCredentialVault || !advertisingApi) throw new Error("APP_NOT_READY");
      if (apiRequestsInFlight > 0) {
        throw new Error("Amazon 查詢或寫入仍在處理；完成後再更新 Ads 憑證。");
      }
      if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
      credentialsChangeInFlight = true;
      try {
        await confirmSensitiveAction("確認保存 Amazon Ads API 憑證到這台電腦的系統安全儲存區");
        const summary = await advertisingCredentialVault.save(input);
        advertisingApi.invalidate();
        apiRouter?.clearPreviews();
        return summary;
      } finally {
        credentialsChangeInFlight = false;
      }
    },
  );
  ipcMain.handle("fba:ads-credentials-editor-close", async (event) => {
    if (!isAdvertisingCredentialEditorFrame(event, advertisingCredentialEditorWindow)) {
      throw new Error("UNTRUSTED_ADS_CREDENTIAL_EDITOR");
    }
    closeAdvertisingCredentialEditor();
  });
  ipcMain.handle("fba:ads-credentials-clear", async (event) => {
    assertTrustedFrame(event);
    if (!advertisingCredentialVault || !advertisingApi) throw new Error("APP_NOT_READY");
    if (apiRequestsInFlight > 0) {
      throw new Error("Amazon 查詢或寫入仍在處理；完成後再清除 Ads 憑證。");
    }
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    credentialsChangeInFlight = true;
    try {
      await confirmSensitiveAction("確認清除這台電腦上獨立的 Amazon Ads API 憑證");
      const summary = await advertisingCredentialVault.clear();
      advertisingApi.invalidate();
      apiRouter?.clearPreviews();
      return summary;
    } finally {
      credentialsChangeInFlight = false;
    }
  });
  ipcMain.handle("fba:ads-credentials-test", async (event, marketplaceId: string) => {
    assertTrustedFrame(event);
    if (!advertisingApi || !isMarketplaceId(marketplaceId)) {
      throw new Error("Amazon Ads 站點無效。");
    }
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    if (usesDemoMode(marketplaceId)) {
      return {
        ok: false,
        testedAt: new Date().toISOString(),
        marketplaceId,
        marketplaceCode: "DEMO",
        accountType: null,
        message: "展示模式不會呼叫真實 Amazon Ads。",
        requestId: null,
      };
    }
    apiRequestsInFlight += 1;
    try {
      return await advertisingApi.probeMarketplace(marketplaceId);
    } finally {
      apiRequestsInFlight -= 1;
    }
  });
  ipcMain.handle("fba:app-version", (event) => {
    assertTrustedFrame(event);
    return app.getVersion();
  });
  ipcMain.handle("fba:app-platform", (event) => {
    assertTrustedFrame(event);
    return process.platform;
  });
  ipcMain.handle(
    "fba:open-external",
    async (event, destination: ExternalDestination) => {
      assertTrustedFrame(event);
      if (!Object.prototype.hasOwnProperty.call(EXTERNAL_DESTINATIONS, destination)) {
        throw new Error("INVALID_DESTINATION");
      }
      await shell.openExternal(EXTERNAL_DESTINATIONS[destination]);
    },
  );
  ipcMain.handle(
    "fba:open-seller-central-inventory",
    async (event, sellerSku: unknown) => {
      assertTrustedFrame(event);
      await shell.openExternal(sellerCentralInventoryUrl(sellerSku));
    },
  );
  ipcMain.handle("fba:update-check", async (event) => {
    assertTrustedFrame(event);
    const policy = desktopUpdatePolicy({
      platform: process.platform,
      packaged: app.isPackaged,
    });
    if (!policy.enabled) {
      return setUpdateStatus({
        state: "not-available",
        version: app.getVersion(),
        message: policy.message ?? undefined,
      });
    }
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo && result.updateInfo.version !== app.getVersion()) {
      await autoUpdater.downloadUpdate();
    }
    return updateStatus;
  });
  ipcMain.handle("fba:update-install", async (event) => {
    assertTrustedFrame(event);
    const policy = desktopUpdatePolicy({
      platform: process.platform,
      packaged: app.isPackaged,
    });
    if (!policy.enabled) throw new Error("APP_UPDATE_DISABLED_FOR_PLATFORM");
    if (updateStatus.state !== "downloaded") throw new Error("UPDATE_NOT_READY");
    if (apiRequestsInFlight > 0 || credentialsChangeInFlight) {
      throw new Error("Amazon／本機安全操作仍在處理；完成後才能安裝更新。");
    }
    apiRouter?.clearPreviews();
    autoUpdater.quitAndInstall(false, true);
  });
}

function isValidLaunchUrl(raw: string): boolean {
  if (raw.length > 256) return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "amz-api:" &&
      url.hostname === "launch" &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function initializeVaultWithRecovery(vault: CredentialVault): Promise<void> {
  for (;;) {
    try {
      await vault.initializeEnvironment();
      return;
    } catch {
      const result = await dialog.showMessageBox({
        type: "error",
        title: "無法開啟本機憑證",
        message: "本機系統安全儲存區目前無法解密，或憑證檔已損壞。",
        detail: "你可以先重試；只有確定不再需要舊憑證時，才清除並重新輸入。",
        buttons: ["退出 App", "重試", "清除本機憑證"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 0) throw new Error("CREDENTIAL_VAULT_UNAVAILABLE");
      if (result.response === 1) continue;
      const confirmation = await dialog.showMessageBox({
        type: "warning",
        title: "確認清除本機憑證",
        message: "這會刪除這台電腦保存的 Amazon／R2 憑證。",
        detail: "GitHub 程式與 Amazon 資料不會刪除；之後需要重新輸入 API 憑證。",
        buttons: ["取消", "確認清除"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) continue;
      await vault.clear();
      invalidateSpApiCredentialCaches();
      return;
    }
  }
}

async function initializeStoreWithRecovery(store: LocalStore): Promise<void> {
  for (;;) {
    try {
      await store.initialize();
      return;
    } catch {
      const result = await dialog.showMessageBox({
        type: "error",
        title: "本機操作資料需要修復",
        message: "商品主檔或防重送帳本無法讀取。",
        detail: "選擇修復會保留一份損壞檔備份，再建立乾淨的本機資料；不會修改 Amazon。",
        buttons: ["退出 App", "重試", "隔離備份並修復"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 0) throw new Error("LOCAL_STORE_UNAVAILABLE");
      if (result.response === 1) continue;
      await store.isolateCorruptedFile();
      return;
    }
  }
}

async function initializeAdvertisingVaultWithRecovery(
  vault: AdvertisingCredentialVault,
): Promise<void> {
  for (;;) {
    try {
      await vault.getSummary();
      return;
    } catch {
      const result = await dialog.showMessageBox({
        type: "error",
        title: "無法開啟 Amazon Ads 憑證",
        message: "本機系統安全儲存區目前無法解密，或獨立 Ads 憑證檔已損壞。",
        detail: "清除 Ads 憑證不會影響現有 SP-API 憑證或本機操作資料。",
        buttons: ["退出 App", "重試", "只清除 Ads 憑證"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 0) throw new Error("ADS_CREDENTIAL_VAULT_UNAVAILABLE");
      if (result.response === 1) continue;
      await vault.clear();
      return;
    }
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (commandLine.some(isValidLaunchUrl)) focusWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (isValidLaunchUrl(url)) focusWindow();
  });

  initializationPromise = app.whenReady().then(async () => {
    if (process.platform === "darwin" || app.isPackaged) {
      app.setAsDefaultProtocolClient("amz-api");
    }
    if (process.platform === "win32" && app.isPackaged) {
      await preflightWindowsHelloAddon({
        platform: process.platform,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
      });
      console.info("AMZ_API_WINDOWS_HELLO_ADDON_READY");
    }
    const userData = app.getPath("userData");
    credentialVault = new CredentialVault(resolve(userData, "credentials.enc"));
    advertisingCredentialVault = new AdvertisingCredentialVault(
      resolve(userData, "ads-credentials.enc"),
    );
    advertisingApi = new AdvertisingApiClient(
      advertisingCredentialVault,
      fetch,
      async (region) => ({
        accountScope: await credentialVault!.getAccountScope(region),
        sellerId: (await credentialVault!.load()).regions[region].sellerId,
      }),
    );
    const localStore = new LocalStore(resolve(userData, "fba-os-data.json"));
    await initializeVaultWithRecovery(credentialVault);
    await initializeAdvertisingVaultWithRecovery(advertisingCredentialVault);
    await initializeStoreWithRecovery(localStore);
    apiRouter = new ApiRouter({
      store: localStore,
      vault: credentialVault,
      approveWrite: confirmSensitiveAction,
      advertising: advertisingApi,
    });
    configureMainSession();
    registerIpc();
    powerMonitor.on("lock-screen", () => {
      closeCredentialEditor();
      closeAdvertisingCredentialEditor();
      invalidateAmazonSecurityContext("lock-screen");
    });
    powerMonitor.on("suspend", () => {
      closeCredentialEditor();
      closeAdvertisingCredentialEditor();
      invalidateAmazonSecurityContext("suspend");
    });
    await createWindow();
    configureUpdater();
    appInitialized = true;
  }).catch(async () => {
    appInitialized = false;
    await dialog.showMessageBox({
      type: "error",
      title: "AMZ.API 無法啟動",
      message: "本機安全資料尚未準備完成，App 已停止啟動。",
      detail: "Amazon 沒有收到任何變更。重新開啟 App 後可以再次重試或選擇修復。",
      buttons: ["關閉"],
      noLink: true,
    });
    app.quit();
  });
}

app.on("activate", () => {
  if (!initializationPromise) return;
  void initializationPromise.then(() => {
    if (!appInitialized) return;
    if (!mainWindow || mainWindow.isDestroyed()) void createWindow();
    else focusWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitWarningVisible = false;
app.on("before-quit", (event) => {
  if (apiRequestsInFlight <= 0 && !credentialsChangeInFlight) return;
  event.preventDefault();
  if (quitWarningVisible) return;
  quitWarningVisible = true;
  void dialog
    .showMessageBox({
      type: "warning",
      title: "安全操作仍在處理",
      message: "完成 Amazon 請求或本機安全保存前，App 暫時不會關閉。",
      detail: "請稍候，再重新選擇結束 App；這能避免結果未知或本機資料損壞。",
      buttons: ["繼續等待"],
      noLink: true,
    })
    .finally(() => {
      quitWarningVisible = false;
    });
});
