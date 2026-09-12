import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { LISTING_IMAGE_PREPARATION_MESSAGES, ListingImageLoginError, publicListingImagePreparationError, type HostedListingImages } from "./hosted-listing-images";
import { validListingImagePassword, type ListingImageCredentialPort } from "./listing-image-credential-vault";

export const LISTING_IMAGE_LOGIN_HTML = String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'">
<title>AMZ.API 圖片服務</title><style>body{font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f7f5;color:#18251f;margin:0;padding:32px}h1{font-size:24px;margin:0 0 12px}p{line-height:1.6;color:#53645b}label{display:grid;gap:8px;font-weight:600}input{font:inherit;border:1px solid #bbcbbf;border-radius:8px;padding:12px}button{font:inherit;border:0;border-radius:8px;padding:11px 18px;cursor:pointer;background:#e3ebe5;color:#244532}button[type=submit]{background:#17643e;color:white}.actions{display:flex;gap:12px;justify-content:flex-end;margin-top:22px}#message{min-height:24px;color:#9b352a}button:disabled{opacity:.5}</style></head>
<body><h1>設定圖片服務快速登入</h1><p>第一次輸入 AMZ.API 下載頁密碼，通過 Touch ID／Windows Hello 後，會在這台電腦加密保存已驗證的密碼。之後鎖定或重啟 App，只需再次使用 Touch ID；Windows 使用 Windows Hello（指紋、臉部或 PIN），不必重填密碼。</p><p>此授權只用於連接圖片服務；更新 Amazon 圖片仍需另行預檢並確認。</p>
<form id="form"><label>下載頁密碼<input id="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></label><p id="message" role="status"></p><div class="actions"><button id="cancel" type="button">暫時取消</button><button id="submit" type="submit">驗證並加密保存</button></div></form>
<script>(()=>{const p=document.getElementById('password'),m=document.getElementById('message'),b=document.getElementById('submit');document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;m.textContent='請完成 Touch ID／Windows Hello…';const password=p.value;p.value='';try{await window.fbaListingImageEditor.login(password);}catch(error){const messages=${JSON.stringify(Object.values(LISTING_IMAGE_PREPARATION_MESSAGES))};m.textContent=messages.find(value=>typeof error?.message==='string'&&error.message.includes(value))||'登入未完成，請稍後再試。';}finally{b.disabled=false;}});document.getElementById('cancel').addEventListener('click',()=>{p.value='';void window.fbaListingImageEditor.close();});addEventListener('pagehide',()=>{p.value='';});})();</script></body></html>`;

export function listingImageLoginDataUrl(updatePassword = false): string {
  const html = updatePassword ? LISTING_IMAGE_LOGIN_HTML.replace("設定圖片服務快速登入", "更新圖片服務密碼").replace("第一次輸入 AMZ.API 下載頁密碼", "先前保存的密碼已被圖片服務拒絕。請輸入目前的 AMZ.API 下載頁密碼") : LISTING_IMAGE_LOGIN_HTML;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function isListingImageLoginFrame(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">, editor: BrowserWindow | null): boolean {
  return Boolean(editor && !editor.isDestroyed() && event.sender === editor.webContents && event.senderFrame === editor.webContents.mainFrame && [listingImageLoginDataUrl(), listingImageLoginDataUrl(true)].includes(event.senderFrame?.url ?? ""));
}

/** Packaged credential sheet and native-approved, main-only session establishment. */
export class ListingImageLogin {
  private window: BrowserWindow | null = null;
  private flight: Promise<void> | null = null;
  private busy = false;
  private generation = 0;
  private editorFence: (() => Promise<void>) | null = null;
  private finishEditor: (() => void) | null = null;
  constructor(private readonly input: Readonly<{
    parent(): BrowserWindow | null;
    preload: string;
    service: HostedListingImages;
    vault: ListingImageCredentialPort;
    /** Must require Touch ID / Windows Hello with no ordinary dialog fallback. */
    approve(reason: string): Promise<void>;
  }>) {
    ipcMain.handle("fba:listing-image-editor-login", async (event, password: unknown) => {
      const window = this.window;
      const editorFence = this.editorFence;
      if (!isListingImageLoginFrame(event, window) || !editorFence || this.busy) throw new Error("圖片登入視窗未授權。");
      if (!validListingImagePassword(password)) throw new Error("請輸入有效的下載頁密碼。");
      const fence = async (): Promise<void> => {
        await editorFence();
        if (window !== this.window || !isListingImageLoginFrame(event, window)) throw new Error("圖片登入視窗已關閉。");
      };
      this.busy = true;
      try {
        await fence();
        await this.input.approve("確認加密保存圖片服務登入密碼；之後使用 Touch ID／Windows Hello 連接圖片服務");
        await fence();
        await this.input.service.login(password, fence, () => this.input.vault.save(password, fence));
        await fence();
        this.finishEditor?.();
      } catch (error) { throw new Error(publicListingImagePreparationError(error).message); }
      finally { this.busy = false; }
    });
    ipcMain.handle("fba:listing-image-editor-close", (event) => {
      if (!isListingImageLoginFrame(event, this.window)) throw new Error("圖片登入視窗未授權。");
      this.close();
    });
  }

  confirmationWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /** Security invalidation/cancel; encrypted credentials intentionally remain. */
  close(): void {
    this.generation += 1;
    this.input.service.clear();
    const window = this.window;
    this.window = null;
    this.editorFence = null;
    this.finishEditor = null;
    this.flight = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  request(assertCurrent: () => Promise<void>): Promise<void> {
    if (this.flight) { this.window?.show(); this.window?.focus(); return this.flight; }
    const generation = this.generation;
    const fence = async (): Promise<void> => {
      if (generation !== this.generation) throw new Error("圖片登入已取消或工作環境已切換，請重新準備圖片。");
      await assertCurrent();
      if (generation !== this.generation) throw new Error("圖片登入已取消或工作環境已切換，請重新準備圖片。");
    };
    const flight = this.connect(fence).finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }

  private async connect(fence: () => Promise<void>): Promise<void> {
    await fence();
    const saved = await this.input.vault.hasCredentials();
    await fence();
    if (saved) {
      await this.input.approve("使用 Touch ID／Windows Hello 解鎖這台電腦保存的圖片服務登入密碼並重新連接");
      await fence();
      let password: string | null = await this.input.vault.read(fence);
      await fence();
      try {
        await this.input.service.login(password, fence);
        return;
      } catch (error) {
        await fence();
        // Only an explicit login rejection warrants replacing credentials.
        if (!(error instanceof ListingImageLoginError) || error.code !== "invalid-password") throw error;
      } finally { password = null; }
    }
    await fence();
    await this.open(fence, saved);
    await fence();
  }

  private async open(fence: () => Promise<void>, updatePassword: boolean): Promise<void> {
    const parent = this.input.parent();
    if (!parent || parent.isDestroyed()) throw new Error("App 尚未就緒。");
    const partition = `amz-listing-image-login-${crypto.randomUUID()}`;
    const isolated = session.fromPartition(partition);
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const window = new BrowserWindow({parent,modal:true,show:false,width:580,height:640,resizable:false,maximizable:false,fullscreenable:false,title:"AMZ.API 圖片服務",webPreferences:{preload:this.input.preload,partition,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,experimentalFeatures:false,webviewTag:false,navigateOnDragDrop:false,devTools:false}});
    this.window = window;
    this.editorFence = fence;
    let completed = false;
    this.finishEditor = () => { completed = true; window.destroy(); };
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({action:"deny"}));
    window.once("ready-to-show", () => { if (this.window === window && !window.isDestroyed()) window.show(); });
    const closed = new Promise<void>(resolve => window.once("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.editorFence = null;
        this.finishEditor = null;
        if (!completed) { this.generation += 1; this.input.service.clear(); }
      }
      resolve();
    }));
    try { await window.loadURL(listingImageLoginDataUrl(updatePassword)); }
    catch { if (this.window === window) this.close(); throw new Error("無法開啟圖片登入視窗。"); }
    await closed;
  }
}
