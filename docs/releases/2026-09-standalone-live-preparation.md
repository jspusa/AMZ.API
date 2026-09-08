# 0.1.59 獨立 FBA 商品準備修正

日期：2026-09-08。Issue #221；[spec](../specs/2026-09-08-standalone-live-preparation.md)。固定基準 `88577f87f3acd17b009fbf412523f71ba96cb047`，保留 PR #217 的首頁更新。

## 實機發現

0.1.58 已完成 Mac Keychain 啟動與受保護下載回驗，詳見 [前版紀錄](2026-09-variation-guidance-price-fix.md)。指定獨立 FBA 商品的 immutable shape／size 已能載入完整原值並保留，但尚有兩個 preparation 問題：

- 未綁掃描能正確辨識完整空 relationships，family parser 卻丟掉其讀取來源，導致清單入口誤報商品已變更。
- 手動來源及目標完整讀取後，attach preview 把單獨保留的既有 theme 誤當成未解除的 parent 關係。production public seam 只增加既有 matching theme 即重現相同拒絕，移除此唯一變數則通過。

## 真實價目表延伸驗收

0.1.58 實機已從使用者原表完成 417 列唯讀價格讀取：242 列有價格，175 列無價格並提供逐列原因。原檔備份 bytes 完全一致；Amazon 首圖比對檔已成功儲存，10 sheets／7 visible、235 formulas、原格值、格式、合併、列欄與列印設定保留，242 個原圖片位置更新為 Amazon 首圖。使用者的原表、帳號或圖片內容不納入 repository。

唯讀 OOXML QA 同時發現 176 個已取得 Amazon 售價的來源文字價格漏算差額；四個來源／Amazon 價格及圖片本身正確。Issue #223／[補充 spec](../specs/2026-09-08-price-text-comparison.md) 在交付 0.1.59 前修正 UI 與 export 的一致解析。不得把這份修正前 export 說成差額全部通過。

## 修正與驗證界線

| 層級 | 狀態 | 證據 |
|---|---|---|
| 空 relationships regression | ★ RED→GREEN | 真正 family parser 接到 mounted picker；top-level／exact-market 空清單可以準備，缺失／畸形／foreign／fallback／incomplete 仍擋住 |
| matching theme regression | ★ RED→GREEN | 7 files／136 tests，含 73 個 production wire cases；相符主題省略 PATCH，9 類不安全資料停止，原生確認前後與 GET 回查 selector 漂移停止或維持 unknown，重送被拒，0.1.58 ledger recovery 通過 |
| production dependency audit | ★ 通過 | `npm audit --omit=dev`：0 vulnerabilities |
| PR #222 全 repo check／兩軸 review | ★ 通過 | 290 files／3,012 tests、typecheck、production build、stylesheet parity；Standards／Spec 均無待修 finding；`git diff --check` 通過 |
| Issue #223 文字價格修正 | ★ 通過 | 4 files／88 focused tests，公開 export、renderer 狀態與 mounted view RED→GREEN；最終 `npm run check` 290 files／3,067 tests、typecheck、build、stylesheet parity；audit 0 vulnerabilities，Standards／Spec 對 `61315bef` 均無待修 finding |
| PR #222／初次 main | ★ 已合併；☆ 未交付 | `61315bef984bdd3fd5239a77aa17fedc0aaba87e`；Validate／Pages 成功，線上 index 與全部 9 assets bytes 相符。Windows 因未改動的 brand-sales 測試 5 秒 timeout 失敗；同 tree PR Windows 及本機原檔通過。保留失敗證據，沒有盲目重跑；後續 Issue #223 使用新 head 正常建置 |
| 最終 main／Mac／Windows／安裝 | ☆ 等待價格差額修正 | 安裝與驗證使用同一最終 release-code SHA 的可信 artifact，不能混用初次產物 |
| 新版實機唯讀／Excel 匯出 | ☆ 尚未完成 | 修正前實機 export 已完成並找到精確差額漏值；新版需 fresh snapshot 及再次 export 核對 |
| live Amazon mutation | ☆ 本次不執行 | 保留指定操作授權、native confirmation、durable idempotency、單次 PATCH／GET 回查 |

正式簽章、public feed、真人 Windows Hello／Windows 安裝仍為獨立驗收；更新通道保持 `disabled`。不保留商業工作簿內容或憑證到 repository。
