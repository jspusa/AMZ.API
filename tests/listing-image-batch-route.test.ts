import {describe, expect, it, vi} from "vitest";
import {ApiRouter} from "../src/main/api-router";
import type {CredentialVault} from "../src/main/credential-vault";
import type {LocalStore} from "../src/main/local-store";
import type {ApiRequest, ApiResponse} from "../src/shared/contracts";
import type {ListingImageBatchCommand} from "../src/main/listing-image-batch-mutations";

describe("folder image batch router boundary", () => {
  it.each([
    ["GET", {}, "capabilities"],
    ["GET", {batchId:"image-batch.fixture"}, "observe"],
    ["GET", {recoverSkus:'["SKU1"]'}, "recover"],
    ["POST", {}, "preview"],
    ["PATCH", {}, "commit"],
  ] as const)("dispatches %s %j to its main owner", async (method, query, operation) => {
    const response: ApiResponse = {status:200,headers:{},body:{kind:"json",value:{owned:true}}};
    const handle = vi.fn(async () => response);
    const router = new ApiRouter({store:{} as LocalStore,vault:{} as CredentialVault,approveWrite:async()=>undefined,
      listingImageBatchMutations:{handle,clear:vi.fn()}});
    const request:ApiRequest={requestId:"batch-route",method,path:"/api/sp-api/listing-images-batch",query,headers:{}};
    expect(await router.handle(request)).toBe(response);
    expect(handle).toHaveBeenCalledWith({operation,request});
  });

  it.each([
    ["POST", "preview", {marketplaceId:"ATVPDKIKX0DER", replacementMode:"selected-slots", rows:[{sellerSku:"AFA21AM", urls:[null,null,null,null,null,null,null,null,"https://images.example.com/shared.jpg",null]}]}],
    ["PATCH", "commit", {marketplaceId:"ATVPDKIKX0DER",batchId:"image-batch.fixture",reviewToken:"image-review.fixture",selectedSlotsAcknowledged:true}],
  ] as const)("keeps the %s selected-slot intent intact at the owner boundary", async (method, operation, value) => {
    const response: ApiResponse = {status:200,headers:{},body:{kind:"json",value:{owned:true}}};
    const handle = vi.fn(async () => response);
    const router = new ApiRouter({store:{} as LocalStore,vault:{} as CredentialVault,approveWrite:async()=>undefined,
      listingImageBatchMutations:{handle,clear:vi.fn()}});
    const request:ApiRequest={requestId:"selected-batch-route",method,path:"/api/sp-api/listing-images-batch",query:{},headers:{},body:{kind:"json",value}};
    expect(await router.handle(request)).toBe(response);
    expect(handle).toHaveBeenCalledWith({operation,request});
  });

  it("returns the owner's async preview and observes the same preparing plan without committing", async () => {
    const marketplaceId = "ATVPDKIKX0DER";
    const batchId = "image-batch.preparing-fixture";
    const snapshot = {
      batchId, marketplaceId, phase: "preparing",
      rows: [{sellerSku:"SKU1", state:"checking"}],
      previewProgress: {checkedSkus:0, totalSkus:1, currentSku:null},
      totals: {submitted:0},
    };
    const started: ApiResponse = {status:202,headers:{"cache-control":"no-store"},body:{kind:"json",value:snapshot}};
    const observed: ApiResponse = {status:200,headers:{"cache-control":"no-store"},body:{kind:"json",value:snapshot}};
    const handle = vi.fn(async ({operation}: ListingImageBatchCommand) => {
      if (operation === "preview") return started;
      if (operation === "observe") return observed;
      throw new Error("This read-only preview fixture does not authorize commit");
    });
    const approveWrite = vi.fn(async () => undefined);
    const router = new ApiRouter({store:{} as LocalStore,vault:{} as CredentialVault,approveWrite,
      listingImageBatchMutations:{handle,clear:vi.fn()}});
    const preview: ApiRequest = {requestId:"async-batch-preview",method:"POST",path:"/api/sp-api/listing-images-batch",query:{},headers:{},
      body:{kind:"json",value:{marketplaceId,replacementMode:"selected-slots",asyncPreview:true,
        rows:[{sellerSku:"SKU1",urls:[null,null,null,null,null,null,null,null,"https://images.example.com/shared.jpg",null]}]}}};
    const observe: ApiRequest = {requestId:"async-batch-observe",method:"GET",path:preview.path,query:{marketplaceId,batchId},headers:{}};

    expect(await router.handle(preview)).toBe(started);
    expect(await router.handle(observe)).toBe(observed);
    expect(started).toMatchObject({status:202,body:{value:{phase:"preparing",rows:[{state:"checking"}],totals:{submitted:0}}}});
    expect(handle.mock.calls.map(([command]) => command)).toEqual([
      {operation:"preview",request:preview}, {operation:"observe",request:observe},
    ]);
    expect(approveWrite).not.toHaveBeenCalled();
  });
});
