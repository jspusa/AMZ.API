# 入庫效期請求拒絕的固定安全診斷

2026-09-13；診斷工作 Issue #273，接續完整效期目標 Issue #263（不結案）。基線 0.1.72／`ad5a1e7080ed72025b50c774f9c11e52ec0fc998`。本機能力版本 0.1.73；不包含同時進行的效期表格版面修改。

## 問題與範圍

可信 0.1.72 原生全 FBA 同步已完成一次，核心庫存可讀，但入庫效期以「Amazon 無法驗證這次 FBA 入庫貨件唯讀請求。（FBA_INBOUND_UPSTREAM_UNAVAILABLE）」停止。這是 production adapter 的 HTTP 400／422 文案；401／403 與 LWA 錯誤使用其他診斷，不能推定使用者需要重新登入或授權。

原錯誤把計畫／商品、首頁／接續頁及 Amazon 具體原因全壓成同一文案。這次只讓下一次明確同步留下足夠安全證據，不宣稱已修復尚未辨識的 Amazon 原因，不更改 query、跳過計畫或使 partial 變 complete。

## 契約

1. 僅 modern `plans`／`plan-items` 的終態 HTTP 400／422 解析已收到的錯誤 body。固定 host／GET／path／pageSize／排序／pagination 及既有 token refresh、限流與 transient retry 不變；診斷不發額外請求。
2. 保留原 HTTP status、`FBA_INBOUND_UPSTREAM_UNAVAILABLE` 與主文案，附加由固定 enum 組成的中文診斷：計畫／商品、首頁／接續頁、400／422、審閱過的 `BadRequest`／`InvalidInput`／未辨識、原因與 body 狀態。沿用既有 canonical sanitizer 和 sync error message，不新增 route、DTO、診斷控制或登入介面。
3. body 上限 128 KiB，最多 8 個 errors，2 秒獨立讀取期限、fatal UTF-8 JSON；必須是只有 errors 的 object，error 只含 code（1–256）、message（1–2048）及選填 details（0–8192）。未知／畸形／超量／讀取失敗保留原 400／422；caller abort 原樣傳遞。讀取結束或中止一律釋放自己的 reader，取消未用 body，不 replay。
4. 原始 body、message、details 與 request 中的 plan ID、token、URL 不進 Error、log、檔案、renderer 或新增儲存。任意 syntactically safe upstream code 也不能輸出；只投影列出的 literal enum。raw 值只在本次 main 記憶體內作 exact 比對後丟棄。
5. HTTP 400＋BadRequest＋正確 operation＋整段已知文案，才能標示具體原因。舊 v0 不支援只接受整段已知訊息與可選固定 `ERROR: ` 前綴；不得做 keyword、大小寫、trim 或部分匹配。其他 BadRequest／InvalidInput 標示其他請求條件遭拒。未列 code 或多個不一致的 code／原因一律未辨識。沒有官方 Inbound 模板的 invalid-pagination 不憑關鍵字推論。
6. body 狀態固定為已讀取、空白、格式無法辨識、超過讀取上限、讀取逾時、無法讀取。任一已解析 error 結構不符，整份診斷保持未知；一致的多筆 errors 可共用同一固定原因。
7. 不更改成功 response 解析、checkpoint／cache、exact context／FBA 身分、資料上限、來源完整度、人工資料或行事曆規則。失敗仍停止該次效期讀取，保留已核對的庫存估算並暫停批次提醒。

## 原因與官方依據

| 分類 | 必須符合的證據 | 用途 |
|---|---|---|
| ★ 舊版入庫計畫不支援商品讀取 | plan-items、400、BadRequest、#3977 的整段固定錯誤 | 辨識歷史 v0 轉換計畫的已知限制；尚不自動跳過 |
| ★ 指定入庫計畫不存在 | plan-items、400、BadRequest、官方 sandbox 缺計畫訊息 | 回報 Amazon 拒絕原因，不推定刪除者或時點 |
| ★ 計畫狀態條件遭拒 | plans、400、BadRequest、官方 sandbox 狀態訊息 | 辨識已知狀態條件拒絕，不更改固定 query |
| ★ 其他請求條件遭拒／尚無可辨識原因 | 只有 generic code 或不符合上述 exact evidence | 維持未知，不作語意 fallback |

- [官方 listInboundPlans](https://developer-docs.amazon/sp-api/reference/listinboundplans)：pageSize 1–30、LAST_UPDATED_TIME／DESC 與現行固定 query 相符。
- [官方 listInboundPlanItems](https://developer-docs.amazon/sp-api/reference/listinboundplanitems)：pageSize 1–1000、38 字元計畫識別碼與現行固定 query 相符。
- [官方 pinned model](https://raw.githubusercontent.com/amzn/selling-partner-api-models/3659f96867bfc669aca7a524c2f95744ff0e4478/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json)：兩個 operation 的 HTTP 400 sandbox error 分別提供 invalid-status 與 missing-plan 的 exact message；ErrorList／Error 定義提供欄位長度。
- [Amazon #3977](https://github.com/amzn/selling-partner-api-models/issues/3977) 與 [SP-API Solutions Architect 回覆](https://github.com/amzn/selling-partner-api-models/issues/3977#issuecomment-2242101273)：2024-07-22 確認轉換的歷史 v0 計畫限制。這是固定分類的歷史來源，不是本次 native 根因證明。

## 驗證與界線

首先以 real production adapter → FbaExpiryReads → InventoryHealthCoordinator → InventoryHealthSync 建立 RED：四種 page position 的錯誤都缺少預期診斷。實作後同 seam 核對 400／422、三種 exact 已知原因、canary 不外洩、stock／clearance 保留、sourceComplete=false、calendarEligible=false、GET observe 不增加請求。

另覆蓋 exact prefix／suffix／operation／status 限制、未知及衝突 errors、全部結構／長度上限、128 KiB 邊界及隱瞞 Content-Length、UTF-8／JSON、期限、caller abort、stream failure、原 401 refresh 與 403／404／429／500 行為、v0 與其他 modern operations 不變。聚焦測試與完整 check／audit 為程式證據；下一次可信 native 同步才可證明真正 Amazon 拒絕原因。

若之後確證個別 legacy 計畫 unavailable，另作 evidence-backed 相容修正，使其他可存取計畫能繼續讀取。該修正需區分掃描結束與來源完整，避免 partial／complete checkpoint 反覆列表；本次不先實作，也不以此縮小原始全 FBA 效期需求。

本機最後驗證：`npm run check` 通過 323 個 test files／3,942 tests、typecheck、build 與 stylesheet verification；新診斷套件 56 tests 通過。`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。這些不代表 native 根因或完整效期已驗收。
