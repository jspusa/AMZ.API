/* Synthetic test-only snapshots from the existing public renderer tests. */
(() => {
 const snapshots={
  "aplus": {
    "mode": "live",
    "marketplaceId": "ATVPDKIKX0DER",
    "fetchedAt": "2026-08-23T08:00:00.000Z",
    "rows": [
      {
        "sellerSku": "PUBLISHED",
        "asin": "B000000001",
        "title": "Published A plus",
        "marketplaceId": "ATVPDKIKX0DER",
        "status": "published",
        "sourceCompleteness": "complete",
        "publishedRecordCount": 1,
        "contentTypes": [
          "EBC"
        ],
        "locales": [
          "en-US"
        ],
        "documents": [],
        "documentEvidenceCompleteness": "unavailable",
        "reasonCode": "PUBLISHED_RECORD_FOUND",
        "reason": "Amazon publish record 已證明目前 ASIN 有已發布 A+。"
      },
      {
        "sellerSku": "MISSING",
        "asin": "B000000002",
        "title": "Missing A plus",
        "marketplaceId": "ATVPDKIKX0DER",
        "status": "missing",
        "sourceCompleteness": "complete",
        "publishedRecordCount": 0,
        "contentTypes": [],
        "locales": [],
        "documents": [],
        "documentEvidenceCompleteness": "unavailable",
        "reasonCode": "NO_PUBLISHED_RECORD",
        "reason": "Amazon 完整查詢沒有找到目前 ASIN 的已發布 A+。"
      },
      {
        "sellerSku": "INCOMPLETE",
        "asin": null,
        "title": "Incomplete identity",
        "marketplaceId": "ATVPDKIKX0DER",
        "status": "incomplete",
        "sourceCompleteness": "partial",
        "publishedRecordCount": null,
        "contentTypes": [],
        "locales": [],
        "documents": [],
        "documentEvidenceCompleteness": "unavailable",
        "reasonCode": "FBA_IDENTITY_INCOMPLETE",
        "reason": "FBA 商品缺少可安全核對的 ASIN，未發出 A+ request。"
      }
    ],
    "totals": {
      "eligibleFbaSkus": 3,
      "uniqueAsins": 2,
      "published": 1,
      "missing": 1,
      "incomplete": 1,
      "unavailable": 0
    },
    "summary": {
      "eligibleFbaSkus": 3,
      "uniqueAsins": 2,
      "published": 1,
      "missing": 1,
      "incomplete": 1,
      "unavailable": 0
    },
    "notice": "只讀取目前 FBA 商品的官方 A+ publish records；不會修改 Amazon 商品頁。"
  },
  "subscription": {
    "mode": "live",
    "marketplaceId": "ATVPDKIKX0DER",
    "fetchedAt": "2026-08-08T08:00:00.000Z",
    "requestedMonths": 6,
    "exportId": "audit-12345678",
    "intervals": [
      {
        "month": "2026-02",
        "startDate": "2026-02-01T00:00:00Z",
        "endDate": "2026-02-28T00:00:00Z"
      },
      {
        "month": "2026-03",
        "startDate": "2026-03-01T00:00:00Z",
        "endDate": "2026-03-31T00:00:00Z"
      },
      {
        "month": "2026-04",
        "startDate": "2026-04-01T00:00:00Z",
        "endDate": "2026-04-30T00:00:00Z"
      },
      {
        "month": "2026-05",
        "startDate": "2026-05-01T00:00:00Z",
        "endDate": "2026-05-31T00:00:00Z"
      },
      {
        "month": "2026-06",
        "startDate": "2026-06-01T00:00:00Z",
        "endDate": "2026-06-30T00:00:00Z"
      },
      {
        "month": "2026-07",
        "startDate": "2026-07-01T00:00:00Z",
        "endDate": "2026-07-31T00:00:00Z"
      }
    ],
    "inventoryEvidence": {
      "source": "FBA_INVENTORY_API_COMPLETE_PAGINATION",
      "coverage": "complete",
      "returnedInventoryRows": 1,
      "provenSkuCount": 1,
      "unrecognizedSellerSkuRows": 0,
      "verifiableReplenishmentOfferCount": 1,
      "unverifiedFbaSkuCount": 0
    },
    "upstreamCoverage": {
      "status": "complete",
      "returnedOfferRows": 1,
      "acceptedOfferRows": 1,
      "returnedMetricRows": 3,
      "acceptedMetricRows": 3,
      "invalidOfferRows": [],
      "problemSkuRows": [],
      "unprovenExactSkuProblems": {
        "exactSkuCount": 0,
        "affectedOfferRows": 0,
        "affectedMetricRows": 0,
        "minimumUnresolvedOfferMonths": 0
      },
      "rejectedSellerSkuRows": 0,
      "minimumUnresolvedOfferMonths": 0,
      "notice": "Amazon Replenishment 回應中的 Seller SKU 均可原樣核對。"
    },
    "offers": [
      {
        "sellerSku": "AFA12AM",
        "asin": "B000000001",
        "eligibility": "ELIGIBLE",
        "price": {
          "amount": 17.99,
          "currencyCode": "USD"
        },
        "sellerFundedBaseDiscount": 5,
        "sellerFundedTieredDiscount": 10,
        "currentActiveSubscriptions": 42,
        "fbaEvidence": "CURRENT_FBA_SKU_SET",
        "monthlySeries": [
          {
            "month": "2026-02",
            "subscriptionRevenue": 120,
            "shippedSubscriptionUnits": 9,
            "activeSubscriptionsAtPeriodEnd": 35,
            "currencyCode": "USD"
          },
          {
            "month": "2026-04",
            "subscriptionRevenue": 150,
            "shippedSubscriptionUnits": 11,
            "activeSubscriptionsAtPeriodEnd": 38,
            "currencyCode": "USD"
          },
          {
            "month": "2026-05",
            "subscriptionRevenue": null,
            "shippedSubscriptionUnits": null,
            "activeSubscriptionsAtPeriodEnd": 40,
            "currencyCode": null
          }
        ]
      }
    ],
    "excluded": [],
    "summary": {
      "currentActiveSubscriptions": 42,
      "provenSubscriptionRevenue": null,
      "revenueCurrencyCode": null,
      "revenueCoverage": {
        "status": "partial",
        "expectedOfferMonths": 6,
        "reportedOfferMonths": 2
      }
    },
    "historyCapability": {
      "supportsSinceEnrollmentMonthlySeries": false,
      "maximumOfficialLookbackMonths": 23,
      "notice": "Amazon 公開 API 只支援最近 23 個完整月；缺月不得補值。"
    }
  },
  "variation": {
    "mode": "live",
    "marketplaceId": "ATVPDKIKX0DER",
    "fetchedAt": "2026-08-09T02:00:00.000Z",
    "exportId": "audit-export-0001",
    "rows": [
      {
        "sellerSku": "UNBOUND-01",
        "asin": "B000000001",
        "title": "Unbound FBA product",
        "productType": "PET_FOOD",
        "relationshipEvidence": "relationships",
        "notice": "Amazon relationships 已完整回傳，且沒有 parent 關係。"
      }
    ],
    "incompleteRows": [
      {
        "sellerSku": "UNKNOWN-02",
        "asin": "B000000002",
        "title": "Unknown relationship product",
        "code": "RELATIONSHIPS_NOT_RETURNED",
        "message": "Amazon 沒有回傳 relationships 資料集。",
        "requestId": null
      }
    ],
    "allVariationRows": [
      {
        "familySku": "PARENT-01",
        "role": "parent",
        "sellerSku": "PARENT-01",
        "title": "",
        "productType": "",
        "variationTheme": "SIZE_NAME",
        "evidence": "parent-sku-from-verified-child"
      },
      {
        "familySku": "PARENT-01",
        "role": "child",
        "sellerSku": "CHILD-01",
        "title": "Child one",
        "productType": "PET_FOOD",
        "variationTheme": "SIZE_NAME",
        "evidence": "verified-child"
      },
      {
        "familySku": "PARENT-01",
        "role": "child",
        "sellerSku": "CHILD-02",
        "title": "Child two",
        "productType": "PET_FOOD",
        "variationTheme": "SIZE_NAME",
        "evidence": "verified-child"
      }
    ],
    "summary": {
      "totalFbaListings": 4,
      "completed": 3,
      "unbound": 1,
      "boundChildren": 2,
      "parentContainers": 0,
      "incomplete": 1
    },
    "notice": "只有完整證據才列入。"
  }
};

 const original=window.fbaOS.api.request;
 const ids={aplus:'30303030-3030-4030-8030-303030303030',subscription:'40404040-4040-4040-8040-404040404040',variation:'50505050-5050-4050-8050-505050505050'};
 let aplusMode='demo';
 const reply=(value,status=200)=>({status,headers:{'content-type':'application/json'},body:{kind:'json',value}});
 window.fbaOS.api.request=async (request)=>{
  const body=request.body?.kind==='json'?request.body.value:{};
  if(request.path==='/api/sp-api/a-plus-audit'){
   if(request.method==='POST')aplusMode=body.mode;
   const snapshot={...snapshots.aplus,mode:aplusMode};
   const job={jobId:ids.aplus,contextId:'60606060-6060-4060-8060-606060606060',marketplaceId:snapshot.marketplaceId,mode:aplusMode,ready:request.method==='GET',status:request.method==='GET'?'completed':'running',progress:{completedAsins:2,totalAsins:2},...(request.method==='GET'?{snapshot}:{})};
   return reply(job,request.method==='POST'?202:200);
  }
  if(request.path==='/api/sp-api/standalone-audit'&&request.method==='POST'&&['subscription','variation'].includes(body.kind)){
   const snapshot={...snapshots[body.kind],mode:body.mode};
   return reply({jobId:ids[body.kind],contextId:'70707070-7070-4070-8070-707070707070',kind:body.kind,mode:body.mode,marketplaceId:snapshot.marketplaceId,options:body.options||{},ready:true,status:'completed',progress:{stage:'complete',message:'Synthetic audit completed',completedUnits:1,totalUnits:1},snapshot});
  }
  return original(request);
 };
})();
