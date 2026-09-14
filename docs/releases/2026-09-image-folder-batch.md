# 0.1.77 資料夾圖片批次與七天暫存交付帳本

Issue #290；[核准規格](../specs/2026-09-image-folder-batch.md)。

- Source base：`396374dc5896d8343dd13369864138836c861c92`；獨立分支 `codex/image-folder-batch-20260914`，原工作目錄的無關檔案未變動。
- 一批最多 30 個 exact SKU／資料夾、每 SKU 10 張、總計 300 張；資料夾是完整圖片組，逐張原／新圖核對與舊图刪除範圍披露後，由一次原生批准授權 main 依序送出。安全驗收使用合成資料，未送真實 Amazon PATCH。
- Supply Boss 既有圖片來源改為七天暫存；舊 v1／v2 圖片採一次性七天遷移緩衝。到期回 410 與實際 R2 刪除分開；只有確認圖片 metadata、reservation 與到期日相符且物件已不存在，才回收 active 容量。小型防重送操作紀錄不保存圖片 bytes。
- 每小時 GitHub Actions 呼叫固定清理入口，一輪最多 256 頁、20 分鐘；新準備也會有界清理。GitHub 排程可能延遲，公開 repository 長期無活動時也可能停用排程；維護者須保留工作流啟用並檢查服務 cleanupStatus。網址到期仍立即生效，清理失敗不會被當成已釋放容量，active 上限仍阻止無限累積。
- 本機完整 check、production audit、兩軸 review、畫面驗收、正式部署、可信 artifacts、下載卡、安裝與原生驗收分層追加於本帳本。版本號本身不代表已交付；發布前實際安裝版本已唯讀確認為 0.1.75。

- 本機 final check：333 files／4,232 tests、typecheck、build、樣式 stream 與 production audit 0 通過。最初全檢的版本／CSS snapshot 已按刻意變更同步；已凍結 main 的新增案例另行通過。其後既有 B2B 測試遇單次 5 秒 timeout，owner／測試未變、定點 9 tests 通過，最終全檢以兩個 workers 完成；沒有提高 timeout、跳過測試或改依賴。
- 畫面驗收使用合成圖片：5／45 與 30／270、31 資料夾拒絕、舊 Bridge 升級提示、32 組初驗及最終 16 組大字深淺色／1440與390畫面；原／新圖逐張對照、完整期限及表格捲動均確認，無破圖、瀏覽器錯誤或頁面溢位。最終 stylesheet fingerprint `894b11de1f6eaa8fd40888ca8d1cceb5cfec48bedbe4b4168d6f44494228a77e`。
- AMZ.API／Supply Boss 兩軸審查的 expiry refresh、URL 等價形式、刪除前 metadata 核對及全容量掃描問題均已修正；最終 Spec 0 open，Standards 的程式修正及後續小型畫面增補分開核對。Server reviewed tree `8c065c377150c293e3e79033900ec0f722c37748`、source commit `45c42cb3a19ffaa8572a99b2cb68feb47fa66f36`；完整 server tests、build、validate 通過。
