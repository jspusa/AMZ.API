import { contextBridge, ipcRenderer } from "electron";
import type {
  AdvertisingCredentialEditorBridge,
  CredentialEditorBridge,
} from "../shared/contracts";

const credentialEditor: CredentialEditorBridge = Object.freeze({
  save: (input) => ipcRenderer.invoke("fba:credentials-save", input),
  close: () => ipcRenderer.invoke("fba:credentials-editor-close") as Promise<void>,
});

const advertisingCredentialEditor: AdvertisingCredentialEditorBridge = Object.freeze({
  save: (input) => ipcRenderer.invoke("fba:ads-credentials-save", input),
  close: () => ipcRenderer.invoke("fba:ads-credentials-editor-close") as Promise<void>,
});

contextBridge.exposeInMainWorld("fbaCredentialEditor", credentialEditor);
contextBridge.exposeInMainWorld("fbaAdvertisingCredentialEditor", advertisingCredentialEditor);
