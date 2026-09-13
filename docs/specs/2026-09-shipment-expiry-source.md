# 以已選定貨件讀取申報效期並保留可讀來源

2026-09-13；Issue #278，接續完整效期目標 #263。基線 main `bd55d8bb8d4d1f1df7d7b505b0c594bf5d3246e4`，已安裝 runtime 0.1.73／`bc0d2ba08baabe515e4ddf2cf9ba48c0a3c30e70`；這次能力版本 0.1.74。

## 實機問題與授權範圍

可信 .73 啟動與 Amazon 連線已恢復。第一次且唯一一次同步更新 284 個 FBA 核心品號、33 個銷售偏慢／待核對；入庫商品清單的某計畫首頁回 HTTP 400／BadRequest，body 已讀取、固定原因為 other-input。不能推定這是整輪第一個計畫、legacy v0、登入失效或請求建構錯誤。重新讀取本機仍保留同次快照；效期來源不完整、284 批次未知、0 已確認風險。沒有重試或 Amazon mutation。

使用者持續要求完成全部 FBA 效期與銷速功能。這次改進正常唯讀來源與部分來源失敗時的保留方式，屬於該既有授權；不再只發布診斷文字，也不聲稱已證明上游 400 的內部原因。此 spec 取代前版「任何 plan-items 400 都停止全輪」及 conditional legacy-only 隔離設想；其餘安全、數量、人工資料與行事曆契約不變。

## 來源與完整度契約

1. 新掃描中每個選定 ACTIVE／SHIPPED 入庫計畫先 `getInboundPlan`，核對 exact plan ID、lastUpdatedAt、status、marketplace。版本時間只接受有界 RFC3339 格式，以保留奈秒精度的 instant 比對等價 Z／小數秒／offset，仍保存清單原字串；真正時間差異或非法格式拒絕。使用 response 的已選 placement 貨件清單，逐個 exact shipmentId 呼叫 `listShipmentItems` 直到所有 token 結束。固定 main-owned GET／host／path／pageSize 1000；沒有 renderer transport 或任意 URL。新掃描重新核對計畫內容與已選 shipment manifest；schema 2 的 plan revision／status 及已選 shipment IDs／狀態都相同時，可沿用已完整讀取的商品 cache。
2. shipments 缺席或空陣列時，仍以原 plan-items 讀完整申報商品，不把缺少貨件解讀成沒有商品。null／非法清單、重複或非法 ID、修訂／站點漂移及成功回應的格式错误均停止；不能 fallback 洗掉矛盾。
3. 每個貨件內重複批次拒絕；同一批次分在不同已選貨件可加總申報量。批次鍵保持原 plan＋SKU＋ASIN＋FNSKU＋效期＋製造批號，sourceRef／record ID 相容舊 plan-level 資料。逐貨件 provenance 留在 main-only checkpoint，避免重複批次與人工確認數量被分攤或倍增。申報量與現存批次餘量保持分離。
4. 已驗證 context／request 的單一計畫明細或商品讀取，若收到 terminal HTTP 400／404／422 且為 adapter 固定 `FBA_INBOUND_UPSTREAM_UNAVAILABLE`，只證明該來源不可讀。保存固定 unavailable 狀態與 plan metadata，丟棄該計畫尚未完整的商品暫存，繼續其他計畫；不保存 raw error、不猜原因、不重送同一請求。錯誤 body 的格式不能授予成功或具體原因。
5. 計畫清單失敗、auth／context／abort、throttle／network／server failure、成功 payload 格式錯誤、pagination 漂移／重複與上限仍停止。catch 後先再核對 context 與 abort，才能隔離來源錯誤。
6. 完成遍歷與來源完整是不同狀態：`traversalComplete=true` 可搭配 `complete=false`／unavailablePlanCount。coordinator 保存已完成來源後停止切片，sync 顯示終態 partial 與無法讀取計畫數，GET／重新讀取本機不會重新列表或重送。新一次明確同步可重新評估不可讀來源。
7. checkpoint schema 2 保存詳細階段、來源與游標、完整 cache 及 unavailable plan；沿用 request／record／plan／token／bytes 上限、原子加密保存與 exact context。schema 1 必須先完整驗證，再開啟新掃描；舊 profile 的人工資料保留。中途切片不把半份計畫發布為完整，重開可接續且不重讀同輪已拒絕來源。
8. 任一無法讀取的計畫仍使來源不完整。未知計畫涉及哪些 SKU 不可推定，自動行事曆與批次確認仍保持原全域完整性門檻。人工公布欄與促銷保留；缺日期／餘量保持未知，不以歷史入庫量或庫齡補算。

## 官方依據與界線

| 證據 | 支持的行為 |
|---|---|
| ★ [Fulfillment Inbound API 總覽](https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api) | STA 完成 placement／transportation 確認後，可透過 API 存取。 |
| ★ [官方 pinned model](https://github.com/amzn/selling-partner-api-models/blob/8e429486005c4ebdce5099e48cc48515a65359bb/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json) | getInboundPlan 的 shipments 來自已選 placement；shipment-items 共用含可選 expiration 的 Item schema。 |
| ★ [官方貨件商品說明](https://developer-docs.amazon.com/sp-api/docs/additional-functionality-fulfillment-inbound#list-shipment-items) | 貨件商品可提供申報效期；不是現存 FBA 批次餘量。 |
| ☆ [AGL 存取限制案例](https://github.com/amzn/selling-partner-api-models/issues/4419#issuecomment-2542268206) | getInboundPlan 也可能不可讀，因此路徑存在不等於本帳號已成功。 |

## 驗證

先在 production transport seam 重現 shipment-items 走錯 path，再驗固定 path／query／GET 與 cursor 編碼。reader 測試覆蓋選定貨件、多頁／多貨件／多效期、跨貨件合併與貨件內重複、空清單、revision／identity、上下限、首頁／中間／最後不可讀、全不可讀、晚頁失敗、100-request slice／checkpoint 重開與 schema 1 遷移。

真 reader→coordinator→sync 整合需驗來源轉換不重複、人工日期／停售日保存、確認餘量不倍增、終態 partial 不重列、GET 不起網路、有效核心預估保留及來源未知不進行事曆。完整 check／audit／兩軸 review／exact-source CI、產物、安裝及 native 首次同步分層記錄；尚未取得 live 貨件日期前，不宣稱完整效期完成。
