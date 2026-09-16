# 0.1.80 全頁工具與圖片進度回查

Issue [#305](https://github.com/jspusa/AMZ.API/issues/305)；[需求規格](../specs/2026-09-workspace-image-recovery.md)。

Base `68e8db8b26e12cadb7a23e986a4f3bdad18a9a69`；獨立工作副本 `codex/workspace-image-recovery-20260916`，原 checkout 的未追蹤檔保持原樣。

## 診斷

- 使用者報告 Amazon 圖片已更新，但批次畫面仍為已接受、回查確認 0。此為使用者 storefront 觀察，不能替代 canonical 回查。
- 最小 main-owner 測試先重現：初次 bounded observer 結束後才讓 canonical 圖片同步，再按手動進度 GET，原實作仍只投影舊 accepted 狀態。修正以顯式 GET refresh 啟動新一輪唯讀回查，普通輪詢不新增 upstream 工作。
- 原生 .79 已重現價目表 generic workspace 錯誤；關閉返回首頁後再次從價格區開啟仍相同。診斷當時未重新載入或退出 App，也未操作 Amazon 寫入。
- .79 與後續下載入口 UI 兩份舊 price-list lazy chunk 的公開 URL 均已 404；目前 Pages chunk 可用。實際 Dashboard 入口以缺少延遲 chunk 重現相同訊息，而 real panel mount 正常；改為 eager import 後同一回歸通過。原生 packaged App 不提供 DevTools，未取得該舊程序的 exception，因此不把 fixture 根因當成確定的原生 exception。
- 已僅按使用者提供的 SKU 範圍唯讀確認十個最新 durable image entries 都仍存在；未輸出帳號、指紋、原始收據或憑證。換版及回查證據另行記錄。

## 驗證紀錄

- WIP 獨立安全審查發現進行中 observer 斷線後 manual GET 會被停用；已修正並補新舊 Bridge 的重接測試，相關三檔 65 tests 通過。此限定 review 不替代最終兩軸 review。
- 本機 production fixture 已用真實選單核對圖片、價目表、AWD 與文件庫完整頁面；圖片恢復表含已確認／待同步與回查時間。390 px document 無水平溢位，進度表在自身容器捲動；深色大字價目表正常。均為 synthetic UI，不代表 Amazon 回查成功。
- 最終 production fixture 的公告日曆已直接展開；同一 instance 的返回與再次開啟保留，無額外讀取。
- 第一輪 full check 4,319 tests 通過、3 個既有 CSS fingerprint 基準因刻意樣式修改而待同步；未降低斷言或變更 renderer trust boundary。CSS 與評論由 drawer 轉全頁的閱讀契約同步後，335 files／4,322 tests、build／stylesheet stream、audit 0 通過。
- Spec review 另以真實 LocalStore／Write Gate 合成重現：較新展示模式紀錄遮住正式 accepted 操作。修正僅排除完整、身分精確且 completed 的 SIMULATED 收據；不排除 null／未知／格式不完整的新紀錄。最終包含此修正的 checks／review 見下列結果。
- 包含展示模式收據修正的最終 `npm run check` 通過：335 files／4,326 tests、typecheck、build 及 stylesheet stream 均成功；`npm audit --omit=dev` 為 0 vulnerabilities。完整本機 log：`/tmp/amz-workspace-image-recovery-check-final3.log`。
- 最終兩軸 review 固定於 `a662dd9479bea4507f6ddb99f922a1645122912d`：Standards／Spec 均為 0 open findings。只排除身分精確、證據完整且 completed 的 demo／SIMULATED 收據；較新未知、格式損壞或矛盾紀錄仍阻擋回退。
- [PR #306](https://github.com/jspusa/AMZ.API/pull/306) 合併後 runtime source 固定為 `f3c159d110bd1692a7a7e1beb9ff4101dd431299`，與 final review head 的 tree 均為 `a6fd243586753f643790babfb8ab1023e416aa19`。後續文件 checkout 不替代這個產物來源。

## 交付狀態

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| 實作與定點回歸 | ★ 已完成 | main 唯讀回查／恢復、全頁導覽及價目表入口；保留未知結果與禁止重送 |
| 完整檢查與兩軸 review | ★ 已通過 | 335 files／4,326 tests、audit 0；final head Standards／Spec 各 0 open findings |
| Exact-source CI／兩平台產物 | ★ 已通過 | 四條 main／push attempt 1 success；安裝檔、ASAR、原生 addon 與 fuses 均綁定上述 runtime |
| GitHub Pages | ★ bytes 已驗 | HTML＋全部 10 個 JS／CSS 共 11 檔逐位元一致；GitHub archive digest 與 tar 身分另驗 |
| 四區原生入口 | ★ 已驗新 Pages | 以 .79 Bridge 正常 Reload 核對圖片、價目表、公布欄與 API 文件庫；不作 .80 main／Amazon 回查證據 |
| Mac 備份／安裝 | ★ 已完成 | 可信 .80 universal 已換入；.79 App 與 0700 userData 備份保留，vault／ledger bytes 未變 |
| 安裝後原生 UI／既有圖片 GET 回查 | ★ 啟動與恢復已驗／☆ canonical 待確認 | .80 已連線；10 SKU／90 張找回，手動 GET 更新回查時間；仍為 Accepted 10／Verified 0／unknown 0，原因未定位 |
| 受保護下載 | ★ 上傳、一般密碼及完整 HTTP bytes 已驗／☆ UI 落地檔未驗 | 兩張 .80 卡與完整串流均符合可信產物；UI 開始下載訊息未證明本機新檔 |

### 正式來源與 Actions

以下四條均來自 `f3c159d110bd1692a7a7e1beb9ff4101dd431299`，branch `main`、event `push`、attempt 1；未重跑 CI。`release-config.json` 已固定 exact run／attempt／artifact，`source-main-verification.json` 再以設定 bytes 的 SHA-256 鎖定實際 main 來源。

| 範圍 | Run | 結果 | Artifact |
|---|---|---|---|
| Validate | [35082655773](https://github.com/jspusa/AMZ.API/actions/runs/35082655773) | ★ success／attempt 1 | — |
| macOS | [35082655863](https://github.com/jspusa/AMZ.API/actions/runs/35082655863) | ★ success／attempt 1 | `10440718173` |
| Windows | [35082655768](https://github.com/jspusa/AMZ.API/actions/runs/35082655768) | ★ success／attempt 1 | `10441615359` |
| Pages | [35082655784](https://github.com/jspusa/AMZ.API/actions/runs/35082655784) | ★ success／attempt 1 | `10441181442` |

### 可信產物

| 已驗檔案 | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.80-universal.dmg` | 246902972 | `70adc5450b70ff534984c516249073337ae1d77f74c5edb04f77ec580d983e70` |
| ★ `AMZ.API-0.1.80-universal.zip` | 222216948 | `e5e1fc424d4bc6796857ed2385791f1f85db6c7ade942bc635a13794281b4f1d` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102085670 | `aa881a8fa10abba4ad1ceb75697d515e08f5a65b9b37b3fef59e50ad1de94ac8` |
| ★ `AMZ.API-Notebook-Key-Windows-x64.zip` | 143401002 | `e4a15e4d1e8cb00031268f5fe623b00a66a6ed91733f05677685642a2e5b4943` |

GitHub Mac archive 為 469120564 bytes／`e22501e5286ffcce45bac018319ab53e5687b1318bb5825fb85e686166d7e52d`；Windows archive 為 245487368 bytes／`3dda628cb5d9c0bb58576dac51c28b244a141b9a8e013a4c7259444ac4dd8890`。兩份均先驗 GitHub archive digest，再核對 manifest 與個別檔案。

Mac ZIP 內 `com.jspusa.amz-api`／0.1.80／disabled channel、x86_64＋arm64、deep／strict ad-hoc integrity 與兩架構各 8 項 fuses 均通過；ASAR SHA-256 為 `6b7328758bfc7a929497a660451755f7cca3416fe5135e2a274bdd774ee7411f`。Windows ASAR／disabled channel、AMD64 PE、唯一 unpacked Hello addon／N-API export、manifest hash 及 8 項 fuses 均通過。此靜態驗證不代表 Developer ID／公證、Authenticode／SmartScreen、真人 Touch ID／Windows Hello 或 live Amazon 成功。

聚合證據：`/tmp/amz-api-v0180-verified/release-artifacts-readonly-verification.json`；各平台 `ci-verification.json`、Mac `verification.json`／`zip-bundle-verification.json`／`zip-bundle-fuses-verification.json`、Windows `verification-result.json`／`fuses-verification.json` 分別保存來源與實際結果。

### Pages 與四區原生入口

2026-09-16 10:13:52 UTC，正式 Pages artifact 與線上 HTML＋全部 10 個 JS／CSS 共 11 檔逐位元相同；entry 為 `index-B_v8KHdd.js`，CSS 為 `index-Buk3bokd.css`。價目表在 entry bundle，沒有獨立 `price-list-panel` 延遲 chunk，三個原有引導標記皆在。這項檢查範圍為 HTML／JS／CSS，未擴稱其他公開資料檔均已驗。

Pages GitHub archive 為 633075 bytes／`a3be36dd9580c46cade82717441d398c464a9e88fa18896800eb90fa154c08f5`；內部 tar SHA-256 為 `f9f92f547ed454128e65dd77ab696397cb13c393782a45c8195507531c4826ba`。證據：`pages/pages-byte-verification.json` 與 `pages/archive-digest-verification.json`。

正式 Pages 上線後，在尚為 .79 的 Notebook Key 內以正常 View → Reload 載入新 UI，已實際從四區開啟並返回：圖片為完整工作頁且有三個分頁、價目表正常顯示、公布欄完整頁直接展開日曆、API 文件庫完整頁載入。此輪未選圖片、未跑 Preview、未原生批准或 PATCH；它證明新 renderer 的入口與返回，不替代 .80 main 或既有圖片 canonical 回查。

### Mac 安裝與後續驗收

確認原生 App 閒置後正常退出 .79，先建立 release-bound 0700 userData 備份，再由已驗證 DMG 安裝 .80 universal。`installation-verification.json` 證明 `/Applications/AMZ.API.app` 的 ASAR 與上述可信 Mac 產物一致、deep／strict integrity 通過、換版期間 App 停止且 vault／ledger bytes 未變。舊 App 保留於 `/Applications/AMZ.API-v0.1.79-backup-before-0180-20260916.app`；userData 備份保留於 `/Users/jasper/Library/Application Support/amz-api-backups/20260916-before-0180`。備份證據為 `user-data-backup-verification.json`。

可信 .80 已成功啟動，原生首頁顯示 Amazon 已連線；先前啟動讀取逾時已解除。僅依使用者提供的 10 個 exact 既有 SKU 恢復操作，全部找回，每項 9 張、合計 90 張。按「重新讀取本批次進度」後，最近回查從 2026-09-16 18:23:55 更新為 18:24:22（Asia/Taipei），畫面仍為 Accepted 10／Verified 0／unknown 0。這證明既有批次可恢復且手動回查時間更新，不代表十筆 canonical 已確認。尚未定位同批未通過的具體原因，不能把泛用 pending 訊息直接解讀為圖片 URL 不符；保留 pending，禁止重新上傳或 PATCH。

另一次單 SKU 唯讀圖片查詢成功，顯示 9／9、FBA、`PET_FOOD`；它不是上述同批 canonical snapshot，不能據此改判十筆完成。本輪實機驗收未送新的 Amazon mutation。原生去敏證據：`/tmp/amz-api-v0180-verified/native-live-readback-verification.json`。Issue #305 保持開啟，後續須先釐清同批 canonical 待確認原因，不重做已驗的入口或安裝。

### 受保護下載

Mac → Windows 的上傳 complete manifest receipts 均已核對，兩卡皆為 0.1.80，名稱／bytes／SHA-256 與上表相符。`portal-upload-macos-dmg-receipt.json` 與 `portal-upload-windows-installer-receipt.json` 僅證明伺服器完成回應，不替代登入下載。

新[專用下載頁](https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads)的一般下載密碼 UI 登入成功，兩張 .80 卡可見，不需 ChatGPT 登入。獨立 HTTP 驗證於 2026-09-16 10:26:41 UTC 完成：匿名入口 200，未認證 manifest／兩個檔案皆 401；正常下載密碼登入後，兩份完整串流各為 200，bytes 與 SHA-256 均等於本輪可信 installer。未使用平台 QA bypass、未自動重試。證據：`/tmp/amz-api-v0180-verified/portal-authenticated-http-download-verification.json`。

兩個一般 UI 下載按鈕均顯示「下載已開始」，但自 `since=1789554407` 起的本機檔案檢查回報 `No new completed macos file after --since`，尚無兩份 UI 新落地檔案的 bytes 證據。此缺口與已完成的 authenticated HTTP 全串流驗證分開；不能把按鈕訊息當作本機下載完成。UI 去敏證據：`/tmp/amz-api-v0180-verified/portal-ui-verification.json`。
