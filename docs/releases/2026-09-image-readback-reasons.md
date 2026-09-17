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
- Main 紅測試先重現沒有同次分類；renderer 紅測試先重現不顯示原因及接受畸形 DTO。畸形 Amazon issue 的回歸確認採 fail-closed，合法 WARNING／INFO 不阻擋。
- 首輪兩軸 review 各發現一項 P2：再次找回失敗會重新顯示舊原因，以及身分／attributes 證據失效仍產生圖片差異分類。兩項均先紅後綠修正：恢復失敗隱藏舊原因並保留原 accepted 紀錄；可信 target gate 與 DTO parser 均禁止無有效商品證據的圖片比較。最終固定來源 `60638e899a555f67fd7536cb993411eb5664219a` 的 Standards／Spec 各 0 open findings。
- Synthetic browser QA 已核對不同 Amazon URL／其他欄位 ERROR 兩種原因顯示；1280px／390px 頁面無整頁橫向溢出。這不等於本批原生回查結果。

## 交付狀態

| 層級 | 狀態 |
|---|---|
| ★ 同次診斷與定點回歸 | 已實作；不放寬 verified、不重送圖片 |
| ★ 完整檢查／兩軸審查 | 336 files／4,398 tests、audit 0、diff check；final 兩軸各 0 open findings |
| ★ 正式 CI／Pages／兩平台產物 | 四條 main／push attempt 1 通過；Pages HTML＋全部 10 個 JS／CSS bytes、兩平台 artifact／manifest／ASAR／fuses 相符 |
| ★ 安裝／密碼下載 | 可信 .81 已安裝；最新 vault／ledger 未變；Mac→Windows 完成 receipts、一般密碼 UI 登入／卡片及完整 authenticated HTTP streams／hash 均已驗 |
| ★ 原生同批原因定位 | 10 筆原始紀錄全部找回；每筆 9 個不同來源 Amazon 圖片網址、0 ERROR；仍 Accepted 10／Verified 0／unknown 0，沒有重送 |


## 固定交付來源與產物

PR #308 合併 runtime `8d92b87b56ea1f9cd683c6ec744d17969b0afbc8`，tree 與最終兩軸審查 candidate 完全相同。四條正式流程均為 main／push／attempt 1；不以本文件之後的 commit 作為 runtime。

| 流程 | Run ID | Artifact ID |
|---|---:|---:|
| ★ Validate | 35169619624 | — |
| ★ macOS | 35169619614 | 10476154283 |
| ★ Windows | 35169619726 | 10475714780 |
| ★ Pages | 35169619628 | 10476042339 |

| 產物 | Bytes | SHA-256 |
|---|---:|---|
| ★ macOS DMG | 246934050 | `d29c3851d2388045248ea664c5dd7146d0692dd62beffdc07d66f16db62dce39` |
| ★ Windows Setup | 102088829 | `10047f357a66d9dd34525fee74d9e60946ffba721b9127d94c63b187ecf07a6a` |
| ★ Mac ASAR | 21050937 | `4e5242c52a0a7bc2c6b812b3d1f79faec0f03fc23bfe1e9edca50fb004ff83bd` |

Pages entry 為 `index-D36oua6H.js`／`index-Buk3bokd.css`，價目表隨入口載入的檢查通過。兩平台仍為 unsigned development distribution／disabled update channel；Windows 靜態與 CI smoke 不等於真人 Windows Hello、SmartScreen 或 Authenticode 驗證。

## 安裝、原生回查與下載

2026-09-17 第一次備份後，使用者的 App 再次開啟並有新的健檢資料，安裝器在 ledger 比對停止，未 stage 或 swap。保留第一次備份及失敗門檻證據，再核對 native 為健檢結果頁、沒有編輯草稿或 active write，正常退出並備份最新資料到 `amz-api-backups/20260917-before-0181-latest`（0700）。可信 DMG 唯讀掛載／核對後完成 .80 → .81，舊 App 備份保留；新 App ASAR 相符，最新 vault／ledger bytes 均未變。首次啟動的 native AX 讀取曾逾時；重新取得視窗後已正常顯示 Amazon 連線及完整圖片工作頁，沒有用隱藏接口代替驗收。

同批 10 SKU／90 張已由正常 native「找回先前圖片更新」恢復。2026-09-17 09:34:30（Asia/Taipei）完成的同一次回查，逐筆展開均只有 URL mismatch：每筆位置符合 1／10、另外 9 個位置為不同來源的 Amazon media URL，未回報 ERROR，沒有身分／FBA／attributes blocker。空的第 10 格相符不能說成 1 張新圖片已確認。再按一次「重新讀取本批次進度」，時間前進至 09:35:46，第一列重新展開同樣原因；結果仍 Accepted 10／Verified 0／unknown 0。

這已定位本批不會自動變成 verified 的原因：回傳網址與送出網址不同。它不證明 Amazon 如何改寫，也不證明不同 URL 的影像內容相同；storefront 觀察、Amazon host、9 張或 0 ERROR 均不取代 strict canonical／durable 完成證據。未新增上傳、Preview、原生寫入批准或 PATCH；不以重送來取得驗收。頂部四區／返回與價目表的導覽程式未改，原生完整頁驗收沿用已完成的 .80 證據；本輪 .81 另已驗圖片入口。

Mac→Windows 下載卡依序取得完成 receipt。[AMZ.API 專用下載頁](https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads) 經一般既有下載密碼登入即可，不需 ChatGPT 登入；兩張 .81 卡片及顯示 hash 相符。另獨立的一般密碼 HTTP 驗證確認匿名 manifest／檔案 401、登入 200，兩份完整檔案 streams 的 size／SHA 均與可信 artifacts 相同。本輪沒有再點 browser 下載按鈕，也不宣稱 browser 落地檔案已驗。

本機證據根目錄：`/tmp/amz-api-v0181-verified/`，包含固定 source／CI／各平台及 Pages 證據、`local-code-review-verification.json`、初次安裝中止記錄、最新 backup／installation、`native-live-readback-verification.json`、兩份 portal completion receipts、`portal-ui-verification.json` 與 `portal-authenticated-http-download-verification.json`。不保留密碼、session 或 signed URL。
