# 0.1.68 庫齡完整數值選擇

Issue [#261](https://github.com/jspusa/AMZ.API/issues/261)，[規格](../specs/2026-09-health-age-values.md)。Base `ad04eaa33d07597112dcee034c515f09a7d2ded0`；[PR #262](https://github.com/jspusa/AMZ.API/pull/262) 已合併至 release source `7b202675a72fcc2cbe38dc3bb371f9664952f5dc`，與最終 reviewed head `cc8932ae1be753d7e6f8bc35c427c5fb97d9bb5a` 的 tree 相同。四條 exact-main CI、Pages、兩平台可信產物與 Mac→Windows 下載卡上傳均已核對；0.1.68 已完成正常備份與安裝；原生首頁已顯示 US／Amazon 已連線，圖片門檻跨重開保存已驗；全 FBA 效期與銷速首次同步仍以「0–30 天缺值」失敗結束，未重試；原因診斷與員工實際下載仍待接續。

## 本版分層證據

| 範圍 | 狀態 |
| --- | --- |
| ★ Source 與公開回歸 | 近期與 181–365 替代組按整份資料的完整數量選擇，19 項新增回歸；5 files／84 tests、typecheck、diff check 通過 |
| ★ 全案 check／audit／兩軸 review | `5dcdd65b1c36f6cf57c58afc18560548c0af583a` 全案 check 通過 323 files／3,813 tests、typecheck 與 build，production audit 0、diff check 通過；累計至 `cc8932ae1be753d7e6f8bc35c427c5fb97d9bb5a` 的 Standards／Spec 均 0 open，後續僅文件變更 |
| ★ 同來源 Validate／Pages | main/push [Validate 34734159587](https://github.com/jspusa/AMZ.API/actions/runs/34734159587) 與 [Pages 34734159987](https://github.com/jspusa/AMZ.API/actions/runs/34734159987) 成功；Pages artifact `10310720561` 的 HTML 及全部 11 個 JS／CSS 與線上 bytes 一致 |
| ★ Windows 可信產物 | 同來源 main/push [34734159637](https://github.com/jspusa/AMZ.API/actions/runs/34734159637) attempt 1 成功，artifact `10310825563` 已下載，archive／清單／Installer／ZIP／ASAR／addon／8 項 fuses 均核對 |
| ★ Mac 可信產物 | 同來源 main/push [34734159943](https://github.com/jspusa/AMZ.API/actions/runs/34734159943) attempt 1 成功，artifact `10310880537`；archive／清單／DMG／ZIP／universal ASAR／deep strict ad-hoc codesign／兩架構各 8 項 fuses 均通過，DMG 唯讀掛載與 ZIP 的 ASAR 一致 |
| ★ 0.1.68 安裝與原生首頁 | 正常退出 .67、完成 0700 userData 備份後安裝可信 .68 universal；ASAR 與產物一致，vault／ledger 未變，.67 App 保留。原生截圖及後續完整輔助使用文字已顯示首頁／US／Amazon 已連線 |
| ★ 圖片門檻跨重開保存 | 安裝前選定 10，正常退出、換版及重開後仍為 10，已恢復原本 8 |
| ☆ 全 FBA 效期與銷速結果 | .68 首次同步終態仍為「0–30 天缺值」失敗；只啟動 1 次，未重試，尚無可驗收的完整結果，後續診斷進行中 |
| ★ 本版下載卡／☆ 員工實際下載 | 依 Mac→Windows 完成兩張既有卡的 0.1.68 上傳，兩個 complete receipts 的 bytes／hash 與可信產物相符；員工頁仍為登入畫面，沒有本版員工下載 bytes 證據 |

## 兩平台產物

| 產物 | Bytes | SHA-256 |
| --- | ---: | --- |
| ★ Windows GitHub archive | 245,431,722 | `2d216f1a12271990d0e2145b295a428a8c90a88b869f1b6bac404272d95e84ad` |
| ★ Mac universal DMG | 246,636,990 | `3c5dc505f9e0e2fc46cdb38d5bccc7edbf34c6b7c981f025180933e248140967` |
| ★ Mac universal ZIP | 222,187,918 | `8e37008f84634c8b83c8afe0c5df59722a193d52944dcdeec3b85556a64303ed` |
| ★ Windows x64 Installer | 102,059,403 | `b9dfbfc10ca36e275304b3ced0f74263cf559a856e9e23ccb917bfabbca55de9` |
| ★ Windows x64 ZIP | 143,371,623 | `8559c502ab45bf6094961d556fe3ce8ab260ee352b700baf458bb49f61d77e30` |

Mac ASAR `24f50a9225d5d79888b7bc6da66de029fcff793c01d389878d8744efff3842b3`；已驗 x86_64／arm64、版本 0.1.68、disabled update channel。可信 DMG 已唯讀掛載並完成安裝，安裝證據在 `installation-verification.json` 與 `user-data-backup-verification.json`；後續原生截圖及完整輔助使用文字已證明首頁／US／Amazon 已連線；先前讀取逾時不再列為啟動授權待辦。圖片服務的真人 Touch ID 與完整效期結果仍須分別驗收。

Windows ASAR `9dcdbce6390a23f251f798454d18b98d865638ed9be18571f746e961f0b025b2`；package 0.1.68、update channel disabled，packed manifest 與唯一 unpacked AMD64 N-API addon 的 bytes／hash 相符。CI 的打包與 Bridge smoke、下載後靜態檢查均通過；未在這台 Mac 執行 Windows 程式，不代表真人 Windows Hello、正式簽章或 live Amazon。

本版證據集中於 `/tmp/amz-api-v0168-verified/`：`source-merge.json`、`local-validation.json`、`review.json`、`pages/pages-byte-verification.json`，以及 `windows/ci-verification.json`、`windows/verification-result.json`、`windows/fuses-verification.json`。Mac 證據在 `macos/ci-verification.json`、`verification.json`、`zip-bundle-verification.json`、`zip-bundle-fuses-verification.json`、`mounted-dmg-verification.json`；兩卡上傳見 `portal-upload-verification.json`，啟動及偏好驗收見 `native-acceptance-20260913.json`；效期的後續終態見下段。安裝與員工實際下載不能沿用 0.1.67 的完成狀態。

## 0.1.68 原生進度

2026-09-13 03:22 UTC 的 `native-acceptance-20260913.json` 記錄首頁／US／Amazon 已連線，以及圖片門檻 10 跨正常退出、安裝、重開仍保存並恢復 8；其中 health 為啟動當時的 running 快照。後續原生畫面已觀察同一次同步以「0–30 天缺值」失敗結束，沒有重試或送出 Amazon mutation。後續確認效期同步仍呼叫嚴格庫齡 reader，缺少任何可用的完整替代組就會拒絕；Issue #263 分離核心讀取入口。沒有取得 live raw row，不能把本版 source／fixture 成功當作完整原生結果。啟動畫面讀取逾時的歷史，不作仍有系統授權提示的證據。

## 0.1.67 本次原生觀察

正常退出舊版後備份 userData，保留 0.1.66 App，安裝可信 0.1.67 universal；ASAR 與 artifact 一致，vault／ledger bytes 保留。啟動曾兩次讀取逾時，後續已看到首頁與 Amazon 已連線、US、預設圖片門檻 8。

免原表價目表第一次執行完成 285 個 FBA 商品，283 筆有一般售價、2 筆未回報。實際遇到 Listing 身分不完整列且只標記該列缺值，整批仍完成；勾選嵌入主圖，經原生 Save 將 `AMZ_US_Price_List.xlsx` 保存至下載項目。檔案 7,033,332 bytes，SHA-256 `4a5c4f9c278d9a6327d99880b1f54f3fc2966d5d9c964f20e17f3fca6c2176d4`；fresh／stable 檢查通過，唯讀內容核對通過 285×9、283 筆 numeric 售價／2 未回報、兩分頁、203 份去重圖片 media 對應 284 個有效 B 欄 anchors，0 公式錯誤／外部關聯。文字及價格版面、缺值列與說明頁預覽通過；Artifact Tool 的整表 PNG 不畫匯入圖片像素，故另核對原圖 bytes、關聯及位置，不宣稱原生 Excel 圖像呈現已驗。

全 FBA 效期與銷速的首次同步則以「0–30 天」缺值結束，未重試。本版兩個公開 seam 回歸重現相同機制，但沒有 live raw row，不能宣稱 synthetic fixture 就是失敗原列。

圖片門檻下拉原生顯示 1–10，初始 8，改選 10 後單次掃描顯示 284 可健檢 FBA、283 少於 10、1 讀取未完成；逐列文案呈現正確差額。結果經原生 Save 匯出，返回首頁仍為 10，之後已恢復原本 8。匯出檔 51,205 bytes、SHA-256 `9af332b0016863b7d92af3dc36942fa0c435dd252c93d047204f958d2a927951`；fresh／stable、284 列與門檻 10、283 不足／1 未完成、差額及未知數量空白、說明頁均通過。變體健檢單次掃描在使用者解鎖後已觀察終態：285 FBA／74 確定未綁／1 讀取未完成。開啟變體的操作遇使用者切換畫面，該次導覽因使用者切換而中止；0.1.68 另已完成一次健檢 → 商品工作台完整讀取 → 返回相同 285／74／1 結果，不送 Preview 或 mutation。

證據在 `/tmp/amz-api-v0167-verified/` 的 `installation-verification.json`、`user-data-backup-verification.json`、`native-acceptance-20260913.json` 及實體匯出檔證據；沒有送 Amazon Preview、原生寫入批准或 mutation。

## 尚未完成的原始範圍

完整全 FBA 效期／銷速結果、低庫齡商品、人工效期／促銷保留與只收已確認正清售缺口的行事曆；價目表若需確認原生 Excel 的圖片呈現，仍需實機開啟；圖片登入加密保存及後續 Touch ID；員工登入後實際下載 bytes。0.1.65 已驗的偏好重開、Vine 11 筆進行中及九張圖片直接準備證據繼續有效。本版修正不縮小完整目標。

0.1.68 後續原生驗收已證明健檢 → 變體工作台完整讀取 → 返回原清單，數字仍為 285 FBA／74 未綁／1 未完成。圖片工作台的後續入口操作再次遇 Mac 鎖定，未觀察圖片授權狀態；不由鎖定推定登入或更新結果。全 FBA 效期首次失敗已接續 [Issue #263](https://github.com/jspusa/AMZ.API/issues/263) 與 [0.1.69 規格](../specs/2026-09-inventory-health-core-report.md)。
