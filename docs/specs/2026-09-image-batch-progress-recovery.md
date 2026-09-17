# 圖片批次預覽、進度恢復與系列選取修正

追蹤：[Issue #317](https://github.com/jspusa/AMZ.API/issues/317)。

## 回報與範圍

2026-09-17，接續已交付的共用圖片功能（#314）及唯讀恢復（#305）。使用者回報核對時看不到處理狀態與進度；將同一張第 9 圖套用到 10 個 SKU，尚未出現 Touch ID 就顯示先前結果不明；重新讀取進度沒有可辨識變化。同時要求系列候選可點整列勾選，並提供全選。本規格只記錄上述回報，不推定本次已送出 Amazon PATCH，也不把既有待確認操作當成失敗。

開工基準為 main `09460121cefb51bee7dc87dbdbd7a1976c89e14b`、Notebook Key `0.1.82`。測試採合成 SKU／圖片與 fake adapters，不保存私人批次、原始 Amazon 回覆或憑證。

## 使用者可見行為

- 準備、預檢及錯誤有明確進度，耗時預檢顯示已檢查／總 SKU 數及目前商品，不只停在沒有結果的等待畫面。保留既有選圖縮圖及成功預檢後逐 SKU 的實際原圖／新圖、指定位置與「其他位置保留」揭露。新配對、模式或安全 context 改變會使舊預覽失效，失敗不假裝成完成。
- main 依目前 exact context 與最新 durable evidence 區分「先前操作待確認」和「本批次已送出但結果不明」。舊 pending／unknown／accepted 阻擋必須有正確狀態與下一步；不能讓未取得原生批准、未送 PATCH 的新批次顯示成已送出結果不明。既有不可重送紀錄不能被新預覽、重開程式或較舊成功覆蓋。
- 被先前操作阻擋時，可從目前 exact SKU 接回唯讀進度，不必重傳圖片或手工重新輸入全部 SKU；新圖草稿保留，舊操作另行呈現。接回的是既有操作；不能拿既有 receipt 證明本次新圖已完成，亦不能將恢復結果變成新圖的 Preview Ticket。
- 「重新讀取本批次進度」應顯示查詢中與結束後狀態。可核對的既有操作執行新的 bounded GET-only canonical 回查；沒有足夠可信證據或沒有可回查項目時明示原因，不能只無聲重畫相同資料。普通背景輪詢僅觀察，重疊 refresh 不重複啟動上游工作。
- 系列候選的 SKU、品名及列內空白均可切換同一 checkbox，勾選狀態清楚，保留原生鍵盤操作與可存取名稱。提供明確的全選／取消選取操作，只作用於目前圖片、已完整讀取且身分相符的 FBA 候選；不自動選整個系列，不加入 parent／FBM／未證明列。
- 全選去重並保留不屬於該候選群的手動 SKU；取消系列選取不得清空無關手動目標。不完整 family 不提供冒充全系列的全選。超過全批 30 個不同 SKU 時明示阻擋，不靜默截斷；準備、預檢、正式提交與安全 context 變更期間的 selection fences 保持有效。

## 安全與相容契約

- 既有 `selected-slots` 只改指定位置、其他 canonical 圖位逐格保留；完整資料夾替換與刪除揭露保持相容。最多 30 SKU／300 個套用組合／每 SKU 10 位置、同 SKU 準備授權、一小時暫存、超過十分鐘來源餘裕及十五分鐘票證上限不變。
- `ListingImageBatchMutations` 維持唯一 main-owned batch plan；`MainWriteGate`／`LocalStore` 維持 collision、原生批准與耐久證據 owner。診斷與進度只能投影有界、清理過的公開狀態，不加入任意 ledger 列舉、raw evidence 或 renderer 控制上游 transport。
- 初次預檢進度由同一 main owner 提供；新版 renderer 經能力偵測明確選用背景預檢，沿用本機 GET 觀察唯一工作，不用輪詢重送 POST。既有未選用的同步預檢保持相容；檢查中不可提交，失敗或 context 清除後遲到工作不得發布可寫預覽。
- 新寫入仍需 fresh identity／FBA／seller-specific PTD／完整舊值／Validation Preview、不可變 review binding、原生批准與 final fence。舊 unresolved collision 在 native approval／新 PATCH 前阻擋；正式寫入仍每個 intent 只有一次 serial PATCH。
- 恢復／refresh 固定 GET-only，不準備或上傳圖片，不建立 Preview Ticket，不取得 Touch ID／Windows Hello，不送或重送 PATCH，不刪除／重設耐久紀錄。accepted 與 verified 分離；unknown、URL 不同、來源到期、相同張數、店面外觀及經過時間不能當成成功或解除防重送。
- 最新紀錄 malformed、歧義或未知時 fail closed，不能回退舊成功。account／mode／marketplace／generation 改變、鎖屏、取消及遲到回覆不得恢復舊權限或污染新畫面；舊 Bridge 缺能力明示升級，不降級安全條件。

## 驗證與交付

- 在公開 renderer 操作驗證圖片準備與預檢進度、逐 SKU 原新圖、阻擋與直接接回進度。主例使用 10 個合成 SKU 的第 9 圖；驗證準備次數、提示與按鈕狀態，避免只測純 helper。舊操作已 verified 與沒有紀錄的混合批次可重新核對保留草稿，但仍須 fresh Preview 與新原生批准；任何 unresolved 列不開放此接續入口。
- 系列選取覆蓋整列點擊、checkbox 不雙重切換、鍵盤、全選／取消、手動目標保留、重複項目、不完整 family、parent／FBM、跨圖片全批超限、busy 與遲到 family response。
- mutation owner 與 `ApiRouter.handle()` 公開接縫重現 prior accepted／pending／unknown 的提交前阻擋，斷言原生批准及新 PATCH 都為零；區分真正已送出的 unknown、未送出的列與既有 accepted。以真 Write Gate／LocalStore 合成證據驗證最新紀錄優先與不可重送，並驗證背景預檢進度、舊同步相容及檢查中不能提交。
- GET-only 回歸覆蓋 fresh refresh、重疊 refresh、接回舊操作、canonical 相符／未相符／失敗、缺少可信 receipt、來源過期與 context invalidation；核對 GET 行為與零 upload／Preview／native approval／PATCH，保留原 folder／selected-slots 回歸。
- 完成聚焦測試、`npm run check`、`npm audit --omit=dev`、`git diff --check` 與固定候選的獨立 Standards／Spec review。本次若變更 main 恢復能力，以 Notebook Key `0.1.83` 交付；版本及發行 identity 只在最終程式範圍確定後鎖定。
- source、CI、Pages bytes、Mac／Windows 可信產物、保留 vault／ledger 的安裝、受保護下載卡、authenticated download bytes 與 live Amazon 分層記錄。安裝前保留未完成工作；不以本機測試代替真機／Amazon 驗收，也不為程式驗收送出真實 Amazon 更新。

不包含圖片生成、系列猜測、變體改掛、雲端圖片服務變更，或放寬 unknown／accepted 的防重送條件。
