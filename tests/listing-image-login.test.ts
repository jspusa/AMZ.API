import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { handle: vi.fn() }, session: {} }));
import { isListingImageLoginFrame, listingImageLoginDataUrl, LISTING_IMAGE_LOGIN_HTML } from "../src/main/listing-image-login";

describe("packaged listing image login boundary", () => {
  it("authorizes only the exact local editor main frame", () => {
    const frame = { url: listingImageLoginDataUrl() };
    const contents = { mainFrame: frame };
    const editor = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
    const event = {sender:contents,senderFrame:frame} as unknown as IpcMainInvokeEvent;
    expect(isListingImageLoginFrame(event,editor)).toBe(true);
    expect(isListingImageLoginFrame({...event,senderFrame:{url:frame.url} as IpcMainInvokeEvent["senderFrame"]},editor)).toBe(false);
    frame.url="https://jspusa.github.io/AMZ.API/";
    expect(isListingImageLoginFrame(event,editor)).toBe(false);
    expect(isListingImageLoginFrame(event,null)).toBe(false);
  });
  it("has no network or form destination and clears the password before IPC completion", () => {
    expect(LISTING_IMAGE_LOGIN_HTML).toContain("connect-src 'none'");
    expect(LISTING_IMAGE_LOGIN_HTML).toContain("form-action 'none'");
    expect(LISTING_IMAGE_LOGIN_HTML).not.toMatch(/https?:\/\//u);
    expect(LISTING_IMAGE_LOGIN_HTML).toContain("const password=p.value;p.value='';try{await window.fbaListingImageEditor.login(password)");
    expect(LISTING_IMAGE_LOGIN_HTML).not.toMatch(/localStorage|sessionStorage|document\.cookie/u);
  });
});
