# 0.1.78 一小時圖片暫存交付帳本

Issue #294；[核准規格](../specs/2026-09-image-one-hour-retention.md)。使用者於 2026-09-14 明確將保留期限由七天改為一小時。

- Source base `50e5d8e0f9e1a5331c6a8f75f72e7c4b9eb15567`；獨立分支 `codex/image-one-hour-retention-20260914`。原 .77 可信 runtime checkout 保持 `b25901ac47017f0d90b8feaea61b2270477bde72`。
- 變更前 .77 實機已完成五個指定商品資料夾／45 張原圖匯入與準備，五個 SKU 全部通過 Amazon Validation Preview；每列九個更新位置、零多餘舊圖，逐張原／新圖顯示正常。完整替換核取方塊未勾、提交未按、沒有正式 Amazon mutation。測試工作區已正常關閉。
- 原始圖與測試副本逐檔 SHA-256 相符；四個 `.DS_Store` 為既有 parser 明示略過的系統檔，其餘沒有 README 或其他檔案被靜默移除。證據位於 `/tmp/amz-api-v0177-verified/five-folder-live-input.json` 與 `five-folder-native-run.json`，不提交原圖或 live payload。
- .78 client 完整檢查通過：333 files／4,252 tests、typecheck、production build 與 stylesheet 驗證；production audit 0。保留共用樣式 fingerprint `894b11de1f6eaa8fd40888ca8d1cceb5cfec48bedbe4b4168d6f44494228a77e`。
- Client Spec 發現 unknown upload 經 GET 410 會釋放 identity 的邊界，已以舊版本兩次 PUT／修正版一次 PUT 的獨立回歸核對修正；`clear()` 不開放 unknown 重傳。Server 審查另發現舊 v1 圖片清理後能在遷移緩衝內重建相同 UUID，改為切換政策時停止 v1 上傳，既有圖按原期限與建立時間加一小時的較早值讀取。Client 最終 staged tree `a512b11b83add1eb1063bfa9156fb77f73591155` 的 Standards／Spec 各 0 open；後續僅本帳本與規格文字補記。Server 最終 staged tree `5d8a55dd291f42e04b003ab94738aca2c28ec8c4` 的 Standards／Spec 亦各 0 open；完整 server tests、build、validate 通過。
- 正式部署、CI、產物與原生驗收各層見下方；不能沿用 .77 七天期限測試冒充 .78 完成。
- Supply Boss 自身目前沒有容量用量頁/API，`/health` 只提供期限與清理狀態。10 GiB 是圖片操作預留額度上限，不是實際 bucket bytes、剩餘空間或平台付費方案。

## 正式來源與圖片服務

- PR #295 已於 2026-09-14 14:00:04 UTC 合併；candidate `15c9ce4e076f87e291951fe68a53c110e578f2f0` 與 runtime main `11f3b2addc8c44267f8097c5d764c660094927b1` 同一 tree。PR Validate `34851830146` 與 Windows `34851830142` 均成功；這些 PR 檢查不是正式發行產物來源。
- Supply Boss source `1347921668502c724fb8c0a362e8340f82d30831` 已推送並核對 remote main；正式 archive 僅含 `.openai/hosting.json` 與 `dist/server/index.js`，source bytes 相符。Saved version 11／`appgprj_6a7719308ad8819186b46adcafcc87a6~appgver_805132234e108191b26d6e26d0472df9`，deployment `appgdep_6aa7fcb118108191a09436d6a248a4e0` 於 13:55:07 UTC 成功；原 public audience 與 environment revision 11 保留。
- Live 新 receipt 一小時、GET 期限不續期、公開原始 bytes 與 `no-store` 均通過；先前七天測試圖在切換後已回 410，固定清理實際刪除 22 個到期物件／25,201,989 bytes，沒有待續頁。沒有 Amazon mutation。證據 `/tmp/amz-api-v0178-verified/site-live-one-hour.json`。
- 正式 caller run `34852798043`（runtime source、attempt 1、workflow_dispatch）成功，刪除 0 個到期物件／0 bytes；每五分鐘 cron 與固定一小時 policy 已在 main。這是手動 caller 驗證，不冒充已觀察到 GitHub 的首個 schedule event。前台時間到期與排程實體刪除保持區分。
- Windows 正式 run `34852747444` attempt 1 在未變更的 `tests/local-store.test.ts:815` 遇到 5,000 ms 限制（5,010 ms）；其餘 4,247 通過／4 個平台略過。已核對相同 tree 的 PR Windows 成功、local-store source/test 無差異，保留原失敗，僅重跑同 source 一次。Attempt 2 完整測試與打包成功，最終綁定 attempt 2；沒有改 source、測試或 timeout，未使用失敗 attempt 產物。

## 正式 CI、Pages 與可信安裝檔

- Runtime source 固定 `11f3b2addc8c44267f8097c5d764c660094927b1`。四條正式 push/main CI 均成功：Validate `34852747448` attempt 1、Pages `34852747437` attempt 1、Mac `34852747572` attempt 1、Windows `34852747444` attempt 2。不可把後續文件 commit 當作本次 runtime 產物来源。
- Final config `/tmp/amz-api-v0178-verified/release-config.json` 與 source proof 已鎖定；source proof SHA-256 `09f99f840c3c678265b64319e167bca4313723397548edea2b4238f817b241d2`。Artifact IDs：Mac `10352641103`、Windows `10352705699`、Pages `10352080162`。
- Pages HTML 加上 11 個 JS／CSS，12 檔共 3,345,174 bytes，線上內容全部等於可信 artifact；實際已包含「1 小時」文案。證據 `/tmp/amz-api-v0178-verified/pages/pages-byte-verification.json`。
- Mac artifact archive／manifest、Universal arm64／x86_64、深度嚴格 adhoc signature 及兩架構 fuses 均通過。DMG 246,937,658 bytes，SHA-256 `9564323cb5ca3f4ecbe18f509c7405bd1298e6a2162b9251bdd949509650865d`；ZIP `af2c048106f60de9f95b807b2f2370a5d71fdb4eb0599e0130c77ec9fb79ab72`；ASAR `0f397fc9b2a9a29a529c9ba3318a7e8ae939416d770e3e873a99e101d20a4d97`。
- Windows archive／manifest、AMD64 PE、Windows Hello addon／ASAR 邊界及八項 fuses 均通過。Installer 102,081,287 bytes，SHA-256 `a45b9666a984d3b2f751e59df5ded8ea87182f2ad8e1d17edffac23c21058706`；Portable ZIP `ff0e7abc12eabb3a24752f4c4996c7cccbcbe9aaf1495fafa7bcb397fad9e5b5`。
- 安裝檔驗證不代表正式 Developer ID／公證、Authenticode、SmartScreen、真人生物辨識或 Amazon mutation 成功。Updater 仍 disabled。

## 安裝前的原生接續與清理排程快照

此節為首次等待解鎖時的歷史狀態；安裝結果與後续測試以「解鎖後安裝與原生測試接續」及最新 server 修正記錄為準。

- 五個原始資料夾與先前測試副本再次逐檔核對：45 張、49,993,451 bytes，原圖 bytes 未變；證據 `/tmp/amz-api-v0178-verified/five-folder-input-reverification.json`。
- 準備退出 .77 安裝 .78 時，CUA 明確回報 Mac 鎖定且自動解鎖失敗。沒有送正常退出、備份、安裝或新一小時原生測試；新解鎖請求已留。仍保留原 .77 App、既有 vault／ledger／備份與所有未完成使用者工作。證據 `/tmp/amz-api-v0178-verified/native-lock-observation.json`；接續須先取得 fresh 原生頁面並確認無進行中作業，再正常退出與執行已備妥的受限安裝 helpers。
- .78 一小時模式的真實五資料夾準備／五 SKU Validation Preview 尚待解鎖後驗收；不得為驗收送出正式 Amazon 更新或原生寫入批准。
- 每五分鐘 workflow 為 active，repository Actions 開啟、default branch main，遠端排程內容與 runtime source 一致；截至 14:21 UTC 尚無真正 `schedule` run（`/tmp/amz-api-v0178-verified/scheduled-cleanup-observation.json`）。原每小時排程的三個應觸發時段亦沒有紀錄；手動 caller 已通過，但不能把它視為自動排程驗收。GitHub 官方允許排程延遲或丟棄；目前未找到確定設定錯誤，沒有任意重設權限或新增付費排程替代。
- 圖片滿一小時即拒絕讀取；實體空間釋放依清理 caller 實際執行，因此現階段不能保證在一小時整完成刪除。保留首次真正 schedule 事件與結果為未完成驗收項目。
- 手動入口：[Clean expired listing images](https://github.com/jspusa/AMZ.API/actions/workflows/listing-image-maintenance.yml) → Run workflow → Branch: main → Run workflow。原生瀏覽器已確認入口與成功紀錄；此功能只清到期圖片，不提供任意 bucket 刪除能力。
- [Sites 管理](https://chatgpt.com/sites) 中的站點名稱是 Supply Boss API；目前 Supply Boss 沒有已用／剩餘圖片容量畫面，亦未取得平台實際 bucket 用量。不能把 10 GiB 產品預留額度或本輪刪除 bytes 當成平台剩餘容量。


## 受保護下載頁

- 已依 Mac → Windows 完成 0.1.78 兩張下載卡上傳；server completion manifest 的版本、bytes、SHA-256 均等於本輪可信 payload。證據 `/tmp/amz-api-v0178-verified/portal-upload-macos-dmg-receipt.json` 與 `portal-upload-windows-installer-receipt.json`。授權仍透過既有 Keychain → stdin，不把憑證寫入檔案／環境／URL／log。
- 原生瀏覽器重讀 `/downloads` 仍為下載密碼表單。員工頁登入及兩份實際下載 bytes 尚待使用者登入後獨立核對；不能把 Mac 解鎖、admin upload receipt 或下載卡更新當成員工下載成功。既有登入請求保持待完成，不重複索取密碼。


## 解鎖後安裝與原生測試接續

- 使用者再次解鎖後，fresh 原生 .77 首頁顯示 US／Amazon 已連線且没有未完成的圖片作業；已正常退出、完成 0700 userData 備份，核對唯讀 DMG 後安裝 .78。Universal／deep-strict adhoc signature 與 ASAR `0f397fc9b2a9a29a529c9ba3318a7e8ae939416d770e3e873a99e101d20a4d97` 相符，vault／ledger bytes 未變；原 .77 App 備份及先前備份保留，DMG 已正常卸載。證據 `/tmp/amz-api-v0178-verified/installation-verification.json`。首次 launch 工具逾時後，fresh AX 已確認新版首頁與 Amazon 連線，不把該次逾時當鎖定或重裝理由。
- .78 原生父資料夾匯入辨識 5 個 SKU／45 張圖片、01–09 位置全對、0 待修正，一小時文案正確。首次準備停在第一張 `IMAGE_PREPARATION_INCOMPLETE`；Worker PUT 14:55:15 UTC outcome `canceled`、wall 30,175 ms／CPU 99 ms，後續 GET 404，尚未開始 Amazon Validation Preview。唯一明確 GET-only 回查 15:01:26 仍404，没有重送 PUT。原未知上傳保留，不用重啟／更換 identity 迴避。證據 `five-folder-native-run.json` 與 `native-upload-safe-worker-events.json`。
- 獨立小 synthetic 圖在真實一小時期限後 HEAD 回410；到期前發出的另一請求在網路途中跨過期限，也回410，不當成瞬間到期前200。先前13:56的200／bytes證據另存；本次沒有PUT或清理，410只證明拒讀。證據 `synthetic-image-one-hour-expiry.json`。
- 固定 manual cleanup 14:59:55→15:00:16 UTC 成功，刪2個到期物件／1,568,292 bytes、hasMore false，整體耗時20,633 ms；這不是整個bucket用量。證據 `cleanup-after-native-failure.json`。
- 本機 public Worker seam 已重現新圖片等待舊圖 HEAD 時，新operation尚未reserved／body尚未讀取而GET404；200個到期舊圖可在新reservation之前引發612個串行R2操作。這證明前置阻塞風險，不证明線上 canceled 的確切階段。Cloudflare HTTP Worker沒有已證實的固定30秒wall-time限制，不能把CPU99ms稱為30秒CPU超限。接續 Issue #297 的獨立 server修正，Amazon寫入與一小時政策保持原界線。
- 原未知SKU未重傳；另外四個原先未嘗試SKU以完整資料夾首次準備36張，副本逐檔hash與原測試來源相符。Worker看到5個PUT200、前4個publicGET200；第5個publicGET canceled。此時CUA又明確回報Mac鎖定，未讀到native終態或五SKU完整預檢。已留新解鎖請求；.78保持執行，不強制結束，未重傳既有圖、未送Amazon更新。證據 `four-unattempted-folder-input.json`、`four-unattempted-native-run.json`、`four-unattempted-safe-worker-events.json`。
- 截至14:52:40 UTC，固定workflow仍active但schedule事件0筆；證據 `scheduled-cleanup-unlock-observation.json`。員工下載頁仍是密碼表單，保留獨立登入／下載bytes待驗項目。


## Issue #297 雲端背景清理修正

- 本機 public `worker.fetch` 的門閂測試先重現「新 PUT 等待無關舊圖 HEAD」，再確認修正後不等待；完整三套 server tests、build、validate 與 diff check 通過。兩個獨立 reviewer 核對 frozen tree `8021599cc32fdc1e95d9e5d7d69abcc68c69e18e`，Standards／Spec 各零 findings。
- 正式 server source `6f9b42a99e0502452dcdc749122775c4c558c828` 已推送且 remote main 相符。新上傳只透過 `waitUntil` 附帶最多一筆背景清理；缺少 context 時跳過。未確認實體不存在或 CAS 未成功仍占額度，配額耗盡仍拒絕。保留一小時、防重播與固定維護入口，不把背景補充當成 idle 排程保證。
- 本機部署 archive 僅含 manifest 與編譯輸出，bytes 與 exact source 相符；worker SHA-256 `db6fa4f6f6dfbdd9e8a1ca3f9605893d3e600c93e86cf5f3c5ae32170df41112`。Saved version 12／`appgprj_6a7719308ad8819186b46adcafcc87a6~appgver_1cfb269e32d88191a2ef95a084c1b135`，deployment `appgdep_6aa80fe91c248191801d60c462997ddd` 於 2026-09-14 15:17:22 UTC 成功，environment revision 11 保留。證據 `nonblocking-server-source.json`、`nonblocking-site-version.json`、`nonblocking-site-deployment.json`。
- 這次只發布 server，不重建或重裝已驗證的 .78 App，不重傳既有 unknown 圖片；本機阻塞風險的紅綠測試不等於確定正式環境 canceled 的原因。原生四 SKU 接續仍需 fresh 解鎖畫面，已有 operation 先 GET 回復確認，再處理從未嘗試的圖，不能直接新建相同工作的 PUT。
- 截至 15:18:48 UTC，固定 GitHub workflow 的 `event=schedule` 查詢仍為零筆；manual caller 的成功與背景清理不替代首個自動 schedule 結果。員工登入後實際下載仍待驗，保持原生操作紀錄與所有備份。

- Version12 線上獨立新 synthetic 圖驗證通過：repo fixture 1,842 bytes，僅一次 PUT200（3,416 ms），同 operation GET200（4,304 ms）及 public GET200（1,388 ms）；原 bytes／hash、no-store、一小時期限全部相符，GET 不續期。15:19:04 UTC fresh Sites 查詢確認 active／public／version12。沒有另行呼叫清理入口、重傳原未知图或執行 Amazon 操作；新 PUT 可能附帶背景清理，小圖成功不冒充完整五 SKU 原生驗收。證據 `nonblocking-live-synthetic.json`。


## Version12 後原生接續的最新觀測

- 原生畫面重新可讀後顯示安全環境已更新／批次停止。重新選擇同一四資料夾（36 張、0 待修正），明確準備一次；原生已顯示先前5張準備完成、正在第6張，期限沿用原2026-09-14 16:04:54 UTC。沒有重啟App、清除unknown或重傳原五張，AFA12AM的另一unknown保持原狀。
- 此階段Worker紀錄為5次operation GET200、7次public GET200、2次新PUT200（3,305／3,346 ms），以及15:26:04 UTC的1次PUT canceled（2,206 ms）。隨後CUA再次明確回報Mac鎖定，無法讀到native終態；最後native直接觀測仍只有5張。不能由Worker的public GET200宣稱36張全部準備或四SKU預檢通過，也沒有正式Amazon寫入或native批准。
- 接續仍需Mac解鎖並保持螢幕開啟約五分鐘，先查回既有operations，再處理從未嘗試的圖。證據 `four-sku-after-server-fix-native.json` 及 `four-sku-after-server-fix-worker-verification.json`。先前logs取證曾因未公開的100筆上限被connector拒絕；修正為100後才取得有效唯讀查詢，不把早先解析失敗當成零請求。
