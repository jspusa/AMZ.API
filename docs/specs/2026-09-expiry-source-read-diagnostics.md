# 效期來源讀取診斷

Issue #281 接續完整效期目標 #263。0.1.74 首次原生同步已完成遍歷，終態為 `FBA_EXPIRY_SOURCES_UNAVAILABLE`；只剩不可讀計畫合計，操作與原因在 reader → coordinator → 本機重讀之間遺失。這不是已證明 request 格式錯誤，也不代表登入失效。

## 行為契約

1. 既有 `GET /api/inventory-health` 只讀目前 account／mode／marketplace 的本機資料；從嚴格驗證的 checkpoint 投影 bounded 來源摘要，不建立報表、不發 Amazon request，也不重啟同步。
2. 計畫合計須分清本輪已列入、讀取完成、不可讀與尚待完成。完成／不可讀／待完成只計本輪已列入的互斥狀態；上輪保留但未列入或正在重讀的 cache 不算本輪完成。遍歷尚未完成時，不能把目前已列入數稱為全部 Amazon 計畫。已排除的其他狀態計畫不冒充讀取完成。讀完一個計畫不保證其中有效期；來源完整也不證明現存批次餘量。
3. 新紀錄只保留固定操作種類（計畫資料、貨件商品、計畫商品）、首頁／後續頁、真實 terminal HTTP 400／404／422 及現有 bounded allowlist 原因。來源 ID、Seller／商品資訊、Request ID、URL、headers、原始 body、任意 error message 與 raw checkpoint 不可進入診斷 DTO。
4. 舊 schema 2 checkpoint 已保存的狀態可以純本機彙總；沒保存的操作／頁次／原因顯示未記錄，不能補猜。結構及 context 相符但超過原 30 分鐘 cursor 時限的紀錄，仍可顯示歷史計數與開始時間，明標 `stale`，不讓 reader 恢復過期 cursor，也不改健康快照或批次確認政策。舊 schema、缺值、非法或未來時間、格式異常及 context 不符不能補成成功摘要；保留現有更嚴格的 GET 拒絕。診斷資料不開放確認或提醒。
5. renderer 只接收 validated public DTO。來源摘要預設收折，使用固定文字說明狀態；原八欄商品表格、全部 FBA／銷售偏慢篩選、人工公告與確認流程保持原樣。切換帳號或站點後，舊摘要與快照一起清除。
6. 不更改 method、path、query、pageSize、chosen-placement 選取或遍歷條件。不新增 Amazon 診斷入口、自動重試或任意 transport。既有一次明確同步會保存新診斷；GET／本機重讀始終零上游請求。

## 驗證與證據界線

- 在 public reader → coordinator → 本機 GET seam 先重現診斷丟失，再驗證固定 metadata 可通過保存與重讀。
- 舊 schema 2 純本機摘要、unknown 欄位、狀態計數不重複、非法 checkpoint、stale／context fence、敏感 sentinel 不可外洩及零上游請求均需測試。
- 錯誤回應仍只有限大小、deadline 與固定分類；不得為診斷放寬解析／重試／中止保護。
- renderer 驗證 old／new DTO、不可讀及未記錄文字，並證明收折／本機重讀不發同步 POST。
- 先完成聚焦驗證，再執行 `npm run check`、`npm audit --omit=dev` 與兩軸審查。實際 Amazon 原因、返回效期與多日期驗收仍需分開取得證據，不能以診斷或 CI 通過宣稱完整 #263 已完成。
