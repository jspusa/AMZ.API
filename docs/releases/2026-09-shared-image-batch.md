# 0.1.82 共用圖片批次更新交付紀錄

需求：[Issue #314](https://github.com/jspusa/AMZ.API/issues/314)。規格：[單張、多張與共用圖片](../specs/2026-09-shared-image-batch.md)。開工基準 `d380744ad45187680f0887e91d62d00fe74d88df`，獨立分支 `codex/shared-image-batch-20260917`；原工作目錄與未追蹤檔保留。

## 功能與驗證範圍

新增 loose-image intake、逐圖 exact SKU 目標／位置、唯讀同 family FBA 候選，以及 main-owned selected-slots intent。第 9 圖可套用數個 SKU，其他位置由 canonical 原值保留；既有資料夾完整替換保持原契約。舊 Bridge 只禁用新模式，不降級或誤刪圖片。所有實作驗證使用 fake adapters／fixture，不送真實 Amazon 更新、不修改提供的 OneDrive 原圖。

公開 seam 已先重現缺少 loose-image 入口及 sparse selected-slot 不受支援，再完成對應行為。聚焦驗證包含每個 exact SKU 各自準備、不同圖位、衝突與超限、family 部分結果／晚到回應、編輯使預檢失效、原圖漂移、來源到期、模式批准、single PATCH 與 GET-only recovery。Spec review 發現的多圖不同 SKU 集合測試缺口已補齊：09 圖套用 A／B、08 圖套用 B／C，驗證四筆準備、三筆稀疏預檢及原圖保留。

最終候選 `61099a98aefb54eed38a6d926fc6d476cc9c9daf` 相對整合後基準 `d887fc56cf9c09f7bab8197c1badd9da34c20759`，`VITEST_MAX_WORKERS=4 npm run check` 通過 339 files／4,428 tests、型別、建置與樣式檢查；production audit 0，`git diff --check` 通過。Standards／Spec 最終各 0 open findings，原測試覆蓋 P2 已關閉。

production renderer 的選取／預檢畫面以 1440／390 寬度、明／暗模式核對共 8 組，檔名第 9 圖、family 勾選、手動 SKU、三 SKU 預檢及保留其他九個位置均通過，無頁面或 console error。畫面 source `e55276bb910daa26aba4238e39f73baf12ae387b` 至最終候選只有測試變更；這是 fake adapters 驗證，沒有真實 Amazon traffic。

## 分層狀態

[PR #315](https://github.com/jspusa/AMZ.API/pull/315) 已合併，release-code 固定為 `f7ac19c4bd38b12a85dbc7624a8b5a8ce412ff6c`，與上述最終候選的 tree 相同（`743f6adb3abdfb1c492d8cc6dccbd1e2f8eb0d88`）。以下四條工作流均為這個 exact source 的 `main`／`push`、attempt 1，成功且未混用 PR 或舊版產物。

| 層級 | 正式 run | artifact ID | 結果 |
|---|---|---|---|
| Validate | [35194968022](https://github.com/jspusa/AMZ.API/actions/runs/35194968022) | — | ★ 成功 |
| macOS universal | [35194967994](https://github.com/jspusa/AMZ.API/actions/runs/35194967994) | `10485328883` | ★ 成功 |
| Windows x64 | [35194968076](https://github.com/jspusa/AMZ.API/actions/runs/35194968076) | `10485717585` | ★ 成功 |
| Pages | [35194967972](https://github.com/jspusa/AMZ.API/actions/runs/35194967972) | `10484799027` | ★ 成功 |

Pages artifact 的 `index.html` 與全部 10 個 JS／CSS，合計 11 檔，均已逐一核對線上完整 bytes／SHA-256 相同。兩平台 GitHub archive 的大小／digest、`SHA256SUMS.txt`、package 0.1.82 與 `amzApiUpdateChannel: disabled` 均已驗；macOS universal／ad-hoc deep strict codesign／兩架構 fuses，Windows AMD64／Hello addon 的 ASAR 邊界及 N-API／fuses 亦通過。本機 Windows 產物核對為靜態檢查，未在這台 Mac 執行 EXE。

| 可信產物 | bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.82-universal.dmg` | 246919203 | `7e225d4cdb7d0430cd283ba03e9bc42413c969f0d96a0f78f25714283d8cd936` |
| ★ `AMZ.API-0.1.82-universal.zip` | 222228253 | `00345401af8a4a95942feeb2d504376971d639cecdf0d9db6efcc4672900774e` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102094053 | `89411f2534e711b4a2d0211f9c1d9247572b5674e2ff595cc6f1a690511384aa` |
| ★ `AMZ.API-Notebook-Key-Windows-x64.zip` | 143410774 | `699191fcde65ffe7e99c6b4776dde68f13a8f312e70118314cf9636daf1565e3` |

## 安裝與原生驗收

退出前已觀察到完成的文案健檢（284 個商品、回查時間 2026/9/17 15:02:51），未見編輯草稿或進行中的提交；以原生 Cmd+Q 正常退出後確認 process 為零。保留 `/Applications/AMZ.API-v0.1.81-backup-before-0182-20260917.app`，並以 0700 備份至 `/Users/jasper/Library/Application Support/amz-api-backups/20260917-before-0182`。可信 DMG 唯讀掛載後完成 0.1.81 → 0.1.82 安裝，換版期間 vault／ledger bytes 一致，DMG 已卸載。

安裝位置 `/Applications/AMZ.API.app` 的 ASAR 為 `ee5c322d1c8276fd9e98db780826df0f95acb6fdf14492a7552b319dad7029e2`，符合可信 artifact；舊 .81 ASAR `4e5242c52a0a7bc2c6b812b3d1f79faec0f03fc23bfe1e9edca50fb004ff83bd` 保留。新 App 啟動後觀察到 3 個相關 process，但 CUA `getApp` 與 screenshot 逾時，尚無新版首頁、Amazon 連線或共用圖原生操作證據。另觀察到 SecurityAgent process；CUA 因安全限制拒絕存取 `com.apple.SecurityAgent`，未繞過或代填憑證。不能由此推定提示內容、Mac 鎖定或 Amazon 登入失敗；原生畫面狀態詢問仍待使用者回覆。

## 下載入口與待完成項目

已依 Mac → Windows 更新[受保護下載入口](https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads)的兩張卡；兩份 server completion receipts 的版本 0.1.82、檔名、大小及 SHA-256 均符合上表可信產物。這證明上傳完成回應，尚未證明一般使用者已成功登入或下載。

下載頁目前顯示一般密碼登入表單，分頁已標記 handoff，登入請求仍待使用者完成。HTTP verifier 的本機 preflight 已通過，network／credential reads 均為 0；本輪尚未有 authenticated HTTP 完整 bytes／hash、browser download events 或新本機落地下載檔證據。不要把上傳 receipt、既有 .81 下載證據或按鈕狀態當成本輪下載驗收；接續原生與下載頁的既有詢問，不重裝或重複要求登入。

## 本機證據索引

根目錄 `/tmp/amz-api-v0182-verified`：`local-code-review-verification.json`、`release-config.json`、`source-main-verification.json`；`macos/` 與 `windows/` 各自的 CI／產物／fuses proofs；`pages/pages-byte-verification.json`；`user-data-backup-verification.json`、`installation-verification.json`、`native-installation-status.json`；`portal-upload-macos-dmg-receipt.json`、`portal-upload-windows-installer-receipt.json`、`portal-ui-status.json`。畫面證據為 `/tmp/amz-api-v0182-visual/results.json`。最終 identity 已固定，後續核對保留這份 config 與原始證據，不用文件 commit 取代 runtime SHA。

保留既有 0.1.81 的 pending／accepted ledger；不得以新版驗收重送歷史圖片更新。沒有 live Amazon mutation、真人 Windows Hello、正式簽章或公開自動更新 feed 的新增證據。
