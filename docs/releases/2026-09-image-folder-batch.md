# 0.1.77 資料夾圖片批次與七天暫存交付帳本

Issue #290；[核准規格](../specs/2026-09-image-folder-batch.md)。更新：2026-09-14；原生功能與員工實際下載仍待補證。

## 來源與範圍

- Runtime 由 [PR #291](https://github.com/jspusa/AMZ.API/pull/291) 合併，發行來源固定為 `b25901ac47017f0d90b8feaea61b2270477bde72`／0.1.77。開工 base 為 `396374dc5896d8343dd13369864138836c861c92`，實作分支 `codex/image-folder-batch-20260914`；原工作目錄的無關檔案未變動。
- 一批最多 30 個 exact SKU／資料夾、每 SKU 10 張、總計 300 張。資料夾是完整圖片組，逐張原／新圖核對並披露多餘舊圖的刪除範圍後，由一次原生批准授權 main 依序提交。安全驗收使用合成資料，未送真實 Amazon PATCH。
- Supply Boss 圖片改為七天暫存；舊 v1／v2 圖片採一次性七天遷移緩衝。到期回 410 與實際 R2 刪除分開；只有確認圖片 metadata、reservation 與到期日相符且物件已不存在，才回收 active 容量。小型防重送操作紀錄不保存圖片 bytes。
- 每小時 GitHub Actions 呼叫固定清理入口，一輪最多 256 頁、20 分鐘；新準備也會有界清理。GitHub 排程可能延遲或因公開 repository 長期無活動而停用；維護者須保留工作流啟用並檢查服務 `cleanupStatus`。清理失敗不代表空間已釋放，active 配額仍有上限。
- 後續清理 caller 的 PR #292 與本文件交付紀錄不替換上述 runtime artifact 來源。兩平台 unsigned 測試包的 update channel 均為 `disabled`。

## 分層狀態

星號表示該層已有直接證據；空星表示仍需補驗，不能由其他層推定完成。

| 證據層 | 狀態 | 範圍 |
|---|---|---|
| 本機檢查與兩軸審查 | ★ 已通過 | 333 files／4,232 tests；production audit 0；AMZ.API／Supply Boss 各 0 open |
| 正式 runtime CI | ★ 已通過 | 同一 b25901a 的 Validate、Pages、macOS、Windows，均為 main push／attempt 1 |
| Pages 線上 bytes | ★ 已通過 | HTML＋11 個 JS／CSS，共 12 檔符合可信 artifact |
| macOS／Windows 產物 | ★ 已通過 | Archive／manifest／檔案雜湊、原生模組及平台 fuse 檢查 |
| Supply Boss version 10 | ★ 已發布及直接核對 | 七天 receipt、公開原始 bytes、`no-store`、空 backlog 清理回覆 |
| 固定 caller 正式執行 | ★ 已通過 | PR #292 合併後的新 run 34840054397 success；無到期 backlog |
| Mac 正式安裝 | ★ 已核對 | 可信 DMG 安裝 .77；保留 .75 App、0700 userData 備份及 vault／ledger bytes |
| Mac 原生啟動／功能驗收 | ☆ 等待使用者 | 程序執行中，但原生畫面讀取逾時；系統授權待使用者確認 |
| 兩平台員工下載卡 | ★ server receipts 已驗 | Mac→Windows 兩次完成回覆均符合 .77 可信檔案 |
| 員工登入後實際下載 | ☆ 等待登入 | 頁面仍顯示登入表單；新下載檔的大小與 SHA-256 尚待驗 |
| 真實 Amazon mutation／Windows Hello | ☆ 本輪未驗 | 合成測試及 CI 不構成真人原生批准或 Amazon 寫入證據 |

## 檢查與審查

本機 typecheck、333 files／4,232 tests、build、樣式 stream 與 production audit 0 均通過。版本／CSS snapshot 已按刻意變更同步；一次既有 B2B 5 秒 timeout 後，未變動的 owner／測試定點 9 tests 通過，最後全檢以兩個 workers 完成，沒有提高 timeout 或跳過測試。

合成圖片畫面涵蓋 5 SKU／45 圖、30 SKU／270 圖、31 資料夾拒絕、舊 Bridge 提示、32 組初驗及最終 16 組大字深淺色／1440 與 390 寬度。原／新圖、刪除列、期限、表格捲動均通過，無破圖、瀏覽器錯誤或頁面溢位；stylesheet fingerprint 為 `894b11de1f6eaa8fd40888ca8d1cceb5cfec48bedbe4b4168d6f44494228a77e`。

到期來源重新準備、URL 等價形式、刪除前 metadata 核對及全容量掃描問題均已修正。AMZ.API reviewed implementation tree 為 `2b6e39a487f7dcfa4373de548b14efda150927f5`，final candidate `5d2035b7d041bda0a608d2701549f30fb532d7be` 只追加交付紀錄。Server 最終 reviewed tree 為 `27d408f6c901aa97145b320f8c4b1b8dae60a09a`；空／非空／偽造長度／錯誤／停滯串流測試、完整 server checks 通過。兩個 repository 的 Standards／Spec 均為 0 open。

## 固定來源與正式 Actions

本機證據目錄為 `/tmp/amz-api-v0177-verified/`，僅用於接續本輪核對，不提交 helper、完整 payload 或本機私有資料。`release-config.json` 固定 repository、0.1.77、b25901a、四個 run／attempt 及三個 artifact ID，SHA-256 為 `253c07b3ddc695378a637ffe794d70d57936554da43e77711bc86baf5f3e0c95`。`source-main-verification.json` 於 2026-09-14 11:44:39 UTC 確認來源與當時 main 相同，proof SHA-256 為 `51d6c2d74555d6edd25fb658ce2188ea85bdbf53022cf045aa71ab32e92081e7`；兩平台與 Pages 後續驗證均綁定該 proof。

以下均是 `b25901ac47017f0d90b8feaea61b2270477bde72` 的正式 main push、attempt 1、completed／success。Observation 是流程觀察；可信產物另有實際下載驗證。

| 流程 | Run | Artifact ID／名稱 | 結果 |
|---|---|---|---|
| Validate | [34834880197](https://github.com/jspusa/AMZ.API/actions/runs/34834880197) | 無 | ★ success |
| Pages | [34834880252](https://github.com/jspusa/AMZ.API/actions/runs/34834880252) | `10343269862`／`github-pages` | ★ success |
| macOS | [34834880220](https://github.com/jspusa/AMZ.API/actions/runs/34834880220) | `10343783892`／`AMZ.API-unsigned-b25901ac47017f0d90b8feaea61b2270477bde72` | ★ success |
| Windows | [34834880207](https://github.com/jspusa/AMZ.API/actions/runs/34834880207) | `10342924564`／`AMZ.API-Notebook-Key-Windows-x64-b25901ac47017f0d90b8feaea61b2270477bde72` | ★ success |

Issues event 的 Pages run `34834881944` 為 skipped，未當成部署成功或替代上述 push run。

## 可信 artifacts 與 Pages

| 可信檔案 | Bytes | SHA-256 | 結果 |
|---|---:|---|---|
| `AMZ.API-0.1.77-universal.dmg` | 246934185 | `a547b5c12287b381f2010640e10d203ea063b981c5dc11620b132548fcd540c7` | ★ 相符 |
| `AMZ.API-0.1.77-universal.zip` | 222210507 | `cb3551f6037790ef7abea6ccc11f1414d20283fe4666204b68fc49965946e8ba` | ★ 相符 |
| `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102080400 | `30335b15fad370a0ac0eba52aa5725add5a4f25b80dccd7b52d3ba9a5d139c2c` | ★ 相符 |
| `AMZ.API-Notebook-Key-Windows-x64.zip` | 143395193 | `476295cf58ce52797f62b1409a19e88a60a64fe53b7bc834b41b1510a05d410b` | ★ 相符 |

兩平台 archive／manifest 與上述檔案 bytes／hash 均已驗。Mac ZIP 為 arm64／x86_64 universal，deep strict ad-hoc signature 及八項受檢 fuse 通過；ASAR 為 `57eb2441220af417e7121176bbe41b78936e93e2f9135cbbc7512bbfa64c71a9`。Windows PE32+ AMD64 executable、N-API addon、ASAR manifest／unpacked addon hash 與八項受檢 fuse 通過。這些 package／靜態證據不代表正式簽章、公證、SmartScreen、Windows 真機或真人生物辨識。

Pages 的可信 artifact tar SHA-256 為 `d5d1b1be7211b14c2301491e6d8f6f2d0e9779652828bb1aefade8388b5be37b`；2026-09-14 11:45:51 UTC 核對線上 HTML＋全部 11 個 JS／CSS，12 檔 HTTP 200 且逐檔 bytes／SHA-256 相符。證據在 `pages/pages-byte-verification.json`；不是只檢查首頁版本字串。

## Supply Boss version 10 與清理 caller

version 9 的真實 gateway 空 POST 帶 body stream，舊 guard 因而在 storage 存取前回 400；version 10 已以有界 EOF 驗證修正。正式 Sites 部署來源為 `b30f10c09c46f854427b25b7e78970ab912becc2`，version 10、environment revision 11、deployment `appgdep_6aa7d10d21948191b534eb87f4b29d7e`，狀態 succeeded。證據為 `site-deployment.json`。

`site-live-retention.json` 記錄一次合成 PNG 的 live 準備：1000×1000、5,214 bytes、1 次 PUT；SHA-256 `4eb174d32c4158473cbefe029f721e0c5b1223d273177939a1835338d29a4bdf`。receipt 到期時間為 `2026-09-21T10:49:37.256Z`，公開 bytes 與原圖相符且 `Cache-Control: no-store`，Amazon calls 為 0。固定 maintenance 回覆 `deletedObjects: 0`、`deletedBytes: 0`、`hasMore: false`；後續 health 的 cleanupStatus 為 available，lastCompletedAt `2026-09-14T10:49:35.550Z`。這證明服務與空 backlog 清理路徑可用；尚未經過七天，不能宣稱已觀察該 PNG 到期後實際刪除。

最初 caller run `34835099833` 被 Cloudflare 1010 拒絕，未重跑該失敗 run。[PR #292](https://github.com/jspusa/AMZ.API/pull/292) 僅為同一固定請求加入 `User-Agent: AMZ.API image-maintenance/1.0` 與 `Accept: application/json`；端點、無憑證／body／query、禁止 redirect、上限與回覆驗證未改動。兩軸審查 0 open、production audit 0、[Validate 34839762014](https://github.com/jspusa/AMZ.API/actions/runs/34839762014) success；已於 2026-09-14 11:47:37 UTC 合併至 `f3399f1c3aaadcaeaa279c2cbe1454b44564ebef`。main workflow bytes 已核對，唯一新 dispatch 的 [run 34840054397](https://github.com/jspusa/AMZ.API/actions/runs/34840054397) 在 f3399f1c completed／success，deletedObjects／deletedBytes 均為 0，backlogComplete 為 true；工作流為 active。這次沒有應刪的到期圖片，不冒充已驗過期圖片實刪。證據為 `maintenance-workflow-verification.json`。

## 安裝與尚待交付

`user-data-backup-verification.json` 與 `installation-verification.json` 證明 .75 正常退出後，從唯讀掛載的可信 DMG 安裝 .77 至 `/Applications/AMZ.API.app`；universal、deep strict ad-hoc integrity 及安裝 ASAR 均符合可信產物，換版時 vault／ledger bytes 未變。0700 userData 備份保留於 `/Users/jasper/Library/Application Support/amz-api-backups/20260914-before-0177`，舊 App 保留於 `/Applications/AMZ.API-v0.1.75-backup-before-0177-20260914.app`。

Mac→Windows 兩次 portal upload 完成 receipts 已驗，兩卡均為 0.1.77，Mac DMG／Windows installer 的大小與 SHA-256 精確符合上表。證據為 `portal-upload-macos-dmg-receipt.json`／`portal-upload-windows-installer-receipt.json`；這是 server completion manifest 證據；`delivery-status.json` 已交叉核對來源、平台、卡片與安裝一致。員工頁仍顯示登入表單，兩份登入後實際下載尚未驗收。

2026-09-14 11:50:20 UTC 的 `native-launch-observation.json` 顯示 .77 程序正在執行，但 App 輔助使用／畫面讀取逾時。系統 SecurityAgent 程序存在且工具禁止存取；已請使用者檢查並完成待處理的 macOS 授權，未繞過保護。原生首頁、Bridge／Amazon 連線及資料夾批次功能維持待驗，不能把程序存在當成驗收通過。

接續只補原生畫面／安全功能與員工登入後實際下載；原安裝、可信產物與上傳已驗項目不重做。使用者的系統授權及員工登入請求已提出；任一等待不能以時間經過當成同意。功能驗收不送真實 Amazon mutation；本輪 agent Amazon PATCH 為 0。
