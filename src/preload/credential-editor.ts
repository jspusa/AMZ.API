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
  enroll: (input) => ipcRenderer.invoke("fba:operations-board-editor-enroll", input),
  unlockPassword: (input) =>
    ipcRenderer.invoke("fba:operations-board-editor-unlock-password", input),
  unlockNative: () => ipcRenderer.invoke("fba:operations-board-editor-unlock-native"),
  changeAdmin: (input) =>
    ipcRenderer.invoke("fba:operations-board-editor-change-admin", input),
  save: (input) => ipcRenderer.invoke("fba:operations-board-editor-save", input),
  close: () => ipcRenderer.invoke("fba:operations-board-editor-close") as Promise<void>,
});

contextBridge.exposeInMainWorld("fbaCredentialEditor", credentialEditor);
contextBridge.exposeInMainWorld("fbaAdvertisingCredentialEditor", advertisingCredentialEditor);
contextBridge.exposeInMainWorld("fbaOperationsBoardEditor", operationsBoardEditor);
