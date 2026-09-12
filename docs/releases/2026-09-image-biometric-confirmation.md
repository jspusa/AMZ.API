# 0.1.66 圖片生物辨識與確認流程

Issue [#254](https://github.com/jspusa/AMZ.API/issues/254)。規格見 [圖片登入與送出操作簡化](../specs/2026-09-image-biometric-confirmation.md)。

Source base：`147a14a2afbe19a06adc1ee8192038f2fc58b78e`。開發分支：`codex/image-touch-id-confirmation-20260912`。版本 0.1.66 的實作、review、CI、artifact、安裝與原生驗收分開記錄；目前尚未發布。

## 行為

首次完成圖片登入及原生授權後，Notebook Key 保存獨立的系統加密登入資料；後續重開或安全環境失效後，以 Touch ID／Windows Hello 重新解鎖登入。圖片 Amazon 預檢通過後直接顯示商品與變更位置，不再重打 SKU，按送出才進入一次原生確認。

首次保存、後續解密、取消／鎖定與明確認證失敗的行為，須以實作及聚焦安全測試核對。服務仍維持八小時記憶體 session；不擴大 server audience、不保存 image token、不改下載或公告登入。

## 分層驗收

| 範圍 | 證據／狀態 |
| --- | --- |
| ★ Source | 已完成圖片登入 OS 加密保存、Touch ID／Windows Hello 解鎖，以及免重打 SKU 確認；保留原 main Write Gate、idempotency 與 native confirmation |
| ★ Check／audit | `npm run check`：323 files／3,738 tests、型別與 build 通過；`npm audit --omit=dev`：0 vulnerabilities；`git diff --check` 通過。首輪兩個版號斷言已更新；三個既有大量 durable I/O 測試曾逾時，完整重跑原 5 秒門檻已通過 |
| ☆ 兩軸 review | 待最終 diff 審查 |
| ☆ 同 source CI／Pages／兩平台 artifact | 尚未發布 |
| ☆ 0.1.66 Mac 安裝與圖片登入 | 尚未安裝；不以 0.1.65 的登入成功替代 |
| ☆ 員工下載實體檔 | 必須核對新完成檔案大小與 hash，下載開始訊息不代表完成 |

## 保留的 0.1.65 原生證據及未完成範圍

0.1.65 曾在實際 Mac 重開後保留 large／pink／dark，已恢復 standard／default／light。使用者提供的完整 Vine 原頁已保存 25 筆來源資料，主清單只有 11 筆進行中；14 筆結束項目不顯示，六月仍進行中的登記保留，22／30 的評論回收進度條及重新讀取均已核對。

原生 AFA12AM 圖片查詢及 01–09 整批對照通過，圖片服務登入後顯示「草稿就緒 9 張、暫存待準備 0 張」，每張套用至正確位置，安全預檢按鈕可用。`HostedListingImages` 只有在固定 URL 的匿名讀回 bytes／hash 與原檔相符後才回 ready；這是已安裝 0.1.65 的直接準備證據。Agent 未送 Amazon Preview、原生寫入批准或 PATCH；後續使用者自行操作不從此證據推定成功。之後原生畫面顯示安全環境變更，草稿停止並保留圖片，未自行重送。

全部 FBA 效期同步曾由原生入口啟動；鎖屏後重開與讀取本機資料均顯示 idle、無 job／snapshot。Owner 確認 lock/context 清除會中止 main job，關閉 panel 本身不會；尚未取得完整實機結果。原始需求的全 FBA 效期／銷速、免原表價目表實際 Excel、健檢→變體導覽、圖片門檻結果及實際員工下載驗收仍保留，不因本輪 UI 修正縮小結案範圍。
