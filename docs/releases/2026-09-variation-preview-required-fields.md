# 0.1.61 變體預檢缺欄補填

日期：2026-09-08。Issue #228／[spec](../specs/2026-09-08-variation-preview-required-fields.md)。固定基準 `ca966e0794c0f476ff639540e2909c7b9e27821b`。

0.1.60 已安裝、Amazon 已連線，原始 TPZ preparation 成功並保留唯讀形狀、尺寸及既有主題。實際 Validation Preview 回缺 Contains Liquid Contents 商品事實，UI 卻沒有輸入欄。舊實作只恢復特定 missing code、必須帶 attributeNames、又必須出現在靜態 required 遍歷集合的欄位；無名稱、其他正式 missing 語意或 Preview 才要求的 optional schema property 都可能漏接。native UI 只顯示訊息，沒有 raw code／attributeNames，不能假裝知道該筆實際 response 落在哪個分支。

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Production seam 重現 | ★ RED 已建立 | optional CHILD PTD boolean 的精確 title、HTTP 200 INVALID／4000002、沒有 attributeNames，重現相同訊息與缺失 requiredFields；不使用私有 raw response |
| 修復與本機 regression | ★ 全庫通過 | `npm run check`：290 files／3,173 tests、typecheck、production build、stylesheet parity 通過；audit 0、diff-check 通過。Main 聚焦 4 files／206 tests；renderer 自有聚焦 4 files／51 tests，獨立 renderer 2 files／26 tests 通過。答案保持空白直到使用者填寫 |
| 獨立雙軸審查 | ★ Standards／Spec 各 0 未解 finding | Standards 另以 5 個記憶體 probes 核對 recovery 邊界；Spec 獨立 production 167＋renderer/parser 26 共 193 tests。預讀三項安全／撤回問題與 echoed SKU 問題都已修正後重新核對 |
| Release／CI／artifact／安裝 | ★ 兩平台可信 artifact／Mac 安裝完成；☆ portal 登入下載待驗 | PR #230 與 exact main CI 成功；正式 0.1.61 已替換診斷版並連線，兩份 portal 上傳完成 |
| 真實 Amazon 驗收 | ☆ 尚未通過 | 2026-09-09 正式 CI 包原始商品 prepare 成功，但實際 Preview 仍回 missing Contains Liquid Contents，無 requiredFields／choices；UI 正確標未通過。繼續 Issue #228，未執行正式 mutation |

0.1.60 的完整平台、安裝及已知 Preview blocker 見 [前版帳本](2026-09-single-market-theme-preservation.md)。價目表、原檔／圖片保留與文字價格差額已實機通過，本次不變更其功能。

恢復資料只來自同次 Preview 的 bounded raw metadata 與目前 CHILD PTD。HTTP 200 必須回相同 exact SKU 與正式字串 status；HTTP 400 ErrorList 使用正式 missing code 或保留原拒絕的明確選欄，422 是 App 的同等窄化相容政策，並非官方 PATCH response 保證。私有訊息／不安全 PTD title、錯 SKU／站點、malformed／mixed system failure 不提供可寫欄位或成功票證。候選不是 Amazon 必填，二次模糊回覆後仍可撤回；只有明確的新 missing evidence 才升格必填。既有值、唯讀 theme／dimensions、native confirmation、持久 claim 與 unknown 不重送流程保留。

正式發行前將先用已檢查、固定 commit 的本機診斷包核對原始 SKU 的實際缺欄恢復。它保留 packaged main 載入正式 Pages 的信任邊界，因此最初僅能證明新版 main 與目前線上 UI 的交互，不代表同 commit 全介面驗收或可信 CI 發行。此暫時安裝保留已驗證的 0.1.60 與 vault；最終仍須換成 exact main CI artifact，並分別驗證 Pages、兩平台產物及受保護下載。

PR #230 的 final head `9665149f12ef47db13f42c3ece5b9cd2c556c9a1` 已包含獨立核對的 concurrent PR #229（只涉及首頁樣式及測試）。整合後 `npm run check` 291 files／3,177 tests、typecheck／build／stylesheet parity 全過，log `/tmp/amz-api-v0161-integration-check.log`。同 head Validate `34215911347` 與 Windows `34215911363` 均成功才合併；main release-code SHA `cd2616c911e0812bfe3f96957a30b413cd4a0951` 與 PR head tree 完全相同（`00e7816438e277168500cc80496d8d2612ec79e3`）。Main Validate `34216512913`、Pages `34216512922`、Mac `34216512996`、Windows `34216512909` 分別追蹤，不能由 PR 成功推定。

本機診斷版來源為上述 PR head，universal／deep strict ad-hoc signature／disabled channel 已核對，ASAR `b92c6ccd4bc93341c88a3c99b14dedd3cadf1bd6ac96cf81cf8be2878c5e1dea`。在正常退出 App 後以可復原 swap 暫時安裝，可信 .60 保留在 `/Applications/AMZ.API-v0.1.60-before-0161-canary-20260908.app`；0700 userData 備份及 vault bytes 均保留。Swap helper 的 post-inspect failure rollback 與 restore 後 vault 核對經修正，3 個隔離 synthetic 情境全通過。證據在 `/tmp/amz-api-v0161-local-canary/`。

診斷版啟動後沒有 renderer，AX 讀取 timeout；程序取樣確認等待 macOS Keychain content/decryption，未讀取或輸出憑證。已請使用者在系統視窗解鎖，實際新 main Preview 尚未執行。為了繼續可獨立完成的交付，在雙軸審查與同 head CI 成功後合併並製作可信發行包；不得將這次 merge／本機診斷安裝當作 live acceptance。正式 Amazon mutation 仍為零。

正式 Pages 已在 2026-09-08T10:42:15Z 完成獨立核對：main Validate／Pages 均成功，artifact `10052041587` 的入口及全部 9 個 JS／CSS 與 live bytes 完全相同。新版 lazy variation module `variation-planner-drawer-BwVlWRke.js` SHA-256 `60f4d58f845ceddeeefb80635f4c1fe290ea7781a8bf8efdd54143ac78f995eb`，requiredFieldChoices 與五項補填／自選文案均存在。CSS `index-BEGQxnMO.css` 原始 SHA-256 `7fe49fe3ed03095b0b08cb16080e8eb01b4e839851e6bbc99e3e954a99933a11`，canonical ordered-rule fingerprint `390e962c2c6cfdd888ee172dcfb4de6c389a7c4bc5863290056eaef5ed993510`；兩者不同概念，source／artifact／live 規則一致。完整證據在 `/tmp/amz-api-v0161-verified/pages/`。

Mac main run `34216512996` attempt 1 成功，291 files／3,176 passed／1 skipped；artifact `10052196473`，archive 468,739,815 bytes／`6d8cf2592606bec91dbb5554719089765fe031255eef33ee3731900df139ef67`。DMG 246,690,215 bytes／`69b85a758d9db7338c68700a15b10c59bca173002c0ef32a5772dc172bcff208`，ZIP 222,048,956 bytes／`4cf8892ad42d6d7aa75d25ad3a529a0c56dc89b12235819040bb8bf93d5bdeda`；archive、manifest、universal、deep strict codesign、disabled channel 全通過。Windows main run `34216512909` attempt 1 成功，291 files／3,173 passed／4 skipped；artifact `10052204968`，archive 245,201,267 bytes／`f354ea9442df2ac7c83615fa716c5cf8013a8c5f77fde202917c7b5db1f1dbd2`。Setup 101,958,472 bytes／`0ad704b929eeb0f0412a593fcef1ca035fd588fa08b082c73d132e4fdb56350d`，ZIP 143,242,099 bytes／`5ef3f1367c30595eca0d3eb506b115711e69221fe4b71b214a2dbd85f1622177`；ASAR／AMD64 native boundary 及 win-unpacked、ZIP、installed NSIS Bridge smoke 通過，不代表真人 Windows Hello。各平台完整證據在 `/tmp/amz-api-v0161-verified/{macos,windows}/`。

診斷版與 CI 包雖 ASAR 相同，獨立全 bundle compare 601 entries／268 files／14 symlinks 仍找到 12 個執行檔／簽章差異，故沒有把它當作 CI 安裝。2026-09-09 App 已可正常開啟與連線後，正常退出診斷版、還原可信 .60 並備份目前 userData，再由已驗證 DMG 安裝正式 .61。`/Applications/AMZ.API.app` ASAR `b92c6ccd4bc93341c88a3c99b14dedd3cadf1bd6ac96cf81cf8be2878c5e1dea`；.60 備份 `/Applications/AMZ.API-v0.1.60-backup-20260908.app`、診斷版備份及 0700 userData 備份都保留，vault bytes 未變。正式包啟動首個 AX timeout 後讀取正常、Amazon 已連線。只讀 DMG 已退出；`installation-verification.json` 是正式 CI 安裝證據。

Mac→Windows 兩份 portal 上傳已依序完成並核對本機檔案 bytes/hash，登入後實際下載仍未驗證。隔夜新增的 renderer-only PR #231／#232 到 main `e529ffa2f9d189336bee119911b5e5fbb0e68d0e`；變體／價格 owner 與 main/preload/shared 未變，獨立窄整合 review 0 findings。當前 Pages Validate `34253473070`／Pages `34253473038` 成功，artifact `10066965551` 的入口＋9 assets 全等於 live，原始 CSS SHA／canonical fingerprint 分開核對；證據在 `pages-current/`，不覆寫前版證據。

正式包實測：來源 TPZ 與目標完整，standalone FBA 1、目標 18，shape／size 保留；實際 Preview 再回 `'Contains Liquid Contents?' is required but missing.`，本輪 recovery 仍沒有帶出欄位。不能從這句 UI 訊息猜測 raw code／attribute metadata／PTD 結構。下一步先利用既有 `routeError` 已經安全公開的 code／upstreamCode／issues，讓使用者能展開檢查詳情，取得精確的下一個 regression；不記 raw response、不改 secret／transport／write authority，不再把模擬成功當作實帳通過。
