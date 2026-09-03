import { contextBridge, ipcRenderer } from "electron";
import type {
  AdvertisingCredentialEditorBridge,
  CredentialEditorBridge,
  OperationsBoardEditorBridge,
} from "../shared/contracts";

const credentialEditor: CredentialEditorBridge = Object.freeze({
  save: (input) => ipcRenderer.invoke("fba:credentials-save", input),
  close: () => ipcRenderer.invoke("fba:credentials-editor-close") as Promise<void>,
});

const advertisingCredentialEditor: AdvertisingCredentialEditorBridge = Object.freeze({
  save: (input) => ipcRenderer.invoke("fba:ads-credentials-save", input),
  close: () => ipcRenderer.invoke("fba:ads-credentials-editor-close") as Promise<void>,
});

const operationsBoardEditor: OperationsBoardEditorBridge = Object.freeze({
  state: () => ipcRenderer.invoke("fba:operations-board-editor-state"),
  login: (input) => ipcRenderer.invoke("fba:operations-board-editor-login", input),
  save: (input) => ipcRenderer.invoke("fba:operations-board-editor-save", input),
  close: () => ipcRenderer.invoke("fba:operations-board-editor-close") as Promise<void>,
});

contextBridge.exposeInMainWorld("fbaCredentialEditor", credentialEditor);
contextBridge.exposeInMainWorld("fbaAdvertisingCredentialEditor", advertisingCredentialEditor);
contextBridge.exposeInMainWorld("fbaOperationsBoardEditor", operationsBoardEditor);
