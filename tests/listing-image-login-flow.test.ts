import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
const electron = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), windows: [] as unknown[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { mainFrame: { url: "" }, setWindowOpenHandler: vi.fn() });
    constructor() { super(); electron.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    async loadURL(url: string) { this.webContents.mainFrame.url = url; this.emit("ready-to-show"); }
    show() {}
    focus() {}
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  return { BrowserWindow: Window, ipcMain: {handle: (key: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(key, handler)}, session: {fromPartition: () => ({setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn()})} };

});
import { ListingImageLogin } from "../src/main/listing-image-login";
import { NATIVE_CONFIRMATION_CANCELLED_MESSAGE } from "../src/main/native-confirmation";
import { HostedListingImages } from "../src/main/hosted-listing-images";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
const current = async () => {};
beforeEach(() => {electron.windows.length=0;electron.handlers.clear();});
function fixture(saved: string | null = null) {
  const order: string[] = [];
  let password = saved;
  const vault = {
    hasCredentials: vi.fn(async () => password !== null),
    read: vi.fn(async (fence: () => Promise<void>) => {await fence(); order.push("decrypt"); return password!;}),
    save: vi.fn(async (value: string, fence: () => Promise<void>) => {await fence(); order.push("save"); password=value;}),
  };
  const approve = vi.fn(async () => {order.push("approve");});
  const transport = vi.fn(async () => {order.push("login");return Response.json({token:"fixture-image-session-".repeat(3),expiresAt:new Date(Date.now()+60_000).toISOString()});});
  const service = new HostedListingImages({ requestLogin: async () => {}, fetch: transport });
  const parent = {isDestroyed:()=>false} as BrowserWindow;
  const owner = new ListingImageLogin({ parent:()=>parent, preload:"fixture-preload", service, vault, approve });
  const window = () => electron.windows.at(-1) as BrowserWindow;
  const login = (value: unknown) => electron.handlers.get("fba:listing-image-editor-login")!({sender:window().webContents,senderFrame:window().webContents.mainFrame} as IpcMainInvokeEvent,value) as Promise<void>;
  return { owner, service, vault, approve, transport, order, login, window, password:()=>password };
}

describe("native listing image sign in", () => {
  it("initial setup approves, verifies the password, then saves before continuing preparation", async () => {
    const f=fixture();
    const request=f.owner.request(current);
    await vi.waitFor(()=>expect(electron.windows).toHaveLength(1));
    expect(f.order).toEqual([]);
    await f.login("fixture-new-password");
    await request;
    expect(f.order).toEqual(["approve","login","save"]);
    expect(f.password()).toBe("fixture-new-password");
    expect(f.service.authenticated()).toBe(true);
    expect(f.window().isDestroyed()).toBe(true);
  });
  it("requires native approval before decrypting a saved password and never opens a password sheet", async () => {
    const f=fixture("fixture-saved-password");
    const approval=deferred<void>();
    f.approve.mockImplementationOnce(async()=>{f.order.push("approve");await approval.promise;});
    const request=f.owner.request(current);
    await vi.waitFor(()=>expect(f.approve).toHaveBeenCalledOnce());
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    approval.resolve();
    await request;
    expect(f.order).toEqual(["approve","decrypt","login"]);
    expect(electron.windows).toHaveLength(0);
    expect(f.vault.save).not.toHaveBeenCalled();
  });
  it("native cancellation leaves a saved credential untouched with no decryption or network", async () => {
    const f=fixture("fixture-saved-password");
    f.approve.mockRejectedValueOnce(new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE));
    await expect(f.owner.request(current)).rejects.toThrow(NATIVE_CONFIRMATION_CANCELLED_MESSAGE);
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.password()).toBe("fixture-saved-password");
    expect(electron.windows).toHaveLength(0);
  });
  it("lock during approval prevents late approval from decrypting or restoring a session", async () => {
    const f=fixture("fixture-saved-password");
    const approval=deferred<void>();
    f.approve.mockReturnValueOnce(approval.promise);
    const request=f.owner.request(current);
    const rejected=expect(request).rejects.toThrow("圖片登入已取消");
    await vi.waitFor(()=>expect(f.approve).toHaveBeenCalledOnce());
    f.owner.close();
    approval.resolve();
    await rejected;
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.service.authenticated()).toBe(false);
    await f.owner.request(current);
    expect(f.service.authenticated()).toBe(true);
  });
  it("lock during asynchronous decryption prevents any password dispatch", async () => {
    const f=fixture("fixture-saved-password");
    const decryption=deferred<string>();
    f.vault.read.mockReturnValueOnce(decryption.promise);
    const request=f.owner.request(current);
    const rejected=expect(request).rejects.toThrow("圖片登入已取消");
    await vi.waitFor(()=>expect(f.vault.read).toHaveBeenCalledOnce());
    f.owner.close();
    decryption.resolve("fixture-saved-password");
    await rejected;
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.password()).toBe("fixture-saved-password");
  });
  it("closing the first-setup sheet during native approval never saves or dispatches the password", async () => {
    const f=fixture();
    const approval=deferred<void>();
    f.approve.mockReturnValueOnce(approval.promise);
    const request=f.owner.request(current);
    const requestRejected=expect(request).rejects.toThrow("圖片登入已取消");
    await vi.waitFor(()=>expect(electron.windows).toHaveLength(1));
    const attempt=f.login("fixture-new-password");
    const attemptRejected=expect(attempt).rejects.toThrow();
    await vi.waitFor(()=>expect(f.approve).toHaveBeenCalledOnce());
    f.window().destroy();
    approval.resolve();
    await Promise.all([requestRejected,attemptRejected]);
    expect(f.vault.save).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([429,503,"network","malformed"])("keeps saved credentials and avoids a password prompt on %s", async failure => {
    const f=fixture("fixture-saved-password");
    f.transport.mockImplementationOnce(async()=>{
      if(failure === "network")throw new Error("fixture private request details");
      if(failure === "malformed")return Response.json({unexpected:"fixture private response"});
      return Response.json({}, {status:failure as number});
    });
    await expect(f.owner.request(current)).rejects.toThrow(/已保留登入設定/u);
    expect(electron.windows).toHaveLength(0);
    expect(f.password()).toBe("fixture-saved-password");
    expect(f.vault.save).not.toHaveBeenCalled();
  });
  it("only a 401 offers replacement, and incorrect replacement cannot overwrite the saved password", async () => {
    const f=fixture("fixture-old-password");
    f.transport.mockResolvedValueOnce(Response.json({}, {status:401}));
    const request=f.owner.request(current);
    await vi.waitFor(()=>expect(electron.windows).toHaveLength(1));
    f.transport.mockResolvedValueOnce(Response.json({}, {status:401}));
    await expect(f.login("fixture-incorrect-password")).rejects.toThrow("密碼已失效或不正確");
    expect(f.password()).toBe("fixture-old-password");
    expect(f.vault.save).not.toHaveBeenCalled();
    await f.login("fixture-replacement-password");
    await request;
    expect(f.password()).toBe("fixture-replacement-password");
    expect(f.approve).toHaveBeenCalledTimes(3);
    expect(f.vault.save).toHaveBeenCalledOnce();
  });
  it("does not publish a session when saving the verified password fails", async () => {
    const f=fixture();
    f.vault.save.mockRejectedValueOnce(new Error("fixture storage failure"));
    const request=f.owner.request(current);
    const rejected=expect(request).rejects.toThrow("圖片登入已取消");
    await vi.waitFor(()=>expect(electron.windows).toHaveLength(1));
    await expect(f.login("fixture-password")).rejects.toThrow("圖片準備尚未完成");
    expect(f.service.authenticated()).toBe(false);
    f.owner.close();
    await rejected;
  });
  it("a late login response after lock cannot save credentials or restore a session", async () => {
    const f=fixture();
    const response=deferred<Response>();
    f.transport.mockReturnValueOnce(response.promise);
    const request=f.owner.request(current);
    const rejected=expect(request).rejects.toThrow("圖片登入已取消");
    await vi.waitFor(()=>expect(electron.windows).toHaveLength(1));
    const attempt=f.login("fixture-new-password");
    const attemptRejected=expect(attempt).rejects.toThrow();
    await vi.waitFor(()=>expect(f.transport).toHaveBeenCalledOnce());
    f.owner.close();
    response.resolve(Response.json({token:"fixture-image-session-".repeat(3),expiresAt:new Date(Date.now()+60_000).toISOString()}));
    await Promise.all([rejected,attemptRejected]);
    expect(f.vault.save).not.toHaveBeenCalled();
    expect(f.service.authenticated()).toBe(false);
  });
});
