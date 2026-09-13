# 0.1.68 庫齡完整數值選擇

Issue [#261](https://github.com/jspusa/AMZ.API/issues/261)，[規格](../specs/2026-09-health-age-values.md)。Base `ad04eaa33d07597112dcee034c515f09a7d2ded0`。

## 本版分層證據

| 範圍 | 狀態 |
| --- | --- |
| ★ Source 與公開回歸 | 近期與 181–365 替代組按整份資料的完整數量選擇，19 項新增回歸；5 files／84 tests、typecheck、diff check 通過 |
| ★ 全案 check／audit／☆ 兩軸 review | `5dcdd65b1c36f6cf57c58afc18560548c0af583a` 的全案 check 通過 323 files／3,813 tests、typecheck 與 build；production audit 0、diff check 通過。Spec review 0 open，Standards 接續核對 |
| ☆ 同來源 CI／Pages／兩平台 artifact | 待發布與核對 |
| ☆ 0.1.68 安裝／原生效期結果 | 待可信新版產物與安裝；目前實際安裝 0.1.67 |
| ☆ 本版下載卡／員工實際下載 | 待本版發布；員工登入仍待使用者完成 |

## 0.1.67 本次原生觀察

正常退出舊版後備份 userData，保留 0.1.66 App，安裝可信 0.1.67 universal；ASAR 與 artifact 一致，vault／ledger bytes 保留。啟動曾兩次讀取逾時，後續已看到首頁與 Amazon 已連線、US、預設圖片門檻 8。

免原表價目表第一次執行完成 285 個 FBA 商品，283 筆有一般售價、2 筆未回報。實際遇到 Listing 身分不完整列且只標記該列缺值，整批仍完成；勾選嵌入主圖，經原生 Save 將 `AMZ_US_Price_List.xlsx` 保存至下載項目。檔案 7,033,332 bytes，SHA-256 `4a5c4f9c278d9a6327d99880b1f54f3fc2966d5d9c964f20e17f3fca6c2176d4`；fresh／stable 檢查通過，唯讀內容核對通過 285×9、283 筆 numeric 售價／2 未回報、兩分頁、203 份去重圖片 media 對應 284 個有效 B 欄 anchors，0 公式錯誤／外部關聯。文字及價格版面、缺值列與說明頁預覽通過；Artifact Tool 的整表 PNG 不畫匯入圖片像素，故另核對原圖 bytes、關聯及位置，不宣稱原生 Excel 圖像呈現已驗。

全 FBA 效期與銷速的首次同步則以「0–30 天」缺值結束，未重試。本版兩個公開 seam 回歸重現相同機制，但沒有 live raw row，不能宣稱 synthetic fixture 就是失敗原列。

圖片門檻下拉原生顯示 1–10，初始 8，改選 10 後單次掃描顯示 284 可健檢 FBA、283 少於 10、1 讀取未完成；逐列文案呈現正確差額。結果經原生 Save 匯出，返回首頁仍為 10，之後已恢復原本 8。匯出檔 51,205 bytes、SHA-256 `9af332b0016863b7d92af3dc36942fa0c435dd252c93d047204f958d2a927951`；fresh／stable、284 列與門檻 10、283 不足／1 未完成、差額及未知數量空白、說明頁均通過。變體健檢已啟動一次，最新讀畫面時 Mac 又鎖定，尚未觀察終態，不能從鎖定推定工作結果或重新送出。

證據在 `/tmp/amz-api-v0167-verified/` 的 `installation-verification.json`、`user-data-backup-verification.json`、`native-acceptance-20260913.json` 及實體匯出檔證據；沒有送 Amazon Preview、原生寫入批准或 mutation。

## 尚未完成的原始範圍

完整全 FBA 效期／銷速結果、低庫齡商品、人工效期／促銷保留與只收已確認正清售缺口的行事曆；價目表若需確認原生 Excel 的圖片呈現，仍需實機開啟；健檢→變體並返回；圖片門檻在 App 重開後的保存；圖片登入加密保存及後續 Touch ID；員工登入後實際下載 bytes。0.1.65 已驗的偏好重開、Vine 11 筆進行中及九張圖片直接準備證據繼續有效。本版修正不縮小完整目標。
