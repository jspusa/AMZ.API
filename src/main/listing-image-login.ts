import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import type { HostedListingImages } from "./hosted-listing-images";

export const LISTING_IMAGE_LOGIN_HTML = String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
<title>AMZ.API 圖片服務</title><style>body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7f5;color:#18251f;margin:0;padding:32px}h1{font-size:24px;margin:0 0 12px}p{line-height:1.6;color:#53645b}label{display:grid;gap:8px;font-weight:600}input{font:inherit;border:1px solid #bbcbbf;border-radius:8px;padding:12px}button{font:inherit;border:0;border-radius:8px;padding:11px 18px;cursor:pointer;background:#e3ebe5;color:#244532}button[type=submit]{background:#17643e;color:white}.actions{display:flex;gap:12px;justify-content:flex-end;margin-top:22px}#message{min-height:24px;color:#9b352a}button:disabled{opacity:.5}</style></head>
<body><h1>連接圖片服務</h1><p>使用 AMZ.API 下載頁的密碼登入。完成後會繼續準備這組圖片，之後就能預檢並確認更新。</p>
<form id="form"><label>下載頁密碼<input id="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></label><p id="message" role="status"></p><div class="actions"><button id="cancel" type="button">暫時取消</button><button id="submit" type="submit">登入並繼續</button></div></form>
<script>(()=>{const p=document.getElementById('password'),m=document.getElementById('message'),b=document.getElementById('submit');document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='正在連接…';const password=p.value;p.value='';try{await window.fbaListingImageEditor.login(password);}catch{m.textContent='登入未完成，請確認下載頁密碼或稍後再試。';}finally{b.disabled=false;}});document.getElementById('cancel').addEventListener('click',()=>{p.value='';void window.fbaListingImageEditor.close();});addEventListener('pagehide',()=>{p.value='';});})();</script></body></html>`;

export function listingImageLoginDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(LISTING_IMAGE_LOGIN_HTML)}`;
}

export function isListingImageLoginFrame(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, editor: BrowserWindow | null): boolean {
  return Boolean(editor && !editor.isDestroyed() && event.sender === editor.webContents && event.senderFrame === editor.webContents.mainFrame && event.senderFrame?.url === listingImageLoginDataUrl());
}

/** Packaged, no-network credential sheet, reachable only while preparing an uploaded file. */
export class ListingImageLogin {
  private window: BrowserWindow | null = null;
  private flight: Promise<void> | null = null;
  private busy = false;
  constructor(private readonly input: Readonly<{ parent(): BrowserWindow | null; preload: string; service: HostedListingImages }>) {
    ipcMain.handle("fba:listing-image-editor-login", async (event, password: unknown) => {
      const window = this.window;
      if (!isListingImageLoginFrame(event, window) || this.busy) throw new Error("圖片登入視窗未授權。");
      this.busy = true;
      try {
        await this.input.service.login(password);
        if (window !== this.window || !isListingImageLoginFrame(event, window)) { this.input.service.clear(); throw new Error("圖片登入視窗已關閉。"); }
        this.close();
      } finally { this.busy = false; }
    });
    ipcMain.handle("fba:listing-image-editor-close", (event) => {
      if (!isListingImageLoginFrame(event, this.window)) throw new Error("圖片登入視窗未授權。");
      this.input.service.clear();
      this.close();
    });
  }
  close(): void { if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; }
  request(): Promise<void> {
    if (this.flight) { this.window?.show(); this.window?.focus(); return this.flight; }
    this.flight = this.open().finally(() => { this.flight = null; });
    return this.flight;
  }
  private async open(): Promise<void> {
    const parent = this.input.parent();
    if (!parent || parent.isDestroyed()) throw new Error("App 尚未就緒。");
    const partition = `amz-listing-image-login-${crypto.randomUUID()}`;
    const isolated = session.fromPartition(partition);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const window = new BrowserWindow({parent,modal:true,show:false,width:520,height:390,resizable:false,maximizable:false,fullscreenable:false,title:"AMZ.API 圖片服務",webPreferences:{preload:this.input.preload,partition,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,experimentalFeatures:false,webviewTag:false,navigateOnDragDrop:false,devTools:false}});
    this.window = window;
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({action:"deny"}));
    window.once("ready-to-show", () => window.show());
    const closed = new Promise<void>(resolve => window.once("closed", () => { if (this.window === window) this.window = null; resolve(); }));
    try { await window.loadURL(listingImageLoginDataUrl()); await closed; }
    catch { this.close(); throw new Error("無法開啟圖片登入視窗。"); }
  }
}
