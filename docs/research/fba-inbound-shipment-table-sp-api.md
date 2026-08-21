# FBA 入庫 Shipment 表：公開 SP-API 能力研究

日期：2026-08-20
範圍：Seller Central「貨件」清單與單一 FBA 入庫貨件 contents 中的「預期單位數量／已找到商品」類資料。只評估 Amazon 公開 Selling Partner API 與 Reports API；未呼叫任何真實賣家帳號，也不使用 Seller Central 私有接口。

## 結論

可以在 AMZ.API 做一張實用的 **FBA 入庫貨件唯讀表**，而且不用逐筆打開 Seller Central。現階段最穩妥的主資料源不是只用新版 API，而是：

1. 用仍由 Amazon 明確列為「未棄用」的 Fulfillment Inbound v0 `getShipments` 取得 FBA 貨件清單、名稱、狀態、目的地 FC 與分頁。
2. 使用 v0 `getShipmentItemsByShipmentId` 在展開單一貨件時取得 Seller SKU、FNSKU、`QuantityShipped`（預期／送出單位）及 `QuantityReceived`（Amazon FC 已接收單位）。
3. 若需要新版 Send to Amazon 的計畫、預計出貨／送達區間、完整目的地或追蹤資料，再以 Fulfillment Inbound v2024-03-20 補充；不要用新版 `listShipmentItems.quantity` 冒充已接收量，因為目前官方模型沒有 received quantity 欄位。

Amazon 官方目前仍把 `getShipments`、`getShipmentItemsByShipmentId` 與 `getShipmentItems` 列為 **not deprecated**，所以讀取型 Shipment 儀表板使用這三個 v0 operation 並不是依賴已移除接口。[Fulfillment Inbound API considerations](https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api)

## 欄位與官方來源

| AMZ.API 可顯示欄位 | 建議來源 | 能力／限制 |
|---|---|---|
| FBA Shipment ID | v0 `getShipments.ShipmentId` | 可直接對應 Seller Central 常見的 `FBA...` 貨件 ID。 |
| 貨件名稱 | v0 `ShipmentName` | 公開欄位。 |
| 貨件狀態 | v0 `ShipmentStatus` | 支援 WORKING、READY_TO_SHIP、SHIPPED、RECEIVING、CLOSED、IN_TRANSIT、DELIVERED、CHECKED_IN 等狀態篩選。 |
| 目的地 | v0 `DestinationFulfillmentCenterId` | 可顯示 FC ID。若另用 v2024 `getShipment`，可讀 `destinationType`、`warehouseId` 與可能存在的地址；`AMAZON_OPTIMIZED` 目的地可以沒有倉庫／地址，不能自行推測。 |
| 建立／更新日期 | v0 只能用 `LastUpdatedAfter`、`LastUpdatedBefore` 篩選；v2024 提供 **inbound plan** 的 `createdAt`、`lastUpdatedAt` | 公開模型沒有 Seller Central 清單所用的逐 shipment `SHIPMENT_UPDATE_DATE` 回傳欄位。因此可以按日期窗口同步，但不能把 plan 更新時間或 App 抓取時間標成「貨件更新時間」。 |
| 預計出貨／送達區間 | v2024 `getShipment.dates.readyToShipWindow`、`selectedDeliveryWindow` | 這是計畫／預約區間，不是 shipment 建立或最後更新時間。 |
| Seller SKU／FNSKU | v0 `getShipmentItemsByShipmentId` | 公開欄位；v0 item 不含 ASIN／標題，可另外用 Listings 做非必要 enrichment。 |
| 預期單位數量 | v0 `QuantityShipped` | Amazon 定義為 seller 正在運送的 item quantity；可在 shipment 層加總。UI 建議稱「預期／送出單位」，並保留欄位說明。 |
| 已接收單位 | v0 `QuantityReceived` | Amazon 定義為 fulfillment center 已接收的 item quantity；可在 shipment 層加總。 |
| 差額 | `QuantityShipped - QuantityReceived` | 可以計算，但接收進行中時只是暫時未接收，不能直接稱為短少／Amazon 遺失。正值可顯示「尚未接收」、負值要保留為「超收」，不得硬壓成 0；只有另有問題證據時才標示異常。 |
| 入庫問題／不合規 | Reports `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA` | 每日更新、只含有問題的 product/shipment rows，含 problem type/quantity、expected/received quantity；不能拿它當完整 shipment 清單。 |

v0 `getShipments` 的輸入可依狀態、最多 999 個 Shipment ID，或 `LastUpdatedAfter`／`LastUpdatedBefore` 日期區間查詢；後續頁使用 `NextToken`。官方回應模型提供 `ShipmentId`、`ShipmentName`、`ShipFromAddress`、`DestinationFulfillmentCenterId` 與 `ShipmentStatus`，但沒有逐貨件的 created/updated timestamp。[官方 v0 模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-inbound-api-model/fulfillmentInboundV0.json) · [getShipments reference](https://developer-docs.amazon.com/sp-api/reference/getshipments)

v0 `getShipmentItemsByShipmentId` 回應包含 `SellerSKU`、`FulfillmentNetworkSKU`、`QuantityShipped`、`QuantityReceived`、`QuantityInCase`，回應模型也定義了 `NextToken`。[getShipmentItemsByShipmentId reference](https://developer-docs.amazon.com/sp-api/reference/getshipmentitemsbyshipmentid) · [官方 v0 模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-inbound-api-model/fulfillmentInboundV0.json)

要注意一個 Amazon 官方合約缺口：目前 `getShipmentItemsByShipmentId` 的操作參數沒有可送回 `NextToken` 的 continuation 參數，雖然回應 schema 可以回傳 token。若真的收到 token，App 不得私自猜參數；應把該 shipment 標為 partial。需要完整大量增量時，可改用 v0 `getShipmentItems` 的日期區間＋正式 `NextToken` 分頁，依 `ShipmentId` 合併回貨件。

## Legacy v0 與 v2024-03-20 的差異

### v0：最適合目前這張查詢表

- `getShipments` 是直接的 shipment list，可依狀態／ID／最後更新日期窗口查詢。
- `getShipmentItemsByShipmentId` 直接以 Seller Central 可見的 shipment ID 讀 SKU 層級的預期與已接收量。
- Amazon 現行文件明確把這三個讀取 operation 保留為未棄用能力。
- 缺點是 shipment list 不回傳精確的建立／最後更新 timestamp，item 不含 ASIN、title，目的地主要是 FC ID。

### v2024-03-20：適合補充新 Send to Amazon 結構

- `listInboundPlans` 列的是 **inbound plan**，不是直接的 shipment 清單；每頁 1–30 筆，以 `paginationToken` 翻頁，能依 plan creation/last-updated 排序。[listInboundPlans reference](https://developer-docs.amazon.com/sp-api/reference/listinboundplans)
- 要找到 shipment，需對每個 plan 呼叫 `getInboundPlan`，取得其中的 `ShipmentSummary`（shipment ID＋status），再呼叫 `getShipment` 取得 shipment confirmation ID、名稱、目的地、status、ready-to-ship window、selected delivery window 與追蹤資訊。[getInboundPlan reference](https://developer-docs.amazon.com/sp-api/reference/getinboundplan) · [getShipment reference](https://developer-docs.amazon.com/sp-api/reference/getshipment) · [官方 v2024-03-20 模型](https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json)
- `listShipmentItems` 每頁最多 1,000 筆、以 `paginationToken` 翻頁，回傳 ASIN、FNSKU、MSKU 與 `quantity`；官方 Item schema 沒有 `QuantityReceived`／received quantity。因此只用新版 API 無法可靠重現使用者要看的「已找到／已接收」數量。[listShipmentItems reference](https://developer-docs.amazon.com/sp-api/reference/listshipmentitems) · [官方 v2024-03-20 Item schema](https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json)

結論是讀取表應以 v0 為主，v2024 作可選 enrichment。不要為了「全面遷移新版」而失去 `QuantityReceived`。

## 「已找到商品」應如何命名

Amazon 公開 v0 欄位的正式語意是「Amazon fulfillment center 已接收的數量」；公開模型沒有把它命名為 Seller Central 畫面上的「已找到商品」。因此第一版應顯示：

- 卡片摘要：`預期／送出 120 · Amazon 已接收 114 · 尚未接收 6`
- 展開明細：`Seller SKU · FNSKU · 預期／送出 · Amazon 已接收 · 尚未接收差額`
- 說明：`Amazon 已接收取自 QuantityReceived；Seller Central 顯示文字或內部結算狀態可能不同。`

不能把下列資料混在一起：

- Inventory Ledger 的 `Found` 是庫存帳簿中的 found adjustment／inventory movement，不是這張 inbound shipment contents 的同名數量。Inventory Ledger detail 可另外依 `Receipts`、`ReferenceID` 分析庫存動作，但不應替代 shipment 的 `QuantityReceived`。[FBA Inventory Ledger reports](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)
- Inbound Performance Report 是每日更新的問題子集，不是完整貨件內容；無該報表列不代表貨件一定沒有任何差異。[FBA report type documentation](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)

## 分頁、節流與同步設計

Amazon 公開預設 usage plan 如下；實際 account/application 可由 `x-amzn-RateLimit-Limit` 回應 header 得到不同限制：[Fulfillment Inbound API rate limits](https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api-rate-limits)

| Operation | 預設速率 | Burst |
|---|---:|---:|
| v0 `getShipments` | 2 req/s | 30 |
| v0 `getShipmentItemsByShipmentId` | 2 req/s | 30 |
| v0 `getShipmentItems` | 2 req/s | 30 |
| v2024 `listInboundPlans` | 2 req/s | 6 |
| v2024 `getInboundPlan` | 2 req/s | 6 |
| v2024 `getShipment` | 5 req/s | 6 |
| v2024 `listShipmentItems` | 2 req/s | 30 |

實作時應：

1. 清單只跑 `getShipments` 的所有 `NextToken` 頁，檢查 token 循環、重複 shipment ID 與 marketplace identity。
2. 產品第一版採使用者要求的「按一次自動完成」：在 main process 背景以保守 2 requests/second 逐貨件呼叫 `getShipmentItemsByShipmentId`，renderer 關閉面板只停止觀察、不停止同一工作。若該回應出現官方無 continuation input 可承接的 `NextToken`，明確標示 partial，不得假裝完整。若日後貨件量證明需要更快的增量路徑，再另評估 global `getShipmentItems`；不能因日期窗口相同就假設它含每一個貨件的完整 item set。
3. 同一 account＋mode＋marketplace＋精確日期範圍的 active 工作做 single-flight；背景刷新必須遵守 429／`Retry-After`，唯讀 GET 可 bounded retry。terminal 後使用者明確再同步可建立新的 GET 工作，但每日問題報表仍由耐久化 broker 防止盲目重建。
4. 一頁失敗時保留已證明的其他 shipment，但該 shipment 標成「明細未完成」，不得把未讀到的 received quantity 補 0。
5. 需要大範圍完整 item 增量時，使用有正式 continuation 參數的 v0 `getShipmentItems` 日期窗口＋`NextToken`，再依 Shipment ID 合併；不能把不同窗口的舊值盲目相加。
6. 只接受精確站點的 FBA inbound 資料；不加入 Merchant Fulfillment／FBM shipping API。

官方集中 rate-limit 表目前列 `getShipment` 為 5 req/s、burst 6，但 v2024 模型內 operation 說明仍寫 2 req/s、burst 6。實作不能把其中一個常數當永久真理；應採較保守初始值，並以實際回應的 `x-amzn-RateLimit-Limit` 做 account/application 節流。

## 角色與資料權限

- Fulfillment Inbound 的 v0 讀取 operation 與 v2024-03-20 的 `listInboundPlans`、`getInboundPlan`、`getShipment`、`listShipmentItems` 等 operation，Amazon 明列所需角色為 **Amazon Fulfillment**，適用 NA／EU／FE。[Fulfillment Inbound API roles](https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api) · [Role mappings](https://developer-docs.amazon.com/sp-api/docs/role-mappings)
- FBA Inbound Performance Report 可由 Pricing 或 Amazon Fulfillment 角色取得；Inventory Ledger 的角色為 Amazon Fulfillment。[FBA Reports roles](https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba)
- 這些 Shipment 欄位不需要買家 PII 或 RDT；不應讀取或輸出 Seller Central 的私有 session／cookie。
- AMZ.API 目前的產品設計已要求 Amazon Fulfillment 角色，但是否真的能讀這些 operation 仍必須在使用者 Notebook Key 以唯讀 canary 分開驗證；Orders／Listings 成功不能代替 Fulfillment Inbound access proof。

## Seller Central 無法由公開 API 完整重現的部分

以下應在 UI 明確標成公開資料限制，而不是猜值：

1. Seller Central 清單的精確 `SHIPMENT_UPDATE_DATE` 值與完全相同的伺服器排序。v0 能用更新日期範圍篩選，但回應不帶該 timestamp；v2024 只公開 plan 的 `lastUpdatedAt`。
2. Seller Central 「已找到商品」若包含 UI 私有的 scan、investigation、reconciliation 或 eligibility 邏輯，公開 `QuantityReceived` 只能證明 FC 已接收數，不保證文字與內部計算完全等價。
3. Seller Central 的 reconciliation case、可調查／可索賠資格、每一個掃描事件、問題處理步驟與 UI badges，官方 shipment models 未公開完整對應欄位。
4. `AMAZON_OPTIMIZED` shipment 的實際目的地地址／warehouse ID 可能空白；官方明示應以 carton label 為準，App 不得從其他貨件推測。
5. 公開 API 不保證與 Seller Central 同一頁的所有非資料 UI、排序選項或內部提示逐字一致。
6. 舊 `GET_FBA_FULFILLMENT_INVENTORY_RECEIPTS_DATA` 已被 Amazon 移除，不能拿過時文章中的 report type 當替代來源。[SP-API deprecations](https://developer-docs.amazon.com/sp-api/docs/sp-api-deprecations)

## 研究當時的 AMZ.API 基線（v0.1.16）

- v0.1.16 的 `/api/sp-api/replenishment` 只從 FBA Inventory API 讀 SKU 聚合的 `inboundWorkingQuantity`、`inboundShippedQuantity`、`inboundReceivingQuantity`；它沒有 shipment ID，也不能回答某一貨件的 expected／received。
- 品牌營收使用 `GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA`，這是 **FBA 客戶出貨銷售**，不是賣家送進 Amazon FC 的 inbound shipment。
- 報表文件庫當時已列出 `GET_LEDGER_DETAIL_VIEW_DATA` 與 `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA`，但 catalog 只是能力規劃，尚未接入 inbound 產品流程。
- main router 當時沒有 FBA inbound shipment 產品 route，所以首版必須新增 Notebook Key 底層唯讀 capability；只改 GitHub Pages 無法取得這些 Amazon 資料。

## v0.1.17 最終第一版

v0.1.17 實作「FBA 入庫貨件追蹤」，提供 30／90／180 天日期窗口與狀態、關鍵字、僅顯示差異篩選：

| 貨件 ID／名稱 | 狀態 | 目的地 FC | SKU 種類 | 預期／送出 | Amazon 已接收 | 接收差額 | 資料時間 |
|---|---|---|---:|---:|---:|---:|---|

使用者按一次後，Notebook Key main process 會在背景依保守速率讀完整個日期窗口的貨件與逐貨件商品；收合面板只停止 renderer 觀察，不取消同一背景工作。明細展開時顯示已由 main 完成或正在完成的同一工作快照：

| Seller SKU | FNSKU | 預期／送出 | Amazon 已接收 | 接收差額 |
|---|---|---:|---:|---:|

狀態為 RECEIVING／CHECKED_IN 時，差額使用中性提示；CLOSED 且仍有差額時才升級成「建議到 Seller Central 核對」，但仍不能僅憑相減宣稱 Amazon 遺失。每日 `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA` 已在第一版接入，貨件／包裝箱／產品三層問題與數量快照分開標示來源及讀取時間；空報表或 unavailable 不會被宣稱為 Seller Central 即時零瑕疵。
