import { contextBridge, ipcRenderer, webFrame } from "electron";
import type {
  ApiRequest,
  ApiResponse,
  ConnectionTestResult,
  CredentialInput,
  CredentialSummary,
  DesktopBridge,
  ExternalDestination,
  SpellcheckWordResult,
  UpdateStatus,
} from "../shared/contracts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SPELLCHECK_WORDS = 5_000;
const MAX_SPELLCHECK_WORD_LENGTH = 64;

function checkSpelling(words: string[]): SpellcheckWordResult[] {
  if (!Array.isArray(words) || words.length > MAX_SPELLCHECK_WORDS) {
    throw new TypeError("本機拼字檢查的單次字數超過安全上限。");
  }
  const unique = new Map<string, string>();
  for (const rawWord of words) {
    if (typeof rawWord !== "string") continue;
    const word = rawWord.trim();
    if (
      word.length < 3 ||
      word.length > MAX_SPELLCHECK_WORD_LENGTH ||
      !/^[A-Za-z][A-Za-z'\u2019-]*$/.test(word)
    ) {
      continue;
    }
    const key = word.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, word);
  }

  const results: SpellcheckWordResult[] = [];
  for (const word of unique.values()) {
    if (!webFrame.isWordMisspelled(word)) continue;
    const suggestions = webFrame
      .getWordSuggestions(word)
      .filter((suggestion) => typeof suggestion === "string" && suggestion.length <= 80)
      .slice(0, 3);
    results.push({ word, suggestions });
  }
  return results;
}

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
  spellcheck: Object.freeze({
    check: checkSpelling,
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
