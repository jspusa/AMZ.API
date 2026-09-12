import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ListingImageLoginError, HostedListingImages, LISTING_IMAGE_SERVICE_ORIGIN as ORIGIN } from "../src/main/hosted-listing-images";
import { NATIVE_BIOMETRIC_REQUIRED_MESSAGE, NATIVE_CONFIRMATION_CANCELLED_MESSAGE, WINDOWS_HELLO_REQUIRED_MESSAGE } from "../src/main/native-confirmation";
import { LISTING_IMAGE_VAULT_ERROR, LISTING_IMAGE_VAULT_UNAVAILABLE } from "../src/main/listing-image-credential-vault";
import { LocalImageUpload } from "../src/main/local-image-upload";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { createRouterRequestContextAdapter } from "../src/main/router-request-context";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-12T12:00:00Z");
const bytes = new Uint8Array(32);
bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
new DataView(bytes.buffer).setUint32(16,1000);
new DataView(bytes.buffer).setUint32(20,1000);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = `${ORIGIN}/listing-images/${ID}/${sha256}.png`;
const receipt = {operationId:ID,sha256,url,width:1000,height:1000,size:bytes.length,contentType:"image/png"};
const data = () => ({bytes,contentType:"image/png" as const,width:1000,height:1000,contextKey:"test-account-US-SKU",assertCurrent:vi.fn(async()=>{})});
const json = (value: unknown) => Response.json(value);

function fixture(options: {lostPut?: boolean; publicStatus?: number; wrongBytes?: boolean; afterPut?: () => void; badReceipt?: boolean} = {}) {
  const calls: {path:string;method:string;headers:Headers}[] = [];
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({path,method,headers:new Headers(init?.headers)});
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    if (path.endsWith("/login")) return json({token:"fixture-image-token-".repeat(4),expiresAt:new Date(NOW+60_000).toISOString()});
    if (path.startsWith("/api/")) {
      if (method === "PUT") { options.afterPut?.(); if (options.lostPut) throw new Error("response lost"); }
      return json(options.badReceipt ? {...receipt,url:"https://untrusted.test/image.png"} : receipt);
    }
    return new Response(Buffer.from(options.wrongBytes?new Uint8Array(32):bytes),{status:options.publicStatus ?? 200,headers:{"content-type":"image/png"}});
  });
  let service: HostedListingImages;
  const requestLogin = vi.fn(async()=>{await service.login("fixture-password");});
  service = new HostedListingImages({requestLogin,fetch:transport as typeof fetch,now:()=>NOW,uuid:()=>ID});
  return {service,calls,requestLogin,transport};
}

describe("dedicated hosted image preparation",()=>{
  it("allows no-R2 local upload to return a byte-verified public image with no Amazon call",async()=>{
    const f=fixture();
    const route = new LocalImageUpload({
      context:createRouterRequestContextAdapter(createScriptedSpExecutionContextAdapter(marketplaceId=>({marketplaceId,mode:"demo",accountScope:"fixture-account"}))),
      vault:{getImageStorage:async()=>null},hostedImages:f.service,
    });
    const response=await route.uploadImage({requestId:"hosted-image-test",method:"POST",path:"/api/uploads/listing-images",headers:{},query:{},body:{kind:"multipart",fields:{marketplaceId:"ATVPDKIKX0DER",sellerSku:"TEST-IMAGE-SKU"},file:{name:"TEST-IMAGE-SKU_01.png",type:"image/png",bytes}}});
    expect(response.status).toBe(200);
    expect(response.body.kind === "json" && response.body.value).toMatchObject({amazonUrl:url,readyForAmazon:true});
    expect(f.calls.map(call=>call.method)).toEqual(["POST","PUT","GET"]);
    expect(f.calls[2].headers.has("authorization")).toBe(false);
    expect(f.calls.every(call=>!call.path.includes("sp-api"))).toBe(true);
  });
  it("recovers a lost upload response with GET and never repeats PUT on preparation",async()=>{
    const f=fixture({lostPut:true});
    await expect(f.service.prepare(data())).resolves.toEqual({url,key:ID});
    await f.service.prepare(data());
    expect(f.calls.filter(call=>call.method==="PUT")).toHaveLength(1);
    expect(f.requestLogin).toHaveBeenCalledOnce();
  });
  it.each([{publicStatus:403},{wrongBytes:true},{badReceipt:true}])("does not mark an unreadable/mismatched image ready (%j)",async options=>{
    const f=fixture(options);
    await expect(f.service.prepare(data())).rejects.toThrow();
  });
  it("rejects late upload receipt after context changes before public verification",async()=>{
    let current=true;
    const f=fixture({afterPut:()=>{current=false;}});
    await expect(f.service.prepare({...data(),assertCurrent:async()=>{if(!current)throw new Error("context changed");}})).rejects.toThrow("context changed");
    expect(f.calls.filter(call=>call.path.startsWith("/listing-images/"))).toHaveLength(0);
  });
  it("clears the separate image session on security invalidation",async()=>{
    const f=fixture();
    await f.service.prepare(data());
    f.service.clear();
    expect(f.service.authenticated()).toBe(false);
    await f.service.prepare(data());
    expect(f.requestLogin).toHaveBeenCalledTimes(2);
    expect(f.calls.filter(call=>call.method==="PUT")).toHaveLength(1);
  });
  it.each([401, 413, 415, 422])("permits explicit preparation after a definitive %i rejection and confirmed absence", async status => {
    const f = fixture();
    const normal = f.transport.getMockImplementation()!;
    let puts = 0;
    f.transport.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "PUT" && ++puts === 1) return Response.json({}, {status});
      if (path.startsWith("/api/") && !path.endsWith("/login") && init?.method === "GET" && puts === 1) return Response.json({}, {status:404});
      return normal(input, init);
    });
    await expect(f.service.prepare(data())).rejects.toThrow();
    expect(puts).toBe(1);
    await expect(f.service.prepare(data())).resolves.toEqual({url,key:ID});
    expect(puts).toBe(2);
  });
  it("keeps unknown outcomes GET-only even when status has not found the image yet", async () => {
    const f = fixture();
    const normal = f.transport.getMockImplementation()!;
    let puts = 0;
    f.transport.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "PUT") { puts++; throw new Error("unknown transport outcome"); }
      if (path.startsWith("/api/") && !path.endsWith("/login")) return Response.json({}, {status:404});
      return normal(input, init);
    });
    await expect(f.service.prepare(data())).rejects.toThrow();
    await expect(f.service.prepare(data())).rejects.toThrow();
    expect(puts).toBe(1);
  });
  it("keeps unknown local uploads GET-only after lock while preserving account isolation", async () => {
    const f = fixture();
    const normal = f.transport.getMockImplementation()!;
    let puts = 0;
    f.transport.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === "PUT") { puts++; throw new Error("unknown transport outcome"); }
      if (path.startsWith("/api/") && !path.endsWith("/login")) return Response.json({}, { status: 404 });
      return normal(input, init);
    });
    let accountScope = "fixture-account-one";
    const context = createScriptedSpExecutionContextAdapter(marketplaceId => ({ marketplaceId, mode: "live", accountScope }));
    const route = new LocalImageUpload({ context: createRouterRequestContextAdapter(context), vault: { getImageStorage: async () => null }, hostedImages: f.service });
    const prepare = () => route.uploadImage({ requestId: "retained-image-test", method: "POST", path: "/api/uploads/listing-images", headers: {}, query: {}, body: { kind: "multipart", fields: { marketplaceId: "ATVPDKIKX0DER", sellerSku: "TEST-IMAGE-SKU" }, file: { name: "TEST-IMAGE-SKU_01.png", type: "image/png", bytes } } });
    expect((await prepare()).status).toBe(503);
    context.invalidate("lock-screen");
    f.service.clear();
    expect((await prepare()).status).toBe(503);
    expect(puts).toBe(1);
    expect(f.requestLogin).toHaveBeenCalledTimes(2);
    accountScope = "fixture-account-two";
    context.invalidate("account-changed");
    f.service.clear();
    expect((await prepare()).status).toBe(503);
    expect(puts).toBe(2);
  });
});

describe("image login response evidence", () => {
  it.each([401, 429, 503])("distinguishes only an exact 401 rejection from transient %i failure", async status => {
    const transport = vi.fn(async () => Response.json({message:"fixture private server detail"}, {status}));
    const service = new HostedListingImages({requestLogin:async()=>{}, fetch:transport, now:()=>NOW});
    await expect(service.login("fixture-password")).rejects.toMatchObject({code: status === 401 ? "invalid-password" : "unavailable"});
    expect(transport).toHaveBeenCalledOnce();
    expect(service.authenticated()).toBe(false);
  });
  it("checks the caller context before password dispatch and before retaining the session", async () => {
    const f = fixture();
    await expect(f.service.login("fixture-password", async () => {throw new Error("context changed");})).rejects.toThrow("context changed");
    expect(f.transport).not.toHaveBeenCalled();
    const normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => { const result = await normal(input, init); f.service.clear(); return result; });
    await expect(f.service.login("fixture-password")).rejects.toThrow();
    expect(f.service.authenticated()).toBe(false);
  });
});

describe("public local image preparation diagnostics", () => {
  it.each([
    [new Error(NATIVE_CONFIRMATION_CANCELLED_MESSAGE), "IMAGE_LOGIN_CANCELLED", "身分驗證已取消"],
    [new Error(NATIVE_BIOMETRIC_REQUIRED_MESSAGE), "IMAGE_BIOMETRIC_REQUIRED", "需要可用的 Touch ID"],
    [new Error(WINDOWS_HELLO_REQUIRED_MESSAGE), "IMAGE_WINDOWS_HELLO_REQUIRED", "Windows Hello"],
    [new Error(LISTING_IMAGE_VAULT_UNAVAILABLE), "IMAGE_VAULT_UNAVAILABLE", "不會用明文"],
    [new Error(LISTING_IMAGE_VAULT_ERROR), "IMAGE_VAULT_ERROR", "無法確認"],
    [new ListingImageLoginError("unavailable"), "IMAGE_LOGIN_UNAVAILABLE", "已保留登入設定"],
    [new Error("fixture private request details password=canary"), "IMAGE_PREPARATION_INCOMPLETE", "圖片準備尚未完成"],
  ])("returns only an allowlisted diagnostic for %s", async (error, code, message) => {
    const route=new LocalImageUpload({
      context:createRouterRequestContextAdapter(createScriptedSpExecutionContextAdapter(marketplaceId=>({marketplaceId,mode:"demo",accountScope:"fixture-account"}))),
      vault:{getImageStorage:async()=>null},
      hostedImages:{prepare:async()=>{throw error;}},
    });
    const response=await route.uploadImage({requestId:"image-diagnostic-test",method:"POST",path:"/api/uploads/listing-images",headers:{},query:{},body:{kind:"multipart",fields:{marketplaceId:"ATVPDKIKX0DER",sellerSku:"TEST-IMAGE-SKU"},file:{name:"fixture.png",type:"image/png",bytes}}});
    expect(response.body.kind).toBe("json");
    expect(JSON.stringify(response.body)).toContain(String(code));
    expect(JSON.stringify(response.body)).toContain(String(message));
    expect(JSON.stringify(response.body)).not.toMatch(/canary|private request|完成圖片服務登入/u);
  });
});
