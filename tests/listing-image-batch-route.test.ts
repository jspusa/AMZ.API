import {describe, expect, it, vi} from "vitest";
import {ApiRouter} from "../src/main/api-router";
import type {CredentialVault} from "../src/main/credential-vault";
import type {LocalStore} from "../src/main/local-store";
import type {ApiRequest, ApiResponse} from "../src/shared/contracts";

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
});
