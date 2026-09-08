# 0.1.59 獨立 FBA 商品準備修正

日期：2026-09-08。Issue #221；[spec](../specs/2026-09-08-standalone-live-preparation.md)。固定基準 `88577f87f3acd17b009fbf412523f71ba96cb047`，保留 PR #217 的首頁更新。

## 實機發現

0.1.58 已完成 Mac Keychain 啟動與受保護下載回驗，詳見 [前版紀錄](2026-09-variation-guidance-price-fix.md)。指定獨立 FBA 商品的 immutable shape／size 已能載入完整原值並保留，但尚有兩個 preparation 問題：

- 未綁掃描能正確辨識完整空 relationships，family parser 卻丟掉其讀取來源，導致清單入口誤報商品已變更。
- 手動來源及目標完整讀取後，attach preview 把單獨保留的既有 theme 誤當成未解除的 parent 關係。production public seam 只增加既有 matching theme 即重現相同拒絕，移除此唯一變數則通過。

## 修正與驗證界線

| 層級 | 狀態 | 證據 |
|---|---|---|
| 空 relationships regression | ★ RED→GREEN | 真正 family parser 接到 mounted picker；top-level／exact-market 空清單可以準備，缺失／畸形／foreign／fallback／incomplete 仍擋住 |
| matching theme regression | ★ RED→GREEN | 7 files／136 tests，含 73 個 production wire cases；相符主題省略 PATCH，9 類不安全資料停止，原生確認前後與 GET 回查 selector 漂移停止或維持 unknown，重送被拒，0.1.58 ledger recovery 通過 |
| production dependency audit | ★ 通過 | `npm audit --omit=dev`：0 vulnerabilities |
| 全 repo check／兩軸 review | ★ 通過 | `npm run check`：290 files／3,012 tests、typecheck、production build、stylesheet parity；Standards／Spec 對固定基準獨立審查，均無待修 finding；`git diff --check` 通過 |
| main／Pages／Mac／Windows | ☆ 尚未發布 | 安裝與驗證使用同一 exact release-code SHA 的可信 artifact |
| 新版實機唯讀／Excel 匯出 | ☆ 尚未完成 | 使用者解鎖後接續；帳號／安全 context 若失效，重新取得有效本機快照 |
| live Amazon mutation | ☆ 本次不執行 | 保留指定操作授權、native confirmation、durable idempotency、單次 PATCH／GET 回查 |

正式簽章、public feed、真人 Windows Hello／Windows 安裝仍為獨立驗收；更新通道保持 `disabled`。不保留商業工作簿內容或憑證到 repository。
