# Amazon 營運擴充：來源與實作邊界查核

日期：2026-09-08。範圍：Promotions、AWD、價格健康、事件通知的公開規格與程式參考。AMZ.API 檢查起點為 `69a395096b1fdbf23be94c804a0aea1a4d523a24`。這份筆記只記錄來源調查；沒有改功能程式、安裝 SDK、呼叫真實 Amazon 帳號、建立訂閱或部署雲端服務，也不代表 live 驗收通過。廣告成效實作另由既有 Advertising／Report Broker owner 工作流核對。

## 可重現來源與授權

以下都是本次實際讀取的第一方原始碼／模型；以 exact commit 固定，不能以日後 default branch 內容代替本次證據。星等為本輪採用適合度，不是 GitHub stars。

| 來源與 pin | 核實授權 | 本輪用途 | 適合度 |
|---|---|---|---|
| [Amazon Models — 3659f96867bfc669aca7a524c2f95744ff0e4478](https://github.com/amzn/selling-partner-api-models/tree/3659f96867bfc669aca7a524c2f95744ff0e4478) | [Apache-2.0](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/LICENSE) | 固定 endpoint、資料模型與語義來源 | ★★★★★ |
| [Bizon SDK — 1a340fd1b118a04b7fa553f77084023ce1fcbbda](https://github.com/bizon/selling-partner-api-sdk/tree/1a340fd1b118a04b7fa553f77084023ce1fcbbda) | [MIT](https://github.com/bizon/selling-partner-api-sdk/blob/1a340fd1b118a04b7fa553f77084023ce1fcbbda/LICENSE) | Promotions TypeScript 客戶端結構參考；不直接替換 main transport | ★★★★☆ |
| [Amazon Samples — dfdb3aeb97495bfc71cd95bda176e5611efa3271](https://github.com/amzn/selling-partner-api-samples/tree/dfdb3aeb97495bfc71cd95bda176e5611efa3271) | [根目錄 MIT-0](https://github.com/amzn/selling-partner-api-samples/blob/dfdb3aeb97495bfc71cd95bda176e5611efa3271/LICENSE) | 價格診斷流程與通知運送架構參考 | ★★★★☆ |

本輪沒有複製第三方功能程式到 AMZ.API；上表是概念／規格參考清單，不是已採用依賴聲明。將來若複製實作或產生模型型別，另保存 adopted file、commit、修改摘要與適用 NOTICE／copyright／license。僅核對了 Samples 根授權，不能以此宣稱每個子目錄的全部依賴均同授權。

## 1. Coupon／促銷同步

精確規格：[promotions_2025-12-01.json](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/promotions-api-model/promotions_2025-12-01.json)。官方 [Promotions API](https://developer-docs.amazon/sp-api/docs/promotions-api) 與 [SP-API Release Notes](https://developer-docs.amazon/sp-api/docs/sp-api-release-notes) 也確認該版本及 2026-08-26 發布資訊。

此 pin 的 `paths` 只有三個 GET operation；描述文字雖稱 create/manage，不能據此新增不存在的 Coupon 寫入 endpoint。

| Operation | 固定 method／path | 必要資料與分頁 |
|---|---|---|
| `searchPromotions` | `GET /promotions/2025-12-01/promotions` | `marketplaceIds` 必填、最多 1 個；request `paginationToken`，response `pagination.nextToken`；`limit` 1–100、預設 20 |
| `getPromotion` | `GET /promotions/2025-12-01/promotions/{promotionId}` | 以 main 已取得的 exact ID 讀取；可要求 `includedData=ISSUES,SELECTION` |
| `getSelection` | `GET /promotions/2025-12-01/promotions/{promotionId}/selections/{selectionId}` | **`revisionId` 必填且 >=1**；request `paginationToken`，response `selection.selectionDetails.pagination.nextToken`；`limit` 1–100；可要求 `includedData=ISSUES` |

搜尋的允許欄位為 `marketplaceIds`、`locale`、`statuses`、`asins`／`skus`（各最多 10）、`promotionTypes`、開始／結束／更新日期上下界、`paginationToken`、`revision`、`limit`、`includedData`。`locale` 是 `en_US` 這種 underscore 格式；日期篩選是含時區的 ISO 8601。固定 main intent 必須自行選定允許集合，不應把全套 arbitrary query 交給 renderer。

最重要的 parser／UI 邊界：

- 狀態全集為 `PROCESSING`、`UPCOMING`、`RUNNING`、`EXPIRED`、`FAILED`、`CANCELLING`、`CANCELLED`；類型為 `BASKET_BUILDING`、`DEAL`、`PRICE_DISCOUNT`、`COUPON`。未知值不能當 RUNNING。
- 搜尋 `revision` 預設 `PUBLISHED`；`ANY` 可匹配已發布與最新修訂。查詢選項控制「哪些促銷匹配」，不是把 response 主體改成最新修訂。主體與 `latestRevision` 必須分開呈現，失敗修訂不能覆蓋仍 RUNNING 的已發布版本。
- `searchPromotions` 的 selection 沒有 `selectionDetails`，不能只用搜尋摘要宣稱已核對全部參與 SKU。
- `getSelection` 只支援 `ITEMS`，不支援 `CATALOG`。CATALOG 的 `selectionId`／`revisionId` 可以不存在；不可捏造 ID 或把全店 catalog 促銷假裝只有已查的 FBA SKU。
- `getPromotion` 要同時選 `ISSUES`、`SELECTION` 才包含 item issues；`getSelection` 也需明確 `ISSUES`。未要求或缺失的 issues 不等於沒有問題。
- 搜尋与 selection 可能有**空但非終頁**；有 token 就在安全上限內續讀，token 重複停止並標 incomplete。官方明示少數 records 可能被省略，全部頁面的合計也可能少於 `totalResults`；應標 coverage 缺口，不補造或假裝完整。
- 促銷本身是帳號資料，ITEMS 要以同次 current-FBA exact SKU／ASIN 證據投影，未匹配與 CATALOG 另標明範圍不完整。保留既有人工公布欄，Amazon 讀回結果不應自動寫入 Supply Boss 公開 board。

Bizon 實際檔案：[client.ts](https://github.com/bizon/selling-partner-api-sdk/blob/1a340fd1b118a04b7fa553f77084023ce1fcbbda/clients/promotions-api-2025-12-01/src/client.ts)、[package.json](https://github.com/bizon/selling-partner-api-sdk/blob/1a340fd1b118a04b7fa553f77084023ce1fcbbda/clients/promotions-api-2025-12-01/package.json)、[generated API export](https://github.com/bizon/selling-partner-api-sdk/blob/1a340fd1b118a04b7fa553f77084023ce1fcbbda/clients/promotions-api-2025-12-01/src/api-model/api.ts)。套件為 `@sp-api-sdk/promotions-api-2025-12-01`，此 pin 的版本為 `1.1.0`、`engines.node` **`>=20`**，不是套件本身要求 Node 24；`clientRateLimits` 確實為空陣列。AMZ.API 的 Node 24 要求仍由自身 package 定義。不能從空陣列假設已具備端點專屬完整限流。

## 2. AWD 真實庫存與在途

精確規格：[awd_2024-05-09.json](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/amazon-warehousing-and-distribution-model/awd_2024-05-09.json)。以下是固定讀取操作，不需要複製 AWD 建單流程。

| Operation | 固定 method／path | 欄位／限制 |
|---|---|---|
| `listInventory` | `GET /awd/2024-05-09/inventory` | `sku` 單個可選、`details=SHOW`、`sortOrder`、`nextToken`、`maxResults` 1–200（預設 25）；預設 rate 2/s、burst 2 |
| `listInboundShipments` | `GET /awd/2024-05-09/inboundShipments` | `sortBy=UPDATED_AT/CREATED_AT`、`sortOrder`、單個 `shipmentStatus`、`updatedAfter/Before`、`nextToken`、`maxResults` 1–200；預設 rate 1/s、burst 1 |
| `getInboundShipment` | `GET /awd/2024-05-09/inboundShipments/{shipmentId}` | `skuQuantities=SHOW` 才要求 SKU quantity detail；預設 rate 2/s、burst 2 |

這三條 query 都**沒有 `marketplaceId`／`marketplaceIds`**。固定 regional endpoint 和 app 的 exact marketplace/account binding 是 main 的責任，不能捏造 upstream marketplace 篩選保證。空但非終頁有效，回應 `nextToken` 原樣配合原查詢續頁。

| API 欄位 | 可安全呈現的語义 | 不可推定 |
|---|---|---|
| `totalInboundQuantity` | 賣家→AWD、AWD 尚未接收數量 | 不是 AWD→FBA 在途 |
| `totalOnhandQuantity` | AWD 倉內數量 | 不代表全數可立即調撥或全數專供 FBA |
| `inventoryDetails.availableDistributableQuantity` | 可供下游通路補貨數量 | 下游通路不必然僅 FBA |
| `inventoryDetails.reservedDistributableQuantity` | 為準備出貨的下游補貨訂單保留數量 | 不是另一批可任意加到在庫的貨 |
| `inventoryDetails.replenishmentQuantity` | 官方明確定義為 AWD→FBA 尚未收貨在途 | 不得再與已涵蓋同批的 FBA inbound 重複加總 |
| `expirationDetails[].expiration/onhandQuantity` | API 有提供的 AWD 效期與對應在庫數量 | 缺資料不代表無效期；不是所有 FBA lot 效期 |

`InventorySummary` 只有 `sku` 必填，數量與 details 可以缺失。`expirationDetails` 需 `details=SHOW` 才可能提供。未知值保留 null／unavailable，不補 0。

`shipmentSkuQuantities[].expectedQuantity`／`receivedQuantity` 是 `{quantity, unitOfMeasurement}`，單位為 `PRODUCT_UNITS`、`CASES`、`PALLETS`；received 可缺失。只能同 SKU、同單位相減；不能把箱／板當件，也不能用使用者 24 箱／板規則自行換算官方未知單位。狀態 `RECEIVING` 只代表部分接收，`DELIVERED` 是抵達設施 yard、不是完成上架；差額不能直接叫貨物遺失。

實作建議（推論）：先以 AMZ.API 同次 current-FBA catalog exact SKU 證據限制顯示，未證明的 AWD SKU 只回 aggregate coverage 警告；AWD 貨源仍標為 AWD shared/downstream-channel stock，而不是 FBA-owned。取得帳號角色／站點實際支援需用使用者 Notebook Key 驗收；403 顯示權限不足，不能 fallback 為空庫存。

## 3. Buy Box／價格健康

精確規格：[productPricing_2022-05-01.json](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/product-pricing-api-model/productPricing_2022-05-01.json)。

`getCompetitiveSummary` 外層為 `POST /batches/products/pricing/2022-05-01/items/competitiveSummary`，但語義為**唯讀 batch**。body `requests` 1–20 項；每項需 `asin`、`marketplaceId`、`includedData`，固定 `method=GET`、`uri=/products/pricing/2022-05-01/items/competitiveSummary`。本輪可限制 `includedData=[featuredBuyingOptions,referencePrices]`。renderer 不應取得任意 batch method/URI 權限。

- 預設 rate **0.033 request/s、burst 1**，應 app-session-wide pacing（保守約 31 秒一批），context 清除不能洗掉 quota；這不是普通每秒数十次 GET。此 note 不授權 POST 盲重試。
- 外層 200 不等於全項成功；逐項驗 `status.statusCode`、`body.asin`、`body.marketplaceId`，批次結果必須 exact 一對一匹配，不依 response 順序猜。
- `featuredBuyingOptions` 包含 `segmentedFeaturedOffers`：會依會員、地區等 context 分段。只見其他賣家 featured、資料缺失或空結果，不等於自己的整體 Buy Box eligibility 為 false。
- `referencePrices` 的 `CompetitivePriceThreshold`、`CompetitivePrice`、`WasPrice` 不可混為同一標準；幣別與 listing／shipping 口徑要相符。CPT 相關資料是健康風險證據，不是完整不合格理由、也沒有指出 Chewy 因果。
- 若要判自己是否在已回傳的某個 featured segment，main 可用自身 seller identity 比對後只投影 boolean／分段狀態；原始 seller IDs／完整 upstream body 不離開 main。

官方 [Pricing FAQ](https://developer-docs.amazon.com/sp-api/docs/pricing-faq) 與 [Notification Type Values](https://developer-docs.amazon.com/sp-api/docs/notification-type-values) 可作 CPT 與 eligibility 文意對照；Notifications 的措辭為價格加運費高於 CPT **可能**失去 eligibility，不是所有理由的排他性結論。

實际範例：[calculate_new_price_handler.py](https://github.com/amzn/selling-partner-api-samples/blob/dfdb3aeb97495bfc71cd95bda176e5611efa3271/use-cases/pricing/code/python/src/calculate_new_price_handler.py)。它包含自動新價計算、完整 event logging 與 `amount=-1` skip sentinel；不應原樣導入 AMZ.API。僅參考診斷分支，使用明確 `needs-review`／`insufficient-evidence`，任何正式調價仍交既有 Write Gate。

## 4. 事件通知中心：接收器与本機彙整不同

精確規格：[notifications.json](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/notifications-api-model/notifications.json)。`DestinationResource` 提供 `sqs` 或 `eventBridge`，不是直接把 GitHub Pages URL 設為通知收件者。

官方 [Notifications sample README](https://github.com/amzn/selling-partner-api-samples/blob/dfdb3aeb97495bfc71cd95bda176e5611efa3271/use-cases/notifications/README.md) 的 webhook／GCP／Azure forwarding 是**部署後的中介 pipeline**：SQS／EventBridge、Lambda、Step Functions、Secrets Manager 等，不是 Amazon 原生直接推給任意靜態網頁。不能將 sample 的雲端 secret 儲存方式搬入現有本機憑證架構。

已存在的唯讀 subscription/destination 檢查，不代表已接收事件：

- `GET /notifications/v1/subscriptions/{notificationType}` 可檢查該類型訂閱，`payloadVersion` 可選。
- `GET /notifications/v1/subscriptions` 的 `notificationTypes` 目前每次只允許一種；`pageSize` 30–100；用 `nextToken` 讀完所有訂閱。
- `GET /notifications/v1/destinations` 為 **grantless** 操作，不能直接假設現有 seller-token transport 已支援；內部 destination IDs／ARN 不應回 renderer。
- 建立 destination／subscription 本身是外部寫入。新 AWS resources、IAM、額外 credentials、費用與 24 小時運行，都需獨立決策和授權，這次沒有執行。

| 可實作路徑 | 真正能力與離線邊界 | 現有本機架構適合度 |
|---|---|---|
| 本機偵測通知中心 | 將促銷／AWD／價格／Ads 的已驗證 snapshot 變化彙整、去重與已讀；須標明「本機偵測／非 Amazon push」，App 未執行期間沒有連續偵測保證 | ★★★★★ |
| Amazon push 接收 | 另選既有 SQS/EventBridge receiver 或部署 durable 接收／驗證／去重／離線補送服務；只讀取 subscription 資訊不代表完成 | ★★★☆☆，需架構與費用確認 |

以上為實作設計推論：不論採哪條，identity 為 exact account／mode／marketplace／generation，通知 ID 不能帶 secrets 或完整 account IDs；context 清除取消舊工作，遲到結果不能復活。重複／亂序事件、收件時間與 Amazon event time、資料 stale、無事件與未同步都應分開。不得把共享人工公布欄改造成未經批准的 Amazon 營運資料外送管道。

## 最小驗收重點

這些是下一步 public seam 測試建議，不代表使用者已核准該 seam 或程式已實作：

1. Promotions：revision／CATALOG／缺 issues／空非終頁／重複 token／總數缺口／錯 marketplace，不作零資料成功。
2. AWD：current-FBA proof、非 FBA 下游語義、四段數量不重複算、缺值不補零、CASES/PALLETS/PRODUCT_UNITS 不混用。
3. Pricing：唯讀 POST 固定 request vocabulary、每批 <=20、跨工作 pacing、逐項失敗、segment 局部證據、CPT 不冒充 eligibility／Chewy 原因。
4. Events：本機觀察與 Amazon push 明確区分、stable 去重／已讀和 context invalidation、不新增未授權雲端服務／訂閱寫入。
5. 全域：保留 main/preload/renderer 邊界及既有單一 Report Broker；權限／unknown／stale 不能冒充 complete。正式發布前仍需 repo 的 `npm run check`、`npm audit --omit=dev`、`git diff --check` 與 Notebook Key live 驗收。
