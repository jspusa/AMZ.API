# 變體工作台與 US 價目表證據

核准範圍見 [spec](../specs/2026-09-08-variation-price-workbench.md)。Source baseline `cc491d0adda3bffe5221198e3c05a542ca9fe4d4`，實作分支 `codex/variation-price-workbench`，Notebook Key 目標版本 `0.1.57`。

## 實作與 public seam

變體原流程只把 theme 維度帶到表單，CHILD PTD 的缺少商品事實無法補填。新版由 main 提供可填的缺漏欄位，已知事實保持唯讀，requiredValues 與 parent／dimensions 同受 schema、exact identity、Preview、native approval 和 ledger 保護。主入口改為寬版表格工作區，Preview 與確認送出分開，未知結果保持 GET-only recovery。

價目表在 main 解析有上限的 ZIP/XML，保留原始 bytes。匯入、圖片、兩檔比對、原檔匯出與清除是固定本機 intents；Amazon owner 只讀 US current FBA 與 exact Listing，並在 main 保存匯出快照。原售價／最低活動價與 Amazon 設定售價／最低價格分欄，差異使用 ★／☆；比對輸出附加欄位，首圖替換是選配，原檔不被覆蓋。使用者的商業資料與原檔沒有加入 repository。

## 驗證帳本

- Baseline：typecheck 通過；全套既有測試有一項 A+ timing 失敗，單獨重跑 4/4 通過。這是測試執行觀察，未將失敗直接歸因本次變更。
- 已先在 production variation public wire 重現「缺少 product_contains_liquid，preparation 沒有輸入欄位」。修補測試涵蓋 explicit false、部分屬性、條件必填、preview binding、unknown 與回查。
- 價目表聚焦驗證：原檔 exact bytes、欄位／公式／圖片保留、兩檔差異、唯一 FBA 對應、歧義不查 Listing、缺少最低價不補零、single-flight、context 失效、image host 及 preload 匯入上限。
- Dashboard 實際 renderer interaction 驗證七張健檢與兩個新寬版工作區，無 modal、選單鎖定及返回焦點／捲動恢復。
- 整合 main `bde207f5f6d038ad195bcd47594599970daf0933` 的首頁日期控制修正後，`npm run check` 通過：287 test files／2,942 tests、TypeScript、production build、stylesheet parity；`npm audit --omit=dev` 為 0 vulnerabilities；`git diff --check` 通過。
- 真實本機原價目表解析成功：10 sheets、232 images、417 product rows、235 formulas。原檔 export 與輸入 exact bytes／hash 相符；比對輸出重讀保留原商品價格及公式。檔案沒有加入 repository。實際 browser 匯入另揭露 renderer 的舊 15 MiB 上限，已和 preload 同步為僅 exact price-list import 25 MiB，並以真實檔案大小的合成內容回歸。
- Standards 與 Spec review 均無剩餘阻擋。Review 發現的 image pixel bound、重複圖片輸出放大、部分必填 fact 保留、native fact disclosure 及 preview recovery 已修正並回歸。圖片共用 media part，匯出單一工作且有整體時間上限。
- 變體 production browser fixture：1440px／390px 無整頁水平溢出，來源清單固定 438px 可捲动，長名稱不阻擋下方表單，boolean 初始空白、false 明確選擇、預覽與確認分開。此 fixture 拒絕 mutation。完整樣式 fingerprint：`99e1e84896887d7cfa06383874cd2bb53bc36a4ce5fa67833d74df3978bf0170`；歷史 CSS payload pins 原樣保留。
- 價目表 production browser 以使用者本機原檔匯入成功，1440px／390px 無整頁水平溢出，圖片可載入、85% 預覽的欄寬與原欄寬比例相符。右側 Amazon 比對欄已檢查；這次畫面驗證的 Amazon 回傳是 unavailable fixture，不能當成 live 價格證據。臨時檔已清理，截圖只在 ignored 本機 output。
- exact commit Actions、Pages、artifact、安裝與受保護下載頁待下方補記；以上本機驗證不代表已發布。

## 驗證界線

本輪工程驗收沒有對真實 Amazon 發出 Listing mutation。真實 CHILD PTD／Validation Preview、Touch ID、Windows Hello、Amazon 更新與回查仍需在使用者指定的實際 SKU 操作時確認。CI 的 Mac／Windows packaging 不代表真人生物辨識或 Amazon 成功。正式簽章與公開更新 feed 的獨立 gate 保持不變。

Amazon 官方說明：[Listings issues troubleshooting](https://developer-docs.amazon/sp-api/lang-en_EN/docs/listings-items-api-issues-troubleshooting)、[Preview errors before creating a listing](https://developer-docs.amazon/sp-api/docs/preview-errors-before-creating-a-listing)。
