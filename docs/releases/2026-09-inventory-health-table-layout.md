# 效期與清售風險表格介面交付

Issue #271；[需求契約](../specs/2026-09-inventory-health-table-layout.md)。Control Console Release，Notebook Key 沿用已安裝並驗證的 0.1.72。

## 已確認的問題與修正

- 原生畫面確認八欄擠壓。真實 `InventoryHealthPanel`＋完整 CSS 的合成重現，1961px 與 1440px 畫面最後三欄都是 0px；只清除滲入的全站五欄百分比設定，即能恢復欄位。
- 改用此八欄表專屬的欄寬與正常換行，寬螢幕視窗使用較大可視範圍；窄螢幕保留可讀欄寬、捲動提示與鍵盤可聚焦區。長表頭按語意分段，日期、數量、銷速、缺口與核對都保留。
- 表內核對明細在窄螢幕貼齊目前可視範圍，表單可達；深色模式使用既有色彩 token。資料篩選、批次確認處理、來源完整度、未知值及自動月曆規則未改。
- 合成畫面與量測保存於 `/tmp/inventory-health-layout-evidence/`；這些資料只證明版面，不是 live Amazon 或實際批次證據。

## 驗證與發布

- 完整本機檢查 322 files／3,886 tests、typecheck／build／樣式驗證與 production audit 0 通過。初次全檢有一個未改動的 durable-store 測試逾時；確認 test／owner 未變、單項 1,576 ms 通過後，原碼只重跑一次全檢即通過，未改測試或 timeout。
- Standards／Spec 對 `cd036fa7a5d33b9b01206e8a00018e3cba0601a8` 各 0 未解問題。PR #272 的 Validate `34755417302` 與 Windows `34755417255` 全部成功，已合併至 main `993a789966d9dbc9f068d853e3830984051dd633`。該 main 的 Validate `34755750071`、Pages `34755750072` 均成功，Pages artifact `10316947572` 的 HTML 與全部 11 個 JS／CSS 均 HTTP 200 且 bytes／hash 相同；證據在 `/tmp/amz-api-health-table-20260913/pages/pages-byte-verification.json`。
- 鎖定解除後，原生 .72 正常 Reload 並開啟健康表，已從真實畫面核對八欄、換行表頭、右側核對按鈕及捲動提示清楚可見。保留 284 FBA 既有 snapshot、人工公告 4 項與門檻 8；未重跑同步或修改批次。證據 `/tmp/amz-api-health-table-20260913/native-table-verification.json`，本表格問題已完成原生驗收。
- 新 renderer 不要求重裝 Notebook Key；.72 桌面 artifact／安裝與員工下載證據仍以[原版本帳本](2026-09-empty-inbound-plan-name.md)為準。
- 原始效期目標仍待處理 .72 的終態請求驗證錯誤。已確認訊息只對應 400／422，現有 request 路徑／排序／pageSize 符合官方規格；下一步是窄化安全錯誤原因，沒有盲目重試或改動未知批次政策。
