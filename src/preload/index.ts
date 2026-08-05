import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
  CredentialInput,
  CredentialSummary,
  DesktopBridge,
  ExternalDestination,
  UpdateStatus,
} from "../shared/contracts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function invokeApi(input: ApiRequest): Promise<ApiResponse> {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.path !== "string" ||
    !input.path.startsWith("/api/") ||
    input.path.length > 200
  ) {
    return Promise.reject(new TypeError("App 內部請求格式無效。"));
  }
  if (
    input.body?.kind === "multipart" &&
    input.body.file.bytes.byteLength > MAX_IMAGE_BYTES
  ) {
    return Promise.reject(new TypeError("圖片不可超過 10 MB。"));
  }
  return ipcRenderer.invoke("fba:api-request", input) as Promise<ApiResponse>;
}

const bridge: DesktopBridge = Object.freeze({
  api: Object.freeze({
    request: invokeApi,
    cancel: (requestId: string) => ipcRenderer.send("fba:api-cancel", requestId),
  }),
  credentials: Object.freeze({
    status: () =>
      ipcRenderer.invoke("fba:credentials-status") as Promise<CredentialSummary>,
    save: (input: CredentialInput) =>
      ipcRenderer.invoke("fba:credentials-save", input) as Promise<CredentialSummary>,
    clear: () =>
      ipcRenderer.invoke("fba:credentials-clear") as Promise<CredentialSummary>,
    test: () =>
      ipcRenderer.invoke("fba:credentials-test") as Promise<ConnectionTestResult>,
  }),
  app: Object.freeze({
    version: () => ipcRenderer.invoke("fba:app-version") as Promise<string>,
    platform: () => ipcRenderer.invoke("fba:app-platform") as Promise<string>,
    openExternal: (destination: ExternalDestination) =>
      ipcRenderer.invoke("fba:open-external", destination) as Promise<void>,
  }),
  updates: Object.freeze({
    check: () => ipcRenderer.invoke("fba:update-check") as Promise<UpdateStatus>,
    install: () => ipcRenderer.invoke("fba:update-install") as Promise<void>,
    onStatus: (listener: (status: UpdateStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) =>
        listener(status);
      ipcRenderer.on("fba:update-status", handler);
      return () => ipcRenderer.removeListener("fba:update-status", handler);
    },
  }),
});

contextBridge.exposeInMainWorld("fbaOS", bridge);
