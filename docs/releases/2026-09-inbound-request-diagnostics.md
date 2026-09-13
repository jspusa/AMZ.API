# 0.1.73 入庫請求安全診斷交付帳本

Issue #273；[契約](../specs/2026-09-inbound-request-diagnostics.md)。完整效期目標 Issue #263 尚未結案。

## 實際基線與本次變更

- 可信 .72 已安裝，Amazon 原生連線正常；只執行過一次全 FBA 同步，保留庫存及銷速估算，但入庫效期以對應 HTTP 400／422 的固定訊息 partial。沒有重試或重新要求登入，亦沒有保存原始 Amazon 錯誤內容。
- .73 只對已收到的 modern 計畫／商品終態 400／422，產生固定操作、頁次、狀態、允許錯誤代碼及精確原因。讀取上限 128 KiB／2 秒；原始上游文字、識別值、網址與權杖不會公開或落檔。
- 不新增 Amazon 請求、不跳過計畫、不改來源完整度或行事曆規則；本版用於辨識下一次真實拒絕原因，尚不能宣稱已修復該原因。
- 沿用 PR #272／main `993a789966d9dbc9f068d853e3830984051dd633` 的八欄表格修正。該 Control Console Release 的證據另列於[表格帳本](2026-09-inventory-health-table-layout.md)。

## 程式驗證

- 初始診斷 HEAD `abd54da6207f90b845db66b1a16a6777563ef726` 在真實 adapter → expiry → coordinator → sync 先重現四個缺少診斷的 RED 案例；新增套件最後 56 案，完整檢查 323 files／3,942 tests、typecheck、build、樣式驗證通過，production audit 0。先前完整檢查也通過 3,941 tests，最後補入案例後重新全檢，並非失敗盲重試。
- Standards／Spec 對初始 HEAD 各 0 未解問題。重定基底至已合併表格 main 時無衝突；診斷 production、tests 與版本 bytes 保持不變。整合後 `VITEST_MAX_WORKERS=4 npm run check` 全部 323 files／3,942 tests、typecheck、build、樣式驗證通過，production audit 0、diff check 通過；final HEAD 差異確認仍待完成。
- 整合全檢最初在預設 14 個可用 worker 環境中，先後遇到未修改的 B2B durable-store 測試 5 秒逾時及 Ads fixture 觀察次數耗盡。兩案 test／owner 與 .72 相同，個別診斷分別 1,451 ms／249 ms 通過。改以四個 worker 執行全部原測試及原 timeout 後通過，沒有改 production、測試、runner config 或略過案例；並行資源競爭是符合證據的推論，不是原失敗時刻的效能量測。過程記錄在 `check-timeout-diagnosis.json`。
- 證據：`/tmp/amz-inbound-request-diagnostics-red.log`、`/tmp/amz-inbound-request-diagnostics-check-r2.log`；本次整合與發行證據根目錄為 `/tmp/amz-api-v0173-verified/`。

## 後續交付與實機

- final main、四條 exact source CI、Pages、Mac／Windows artifact、受保護下載卡、登入後實際下載及原生 .73 安裝尚待完成；prepared helpers 不是發行成功證據。
- 原生 .72 同步已終態停止。後續核對畫面時，CUA 又回報 Mac 鎖定且無法自動解鎖；這是使用者解鎖後新發生的阻礙。先完成可獨立進行的發布與驗證，至需要原生操作時才請使用者解鎖，不繞過鎖定控制。
- 安裝後只執行一次 .73 效期同步；依實際固定原因接續修正。仍須完成可存取申報效期與來源、同 SKU 多日期（若存在）、本機讀回、全庫存估算與未知批次區別、人工公布欄及行事曆保留。不得以合成資料偽造已確認批次或送 Amazon mutation 作為驗收。
