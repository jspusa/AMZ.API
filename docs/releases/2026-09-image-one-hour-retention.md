# 0.1.78 一小時圖片暫存交付帳本

Issue #294；[核准規格](../specs/2026-09-image-one-hour-retention.md)。使用者於 2026-09-14 明確將保留期限由七天改為一小時。

- Source base `50e5d8e0f9e1a5331c6a8f75f72e7c4b9eb15567`；獨立分支 `codex/image-one-hour-retention-20260914`。原 .77 可信 runtime checkout 保持 `b25901ac47017f0d90b8feaea61b2270477bde72`。
- 變更前 .77 實機已完成五個指定商品資料夾／45 張原圖匯入與準備，五個 SKU 全部通過 Amazon Validation Preview；每列九個更新位置、零多餘舊圖，逐張原／新圖顯示正常。完整替換核取方塊未勾、提交未按、沒有正式 Amazon mutation。測試工作區已正常關閉。
- 原始圖與測試副本逐檔 SHA-256 相符；四個 `.DS_Store` 為既有 parser 明示略過的系統檔，其餘沒有 README 或其他檔案被靜默移除。證據位於 `/tmp/amz-api-v0177-verified/five-folder-live-input.json` 與 `five-folder-native-run.json`，不提交原圖或 live payload。
- .78 client 完整檢查通過：333 files／4,252 tests、typecheck、production build 與 stylesheet 驗證；production audit 0。保留共用樣式 fingerprint `894b11de1f6eaa8fd40888ca8d1cceb5cfec48bedbe4b4168d6f44494228a77e`。
- Client Spec 發現 unknown upload 經 GET 410 會釋放 identity 的邊界，已以舊版本兩次 PUT／修正版一次 PUT 的獨立回歸核對修正；`clear()` 不開放 unknown 重傳。Server 審查另發現舊 v1 圖片清理後能在遷移緩衝內重建相同 UUID，改為切換政策時停止 v1 上傳，既有圖按原期限讀取。Client 最終 staged tree `a512b11b83add1eb1063bfa9156fb77f73591155` 的 Standards／Spec 各 0 open；後續僅本帳本與規格文字補記。Server 最終審查、source 與部署證據待補。
- 部署、CI 產物、安裝及新一小時原生驗收各層待追加；不能沿用 .77 七天期限測試冒充 .78 完成。
- Supply Boss 自身目前沒有容量用量頁/API，`/health` 只提供期限與清理狀態。10 GiB 是圖片操作預留額度上限，不是實際 bucket bytes、剩餘空間或平台付費方案。
