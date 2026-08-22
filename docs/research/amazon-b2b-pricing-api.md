# Amazon Business／B2B 價格的 SP-API 能力研究

日期：2026-08-22
範圍：Amazon Business 單件 Business Price 與 quantity discounts；僅查 Amazon 官方 SP-API 文件、官方 OpenAPI／JSON schema 與官方 changelog。
限制：本研究未使用 Jasper 的實際 Seller ID、未讀取真實商品，也未送出任何 Amazon 寫入。

## 結論

1. **公開 SP-API 已能讀、寫 Amazon Business 價格。** 正式資料模型是 Listings Items 的 `purchasable_offer[]`；一般售價為 `audience: "ALL"`，Business Price 為 `audience: "B2B"`。一筆 offer 由 `audience`、`currency`、`marketplace_id` 三個 selector 唯一識別。Amazon 在 2024-09-11 公告 Listings Items v2021-08-01 與 `JSON_LISTINGS_FEED` 都支援 B2B 價格與 `quantity_discount_plan`。[Amazon B2B pricing changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-and-json_listings_feed-now-support-amazon-business-b2b-pricing)
2. **最適合 AMZ.API 的正式調價路徑是 `patchListingsItem`，不是 Product Pricing、Reports 或舊價格 feed。** Listings Items 可先用 `mode=VALIDATION_PREVIEW` 做零寫入驗證，再送同一份 PATCH；Product Pricing 與 Reports 都只能讀；`JSON_LISTINGS_FEED` 可批次寫，但沒有 Listings Items 同等的同步、逐 SKU、零寫入 Validation Preview。[Validation Preview changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-now-supports-previewing-errors) [official JSON feed schema](https://github.com/amzn/selling-partner-api-models/blob/main/schemas/feeds/listings-feed-schema-v2.json)
3. **判定「沒有 B2B 價格」不能只看一次 API 空值。** 只有在帳號／站點／SKU／ASIN／product type 均精確吻合、seller-specific PTD 明確支援 `B2B`、Listings Items 的 `attributes` 與 `offers` 均完整回應，且沒有相符 B2B offer 時，才可標為 `missing`。權限不足、PTD 不支援、Amazon 回應缺頁／缺欄／重複、FBA 身分衝突或讀取失敗都必須標成 `unsupported` 或 `incomplete`，不可當成沒有設定。
4. **掃描全站 FBA SKU 應先取得完整 FBA 範圍，再逐 SKU 讀 B2B。** 現有 `GET_MERCHANT_LISTINGS_ALL_DATA` 可提供 SKU／ASIN／`fulfillment-channel`／status 的全 listing 基線，但官方欄位表沒有 Business Price；可再用 FBA Inventory 全頁結果交叉核對。其後以 Listings Items 每批最多 20 個精確 SKU 讀 `attributes,offers,productTypes,summaries,fulfillmentAvailability`。Active／Inventory report 的 B2B 欄位只能加速或交叉核對，不能取代 FBA 範圍與逐 SKU 完整性判定。[Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory) [FBA Inventory model](https://github.com/amzn/selling-partner-api-models/blob/main/models/fba-inventory-api-model/fbaInventory.json)

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

Amazon 明確保證：PATCH 只更新 selector 相符的 offer，不影響 `ALL` offer。[Advanced multiple-offer guide](https://developer-docs.amazon.com/sp-api/docs/manage-amazon-haul-advanced-multiple-offer-multiple-fulfillment-use-cases)

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
- [Retrieve a product type definition](https://developer-docs.amazon.com/sp-api/docs/retrieve-a-product-type-definition)
- [Mapping product attributes](https://developer-docs.amazon.com/sp-api/docs/mapping-product-attributes)
- [Inventory report types](https://developer-docs.amazon.com/sp-api/docs/report-type-values-inventory)
- [Validation Preview changelog](https://developer-docs.amazon.com/sp-api/changelog/update-listings-items-api-v2021-08-01-now-supports-previewing-errors)
- [Validation Preview error-code changelog](https://developer-docs.amazon.com/sp-api/changelog/validation-preview-mode-error-code-changes-in-the-listings-items-api)
- [Amazon official SP-API models](https://github.com/amzn/selling-partner-api-models)
