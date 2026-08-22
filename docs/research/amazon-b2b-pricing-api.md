# Amazon Business／B2B 價格的 SP-API 能力研究

日期：2026-08-23
範圍：Amazon Business 單件 Business Price 與 quantity discounts；僅查 Amazon 官方 SP-API 文件、OpenAPI／JSON schema、changelog 與 Amazon 官方 Seller 指南。
限制：本研究未使用 Jasper 的實際 Seller ID、未讀取真實商品，也未送出任何 Amazon 寫入。

## 結論

1. **公開 SP-API 已能讀、寫 Amazon Business 價格。** 正式資料模型是 Listings Items 的 `purchasable_offer[]`；一般售價為 `audience: "ALL"`，Business Price 為 `audience: "B2B"`。一筆 offer 由 `audience`、`currency`、`marketplace_id` 三個 selector 唯一識別。Amazon 在 2024-09-11 公告 Listings Items v2021-08-01 與 `JSON_LISTINGS_FEED` 都支援 B2B 價格與 `quantity_discount_plan`。[Amazon B2B pricing changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-and-json_listings_feed-now-support-amazon-business-b2b-pricing)
2. **最適合 AMZ.API 的正式調價路徑是 `patchListingsItem`，不是 Product Pricing、Reports 或舊價格 feed。** Listings Items 可先用 `mode=VALIDATION_PREVIEW` 做零寫入驗證，再送同一份 PATCH；Product Pricing 與 Reports 都只能讀；`JSON_LISTINGS_FEED` 可批次寫，但沒有 Listings Items 同等的同步、逐 SKU、零寫入 Validation Preview。[Validation Preview changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-now-supports-previewing-errors) [official JSON feed schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/feeds/listings-feed-schema-v2.json)
3. **判定「沒有 B2B 價格」不能只看一次 API 空值。** 只有在帳號／站點／SKU／ASIN／product type 均精確吻合、seller-specific PTD 明確支援 `B2B`、Listings Items 的 `attributes` 與 `offers` 均完整回應，且沒有相符 B2B offer 時，才可標為 `missing`。權限不足、PTD 不支援、Amazon 回應缺頁／缺欄／重複、FBA 身分衝突或讀取失敗都必須標成 `unsupported` 或 `incomplete`，不可當成沒有設定。
4. **掃描全站 FBA SKU 應先取得完整 FBA 範圍，再逐 SKU 讀 B2B。** 現有 `GET_MERCHANT_LISTINGS_ALL_DATA` 可提供 SKU／ASIN／`fulfillment-channel`／status 的全 listing 基線，但官方欄位表沒有 Business Price；可再用 FBA Inventory 全頁結果交叉核對。其後以 Listings Items 每批最多 20 個精確 SKU 讀 `attributes,offers,productTypes,summaries,fulfillmentAvailability`。Active／Inventory report 的 B2B 欄位只能加速或交叉核對，不能取代 FBA 範圍與逐 SKU 完整性判定。[Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory) [FBA Inventory model](https://github.com/amzn/selling-partner-api-models/blob/main/models/fba-inventory-api-model/fbaInventory.json)
5. **「5 件 5%、10 件 10%、15 件 15%、20 件 20%」可以用正式 QDP shape 表示。** 應在 exact `B2B` offer 的單一 `quantity_discount_plan` schedule 內使用 `discount_type: "percent"`，並建立四個 `levels`；`lower_bound` 是開始適用的最低件數，`value` 是百分比數字，所以 5% 應送 `5`，不是 `0.05`，也不是折後單價。Amazon 官方 Seller 指南明確區分 percent 與 fixed，且允許最多五階；最終仍須由當下 seller-specific PTD 與 Validation Preview 接受。[Amazon 官方 B2B pricing 指南](https://sell.amazon.com/blog/amazon-b2b-prices) [Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)
6. **既有「多段」通常是正常 levels，不應誤判成多個價格。** 不同 `audience`／`currency`／`marketplace_id` 的 offer 是正常多 offer；同一個 QDP schedule 內有多個 `levels` 也是正常的 quantity tiers。真正需 fail closed 的是 exact selector 重複、同一欄位出現程式不能證明語義的多個 plan／schedule、selector 缺失，或 seller-specific PTD 不允許該 shape。Amazon PTD 的 `selectors`、`minUniqueItems`／`maxUniqueItems` 才是當下陣列唯一性與數量限制的正式來源，不可把範例的 `[0]` 寫死成全站規則。[Amazon PTD meta-schema](https://developer-docs.amazon.com/sp-api/docs/product-type-definition-meta-schema)
7. **B2B 價格高於標準價應列為健檢問題。** Amazon 官方說明：Business Price 高於 standard price 時，Business 客戶不會看到該 Business Price，而會看到 standard price。對美國站採「標準價減 USD 1.00」可作為 Jasper 的產品預設，但這是內部修正政策，不是 Amazon 強制公式；只能用 `audience=ALL` 的 canonical `our_price` 作基準，且須先確定 USD、結果大於 0、幣別精度正確、沒有自動定價衝突，再走 Preview／確認／單次 PATCH／回查。[Amazon 官方 Business Discount Insights 指南](https://sell.amazon.com/blog/business-discount-insights) [Pricing attribute mapping](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

## API 能力矩陣

| API／資料源 | B2B 單件價 | quantity discounts | 讀 | 寫 | 應在 AMZ.API 扮演的角色 |
| --- | --- | --- | --- | --- | --- |
| Listings Items v2021-08-01 | `attributes.purchasable_offer`；`includedData=offers` 亦可回單件 offer price | `includedData=attributes` 內的 `quantity_discount_plan` | 是 | 是，`patchListingsItem`／`putListingsItem` | **設定真相與正式單 SKU 寫入主路徑** |
| Product Type Definitions v2020-09-01 | 定義 `B2B` 是否可用及價格結構 | 定義當下 seller／站點／product type 的型別、enum 與限制 | 是 | 否 | **寫入能力 gate 與 payload schema** |
| `JSON_LISTINGS_FEED` | 與 Listings Items 相同的 attribute model | 支援 `quantity_discount_plan` | 不是一般查詢 API；processing report 可附 Listings included data | 是，非同步批次 | 大批量後備；不適合互動式安全調價的第一版 |
| Product Pricing v0 `getPricing` | `OfferType=B2B` 可讀賣家 offer 的運作中價格 | `quantityDiscountPrices[]` | 是，每次最多 20 SKU | 否 | 運作中價格／readback 的第二來源，不是設定寫入 API |
| Product Pricing v0／v2022 competitive operations | Business customer／offer type 可讀競爭 offer | 可見的競爭資料依 operation 而定 | 是 | 否 | 競爭情報；不能證明自己的 B2B 設定不存在 |
| Reports API | 部分 listing report 有 `Business Price` | 最多五組 Quantity 欄位，另有 Progressive 欄位 | 是，非同步快照 | 否 | 大批量 audit 加速與交叉核對 |
| Notifications `B2B_ANY_OFFER_CHANGED` | 活躍 B2B offer 變更事件 | 事件涵蓋固定 tier 集合 | 是，事件式 | 否 | 增量監控；不能建立完整基線 |

Product Pricing 的公開模型沒有任何更新價格 operation；Reports 的 `createReport` 是建立讀取工作，不會改 listing；Feeds 的 `createFeed` 則會提交非同步寫入。上述邊界可由 Amazon 官方 model 直接核對：[Product Pricing v0 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricingV0.json) [Reports model](https://github.com/amzn/selling-partner-api-models/blob/main/models/reports-api-model/reports_2021-06-30.json) [Feeds model](https://github.com/amzn/selling-partner-api-models/blob/main/models/feeds-api-model/feeds_2021-06-30.json)

## 精確 attribute 與 selector

Listings Items／JSON feed 的 B2B offer 結構如下；陣列索引不是身分，三個 selector 才是身分：

```json
{
  "purchasable_offer": [
    {
      "audience": "B2B",
      "currency": "USD",
      "marketplace_id": "ATVPDKIKX0DER",
      "our_price": [
        {
          "schedule": [
            { "value_with_tax": 28.0 }
          ]
        }
      ],
      "quantity_discount_plan": [
        {
          "schedule": [
            {
              "discount_type": "fixed",
              "levels": [
                { "lower_bound": 5, "value": 25.0 },
                { "lower_bound": 10, "value": 20.0 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Amazon 的 mapping 明確對應如下：[Mapping product attributes](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

| 意義 | JSON path／條件 |
| --- | --- |
| Business Price | `/attributes/purchasable_offer/*/our_price/0/schedule/0/value_with_tax`，且同一 offer 的 `audience = "B2B"` |
| Quantity Price Type | `/attributes/purchasable_offer/*/quantity_discount_plan/0/schedule/0/discount_type` |
| 第 n 階門檻 | `.../levels[n]/lower_bound` |
| 第 n 階價格／折扣值 | `.../levels[n]/value` |

實作不可固定假設 `purchasable_offer[0]` 是 B2B，也不可只用 audience 找值；必須同時比對 `audience === "B2B"`、預期 `currency` 與 `marketplace_id`。Amazon 官方範例目前使用 `discount_type: "fixed"`；IVP 範例另出現 `percent`。可用型別、階數、上下限與條件必須以**當下 seller-specific PTD** 為準，不能把官方範例或 report 的五階欄位硬編成全站規則。[Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)

### `fixed`／`percent` 與 Business Price 的精確關係

`audience: "B2B"` 的 `our_price[0].schedule[0].value_with_tax` 是單件 Business Price；`quantity_discount_plan` 是掛在**同一個 B2B offer** 下的多件購買規則。Amazon 官方 Seller 指南對兩種 `discount_type` 的定義如下：[Amazon 官方 B2B pricing 指南](https://sell.amazon.com/blog/amazon-b2b-prices) [Amazon 官方 Business Discount Insights 指南](https://sell.amazon.com/blog/business-discount-insights)

| `discount_type` | `levels[].lower_bound` | `levels[].value` | 語義 |
| --- | --- | --- | --- |
| `percent` | 這一階開始適用的最低購買件數 | 相對於單件 Business Price 的折扣百分比；`5` 表示 5%，不是 `0.05` | Amazon 依 Business Price 算該階每件價格 |
| `fixed` | 這一階開始適用的最低購買件數 | 該階的實際每件固定價格 | `value` 是單價，不是減價金額也不是百分比 |

Amazon 的 Seller 指南以 5–9 件、10–24 件等方式說明門檻，因此 `lower_bound` 是含該件數的階段起點，下一個更高門檻開始後改用下一階。每個後續 tier 必須給出更低的每件價格；對 percent 模式即折扣百分比應隨件數上升而增加。Seller Central 可建立最多五階，故四階策略在數量上位於正式 UI 能力範圍內；但實際 API payload 仍必須通過 seller-specific PTD 與 Validation Preview，不能只依部落格範例放行。[Amazon 官方 B2B pricing 指南](https://sell.amazon.com/blog/amazon-b2b-prices) [Retrieve a Product Type Definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition)

Jasper 要的 US 預設可正式表示為：

```json
{
  "currency": "USD",
  "audience": "B2B",
  "marketplace_id": "ATVPDKIKX0DER",
  "our_price": [
    { "schedule": [{ "value_with_tax": "<ALL 單件標準價減 1.00>" }] }
  ],
  "quantity_discount_plan": [
    {
      "schedule": [
        {
          "discount_type": "percent",
          "levels": [
            { "lower_bound": 5, "value": 5 },
            { "lower_bound": 10, "value": 10 },
            { "lower_bound": 15, "value": 15 },
            { "lower_bound": 20, "value": 20 }
          ]
        }
      ]
    }
  ]
}
```

上例的 `our_price` placeholder 只用來表達計算來源；正式 JSON 必須放符合 USD 兩位小數的正數。API 不應把自行算出的各階折後單價寫回 `levels[].value`；percent 模式寫入的是 `5／10／15／20`，實際 tier price 應在 canonical readback 時從 Listings attributes 重新核對，並可用 Product Pricing v0 回傳的 `quantityDiscountPrices[].listingPrice` 作第二讀取證據。Product Pricing 模型將該欄明確定義為「The price at this quantity tier」，但它是讀取面而不是設定 payload。[Product Pricing v0 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricingV0.json)

若 UI 要做到「跟 Seller Central 一樣可填幾件折幾%」，一般 percent editor 可接受 1–5 個動態 tier，並在前台增刪門檻；「套用預設」才產生上述固定四階。使用者本次要求的是 percent，故第一版可只讓 `percent` 可編輯，把既有 `fixed` plan 完整顯示但保持唯讀；若也開放 fixed，欄位必須明確改稱「每件固定價」，不能仍標成「折扣 %」。Amazon 官方 UI 同時提供 `% off` 與 `Fixed Price`，最多五個 thresholds。[Amazon 官方 B2B pricing 指南](https://sell.amazon.com/blog/amazon-b2b-prices)

### 多 offer、多 plan、多 schedule 與多 levels 的判讀

| Amazon 回傳形狀 | 判讀 | 自動處理 |
| --- | --- | --- |
| 多個 `purchasable_offer`，selector tuple 不同 | 正常：可能同時有 `ALL`、`B2B`、IVP 或其他站點／幣別 | 只選 exact `B2B + expected currency + marketplace`；其餘原樣保護 |
| exact B2B offer 的一個 plan／一個 schedule／多個 `levels` | 正常 quantity tiers | 顯示全部 tiers；不得因 `levels.length > 1` 標成歧義 |
| exact selector tuple 出現兩個以上 offer | 重複且無唯一設定真相 | `incomplete/ambiguous`，禁止建議值、Preview 與 PATCH |
| `quantity_discount_plan` 有多個 plan，或單一 plan 有多個 schedule | 不能只靠通用文件判斷哪筆是目前／未來有效；實際合法性與限制來自 seller-specific PTD | 保留 raw hash 並標 `ambiguous`；除非程式完整實作 PTD 對應的 schedule 語義，否則禁止一鍵覆寫 |
| `our_price` 有多個 price block／schedule，或帶程式未理解的時間欄位 | 不是 quantity tiers；可能代表額外價格 schedule | 不取 `[0]` 猜目前價；標 `ambiguous` 並停用修正 |
| fixed plan 要改成 percent default | 是 discount type 與所有 tiers 的實質變更 | 只能在畫面展示 old fixed → new percent 完整 diff 後明確送 Preview；不得暗中換算 |

Amazon 明定 `purchasable_offer` 由 `audience`、`currency`、`marketplace_id` 唯一識別；offers view 只回每個 audience 的單件價，QDP 細節必須用 `includedData=attributes` 讀取。PTD meta-schema 的 `selectors` 定義陣列物件唯一性，`minUniqueItems`／`maxUniqueItems` 定義可接受的 unique item 數量；因此程式可把多個 levels 視為正常，但不能自行發明多 plan／schedule 的優先順序。[Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases) [Amazon PTD meta-schema](https://developer-docs.amazon.com/sp-api/docs/product-type-definition-meta-schema)

### Listings Items 的兩種讀法

- `includedData=offers`：回傳每個 marketplace 的 `offerType`（`B2C`／`B2B`）、`price` 與 `audience`。適合顯示單件可購價格。
- `includedData=attributes`：回傳完整結構化 attributes；要取得 quantity discount plan 必須讀這裡。Amazon 官方明說 offers view 只回單件折扣價，QDP 詳情要用 attributes。
- `includedData=productTypes`：提供後續 seller-specific PTD 查詢所需 product type。
- `searchListingsItems` 可用 `identifiersType=SKU` 與最多 20 個 `identifiers`；回應 `pageSize` 最大 20 並可能有 `pageToken`。單 SKU write 前仍應用 `getListingsItem` 做新鮮、精確 read-before-write。[Listings Items official model](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)

### Product Pricing v0 的讀取形狀

`GET /products/pricing/v0/price` 可用：

```text
MarketplaceId=ATVPDKIKX0DER
ItemType=Sku
Skus=<最多 20 個 seller SKU>
OfferType=B2B
```

模型的 `Product.Offers[]` 可包含 `offerType: "B2B"`、`BuyingPrice.ListingPrice`、`RegularPrice`、選用的 `businessPrice`，以及：

```json
{
  "quantityDiscountPrices": [
    {
      "quantityTier": 2,
      "quantityDiscountType": "QUANTITY_DISCOUNT",
      "listingPrice": { "CurrencyCode": "USD", "Amount": 8.0 }
    }
  ]
}
```

這是「目前運作中的賣家 offer 價格」的讀取面，不是 `purchasable_offer` 的原始設定形狀，也不是寫入 API。空 `Offers`、單列錯誤或節流都只能標為 `incomplete`；不能單獨據此斷言沒有 B2B。[getPricing model](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-pricing-api-model/productPricingV0.json)

### Reports 的精確欄位與限制

官方 Inventory Reports 文件列出：

- `GET_FLAT_FILE_OPEN_LISTINGS_DATA`：`sku`、`asin`、`price`、`quantity`、`Business Price`、`Quantity Price Type`、`Quantity Lower Bound 1..5`、`Quantity Price 1..5`、Progressive 欄位。
- `GET_MERCHANT_LISTINGS_DATA`（Active Listings）：同樣包含 `Business Price`、五組 Quantity 欄位、Progressive 欄位，且有 `fulfillment-channel`。
- `GET_MERCHANT_LISTINGS_DATA_LITE`：只涵蓋 quantity 大於零的 item，但也列出 B2B／Quantity／Progressive 欄位。
- `GET_MERCHANT_LISTINGS_ALL_DATA`：有 `seller-sku`、ASIN、price、quantity、`fulfillment-channel`、status 等，但**官方欄位表沒有 Business Price／Quantity Price**。

因此不能拿 AMZ.API 現有 All Listings report 的空欄位直接判成「未設定 B2B」。Active／Inventory report 可當大量 audit 快照，但仍須：限制單一 marketplace、處理 UTF-8 BOM、要求每個 SKU 唯一、與 FBA seed 取交集、對缺列／缺欄標 `incomplete`，並在寫入前重讀 Listings Items。[Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory)

## PTD、角色與權限

### Seller-specific PTD 是必要的 capability gate

對每個 `productType + marketplaceId` 呼叫：

```text
GET /definitions/2020-09-01/productTypes/{productType}
  ?sellerId=<current seller>
  &marketplaceIds=<one marketplace>
  &requirements=LISTING_OFFER_ONLY
  &requirementsEnforced=NOT_ENFORCED
  &productTypeVersion=LATEST
```

`sellerId` 不可省略。Amazon 官方說明：只有 seller 已加入 Amazon Business 時，seller-specific schema 才會回 B2B attributes；不帶 sellerId 得到的是 generic schema，不能用來證明該帳號可寫 B2B。回應 `schema.checksum` 是 Base64 MD5，可用來做快取 key、顯示 capability 版本，並綁定 preview ticket；若 checksum 或 schema 內容改變，舊 preview 必須失效。[Retrieve a product type definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition) [PTD official model](https://github.com/amzn/selling-partner-api-models/blob/main/models/product-type-definitions-api-model/definitionsProductTypes_2020-09-01.json)

PTD 應驗證：

1. `purchasable_offer` 存在；
2. seller-specific `audience` enum／條件允許 `B2B`；
3. `our_price` 與需要時的 `quantity_discount_plan` 在該站點／product type／audience 可用；
4. currency、數字範圍、階數、`discount_type` 及條件符合下載的 schema；
5. schema download 與 checksum 一致。任何一步不明都不可開放編輯。

### 需要的角色

- Listings Items、PTD 與 listing attribute write：**Product Listing** role；seller 必須授權應用，並已加入 Amazon Business 才會取得 B2B seller-specific schema。
- Product Pricing：**Pricing** role。
- 上述 Inventory／Active listing reports：官方允許 Inventory and Order Tracking、Pricing、Product Listing 等角色；AMZ.API 只應申請實際使用的最小集合。
- 這些價格資料不含買家 PII，不需要 Restricted Data Token；不可因此擴張到 restricted roles。

官方角色定義與每份 report 的角色清單：[Roles in SP-API](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api) [Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory)

## 安全掃描所有目前 FBA SKU

建議採兩層基線、逐列 fail closed：

1. 鎖定已解鎖 Notebook Key 的 `account mode + seller + marketplace`；只允許一個站點，不接受前端傳入 Seller ID。
2. 以完整 `GET_MERCHANT_LISTINGS_ALL_DATA` 取得 seller SKU、ASIN、status 與 fulfillment channel，保留官方 FBA channel（例如美國 `AMAZON_NA`），排除 parent／無 ASIN／FBM。不能用 report 空值判 B2B。
3. 同步取得 FBA Inventory `getInventorySummaries` 全頁；初始全量掃描須省略 `startDateTime` 與 SKU filter，並在 30 秒有效期內連續消耗 `nextToken`。它是 FBA inventory 的第二份證據，但零庫存 listing 可能仍須由 All Listings 補齊。
4. 對兩份 seed 做 SKU／ASIN／marketplace 去重與衝突檢查；衝突列標 `incomplete`，不默默選一份。
5. 以每批最多 20 個精確 SKU 呼叫 `searchListingsItems`，請求 `attributes,offers,productTypes,summaries,fulfillmentAvailability`；處理所有 pageToken，逐一核對回傳 SKU／ASIN／marketplace。缺列、額外列、重複列一律 `incomplete`。
6. 依 `productType + marketplaceId` 取得並 checksum 驗證 seller-specific PTD；快取只能綁 seller／站點／schema checksum。
7. 解析三 selector 完全相符的 B2B `purchasable_offer` 與 offers view。必要時再分批呼叫 Product Pricing v0 `getPricing(OfferType=B2B)` 作運作中價格交叉核對；受 0.5 req/s 預設 rate limit 約束。
8. 報表中的 Business Price／Quantity 欄位可作大量預填與差異檢查，但任何報表與 Listings／Product Pricing 不一致都標 `incomplete`，不可自動覆蓋。
9. 快照保留 `fetchedAt`、來源完整度、request ID（可安全保存，不含 token）、schema checksum 與每列 reason；使用者看到的總數必須分 `configured`／`missing`／`unsupported`／`incomplete`。

### 狀態判定

| 狀態 | 必要條件 | 可否調價 |
| --- | --- | --- |
| `configured` | exact SKU 身分完整；PTD 支援 B2B；相符 B2B offer 有可解析 `our_price` | 是，但仍須 fresh read、preview、native approval |
| `missing` | exact SKU 身分完整；PTD 支援 B2B；Listings `attributes`／`offers` 都完整，且沒有相符 B2B offer | 可建立 B2B offer，但 UI 必須明示舊值為「未設定」而不是 0 |
| `unsupported` | seller-specific PTD 沒有 B2B，或 seller／站點／product type 明確不具資格 | 否 |
| `incomplete` | 權限、節流、缺頁、缺欄、重複、身分衝突、schema download／checksum 失敗，或來源互相矛盾 | 否；不得假設 missing |

### 「B2B 高於一般售價」的新增健檢判定

一般售價應從 exact `audience=ALL + currency + marketplace_id` 的 canonical `our_price` 讀取；Business Price 應從 exact `audience=B2B + 同幣別 + 同站點` 的 canonical `our_price` 讀取。不能拿 `offers.price`、Product Pricing effective／sale price、`discounted_price`、Buy Box 或報表快照代替這兩個 base price。Amazon 的 attribute mapping 將 `ALL.our_price` 定義為 standard price、`B2B.our_price` 定義為 Business Price，而 `discounted_price` 是另一個有起訖日期的暫時 sale price。[Pricing attribute mapping](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

建議額外狀態／原因：

| 狀態 | 條件 | US 預設建議 |
| --- | --- | --- |
| `configured_ok` | B2B base price 可解析且 `B2B <= ALL` | 不自動改 |
| `business_price_above_standard` | 兩邊皆為 exact canonical USD，且 `B2B > ALL` | `ALL - 1.00`，但只作 proposed value |
| `missing` | 已滿足前述完整性條件且沒有 B2B offer | `ALL - 1.00`，但只作 proposed value |
| `ambiguous/incomplete` | 任一 selector、price schedule、PTD、identity 或來源不唯一 | 不產生預設、不開放修正 |

Amazon 官方說明，Business Price 高於 standard price 時不會向 Business 客戶顯示，客戶會看到 standard price；因此 `business_price_above_standard` 是有實際營運影響的問題，不只是美觀提示。[Amazon 官方 Business Discount Insights 指南](https://sell.amazon.com/blog/business-discount-insights)

`ALL - 1.00` 的自動建議只能在 US／USD 執行，並至少滿足：

1. standard price 為 exact、單一、正值且符合 USD 兩位小數；
2. standard price 大於 USD 1.00，使結果仍為正；
3. 結果通過 seller-specific PTD 的最小／最大與條件式限制；
4. 沒有 `automated_pricing_merchandising_rule_plan` 或其他已知自動定價管理衝突；Amazon 官方說明 Automate Pricing 可管理 Business Price 與 quantity discounts，直接提交 static value 可能之後再被規則改寫；[Amazon 官方 B2B pricing 指南](https://sell.amazon.com/blog/amazon-b2b-prices)
5. fresh read 時 `ALL`、`B2B`、QDP 與受保護 offer hash 均未漂移。

對非 USD 站點不可把「1 美元」誤翻成減當地貨幣 1 單位；應停用這個預設或另由使用者定義站點政策。`B2B === ALL` 並不符合本次「高於」的條件，若未來想把「沒有任何 Business 優惠」另列提醒，應建立不同 reason，不能偷偷擴大本次規則。

## 可直接實作的 DTO 與 guards

下列 DTO 刻意把「Amazon 原始 shape」、「已證明 canonical 的顯示值」與「待寫入 proposal」分開，避免 renderer 以畫面計算值重建 Amazon payload：

```ts
type BusinessOfferSelector = Readonly<{
  audience: "B2B";
  currency: string;
  marketplaceId: string;
}>;

type QuantityDiscountLevel = Readonly<{
  lowerBound: number; // positive integer
  value: number;      // percent number or fixed per-unit price
}>;

type QuantityDiscountPlan = Readonly<{
  discountType: "percent" | "fixed";
  levels: readonly QuantityDiscountLevel[];
  rawHash: string;
}>;

type BusinessPricingCanonicalSnapshot = Readonly<{
  selector: BusinessOfferSelector;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: Money;
  businessPrice: Money | null;
  businessOfferPresence: "absent" | "present";
  quantityPlan: QuantityDiscountPlan | null;
  quantityPlanPresence: "absent" | "canonical";
  protectedOffersHash: string;
  ptdSchemaChecksum: string;
  fetchedAt: string;
}>;

type BusinessPricingProposal = Readonly<{
  expectedStandardPrice: Money;
  expectedBusinessPrice: Money | null;
  requestedBusinessPrice: Money;
  expectedQuantityPlanHash: string | null;
  requestedQuantityPlan: QuantityDiscountPlan | null;
  protectedOffersHash: string;
  ptdSchemaChecksum: string;
}>;
```

如果任何 shape 不能 canonicalize，不要以 `null` 冒充「沒有」，而應回另一個 fail-closed union，例如 `BusinessPricingUnresolvedSnapshot { state: "ambiguous" | "incomplete"; reasonCode }`。這可避免多 schedule 被錯當成 missing。

實作 guards：

1. **Exact identity**：Seller SKU、ASIN、marketplace、product type 與三 selector 全部唯一且精確；相同 selector tuple 重複即停止。
2. **Canonical base price**：`ALL.our_price` 與 `B2B.our_price` 都只在程式完整理解其 price block／schedule 時轉成 `Money`；額外 schedule 或時間欄位不取第一筆猜值。
3. **PTD validation**：取得帶 current sellerId、單一 marketplace、`LISTING_OFFER_ONLY` 的 schema，核對 MD5 checksum，並用完整 JSON Schema＋Amazon vocabulary 驗證 proposed offer；`editable: true` 只是一個必要 gate，不取代 schema validation。[Retrieve a Product Type Definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition) [Amazon PTD meta-schema](https://developer-docs.amazon.com/sp-api/docs/product-type-definition-meta-schema)
4. **Percent tier policy**：一般自訂 editor 接受 1–5 階；每個 `lower_bound` 必須是正整數、唯一且遞增，每個 percent `value` 必須大於 0 且小於 100、隨門檻遞增。「套用預設」另要求門檻恰為 `5,10,15,20`、value 恰為 `5,10,15,20`。以 Business Price 及幣別精度模擬後，每一階 per-unit price 必須嚴格下降；模擬只作本機 guard，不取代 Amazon Preview。
5. **Fixed plan 不暗轉**：目前為 `fixed` 時，若使用者要套新 percent defaults，confirmation 必須明示 type 與每一階完整差異；price-only 更新則完全省略 `quantity_discount_plan`，原 plan hash 必須在 commit 前相同。
6. **Automation conflict**：exact B2B offer 含 automated pricing plan 或讀到其他官方自動定價證據時，不做 silent static overwrite；改列 `managed_by_automation` 或要求先在 Seller Central 處理規則。
7. **完整 patch hash**：ticket 綁 selector、old ALL/B2B、old/new QDP、PTD checksum、protected offers hash 與 canonical patch hash。即使只改 Business Price，QDP 漂移也必須使 preview 失效。
8. **Preview strictness**：同一 body 使用 `mode=VALIDATION_PREVIEW&includedData=identifiers,issues`；只接受 exact SKU、exact marketplace identifier、非空 `submissionId`、`status === "VALID"` 且無 `ERROR`。`INVALID` 是明確未接受；缺 status、未知 status、缺 identifier 或壞 issue shape 都是 unknown/fail closed。官方 OpenAPI 定義 Preview 不持久化，且 `VALID` 只會在 Preview 回傳。[Listings Items official model](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)
9. **Native confirmation**：顯示 `ALL` 標準價、舊／新 B2B base price、舊／新 discount type 與四個 tiers；不得只顯示「更新價格」。
10. **Commit/readback**：native confirmation 後再 fresh read＋PTD＋Preview；單次 PATCH 回 `ACCEPTED` 只代表 Amazon 已接受處理，不能當成功。bounded readback 必須核對 exact B2B base、四個 percent levels、`ALL` 與其他 audiences 未變；`offers` view 只能佐證單件價，QDP 必須以 `attributes` 回讀。timeout、429、5xx、缺 status 或 readback mismatch 均標 unknown，不 blind retry。[Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases) [Listings Items official model](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)

## 正式寫入協定

### Payload

只 merge 精確的 B2B offer instance，不帶 `ALL`，也不重送無關 attributes：

```json
{
  "productType": "PRODUCT",
  "patches": [
    {
      "op": "merge",
      "path": "/attributes/purchasable_offer",
      "value": [
        {
          "currency": "USD",
          "audience": "B2B",
          "marketplace_id": "ATVPDKIKX0DER",
          "our_price": [
            { "schedule": [{ "value_with_tax": 28.0 }] }
          ]
        }
      ]
    }
  ]
}
```

程式碼區塊中的 `productType: "PRODUCT"` 是 Amazon 官方 offer 範例使用的通用值，不是 AMZ.API 可硬編的常數；AMZ.API 應沿用 fresh Listings identity 的 exact product type，並用同一 product type 取得 seller-specific PTD、做 Preview 與 commit。若 fresh identity 的 product type 漂移，舊 proposal 失效。

Amazon 明確保證：PATCH 只更新 selector 相符的 offer，不影響 `ALL` offer。[Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)

若該次操作同時明確套用 Jasper 的四階 percent 預設，則同一個 exact B2B selector 的 `merge` value 可同時帶 `our_price` 與 `quantity_discount_plan`：

```json
{
  "productType": "PRODUCT",
  "patches": [
    {
      "op": "merge",
      "path": "/attributes/purchasable_offer",
      "value": [
        {
          "currency": "USD",
          "audience": "B2B",
          "marketplace_id": "ATVPDKIKX0DER",
          "our_price": [
            { "schedule": [{ "value_with_tax": 19.0 }] }
          ],
          "quantity_discount_plan": [
            {
              "schedule": [
                {
                  "discount_type": "percent",
                  "levels": [
                    { "lower_bound": 5, "value": 5 },
                    { "lower_bound": 10, "value": 10 },
                    { "lower_bound": 15, "value": 15 },
                    { "lower_bound": 20, "value": 20 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

上例的 `19.0` 只是非真實商品的示意值。程式必須從 fresh canonical `ALL` price 計算實際 US proposal，並讓 seller-specific PTD 與 Validation Preview 驗證整個 object。只調 base Business Price 時應省略 `quantity_discount_plan`，讓既有 plan 原樣保留；只有「套用四階預設」這個明確操作才帶新 plan，且 old→new tiers 必須出現在 confirmation 中。[Manage purchasable offer](https://developer-docs.amazon.com/sp-api/docs/manage-purchasable-offer) [Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)

若要刪 quantity discounts，可在相同 B2B selector 上 `merge` 並令 `quantity_discount_plan: null`；`our_price` 不能設為 `null`。刪掉整個 B2B offer 需使用 `delete`，但第一版應先停用，直到 seller-specific PTD、Validation Preview 與真實 canary 證明 exact selector delete payload，避免誤刪其他 audience。[Manage purchasable offer](https://developer-docs.amazon.com/sp-api/docs/manage-purchasable-offer)

### Preview → commit → readback

每次調價都應依序執行：

1. **Fresh old-value read**：main process 重新 `getListingsItem`，核對 SKU／ASIN／product type／FBA／marketplace；保存 canonical `ALL` 與 `B2B` old value 及 hash。前端傳的舊值只能當期望值，不能當真相。
2. **Fresh PTD**：取得 seller-specific offer-only schema，驗證 checksum 與相同 payload；PTD 不支援即停止。
3. **零寫入 Validation Preview**：對同一 seller、SKU、marketplace、productType、patch body 呼叫 `patchListingsItem?mode=VALIDATION_PREVIEW&includedData=identifiers,issues`。只有 status `VALID`、無 ERROR、identifier exact match 才可產生 preview ticket；warning 必須完整顯示。Preview 預設只有 1 req/s。[Listings Items model](https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json)
4. **綁定 ticket**：短效、一次性、main-owned ticket 綁定 account mode、marketplace、SKU、ASIN、productType、FBA 證據、old-value hash、new value、PTD checksum、canonical patch hash 與 idempotency key。
5. **原生確認**：Touch ID／Windows Hello 只批准 ticket 中的精確差異；確認 UI 顯示標準價、舊 Business Price、新 Business Price、quantity discounts 是否保持不變。
6. **Commit 前再讀一次**：若舊值、ASIN、FBA、productType、PTD checksum 或任何 selector 已漂移，整筆失效並要求重新 preview。
7. **持久 idempotency ledger**：同一 idempotency key＋payload hash 只容許一個終局；相同 key 不同 payload 拒絕；pending／unknown 不可自動重送。
8. **只送一次 PATCH**：401、403、429、5xx、timeout、連線中斷或結果不明時都停止；記錄安全 request ID 與 unknown 狀態，絕不 blind retry。
9. **Canonical readback**：Amazon 回 `ACCEPTED` 只代表已理解提交，不是最終成功。以 bounded polling 重新讀 Listings attributes／offers，驗證 exact B2B selector 的新值、`ALL` 未變、quantity plan 未被改；可再用 Product Pricing B2B 交叉核對。若逾時或互相矛盾，標 unknown 並停止後續批次。

Validation Preview 的 error code 在 2025 年底曾更新；實作必須泛化處理 `status`、所有 `issues[]`、`severity`、`message` 與 attribute names，不可只 whitelist 舊 code。[Validation Preview error-code changelog](https://developer-docs.amazon.com/sp-api/changelog/validation-preview-mode-error-code-changes-in-the-listings-items-api)

### 批次寫入

安全批次不是 Amazon 原子交易：

- 先對所有列完成 fresh read、PTD 與 **零寫入** preview；任何列 incomplete 不得混入。
- 使用者一次原生確認的是固定清單與固定 hash，不是可變查詢。
- 每列仍各自有 ledger、單次 PATCH 與 canonical readback。
- 任一列 rejected／unknown／readback mismatch 即停止尚未送出的後續列；已成功列不得盲目回滾或重送。
- 只有在大量、離線、可接受非同步逐訊息結果時才考慮 `JSON_LISTINGS_FEED`。其 schema 支援 `PATCH` 的 `add`／`replace`／`merge`／`delete` 與最多 25,000 messages，但 createFeed 沒有 Listings Items 的 `mode=VALIDATION_PREVIEW`；processing report 不是零寫入 preview。第一版互動式調價不應用 feed。[JSON listings feed schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/feeds/listings-feed-schema-v2.json) [Feeds model](https://github.com/amzn/selling-partner-api-models/blob/main/models/feeds-api-model/feeds_2021-06-30.json)

## 不應使用的舊路徑

自 2025-07-31 起，Feeds API 已不再支援 legacy XML／flat-file listing feeds，包含 pricing feed；提交會得到 fatal processing status。B2B 新功能應只走 Listings Items 或 `JSON_LISTINGS_FEED` 的 JSON attribute model。[Amazon mapping and deprecation notice](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)

## AMZ.API 實作基線與仍需實機驗證

第一版可高信心實作：

- FBA-only audit seed、Listings attributes／offers 解析、四態分類；
- seller-specific PTD capability 與 checksum；
- 單 SKU `merge` B2B `our_price`；
- Validation Preview、old-value optimistic concurrency、native approval、idempotency、single PATCH、canonical readback；
- 保持既有 `ALL`、Sale Price 與 quantity plan 完全不動。

正式上線前仍必須用 Jasper 的 Notebook Key 與一個已知、可回復的美國 FBA canary 驗證：實際 PTD 是否回 `B2B`、Listings GET 是否同時回 attributes／offers、建立或更新 B2B price 的 Validation Preview、PATCH 接受後的收斂時間、Product Pricing／report 的 readback 一致性，以及 Amazon Business Seller Central 顯示。CI、官方 sandbox 與 Orders-only 權限都不能證明這些 live 行為。

## 官方來源索引

- [Amazon B2B pricing changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-and-json_listings_feed-now-support-amazon-business-b2b-pricing)
- [Manage purchasable offer](https://developer-docs.amazon.com/sp-api/docs/manage-purchasable-offer)
- [Advanced multiple-offer／B2B guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)
- [Amazon 官方 B2B prices／quantity discounts 指南](https://sell.amazon.com/blog/amazon-b2b-prices)
- [Amazon 官方 Business Discount Insights 指南](https://sell.amazon.com/blog/business-discount-insights)
- [Retrieve a product type definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition)
- [Amazon Product Type Definitions meta-schema](https://developer-docs.amazon.com/sp-api/docs/product-type-definition-meta-schema)
- [Mapping product attributes](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)
- [Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory)
- [Validation Preview changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-now-supports-previewing-errors)
- [Validation Preview error-code changelog](https://developer-docs.amazon.com/sp-api/changelog/validation-preview-mode-error-code-changes-in-the-listings-items-api)
- [Amazon official SP-API models](https://github.com/amzn/selling-partner-api-models)
