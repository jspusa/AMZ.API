# 效期與清售風險表格介面交付

Issue #271；[需求契約](../specs/2026-09-inventory-health-table-layout.md)。Control Console Release，Notebook Key 沿用已安裝並驗證的 0.1.72。

## 已確認的問題與修正

- 原生畫面確認八欄擠壓。真實 `InventoryHealthPanel`＋完整 CSS 的合成重現，1961px 與 1440px 畫面最後三欄都是 0px；只清除滲入的全站五欄百分比設定，即能恢復欄位。
- 改用此八欄表專屬的欄寬與正常換行，寬螢幕視窗使用較大可視範圍；窄螢幕保留可读欄寬、捲動提示與鍵盤可聚焦區。長表頭按語意分段，日期、數量、銷速、缺口與核對都保留。
- 表內核對明細在窄螢幕貼齊目前可視範圍，表單可達；深色模式使用既有色彩 token。資料篩選、批次確認處理、來源完整度、未知值及自動月曆規則未改。
- 合成畫面與量測保存於 `/tmp/inventory-health-layout-evidence/`；這些資料只證明版面，不是 live Amazon 或實际批次證據。

## 驗證與發布

- 完整本機檢查、兩軸 review、exact source CI、Pages 資產比對及原生新介面畫面仍待完成，不能由合成截圖推定已上線。
- 新 renderer 不要求重裝 Notebook Key；.72 桌面 artifact／安裝與員工下載證據仍以[原版本帳本](2026-09-empty-inbound-plan-name.md)為準。
- 原始效期目標仍待處理 .72 的終態請求驗證錯誤。已確認訊息只對應 400／422，現有 request 路徑／排序／pageSize 符合官方規格；下一步是窄化安全錯誤原因，沒有盲目重試或改動未知批次政策。
