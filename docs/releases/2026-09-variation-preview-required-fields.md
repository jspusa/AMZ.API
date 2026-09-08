# 0.1.61 變體預檢缺欄補填

日期：2026-09-08。Issue #228／[spec](../specs/2026-09-08-variation-preview-required-fields.md)。固定基準 `ca966e0794c0f476ff639540e2909c7b9e27821b`。

0.1.60 已安裝、Amazon 已連線，原始 TPZ preparation 成功並保留唯讀形狀、尺寸及既有主題。實際 Validation Preview 回缺 Contains Liquid Contents 商品事實，UI 卻沒有輸入欄。舊實作只恢復特定 missing code、必須帶 attributeNames、又必須出現在靜態 required 遍歷集合的欄位；無名稱、其他正式 missing 語意或 Preview 才要求的 optional schema property 都可能漏接。native UI 只顯示訊息，沒有 raw code／attributeNames，不能假裝知道該筆實際 response 落在哪個分支。

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Production seam 重現 | ★ RED 已建立 | optional CHILD PTD boolean 的精確 title、HTTP 200 INVALID／4000002、沒有 attributeNames，重現相同訊息與缺失 requiredFields；不使用私有 raw response |
| 修復與本機 regression | ★ 全庫通過 | `npm run check`：290 files／3,173 tests、typecheck、production build、stylesheet parity 通過；audit 0、diff-check 通過。Main 聚焦 4 files／206 tests；renderer 自有聚焦 4 files／51 tests，獨立 renderer 2 files／26 tests 通過。答案保持空白直到使用者填寫 |
| 獨立雙軸審查 | ★ Standards／Spec 各 0 未解 finding | Standards 另以 5 個記憶體 probes 核對 recovery 邊界；Spec 獨立 production 167＋renderer/parser 26 共 193 tests。預讀三項安全／撤回問題與 echoed SKU 問題都已修正後重新核對 |
| Release／CI／artifact／安裝 | ☆ 尚未完成 | 更新至 0.1.61；保留 0.1.60 與 vault，最終各層來源另記 |
| 真實 Amazon 驗收 | ☆ 尚未完成 | 原始商品完整 prepare→補填→fresh Validation Preview；不執行正式 mutation |

0.1.60 的完整平台、安裝及已知 Preview blocker 見 [前版帳本](2026-09-single-market-theme-preservation.md)。價目表、原檔／圖片保留與文字價格差額已實機通過，本次不變更其功能。

恢復資料只來自同次 Preview 的 bounded raw metadata 與目前 CHILD PTD。HTTP 200 必須回相同 exact SKU 與正式字串 status；HTTP 400 ErrorList 使用正式 missing code 或保留原拒絕的明確選欄，422 是 App 的同等窄化相容政策，並非官方 PATCH response 保證。私有訊息／不安全 PTD title、錯 SKU／站點、malformed／mixed system failure 不提供可寫欄位或成功票證。候選不是 Amazon 必填，二次模糊回覆後仍可撤回；只有明確的新 missing evidence 才升格必填。既有值、唯讀 theme／dimensions、native confirmation、持久 claim 與 unknown 不重送流程保留。

正式發行前將先用已檢查、固定 commit 的本機診斷包核對原始 SKU 的實際缺欄恢復。它保留 packaged main 載入正式 Pages 的信任邊界，因此最初僅能證明新版 main 與目前線上 UI 的交互，不代表同 commit 全介面驗收或可信 CI 發行。此暫時安裝保留已驗證的 0.1.60 與 vault；最終仍須換成 exact main CI artifact，並分別驗證 Pages、兩平台產物及受保護下載。
