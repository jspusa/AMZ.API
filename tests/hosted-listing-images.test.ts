import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HostedListingImages, LISTING_IMAGE_SERVICE_ORIGIN as ORIGIN } from "../src/main/hosted-listing-images";
import { LocalImageUpload } from "../src/main/local-image-upload";
import { createScriptedSpExecutionContextAdapter } from "../src/main/amazon/sp-execution-context";
import { createRouterRequestContextAdapter } from "../src/main/router-request-context";

const ID = "11111111-1111-4111-8111-111111111111";
const bytes = new Uint8Array(32);
bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
new DataView(bytes.buffer).setUint32(16,1000);
new DataView(bytes.buffer).setUint32(20,1000);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const url = `${ORIGIN}/listing-images/v2/${ID}/${sha256}.png`;
const receipt = {operationId:ID,sha256,url,width:1000,height:1000,size:bytes.length,contentType:"image/png"};
const data = () => ({bytes,contentType:"image/png" as const,width:1000,height:1000,contextKey:"test-account-US-SKU",assertCurrent:vi.fn(async()=>{})});
const json = (value: unknown) => Response.json(value);

function fixture(options: {lostPut?: boolean; publicStatus?: number; wrongBytes?: boolean; afterPut?: () => void; badReceipt?: boolean; expiresAt?: string} = {}) {
  const calls: {path:string;method:string;headers:Headers}[] = [];
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({path,method,headers:new Headers(init?.headers)});
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    if (path.startsWith("/api/")) {
      if (method === "PUT") { options.afterPut?.(); if (options.lostPut) throw new Error("response lost"); }
      return json(options.badReceipt ? {...receipt,url:"https://untrusted.test/image.png"} : {...receipt, ...(options.expiresAt ? {expiresAt: options.expiresAt} : {})});
    }
    return new Response(Buffer.from(options.wrongBytes?new Uint8Array(32):bytes),{status:options.publicStatus ?? 200,headers:{"content-type":"image/png"}});
  });
  const service = new HostedListingImages({fetch:transport as typeof fetch,uuid:()=>ID});
  return {service,calls,transport};
}

describe("dedicated hosted image preparation",()=>{
  it("prepares a fresh source on an explicit request when a verified image has less than two days left", async () => {
    let now = Date.parse("2026-09-14T00:00:00.000Z");
    const nextId = "22222222-2222-4222-8222-222222222222";
    const ids = [ID, nextId];
    const records = new Map<string, object>();
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (!path.startsWith("/api/")) return new Response(bytes, {headers:{"content-type":"image/png"}});
      const id = path.split("/").at(-1)!;
      if (init?.method === "PUT") records.set(id, {...receipt,operationId:id,url:`${ORIGIN}/listing-images/v2/${id}/${sha256}.png`,expiresAt:new Date(now + 7 * 86400000).toISOString()});
      return json(records.get(id));
    });
    const service = new HostedListingImages({fetch:transport as typeof fetch,uuid:()=>ids.shift()!,now:()=>now});
    await expect(service.prepare(data())).resolves.toMatchObject({key:ID});
    now += 5 * 86400000 + 1;
    await expect(service.prepare(data())).resolves.toMatchObject({key:nextId,expiresAt:new Date(now + 7 * 86400000).toISOString()});
    expect(transport.mock.calls.filter(([, init])=>init?.method === "PUT")).toHaveLength(2);
  });
  it("returns the server expiry only after validating the temporary image and bytes", async () => {
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const f = fixture({expiresAt});
    await expect(f.service.prepare(data())).resolves.toEqual({url, key:ID, expiresAt});
  });
  it.each(["not-a-date", "2020-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"])("rejects invalid or expired temporary receipts: %s", async expiresAt => {
    const f = fixture({expiresAt});
    await expect(f.service.prepare(data())).rejects.toThrow();
  });
  it("allows no-R2 local upload to return a byte-verified public image with no Amazon call",async()=>{
    const f=fixture();
    const route = new LocalImageUpload({
      context:createRouterRequestContextAdapter(createScriptedSpExecutionContextAdapter(marketplaceId=>({marketplaceId,mode:"demo",accountScope:"fixture-account"}))),
      vault:{getImageStorage:async()=>{throw new Error("preparation must not unlock credential storage");}},hostedImages:f.service,
    });
    const response=await route.uploadImage({requestId:"hosted-image-test",method:"POST",path:"/api/uploads/listing-images",headers:{},query:{},body:{kind:"multipart",fields:{marketplaceId:"ATVPDKIKX0DER",sellerSku:"TEST-IMAGE-SKU"},file:{name:"TEST-IMAGE-SKU_01.png",type:"image/png",bytes}}});
    expect(response.status).toBe(200);
    expect(response.body.kind === "json" && response.body.value).toMatchObject({amazonUrl:url,readyForAmazon:true});
    expect(f.calls.map(call=>call.method)).toEqual(["PUT","GET"]);
    expect(f.calls.every(call=>!call.headers.has("authorization"))).toBe(true);
    expect(f.calls[0].path).toBe(`/api/listing-images/v2/${ID}`);
    expect(f.calls[0].headers.get("content-length")).toBe(String(bytes.length));
    expect(f.calls[0].headers.get("x-content-sha256")).toBe(sha256);
    expect(f.calls.every(call=>!call.path.includes("sp-api"))).toBe(true);
  });
  it("recovers a lost upload response with GET and never repeats PUT on preparation",async()=>{
    const f=fixture({lostPut:true});
    await expect(f.service.prepare(data())).resolves.toEqual({url,key:ID});
    await f.service.prepare(data());
    expect(f.calls.filter(call=>call.method==="PUT")).toHaveLength(1);
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
  it("retains GET-only recovery across security invalidation",async()=>{
    const f=fixture();
    await f.service.prepare(data());
    f.service.clear();
    await f.service.prepare(data());
    expect(f.calls.filter(call=>call.method==="PUT")).toHaveLength(1);
  });
  it.each([400, 413, 415, 422, 429])("permits explicit preparation after a definitive %i rejection and confirmed absence", async status => {
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
  it("keeps a reserved but unfinished upload GET-only across repeated preparation", async () => {
    const f = fixture();
    f.transport.mockImplementation(async () => Response.json({status:"pending"}, {status:202}));
    await expect(f.service.prepare(data())).rejects.toThrow();
    await expect(f.service.prepare(data())).rejects.toThrow();
    expect(f.transport.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT", "GET", "GET"]);
  });
  it("rejects out-of-bounds preparation before any request", async () => {
    const f = fixture();
    await expect(f.service.prepare({...data(), width: 40_001})).rejects.toThrow();
    await expect(f.service.prepare({...data(), bytes: new Uint8Array(10 * 1024 * 1024 + 1)})).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
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
    accountScope = "fixture-account-two";
    context.invalidate("account-changed");
    f.service.clear();
    expect((await prepare()).status).toBe(503);
    expect(puts).toBe(2);
  });
});

describe("public local image preparation diagnostics", () => {
  it("keeps temporary batch preparation bound to the exact SKU and context without returning base64", async () => {
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const f = fixture({expiresAt});
    const context = createRouterRequestContextAdapter(createScriptedSpExecutionContextAdapter(marketplaceId => ({marketplaceId, mode:"demo", accountScope:"fixture-account"})));
    const route = new LocalImageUpload({context, vault:{getImageStorage:async()=>null}, hostedImages:f.service});
    const response = await route.uploadImage({requestId:"batch-preparation",method:"POST",path:"/api/uploads/listing-images",query:{},headers:{},body:{kind:"multipart",fields:{marketplaceId:"ATVPDKIKX0DER",sellerSku:"TEST-IMAGE-SKU",batchMode:"true"},file:{name:"TEST-IMAGE-SKU_01.png",type:"image/png",bytes}}});
    expect(response.status).toBe(200);
    expect(response.body.kind === "json" && response.body.value).toMatchObject({amazonUrl:url, expiresAt, previewUrl:null});
    expect(JSON.stringify(response.body)).not.toContain("base64");
    const current = await context.capture("ATVPDKIKX0DER");
    await expect(route.assertPreparedImageUrls({urls:[url],context:current,sellerSku:"TEST-IMAGE-SKU"})).resolves.toBeUndefined();
    await expect(route.assertPreparedImageUrls({urls:[url],context:current,sellerSku:"DIFFERENT-SKU"})).rejects.toThrow();
    for (const disguised of [url.replace("supply-boss", "SUPPLY-BOSS"), url.replace(".site/", ".site:443/")]) {
      await expect(route.assertImagePreparation({urls:[disguised],previousUrls:[null],context:current,sellerSku:"TEST-IMAGE-SKU"})).rejects.toThrow();
    }
    route.clear();
    await expect(route.assertPreparedImageUrls({urls:[url],context:current,sellerSku:"TEST-IMAGE-SKU"})).rejects.toThrow();
  });
  it("does not return private upstream details or request login", async () => {
    const route=new LocalImageUpload({
      context:createRouterRequestContextAdapter(createScriptedSpExecutionContextAdapter(marketplaceId=>({marketplaceId,mode:"demo",accountScope:"fixture-account"}))),
      vault:{getImageStorage:async()=>{throw new Error("must not decrypt");}},
      hostedImages:{prepare:async()=>{throw new Error("fixture private request details password=canary");}},
    });
    const response=await route.uploadImage({requestId:"image-diagnostic-test",method:"POST",path:"/api/uploads/listing-images",headers:{},query:{},body:{kind:"multipart",fields:{marketplaceId:"ATVPDKIKX0DER",sellerSku:"TEST-IMAGE-SKU"},file:{name:"fixture.png",type:"image/png",bytes}}});
    expect(response.body.kind).toBe("json");
    expect(JSON.stringify(response.body)).toContain("IMAGE_PREPARATION_INCOMPLETE");
    expect(JSON.stringify(response.body)).not.toMatch(/canary|private request|密碼|登入|指紋/u);
  });
});
