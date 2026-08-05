import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  protocol,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import electronUpdater from "electron-updater";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApiRequest,
  CredentialInput,
  ExternalDestination,
  UpdateStatus,
} from "../shared/contracts";
import { ApiRouter } from "./api-router";
import { invalidateSpApiCredentialCaches } from "./amazon/sp-api";
import { CredentialVault } from "./credential-vault";
import { LocalStore } from "./local-store";
import {
  DEV_RENDERER_ORIGIN,
  REMOTE_CONSOLE_URL,
  isTrustedRendererDocument,
} from "./renderer-trust";

const { autoUpdater } = electronUpdater;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "fba-app",
    privileges: { standard: true, secure: true, codeCache: true },
  },
]);
app.enableSandbox();

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const EXTERNAL_DESTINATIONS: Record<ExternalDestination, string> = {
  "seller-central": "https://sellercentral.amazon.com/",
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

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

let mainWindow: BrowserWindow | null = null;
let apiRouter: ApiRouter | null = null;
let credentialVault: CredentialVault | null = null;
let updateStatus: UpdateStatus = { state: "idle" };
let amazonWritesInFlight = 0;
let apiRequestsInFlight = 0;
let credentialsChangeInFlight = false;
let appInitialized = false;
let initializationPromise: Promise<void> | null = null;

const rendererDirectory = resolve(
  fileURLToPath(new URL("../renderer", import.meta.url)),
);

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
  const touchIdAvailable =
    process.platform === "darwin" && systemPreferences.canPromptTouchID();
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "確認敏感操作",
    message: reason,
    detail:
      "這份摘要由 Mac 主程序依已驗證的操作內容產生。系統仍會核對舊值、預檢票證與防重送確認碼。",
    buttons: ["取消", touchIdAvailable ? "使用 Touch ID 確認" : "確認執行"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 1) {
    throw new Error("操作已取消；Amazon 沒有收到任何變更。");
  }
  if (touchIdAvailable) {
    try {
      await systemPreferences.promptTouchID(reason.slice(0, 120));
    } catch {
      throw new Error("操作已取消；Amazon 沒有收到任何變更。");
    }
  }
}

function setUpdateStatus(status: UpdateStatus): UpdateStatus {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("fba:update-status", status);
  }
  return status;
}

function configureUpdater(): void {
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

async function registerAppProtocol(): Promise<void> {
  const appSession = session.fromPartition("fba-os-memory");
  appSession.setPermissionCheckHandler(() => false);
  appSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  await appSession.protocol.handle("fba-app", async (request) => {
    try {
      const url = new URL(request.url);
      if (
        url.hostname !== "bundle" ||
        (request.method !== "GET" && request.method !== "HEAD") ||
        url.search ||
        url.hash ||
        url.pathname.includes("%") ||
        url.pathname.includes("\\") ||
        url.pathname.includes("\0")
      ) {
        return new Response("Not found", { status: 404 });
      }
      const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const candidate = resolve(rendererDirectory, `.${requestedPath}`);
      const rel = relative(rendererDirectory, candidate);
      if (!rel || rel.startsWith("..") || rel.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const contentType = MIME_TYPES[extname(candidate).toLowerCase()];
      if (!contentType) return new Response("Not found", { status: 404 });
      const data = await readFile(candidate);
      return new Response(request.method === "HEAD" ? null : data, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-security-policy": CSP,
          "cache-control": candidate.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          "cross-origin-opener-policy": "same-origin",
          "referrer-policy": "no-referrer",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
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
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
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
  } else {
    for (;;) {
      try {
        await createdWindow.loadURL(REMOTE_CONSOLE_URL);
        break;
      } catch {
        const result = await dialog.showMessageBox(createdWindow, {
          type: "warning",
          title: "無法載入 GitHub 控制台",
          message: "AMZ.API Mac 鑰匙已啟動，但目前無法取得 GitHub 上的最新控制台。",
          detail: "請確認網路連線後重試。API 憑證仍只保存在這台 Mac，Amazon 沒有收到任何操作。",
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
        "/api/sp-api/listing-images",
        "/api/sp-api/sale-price",
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
  ipcMain.handle("fba:credentials-save", async (event, input: CredentialInput) => {
    assertTrustedFrame(event);
    if (!credentialVault) throw new Error("APP_NOT_READY");
    if (apiRequestsInFlight > 0) {
      throw new Error("Amazon 查詢或寫入仍在處理；完成後再更新憑證。");
    }
    if (credentialsChangeInFlight) throw new Error("本機憑證正在更新。");
    credentialsChangeInFlight = true;
    try {
      await confirmSensitiveAction("確認保存 Amazon API 憑證到這台 Mac 的 Keychain");
      const summary = await credentialVault.save(input);
      invalidateSpApiCredentialCaches();
      apiRouter?.clearPreviews();
      return summary;
    } finally {
      credentialsChangeInFlight = false;
    }
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
      await confirmSensitiveAction("確認清除這台 Mac 上的 Amazon API 憑證");
      apiRouter?.clearPreviews();
      const summary = await credentialVault.clear();
      invalidateSpApiCredentialCaches();
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
  ipcMain.handle("fba:update-check", async (event) => {
    assertTrustedFrame(event);
    if (!app.isPackaged) {
      return setUpdateStatus({
        state: "not-available",
        version: app.getVersion(),
        message: "開發版不執行自動更新。",
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
        message: "macOS Keychain 目前鎖定，或本機憑證檔已損壞。",
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
        message: "這會刪除這台 Mac 保存的 Amazon／R2 憑證。",
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
    const userData = app.getPath("userData");
    credentialVault = new CredentialVault(resolve(userData, "credentials.enc"));
    const localStore = new LocalStore(resolve(userData, "fba-os-data.json"));
    await initializeVaultWithRecovery(credentialVault);
    await initializeStoreWithRecovery(localStore);
    apiRouter = new ApiRouter({
      store: localStore,
      vault: credentialVault,
      approveWrite: confirmSensitiveAction,
    });
    await registerAppProtocol();
    registerIpc();
    configureUpdater();
    powerMonitor.on("lock-screen", () => apiRouter?.clearPreviews());
    powerMonitor.on("suspend", () => apiRouter?.clearPreviews());
    await createWindow();
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
