# 0.1.60 單站既有變體主題保留

日期：2026-09-08。Issue #225／[spec](../specs/2026-09-08-single-market-theme-preservation.md)。固定基準 `73ca77ec7b7ce6aab80fd5950949122a9b908d8a`，保留 PR #217、#222、#224。

PR #227 head `23aaf88e8d5fea0a7d12651e7b06f714d50e70d0` 的 Validate `34209975073` 與 Windows `34209975067` 均成功，合併 release-code SHA 為 `ca966e0794c0f476ff639540e2909c7b9e27821b`。期間 PR #226 的首頁調整先合併，因此 PR 與 main tree 不同；窄整合 review 確認本輪 main/API、變體、價目表與專用樣式未變，13 個整合差異皆來自 PR #226，兩項任務 handoff 都保留，0 findings。exact main 本機 check 再次通過 290 files／3,090 tests、typecheck／build／stylesheet parity，audit 0；記錄 `/tmp/amz-api-v0160-main-check.log`。

exact main 的 Validate `34210615485`、Pages `34210615303` 均成功，唯一 Pages artifact `10049731369`。入口與全部 9 個 JS／CSS 的線上 raw bytes 完全等於該 artifact，price／variation lazy modules 均有入口引用。`index-Bsr0ARQ1.css` 的 canonical ordered-rule fingerprint 為 `c7ab6333f66563f1fa81a60a6841f6347f7cc849184570e66dcb9f3ce2b595e0`；原始檔 SHA-256 為 `3a695bdf5cc15f4d3e983d8fef0b582cfee3a288cc53e0058667085dd1ea2a4a`，本機 build／artifact／live 相同，不能混稱兩種 digest。證據在 `/tmp/amz-api-v0160-verified/pages/pages-byte-verification.json` 與 `stylesheet-byte-evidence.json`。

Mac run `34210615416` attempt 1 在首頁 audit interaction 的 5,000 ms timeout 失敗，3,088 passed／1 failed／1 skipped，沒有 assertion mismatch。同一 source 的本機 full 此 test 344 ms、focused 469 ms、Ubuntu main 815 ms 均通過。此 test 未變，但 PR #226 修改 Dashboard 呈現，不能聲稱 Dashboard 全無變更。保留 failed log 與 diagnosis 後執行唯一一次 failed-job rerun，未改 code 或 timeout；runner timing/load 是假設，尚未證實。attempt 2 與後續可信 artifact 另行記錄。

Windows exact main run `34210615608` attempt 1 全部通過，artifact `10049840636`，GitHub archive 245,195,478 bytes／SHA-256 `d41d3767ef2799396e15f3bbde190253c472a462791928a7416ce509b634d3dd`。CI 290 files／3,086 passed／4 skipped，win-unpacked、ZIP 與已安裝 NSIS 的 Bridge／addon smoke 全通過。靜態驗證確認 AMD64 PE、Windows Hello N-API、native manifest packed／addon unpacked 邊界及版本 `0.1.60`／update channel `disabled`；不代表使用者 Windows 裝置或真人 Hello。Setup 為 101,958,432 bytes／SHA-256 `5b067eb76058bd25552176920872062ec8f54f5928adbb2fde9744ee71d248a5`，ZIP 為 143,236,350 bytes／`51c8e74fb66c6243a762a2a69e0a33fec872e65581e44ae3e9e5611ab27fc14b`。證據在 `/tmp/amz-api-v0160-verified/windows/verification-result.json`、`ci-verification.json` 與 `ci-log-verification.json`。Windows portal upload 已完成；登入後實際下載尚未驗證。

Mac 同一 run attempt 2 全部成功，artifact `10050119615`。四路 bounded range 下載先以 GitHub archive bytes／SHA 核對，再交原 verifier 重新核對 archive／manifest：469,044,051 bytes／SHA-256 `2d11a5905b10546f5c0b960da497e3b4107bbde0054b6418b4b66e00d7056474`。DMG 為 246,999,475 bytes／`7edd8bbd8c865cd2f0bbfa917aa5f22c0eac156a3098bb65288d404529b422fa`，ZIP 為 222,043,932 bytes／`0884bf33fcd9f97001c33e54ebc2477e87c483c37502faa46e3de6870deb9087`。可信產物與 exact CI steps 證據在 `/tmp/amz-api-v0160-verified/macos/verification.json`、`ci-verification.json`。

使用者 Mac 的 `/Applications/AMZ.API.app` 已替換為此 0.1.60 universal，deep strict codesign／ASAR 版本與 disabled channel 通過，ASAR SHA-256 `f841020dfa03c2cc4cc1084dd21e8f4fa32e13afd4c1a79bf89ced8c1429bc78`。0.1.59 備份保留為 `/Applications/AMZ.API-v0.1.59-backup-20260908.app`，0700 userData 備份為 `20260908-before-0160`，vault bytes 未變。首次關閉操作未完成時 backup helper 正確停止、未建立備份；重新取得 UI 狀態後正常關閉才備份與安裝。首次啟動工具 timeout 後再次讀取已顯示新版首頁與 Amazon 已連線，沒有要求新權限。只讀 DMG 已退出，安裝證據為 `/tmp/amz-api-v0160-verified/installation-verification.json`。Windows→Mac 兩份 portal upload 均已依序完成，登入後實際下載驗證仍分開待完成。

0.1.60 實機重新讀取 `TPZ01AM-4` 與 `AF Turkey Tedon_Small`（FBA 1／18、都完整），preparation 已成功，`item_shape= Pretzel`、`size=4 Count (Pack of 1)` 均顯示保留既有值，畫面可執行預檢。實際 Amazon Validation Preview 不再遭本站 theme 判斷阻擋，改回報缺 Contains Liquid Contents 商品資料；表單未帶出輸入欄而仍顯示資料已齊。這是使用者原始漏欄問題，已另建 Issue #228／[spec](../specs/2026-09-08-variation-preview-required-fields.md) 繼續修正；未取得 raw issue metadata，也沒有正式 Amazon mutation。有限摘要 `/tmp/amz-api-v0160-verified/live/tpz-live-preview.json`，不得把到達實際 Preview 說成 Preview 已 VALID。

0.1.59 已在使用者 Mac 安裝並連線，實際解決 `1MGRD015A0` 清單準備入口的錯誤。原始 `TPZ01AM-4` 與目標 `AF Turkey Tedon_Small` 都完整讀取後，仍在準備階段收到 variation_theme 站點條件不明；當時尚未執行 Validation Preview，也沒有 Amazon mutation。錯誤無法區分 selector 真正缺席與 malformed，不能從畫面推定私有原始資料的形狀。

官方範例允許 theme 沒有站點欄位，但現在 Listings GET 也支援多站。因此本次只在實際完整單站讀取、exact SKU 與原 attributes 物件都有 main-only provenance 時，容許保留完全缺席 selector 的唯一 matching theme。沒有補寫 selector，也不送 theme PATCH；malformed、foreign、mixed、duplicate、關係殘留與證據漂移仍停止。既有 native confirmation、durable ledger、unknown／no-blind-retry 與 canonical readback 保持。

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Production 重現與聚焦 regression | ★ 通過 | omitted-selector public seam RED→GREEN；8 files／173 tests，含偽造與複製 scope、fallback、selector 雙向漂移、native 前後及 readback unknown／最多一個 PATCH |
| 最終本機全庫檢查 | ★ 通過 | `npm run check`：290 files／3,088 tests、typecheck、build、stylesheet parity；`npm audit --omit=dev`：0 vulnerabilities；本機記錄 `/tmp/amz-api-v0160-check.log` |
| Spec review | ★ 通過 | 對固定基準與凍結 code/test diff，0 actionable findings |
| Standards review | ★ 通過 | 同一固定基準與凍結 production/test diff，0 actionable findings；核對 renderer/main 邊界、原資料綁定及既有安全契約 |
| 最終 PR／main | ★ 已合併／完整 main 本機通過 | PR #227 與 exact release-code 如上，保留並行 PR #226，main 290 files／3,090 tests；不同 tree 已另外整合核對 |
| 最終 Pages | ★ 實際 bytes 通過 | exact main 成功 run／artifact 的入口與全部 9 assets 均與線上相同 |
| 最終 Windows artifact | ★ 全部核對通過 | 同一 release-code SHA 的 attempt 1／artifact、Setup／ZIP bytes與hash、版本及原生 addon 邊界如上；portal upload 已完成 |
| 最終 Mac artifact | ★ 全部核對通過 | 同一 release-code SHA 的 attempt 2／artifact，archive／manifest／DMG／ZIP bytes與hash皆相符 |
| Mac 安裝／啟動 | ★ 通過 | 已安裝 0.1.60 universal、成功開啟並連線；0.1.59 備份、0700 userData 備份與 encrypted vault bytes 保留 |
| 受保護下載入口 | ★ 兩份上傳完成；☆ 登入後下載待驗 | Windows→Mac 依序上傳 0.1.60，頁面登入已過期，實際下載 bytes／hash 仍需有效登入 |
| 原始 TPZ 實機驗收 | ★ preparation／實際 Preview 到達；☆ 缺欄表單另案修正 | 本輪 theme 站點誤擋解除，兩個 readonly 維度保留；Amazon 回缺 Contains Liquid Contents 而沒有可填欄，Issue #228 接續。未到 VALID，沒有 mutation |
| 價目表 | ★ fresh export QA 通過 | 本次沒有價格 code 變更。已安裝 0.1.59 完成 fresh 417 列／242 有價格／175 無價格及 Amazon 首圖匯出，原表 6,048 cells／235 formulas 等保留、176 文字價格差額全對；完整核對與兩份 Excel 實機結果另記於 0.1.59 帳本 |

真人 Windows Hello、正式簽章與正式 Amazon mutation 不由 CI 或靜態驗證推定；更新通道保持 disabled。私有工作簿、帳號憑證與 raw responses 不納入 repository。
