# 0.1.73 入庫請求安全診斷交付帳本

Issue #273；[契約](../specs/2026-09-inbound-request-diagnostics.md)。完整效期目標 Issue #263 尚未結案。

## 實際基線與本次變更

- 可信 .72 已安裝，Amazon 原生連線正常；只執行過一次全 FBA 同步，保留庫存及銷速估算，但入庫效期以對應 HTTP 400／422 的固定訊息 partial。沒有重試或重新要求登入，亦沒有保存原始 Amazon 錯誤內容。
- .73 只對已收到的 modern 計畫／商品終態 400／422，產生固定操作、頁次、狀態、允許錯誤代碼及精確原因。讀取上限 128 KiB／2 秒；原始上游文字、識別值、網址與權杖不會公開或落檔。
- 不新增 Amazon 請求、不跳過計畫、不改來源完整度或行事曆規則；本版用於辨識下一次真實拒絕原因，尚不能宣稱已修復該原因。
- 沿用 PR #272／main `993a789966d9dbc9f068d853e3830984051dd633` 的八欄表格修正。該 Control Console Release 的證據另列於[表格帳本](2026-09-inventory-health-table-layout.md)。

## 程式驗證

- 初始診斷 HEAD `abd54da6207f90b845db66b1a16a6777563ef726` 在真實 adapter → expiry → coordinator → sync 先重現四個缺少診斷的 RED 案例；新增套件最後 56 案，完整檢查 323 files／3,942 tests、typecheck、build、樣式驗證通過，production audit 0。先前完整檢查也通過 3,941 tests，最後補入案例後重新全檢，並非失敗盲重試。
- Standards／Spec 對初始 HEAD 各 0 未解問題。重定基底至已合併表格 main 時無衝突；診斷 production、tests 與版本 bytes 保持不變。整合後 `VITEST_MAX_WORKERS=4 npm run check` 全部 323 files／3,942 tests、typecheck、build、樣式驗證通過，production audit 0、diff check 通過；final HEAD `06359ecfce410646f4e2d196451b9b47af553ae8` 的兩軸 review 各 0 open。
- 整合全檢最初在偵測到 14 個可用 CPU 的預設排程環境中，先後遇到未修改的 B2B durable-store 測試 5 秒逾時及 Ads fixture 觀察次數耗盡。兩案 test／owner 與 .72 相同，個別診斷分別 1,451 ms／249 ms 通過。改以四個 worker 執行全部原測試及原 timeout 後通過，沒有改 production、測試、runner config 或略過案例；並行資源競爭是符合證據的推論，不是原失敗時刻的效能量測。過程記錄在 `check-timeout-diagnosis.json`。
- 證據：`/tmp/amz-inbound-request-diagnostics-red.log`、`/tmp/amz-inbound-request-diagnostics-check-r2.log`；本次整合與發行證據根目錄為 `/tmp/amz-api-v0173-verified/`。

## 初次來源與排程修正

- PR #274 合併來源 `b64796da043592c6fd5b8d95930fcfbb6d29ae67` 的 PR／main Linux、Pages、Windows 成功，但 main Mac `34756689931` 兩次因不同既有測試 5 秒逾時失敗，沒有 Mac artifact，未做第三次不變重跑。該來源的 Windows artifact 及 Pages 證據只保留為歷史，未混入正式 .73 交付。
- Issue #275／PR #276 僅讓 Mac Validate 逐檔執行 Vitest，保留原全部測試／timeout／打包與安全 gate。本機 `VITEST_MAX_WORKERS=1 npm run check` 323 files／3,942 tests、build、typecheck、styles 通過，production audit 0；fixed HEAD `18e18b583a752b638609d7911064d42ae0f1d7f4` Standards／Spec 各 0 open。詳見[排程規格](../specs/2026-09-macos-validation-scheduling.md)。

## 最終 .73 交付來源

- 最終 release-code main：`bc0d2ba08baabe515e4ddf2cf9ba48c0a3c30e70`。本節後續 docs commit 不改此已驗安裝包来源。
- Validate `34758047986`、Mac `34758047987`、Pages `34758067836`、Windows `34758069010` 全部成功；Mac／Windows 均 attempt 1。Mac 保留 3,942 項總數，其中 3,941 passed／1 個既有 skipped。Pages 及 Windows 因 paths 未觸發，各對 main 明確 dispatch 一次。
- 全新證據根目錄 `/tmp/amz-api-v0173-r2-verified/`：source-main proof、各平台 CI、Pages 12 檔 bytes／hash、Mac universal／ASAR／簽章完整性／fuses、Windows ASAR／Hello addon／fuses 均已核對；沒有沿用 b647 的成功證據或產物。

| 可信檔案 | GitHub artifact | Bytes | SHA-256 | 核對 |
| --- | --- | ---: | --- | --- |
| Mac DMG | 10317838230 | 246884792 | `71bbd45e2cea58fe485dd391f8007c2708b9fd4e8a800e528150b3d8dfb0383c` | ★ 通過 |
| Windows Setup.exe | 10317758278 | 102059589 | `abdb34071a4f4f35bc0d50a6e5805607dae737538ace2ec13ffc4daa409298a1` | ★ 通過 |

- Mac→Windows 下載卡已依序上傳，兩份 server complete manifest receipt 都與可信檔案相同。管理憑據沿用既有 Keychain 直接輸入上傳程序，未進 argv／環境變數／檔案／logs／聊天；未用於員工登入。
- 保留已登入的員工下載頁、不 reload；登記 download event 後只按一次一般 Mac 下載鈕，頁面回報「登入已過期，請重新輸入密碼」，沒有 download event。兩張卡上傳已完成，但本版員工實際下載 bytes 尚待重新登入後核對，不能由 complete receipt 推定完成。

## 安裝與原生驗收

- 原生 .72 正常 Reload 已確認八欄表格及右側核對按鈕清楚可見，原人工公告 4 項、門檻 8 保留；未重跑 .72 同步。證據 `/tmp/amz-api-health-table-20260913/native-table-verification.json`。
- 正常退出 .72 後完成 0700 userData 備份，r2 僅重新唯讀比較並沿用同一備份，沒有重建或覆寫。可信 .73 DMG 唯讀掛載後已安裝 `/Applications/AMZ.API.app`；universal、deep-strict codesign、update channel disabled 均通過，ASAR `5e3838fa3fdfebb26c88e801d7b599b446bd5b31229471d07fb6079eb967e0d3` 與可信 ZIP 相同。保留 `.72` App 備份，換版前後 vault／ledger bytes 未變。見 `installation-verification.json`。
- 安裝後 CUA 開啟原生程式時，再次回報 Mac 已鎖定且自動解鎖失敗；尚無 .73 原生 Amazon 連線或效期同步結果。下載页另已過期，已集中請使用者解鎖並登入，不重點下載、不繞過鎖定、不重跑 .72。本次是新鎖定阻礙的第 1 個 goal turn。
- 使用者完成後只執行一次 .73 效期同步，依實際固定原因接續修正。仍須完成可存取申報效期與來源、同 SKU 多日期（若存在）、本機讀回、全庫存估算與未知批次區別、人工公布欄及行事曆保留。完整目標 #263 未結案；不送 Amazon mutation 或以合成資料偽造已確認批次。已驗圖片、Vine、偏好、價目表、變體及門檻不重做。
