# 計畫明細不可讀時，獨立讀取計畫申報效期

2026-09-14；Issue #285，接續完整目標 #263。開工 main `633be5e64c616c560a06d68c85aae6a77585a23d`，已安裝 runtime 0.1.75／`3a40cc0309d89abed80b25df40ca2c8e29188708`。此能力目標版本 0.1.76。

## 具體問題與證據

.75 首次同步列出 36 個計畫，全部在 getInboundPlan 回 HTTP 400／BadRequest／parsed／other-input。現行 reader 因此未對它們呼叫任何 plan-items。這不能證明 36 個商品端點都可讀，也不能證明它們都不可讀。.73 原本直接讀 plan-items，但遇到第一個商品錯誤便停止全輪；該錯誤不代表整輪第一個計畫，也不能推論其餘計畫的商品來源。

官方 listInboundPlanItems 是獨立 GET，沒有先取得成功 getInboundPlan 或 selected shipment manifest 的前置條件。原始使用者需求是自動帶入入庫申報效期並保留來源，不是以入庫申報量冒充現存批次餘量。因此本次將 metadata 可讀性與計畫商品可讀性分開；不是宣稱已知道 Amazon 拒絕 metadata 的根因。

聚焦合成回歸 `tests/fba-expiry-plan-items-fallback.test.ts` 已在修改前失敗：2 次清單、36 次 metadata、0 次商品，預期在獨立商品可讀的 fixture 中取得 36 筆日期。商品可讀性與日期是合成；不得當成本帳號的成功證據。

## 來源與保存契約

1. 正常路徑仍讀 getInboundPlan、核對 exact ID／revision／status／marketplace，讀完已選貨件的 shipment-items；成功 metadata 的缺席或空 shipments 仍讀 plan-items。成功回應中的矛盾與格式錯誤不得觸發備援。
2. 只對本輪清單已核對的 ACTIVE／SHIPPED 計畫，在 metadata 回固定 HTTP 400／BadRequest／parsed／other-input 時，改讀同一 exact plan 的獨立 plan-items。401／403、context／abort、network／server／throttle、明確 malformed-ID、其他狀態／原因或未知錯誤維持原停止或來源隔離規則。GET host／path／參數仍由既有 production adapter 固定，不增加任意 transport 或 renderer 呼叫入口。
3. 計畫商品須逐頁完整驗證 exact SKU／ASIN／FNSKU、日期、申報數量、batch key、token、identity 與 context；沿用 requests／records／plans／bytes 上限。不得與同計畫 shipment items 合併，不能重複計算申報量。late page failure 丟棄整個尚未完成的計畫，其他獨立計畫接續；context 與格式漂移仍停止。
4. schema 2 的 cached／current plan 增加 optional `planDetailUnavailable: true`。存在時來源必須恰為單一 null shipmentId 的 plan-items，絕不代表貨件清單為空或尚未出貨。未知／false／不相容 shipment provenance 拒絕；原 schema 2 不含此欄位仍相容。日期與 sourceRef／批次 ID 維持原計畫級身分，申報量不轉成現存餘量。
5. 全部選定計畫的獨立申報商品分頁均成功，便可證明申報來源完整；metadata 未核對的貨件資訊另行標示，不把它當成商品資料缺失。任何商品來源不可讀仍為 partial；未知日期、批次餘量與自動行事曆保持既有門檻。人工效期／停售日／促銷與已確認餘量的快照條件保持不變。
6. 已完成的 .75 checkpoint 若保存上述精確 metadata 失敗，新的明確同步先重新列出計畫；同 ID／status／revision 才直接讀尚未嘗試的 plan-items，不重送已知失敗的 metadata GET。不同 revision 重新走正常 metadata 核對。歷史 operation 或 response 未記錄不得推論。partial continuation 的其他來源 tombstone 仍不重試；本機 GET 永不發 Amazon 請求。
7. 已完成且標示 metadata 未核對的 cache，在新清單 revision 不變時使用相同計畫商品來源，但每次明確新同步重新讀商品，不以未核對的 shipment manifest 授權快取沿用。進行中的商品分頁只接續游標，不重讀 metadata。
8. public diagnostics 只新增 optional `planItemFallbackCount`，整數 0–6000 且不超過 completed cached count。僅計入本輪已列出並完成、非 pending／unavailable 的計畫。前台顯示其申報商品已讀取、貨件明細尚未核對；缺欄位相容 .75。不得投影 raw errors、tokens、account scope 或私人 checkpoint。

## 驗證與交付

先 RED→GREEN 聚焦 reader，補 .75 歷史失敗直接讀商品、revision 改變、negative guard、跨 slice／重開、late failure 與 marker tampering。真 reader→coordinator→保存→GET 驗多日期／來源、完整度、未確認餘量不進行事曆及 GET 零外部呼叫。再跑完整 check、audit、兩軸 review、同一 source CI、兩平台可信產物與 Pages；安裝與員工實際下載另外核對。

.76 安裝後先本機讀保存摘要，再進行一次有明確目的的新能力驗收：對 .75 尚未嘗試的 plan-items 讀取。只有 fresh list revision 不變的計畫才可使用先前 metadata 失敗；不將未送出的請求記為成功。成功日期／來源／多日期／重開保存須實測，否則完整 #263 維持未完成。不得為驗收送出 Amazon mutation。

## 官方依據

| 證據 | 可支持的結論 |
|---|---|
| ★ [listInboundPlanItems](https://developer-docs.amazon.com/sp-api/reference/listinboundplanitems) | 獨立 GET，必填為 inboundPlanId；沒有 getInboundPlan 成功的前置條件。 |
| ★ [官方 model](https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json) | Plan summary 有 ID／站點／狀態／revision；Item 有 optional expiration 與申報數量。回應不提供原子快照或現存批次餘量保證。 |
| ★ [createInboundPlan](https://developer-docs.amazon/sp-api/reference/createinboundplan) | quantity 為建立計畫的商品數量，不能稱 FC 現存庫存。 |
