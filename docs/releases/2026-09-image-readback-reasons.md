# 0.1.81 同次圖片回查原因

接續 Issue #305 與 [0.1.80 交付帳本](2026-09-workspace-image-recovery.md)。本輪 base 為文件合併 `c9dcdbf6e1a27cf0f2769bd5b4417fc3a85164ee`；.80 runtime 與已安裝證據仍固定 `f3c159d110bd1692a7a7e1beb9ff4101dd431299`。

## 問題與證據

.80 已修正真正的手動 GET 回查，且原生實測回查時間前進，但既有 10 筆 Accepted／Verified 0 的具體原因仍無法從畫面判斷。程式檢查證明原有 generic pending 文案同時涵蓋操作證據、商品身分、FBA、欄位形狀、任一 Amazon ERROR 及圖片 URL／null 不符，不能將它直接說成圖片未同步。

| 同批未確認的候選原因 | 目前證據 |
|---|---|
| ★ 圖片 URL 或清除位置未精確相符 | 嚴格判斷包含此檢查；尚未取得本批同次分類 |
| ★ Amazon 回報 ERROR，可能屬其他欄位 | 任一 ERROR 皆阻擋原判斷；尚未取得本批分類 |
| ★ 身分／FBA／操作證據或欄位結構未符 | 原判斷保留這些保護；尚未定位本批哪個條件 |

官方 [Manage Product Listings guide](https://developer-docs.amazon/sp-api/docs/manage-product-listings-guide) 的 GET 範例使用 Amazon-origin `media_location`；[Listings Items API](https://developer-docs.amazon/sp-api/docs/listings-items-api) 將 attributes 描述為賣家最新提供資料，但沒有保證逐字保留提交網址。這只能支持 URL 差異需要診斷，不能證明本批遭改寫，也不能把 Amazon host／相同張數當作送出內容完成。

## 實作與驗證

- `analyzeImageReadback` 同時產生原有嚴格 decision 與同次診斷；單 SKU、批次和 durable reconcile 沿用同一判斷，不新增 Amazon query。
- 公開診斷僅有封閉 enums、布林和有限計數，沒有 raw issues、網址、SKU／ASIN 或帳號。schema 拒絕額外欄位、未知版本、矛盾及越界計數。
- 圖片差異、missing／待刪、與原值相同及不同來源 Amazon media host 只供辨識原因；不能自動改判 verified。
- 新回查開始及 GET 失敗清掉舊診斷；renderer 在讀取中／observer 斷線時不將舊原因當成本次結果。舊 Bridge 沒有診斷欄位時不補成零錯誤。
- 「查看本次回查原因」分開顯示核對條件、圖片位置與 Amazon 錯誤分類；整列是否完成仍以 durable row state 為準。
- Main 紅測試先重現沒有同次分類；renderer 紅測試先重現不顯示原因及接受畸形 DTO。修正後定點測試通過；完整檢查、兩軸 review 與交付結果待記錄。

## 交付狀態

| 層級 | 狀態 |
|---|---|
| ★ 同次診斷與定點回歸 | 已實作；不放寬 verified、不重送圖片 |
| ☆ 完整檢查／兩軸審查 | 進行中 |
| ☆ 正式 CI／Pages／兩平台產物 | 待固定 source 後驗證 |
| ☆ 安裝／密碼下載 | 待本輪可信產物，不沿用 .80 結果 |
| ☆ 原生同批原因定位 | 待新版同次 GET；保持 10 筆原始紀錄 |
