import { readFile } from "node:fs/promises";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BATCH_SKUS, MAX_BATCH_SKU_TEXT, adjacentAuditSku, matchesSkuBatch, missingBatchSkus, parseSkuBatch } from "../src/renderer/src/audit-sku-filter";
import { AuditViewMemory, AuditViewSessionProvider, auditViewScope, useAuditMemoryState } from "../src/renderer/src/audit-view-session";
import AuditSkuFilter from "../src/renderer/src/components/audit-sku-filter";
import AuditItemNavigation from "../src/renderer/src/components/audit-item-navigation";
import UiBuildInformation from "../src/renderer/src/components/ui-build-information";
import { loadedUiBuild, requestUiReload } from "../src/renderer/src/ui-build";

const mounted: ReactTestRenderer[] = [];
async function render(element: Parameters<typeof create>[0]) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(element); }); mounted.push(tree); return tree;
}
afterEach(async () => {
  await act(async () => { for (const tree of mounted.splice(0)) tree.unmount(); }); vi.unstubAllGlobals();
});

describe("display-only exact SKU batch", () => {
  it("accepts newline/tab cells and deduplicates in input order", () => {
    expect(parseSkuBatch("A\r\nB\tC\nA\rD\n")).toEqual({skus:["A","B","C","D"],error:null});
  });
  it("preserves spaces, punctuation, leading zeroes and case", () => {
    expect(parseSkuBatch("  A  \na\n0007\nA,B\n空 白").skus).toEqual(["  A  ","a","0007","A,B","空 白"]);
    expect(matchesSkuBatch(["A"],"a")).toBe(false); expect(matchesSkuBatch([" A "],"A")).toBe(false);
  });
  it("accepts empty input as clearing", () => {
    expect(parseSkuBatch("\n\r\n\t")).toEqual({skus:[],error:null}); expect(matchesSkuBatch([],"ANY")).toBe(true);
  });
  it("accepts 500 identities but rejects the whole oversized batch", () => {
    const input=Array.from({length:MAX_BATCH_SKUS},(_,i)=>`SKU-${i}`).join("\n");
    expect(parseSkuBatch(input).skus).toHaveLength(MAX_BATCH_SKUS);
    expect(parseSkuBatch(input+"\nEXTRA")).toMatchObject({skus:[],error:expect.any(String)});
  });
  it("does not silently apply a prefix of oversized text", () => {
    expect(parseSkuBatch("x".repeat(MAX_BATCH_SKU_TEXT+1))).toMatchObject({skus:[],error:expect.any(String)});
  });
  it.each(["A\u0000B","A\u200bB","A\u202eB","A\u007fB","x".repeat(201)])("rejects malformed cell %s", value => {
    expect(parseSkuBatch(value)).toMatchObject({skus:[],error:expect.any(String)});
  });
  it("matches grouped ASIN rows without modifying identity", () => {
    expect(matchesSkuBatch(["CHILD-2"],["CHILD-1","CHILD-2"])).toBe(true);
    expect(matchesSkuBatch(["CHILD-2"],["CHILD-20"])).toBe(false);
    expect(missingBatchSkus(["A","B","C"],["A","C"])).toEqual(["B"]);
  });
  it("keeps typing local and applies/clears without network requests", async () => {
    const change=vi.fn(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const tree=await render(<AuditSkuFilter scope="test" skus={[]} availableSkus={["A","B"]} onChange={change}/>);
    const button=(label:string)=>tree.root.findAllByType("button").find(b=>b.children.join("").includes(label))!;
    await act(async()=>button("批次 SKU").props.onClick());
    await act(async()=>tree.root.findByType("textarea").props.onChange({target:{value:"A\nMISSING"}}));
    expect(change).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    await act(async()=>button("套用篩選").props.onClick());expect(change).toHaveBeenLastCalledWith(["A","MISSING"]);
    await act(async()=>tree.update(<AuditSkuFilter scope="test" skus={["A","MISSING"]} availableSkus={["A","B"]} onChange={change}/>));
    expect(tree.root.findAllByType("code").map(n=>n.children.join(""))).toEqual(["MISSING"]);
    await act(async()=>button("清除批次篩選").props.onClick());expect(change).toHaveBeenLastCalledWith([]);expect(fetch).not.toHaveBeenCalled();
  });
});

describe("memory-only view sessions",()=>{
  it("bounds retained fields and distinguishes falsy values",()=>{
    const m=new AuditViewMemory();m.write("zero",0);expect(m.read("zero",9)).toBe(0);
    for(let i=0;i<513;i++)m.write(String(i),i);
    expect(m.read("0",-1)).toBe(-1);expect(m.read("512",-1)).toBe(512);
  });
  it("isolates audit, marketplace, mode and source",()=>{
    const keys=[auditViewScope("content","US","live","1"),auditViewScope("image","US","live","1"),auditViewScope("content","JP","live","1"),auditViewScope("content","US","demo","1"),auditViewScope("content","US","live","2")];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("restores after child remount but resets on session/source transition",async()=>{
    function Item({scope}:{scope:string}){const [v,set]=useAuditMemoryState(scope,"page",1);return <button onClick={()=>set(n=>n+1)}>{v}</button>;}
    const view=(session:string,show=true,scope="content:1")=><AuditViewSessionProvider sessionKey={session}>{show&&<Item scope={scope}/>}</AuditViewSessionProvider>;
    const tree=await render(view("US/live"));await act(async()=>tree.root.findByType("button").props.onClick());
    await act(async()=>tree.update(view("US/live",false)));await act(async()=>tree.update(view("US/live")));
    expect(tree.root.findByType("button").children).toEqual(["2"]);
    await act(async()=>tree.update(view("JP/live")));expect(tree.root.findByType("button").children).toEqual(["1"]);
    await act(async()=>tree.root.findByType("button").props.onClick());
    await act(async()=>tree.update(view("JP/live",true,"content:2")));expect(tree.root.findByType("button").children).toEqual(["1"]);
  });
  it("does not introduce operational browser persistence or network",async()=>{
    for(const name of ["audit-view-session.tsx","audit-sku-filter.ts","components/audit-sku-filter.tsx"]){
      const s=await readFile(new URL(`../src/renderer/src/${name}`,import.meta.url),"utf8");
      expect(s).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest)\b/u);expect(s).not.toContain("location.");
    }
  });
});

describe("filtered queue navigation",()=>{
  it("does not wrap or guess an absent identity",()=>{
    expect(adjacentAuditSku(["A","B"],"A",-1)).toBeNull();expect(adjacentAuditSku(["A","B"],"B",1)).toBeNull();
    expect(adjacentAuditSku(["A","B"],"missing",1)).toBeNull();expect(adjacentAuditSku(["A","B","C"],"B",1)).toBe("C");
  });
  it("disables switching while busy and selects only exact queued identities",async()=>{
    const select=vi.fn(),tree=await render(<AuditItemNavigation skus={[" A ","B"]} currentSku=" A " disabled onSelect={select}/>);
    expect(tree.root.findAllByType("button").every(b=>b.props.disabled)).toBe(true);
    await act(async()=>tree.root.findAllByType("button")[1]!.props.onClick());expect(select).not.toHaveBeenCalled();
    await act(async()=>tree.update(<AuditItemNavigation skus={[" A ","B"]} currentSku=" A " onSelect={select}/>));
    await act(async()=>tree.root.findAllByType("button")[1]!.props.onClick());expect(select).toHaveBeenLastCalledWith("B");
  });
  it.each([{skus:[] as string[]},{skus:["A"]}])("hides redundant navigation for %j",async ({skus})=>{
    const tree=await render(<AuditItemNavigation skus={skus} currentSku="A" onSelect={()=>undefined}/>);expect(tree.toJSON()).toBeNull();
  });
  it("retains exact SKU and confirms unsent drafts in content/image navigation",async()=>{
    const content=await readFile(new URL("../src/renderer/src/components/sku-operations-drawer.tsx",import.meta.url),"utf8");
    const image=await readFile(new URL("../src/renderer/src/components/image-workspace-drawer.tsx",import.meta.url),"utf8");
    expect(content).toContain("const sellerSku = sellerSkuOverride ?? skuInput.trim()");expect(content).toContain("snapshot.sellerSku !== sellerSku");
    expect(image).toContain("const sellerSku = exact ? requestedSku : requestedSku.trim()");expect(image).toContain("next.sellerSku !== sellerSku");
    for(const s of [content,image])expect(s).toContain("window.confirm(");
  });
});

describe("bundled UI version and safe reload",()=>{
  it("does not guess production metadata",()=>{expect(loadedUiBuild()).toEqual({revision:"",builtAt:""});});
  it("reads a validated revision/time from its own bundle",()=>{
    vi.stubGlobal("__AMZ_UI_BUILD__",{revision:"a".repeat(40),builtAt:"2026-09-10T00:00:00Z"});
    expect(loadedUiBuild()).toEqual({revision:"a".repeat(40),builtAt:"2026-09-10T00:00:00Z"});
  });
  it("rejects malformed metadata",()=>{vi.stubGlobal("__AMZ_UI_BUILD__",{revision:"wrong",builtAt:"invalid"});expect(loadedUiBuild()).toEqual({revision:"",builtAt:""});});
  it("blocks busy reload without a confirmation",()=>{
    const confirm=vi.fn(()=>true),reload=vi.fn();expect(requestUiReload(()=>true,confirm,reload)).toBe(false);expect(confirm).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
  });
  it("does not reload on cancellation",()=>{const reload=vi.fn();expect(requestUiReload(()=>false,()=>false,reload)).toBe(false);expect(reload).not.toHaveBeenCalled();});
  it("rechecks the guard after confirmation",()=>{
    let busy=false;const reload=vi.fn();expect(requestUiReload(()=>busy,()=>{busy=true;return true;},reload)).toBe(false);expect(reload).not.toHaveBeenCalled();
  });
  it("reloads once on explicit confirmation",()=>{const reload=vi.fn();expect(requestUiReload(()=>false,()=>true,reload)).toBe(true);expect(reload).toHaveBeenCalledTimes(1);});
  it("shows the blocked reason and disables the settings control",async()=>{
    const tree=await render(<UiBuildInformation blockedReason="請先返回首頁"/>);expect(tree.root.findByType("button").props.disabled).toBe(true);expect(tree.root.findByProps({role:"status"}).children).toEqual(["請先返回首頁"]);
  });
});
