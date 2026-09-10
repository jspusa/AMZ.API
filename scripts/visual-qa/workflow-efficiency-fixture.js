/* Synthetic, read-only fixture for frontend navigation. Never installed in production. */
(() => {
  const original = window.fbaOS.api.request;
  window.fbaOS.app.version = async () => "0.1.63";
  window.fbaOS.app.capabilities = async () => ({schemaVersion:1, appVersion:"0.1.63", features:{businessPricingBatch:1,recentBusinessPricingWork:0}});
  const reply = value => ({ status:200,headers:{'content-type':'application/json'},body:{kind:'json',value} });
  const capability = {supported:true,editable:true,required:false,minItems:1,maxItems:5,minLength:1,maxLength:10000,maxUtf8Bytes:null,languageTags:[],reason:null};
  const interactiveListing = {
  mode: "live",
  marketplaceId: "ATVPDKIKX0DER",
  sellerSku: "FBA-MISSING",
  asin: "B000000001",
  title: "Missing business price",
  productType: "PET_FOOD",
  standardPrice: { amount: 19.99, currencyCode: "USD" },
  minimumPrice: { amount: 18, currencyCode: "USD" },
  minimumPricePresence: "canonical",
  businessPrice: null,
  businessOfferPresence: "absent",
  businessPricingManagedByAutomation: false,
  quantityDiscountPlan: {
    discountType: "percent",
    levels: [
      { lowerBound: 5, value: 3 },
      { lowerBound: 10, value: 6 },
    ],
  },
  quantityDiscountPlanPresence: "canonical",
  quantityDiscountPlanHash: "f".repeat(64),
  businessOfferGuardHash: "a".repeat(64),
  businessOfferProtectedHash: "e".repeat(64),
  businessPricingCapability: {
    supported: true,
    editable: true,
    reason: null,
    schemaChecksum: "seller-schema-checksum",
    quantityDiscountsSupported: true,
    quantityDiscountsEditable: true,
    quantityDiscountsReason: null,
  },
  fetchedAt: "2026-08-22T12:00:00.000Z",
  notice: null,
};
  window.fbaOS.api.request = async request => {
    if(request.method==='GET' && request.path==='/api/sp-api/listing-content') {
      window.__rendererVisualRequests.push({method:request.method,path:request.path});
      const sku=request.query.sku;
      return reply({mode:'demo',marketplaceId:request.query.marketplaceId,sellerSku:sku,asin:sku.includes('TYPO')?'B04COPY002':'B04COPY001',productType:'PET_FOOD',status:['BUYABLE'],fetchedAt:'2026-08-22T12:00:00.000Z',updatedAt:null,requestId:null,issues:[],notice:null,
        content:{title:`Synthetic ${sku}`,itemHighlight:'A safe fixture highlight',bulletPoints:['One fixture bullet'],productDescription:'Synthetic content',ingredients:'Turkey'},
        capabilities:{title:capability,itemHighlight:capability,bulletPoints:capability,productDescription:capability,ingredients:capability}});
    }
    if(request.method==='GET' && request.path==='/api/sp-api/listing-images') {
      window.__rendererVisualRequests.push({method:request.method,path:request.path});
      return reply({mode:'demo',marketplaceId:request.query.marketplaceId,sellerSku:request.query.sku,asin:'B04IMAGE01',productType:'PET_FOOD',title:`Synthetic ${request.query.sku}`,notice:'Synthetic images only',images:Array.from({length:9},(_,index)=>({attributeName:index?'other_product_image_locator_'+index:'main_product_image_locator',label:index?'圖片 '+(index+1):'主圖',url:index<3?'https://example.invalid/fixture-'+index+'.png':null,capability:{...capability,attributeName:index?'other_product_image_locator_'+index:'main_product_image_locator',label:'圖片',required:index===0}}))});
    }
    if(request.method==='GET' && request.path==='/api/sp-api/business-pricing') {
      window.__rendererVisualRequests.push({method:request.method,path:request.path});
      return reply({...interactiveListing,mode:'demo',sellerSku:request.query.sku,asin:request.query.sku==='FBA-SECOND'?'B000000002':'B000000001'});
    }
    const response=await original(request);
    if(request.path==='/api/sp-api/standalone-audit' && response.body?.value?.kind==='businessPricing') {
      const copy=structuredClone(response);const data=copy.body.value.snapshot;
      const first={...(data.rows.find(row=>row.status==='missing') ?? data.rows[0]),sellerSku:'FBA-MISSING',asin:'B000000001'};
      data.rows=[first,{...first,sellerSku:'FBA-SECOND',asin:'B000000002',title:'Second fixture B2B product'}];
      data.summary={totalFbaSkuCount:2,configured:0,aboveStandard:0,missing:2,unsupported:0,incomplete:0,recommendedPriceMismatch:first.recommendedPriceMismatch?2:0,recommendedQuantityDiscountMismatch:first.recommendedQuantityDiscountMismatch?2:0};
      copy.body.value.progress.completedUnits=2;copy.body.value.progress.totalUnits=2;return copy;
    }
    return response;
  };
})();
