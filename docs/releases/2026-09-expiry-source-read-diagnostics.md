# 效期來源讀取診斷交付紀錄

Issue #281；[規格](../specs/2026-09-expiry-source-read-diagnostics.md)。開始來源為 `20580a9615b01166950db46abbe617df67d99bee`，實際安裝仍為 0.1.74／runtime `8352a502aefe8eae61912c26496cd749490bcdc5`。

## 最新實機證據

使用者解除原生啟動等待後，0.1.74 首頁與 Amazon 連線已確認。首次且唯一效期同步於 2026-09-13 23:12:14（Asia/Taipei）顯示終態 partial：284 個 FBA 品號、33 個銷售偏慢／待核對品號，36 個入庫計畫不可讀。這是不可讀數，不是所有計畫數，也不證明同一 operation 或 HTTP 狀態。

本機重新讀取保留相同時間、計數與 partial 狀態。人工公告 4 項、既有人工效期及促銷月曆保留，圖片門檻 8，八欄與捲動提示仍可見。未重送同步，沒有 native 最終寫入批准或 Amazon mutation。聚合證據：`/tmp/amz-api-v0174-verified/native-acceptance-resumed-20260913.json`。

員工下載頁仍顯示登入表單；已另行指出精確的下載頁登入需求，無須再要求 Mac 解鎖。0.1.74 的安裝、CI、Pages、兩平台可信產物及伺服器上傳已驗，員工實際下載 bytes 尚待。原已驗圖片、Vine、偏好、價目表、變體及表格流程不重做。

## 本輪狀態

0.1.75 診斷補強已完成本機檢查：326 files／4,070 tests、typecheck、build、stylesheet composition 與 `git diff --check` 通過，production audit 0。最初完整檢查只在兩項仍固定 .74 的版本測試失敗，將預期版本明確更新為 .75 後重新通過，未放寬功能 assertion。stylesheet fingerprint 保持 `ff016e1e974b03b58bdf23378722b9416f78285c8052bf82581df8d686637926`。

Public seam 先重現診斷丟失，之後驗證 production adapter → reader → coordinator → 保存 → 重開／GET 的操作分類；30 項來源診斷測試包含舊 schema 2 的 36 筆歷史分類、超過 cursor 時限的純本機讀取、未知／型別／合計／context／sentinel 保護及零額外上游請求。Renderer 新增兩項先紅後綠，15 項流程測試通過；synthetic CUA 檢查預設收折、歷史／未記錄文案與 390px 無溢出，暫時 viewport／tab／server 已恢復或結束。八欄樣式沒有修改。

第一次獨立 Spec 審查找到兩項 P2：部分遍歷保留快取重複計入本輪完成，以及不存在的日期被正規化為有效時間。兩項已在 public GET 先重現，再修正投影與 DTO 一致性；120／150 個舊 cache、過期部分遍歷 tombstone、非法日期、合法閏日／offset 及微秒未來邊界皆已驗，底層快取／遍歷／request 未改。複查中既有 B2B recent-work 的 65 筆磁碟 fixture 曾超過 5 秒，原測試未改，單檔 9 tests 與第二次完整檢查通過。

本機證據：`/tmp/amz-expiry-source-diagnostics-revised-check-r2.log`、`/tmp/amz-expiry-source-diagnostics-recent-work-focused.log`、`/tmp/amz-expiry-source-diagnostics-audit.log`、`/tmp/inventory-expiry-source-summary-evidence/verification.json`。修訂後 exact candidate 複審及 CI／產物／安裝證據尚待。完整 #263 仍未完成；真正效期來源與多日期尚無實機驗收。

## 發布前完整分類補強

`1bdf738` 已完成兩軸 0 findings 與 PR Validate／Windows 檢查，但尚未合併。最後唯讀核對發現 adapter 已解析的固定 code／response state 仍會在來源保存時丟失，因此在同一未發布版本補齊，避免安裝後又只看到泛化原因。新增分類只依官方模型的 operation／400／BadRequest／完整精確訊息；其他 operation、狀態、代碼與近似文字保守不分類。這不是本帳號 live 原因的推論。

Renderer 保留分類與回應狀態，舊資料標示未記錄；public DTO 拒絕非法組合，聚合鍵分開保留不同固定維度。原 cursor、schema 2 歷史相容、嚴格日期、本輪互斥計數、128 KiB／2 秒錯誤讀取與 404 不讀 body 政策保持。Adapter 107 項聚焦驗證通過；renderer 16 項測試通過，390px 的摘要段落沒有溢出，viewport／暫時頁面與 server 已清理。最終來源保存檢查、完整 check、exact candidate 複審及 CI 需在補強完成後另行記錄。

新增本機證據：`/tmp/amz-expiry-source-diagnostics-body-renderer-red.log`、`/tmp/amz-expiry-source-diagnostics-body-renderer-green.log`、`/tmp/inventory-expiry-source-summary-complete-evidence/verification.json`。

補強後完整檢查已通過：326 files／4,106 tests、typecheck、build、stylesheet composition、diff check，production audit 0。來源摘要的 41 項測試包含 6,000 個來源／全部 200 種合法固定分類、旧三欄保存、未記錄與新回應狀態、嚴格日期及本輪互斥計數；相關 9 files／305 tests 另已通過。最終 check：`/tmp/amz-expiry-source-diagnostics-complete-check.log`；audit：`/tmp/amz-expiry-source-diagnostics-complete-audit.log`。補強後 final candidate 的兩軸複審與 CI 尚待，尚未合併／安裝 .75。
