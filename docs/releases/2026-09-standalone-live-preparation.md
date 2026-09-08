# 0.1.59 獨立 FBA 商品準備與文字價格差額修正

日期：2026-09-08。Issue #221／[spec](../specs/2026-09-08-standalone-live-preparation.md) 與 Issue #223／[文字價格 spec](../specs/2026-09-08-price-text-comparison.md)。獨立商品修正基準 `88577f87f3acd17b009fbf412523f71ba96cb047`，文字價格修正基準 `61315bef984bdd3fd5239a77aa17fedc0aaba87e`；保留 PR #217 的首頁更新。最終 release-code SHA 為 `73ca77ec7b7ce6aab80fd5950949122a9b908d8a`。

## 實機發現

0.1.58 已完成 Mac Keychain 啟動與受保護下載回驗，詳見 [前版紀錄](2026-09-variation-guidance-price-fix.md)。指定獨立 FBA 商品的 immutable shape／size 已能載入完整原值並保留，但尚有兩個 preparation 問題：

- 未綁掃描能正確辨識完整空 relationships，family parser 卻丟掉其讀取來源，導致清單入口誤報商品已變更。
- 手動來源及目標完整讀取後，attach preview 把單獨保留的既有 theme 誤當成未解除的 parent 關係。production public seam 只增加既有 matching theme 即重現相同拒絕，移除此唯一變數則通過。

使用者在仍安裝 0.1.58 時另回報 `1MGRD015A0` 的「準備綁定」收到相同獨立 FBA／資料已變更錯誤。0.1.59 安裝後已驗此 SKU 的清單入口；原先的 `TPZ01AM-4` 與目標完整讀取後，preparation 仍遭 theme 站點條件不明阻擋，未到 Validation Preview，已交由 Issue #225／[0.1.60 帳本](2026-09-single-market-theme-preservation.md) 處理。

0.1.58 的唯讀未綁健檢實際完成 285 個 FBA、76 個已確認獨立商品與 1 個資料未完成；`EZD011`、`EZD061` 均顯示 `EZD_Series` 的 ★★★ 建議，依據為 3 個同系列 SKU。這證明前版已能顯示有證據的建議，不代表改掛成功；本次沒有 Amazon mutation。有限摘要留於本機 `/tmp/amz-api-v0158-verified/live/unbound-recommendations.json`。

0.1.59 於 2026-09-08 09:03:48 UTC 的實機驗收使用新版 fresh audit（285 FBA／76 獨立／1 未完成），從清單選 `1MGRD015A0` 後成功顯示「已確認為獨立 SKU，可綁定目標」，FBA count 為 1，沒有再次誤報商品已變更。仍需目標才能執行 Preview，這次操作沒有 Amazon mutation；有限摘要為 `/tmp/amz-api-v0159-verified/live/unbound-picker-1MGRD015A0.json`。

## 真實價目表延伸驗收

0.1.58 實機已從使用者原表完成 417 列唯讀價格讀取：242 列有價格，175 列無價格並提供逐列原因。原檔備份 bytes 完全一致；Amazon 首圖比對檔已成功儲存，10 sheets／7 visible、235 formulas、原格值、格式、合併、列欄與列印設定保留，242 個原圖片位置更新為 Amazon 首圖。使用者的原表、帳號或圖片內容不納入 repository。

唯讀 OOXML QA 同時發現 176 個已取得 Amazon 售價的來源文字價格漏算差額；四個來源／Amazon 價格及圖片本身正確。Issue #223 已透過 PR #224 在交付 0.1.59 前修正 UI 與 export 的一致解析：有限且無歧義的十進位文字價格可計算差額，相等價格輸出數值 0；缺失、無效值與布林值仍不可當成零。原始格值、型別、公式與兩份 Excel 的型別差異保持不變。不得把修正前 export 說成新版差額全部通過。

最終程式的唯讀補充 QA 以 PR #224 head `4fa43de73fd54be51d70db6c33cc065e2eaa6673`，重用先前取得的 Amazon 證據在記憶體產生 overlay：176／176 個文字售價差額與獨立 Python Decimal 核算一致，前三個相等案例皆為數值 0；417 個商品列與 242 個圖片 anchors 保持，原檔及先前 export bytes 未變。證據為本機 `/tmp/amz-api-v0158-verified/workbook/source-overlay-v0159-verification.json`。這是 source＋cached evidence QA，沒有新 Amazon 讀取，與下列新版實際匯出分開。

已安裝 0.1.59 的 fresh job 於 2026-09-08 17:14:14（Asia/Taipei）完成全部 417 列；242 列有價格、175 列缺值或無法唯一配對，visible 317 列為 231 差異／4 相同／82 待確認。啟用 Amazon 首圖後實際匯出 `/Users/jasper/Downloads/AMZ_US_Amazon_Comparison_20260908_v0159.xlsx`，23,404,935 bytes，SHA-256 `48c84d8db44d67723b0b22e8a184442d8e5694389a56461e11e27529c7645684`。唯讀 OOXML QA 確認 10 sheets／7 visible、原 6,048 cells 的值／型別／235 formulas／style、合併／列欄／panes／print 及原 232 圖片和 metadata 保留；242 圖片 anchors 替換、159 個新增去重圖片可解碼。原欄右方新增 2,766 comparison cells，176 個文字售價差額全數符合獨立 Decimal 計算，前三個相等售價差額為數值 0，原檔 SHA 未變。證據為 `/tmp/amz-api-v0159-verified/workbook/export-verification.json` 與 `export-aggregate-verification.json`；沒有開啟或重新儲存使用者正在編輯的舊 Excel。

實機另將原檔備份匯入「兩份 Excel 比對」，顯示 0 差異／0 新增／0 移除、304 相同及 56 重複貨號待確認；重複貨號保持人工核對，沒有猜測配對。原表檢視也顯示原工作表與右側四個價格／差額欄。

## 固定來源與部署證據

| 層級 | 狀態 | exact source／證據 |
|---|---|---|
| PR #222 獨立商品修正 | ★ 已合併 | [PR #222](https://github.com/jspusa/AMZ.API/pull/222) head `98d2857d1e25a3f106e81ec4e3a3a782ef579f23`；PR [Validate 34202833284](https://github.com/jspusa/AMZ.API/actions/runs/34202833284)／[Windows 34202833264](https://github.com/jspusa/AMZ.API/actions/runs/34202833264) 均成功；merge `61315bef984bdd3fd5239a77aa17fedc0aaba87e` |
| PR #224 文字價格修正 | ★ 已合併 | [PR #224](https://github.com/jspusa/AMZ.API/pull/224) head `4fa43de73fd54be51d70db6c33cc065e2eaa6673`；PR [Validate 34205045793](https://github.com/jspusa/AMZ.API/actions/runs/34205045793)／[Windows 34205045860](https://github.com/jspusa/AMZ.API/actions/runs/34205045860) 均成功；merge／最終 release-code `73ca77ec7b7ce6aab80fd5950949122a9b908d8a` |
| 最終 main Validate | ★ 成功 | [push run 34205661420](https://github.com/jspusa/AMZ.API/actions/runs/34205661420)，exact SHA `73ca77ec7b7ce6aab80fd5950949122a9b908d8a` |
| 最終 main Pages | ★ 成功 | [push run 34205661449](https://github.com/jspusa/AMZ.API/actions/runs/34205661449)，同一 exact SHA；artifact `10047686728`，不以 issues run 代替 |
| 最終 Pages 實際回讀 | ★ bytes 完全一致 | 2026-09-08 08:42:08 UTC：線上 `index.html` 與全部 9 個 JS／CSS 對該 exact-run artifact 逐檔相符；entry `index-D1spBcFz.js`、`index-DLk4XY3T.css`；價目表及變體懶載入模組均有入口引用 |
| 最終 main Windows | ★ attempt 1 成功 | [push run 34205661530](https://github.com/jspusa/AMZ.API/actions/runs/34205661530)，同一 exact SHA；artifact `10047859104`；290 files／3,063 passed／4 skipped，CI NSIS 安裝及 ZIP Bridge smoke 均通過 |
| 最終 main Mac | ★ attempt 2 成功 | [push run 34205661390](https://github.com/jspusa/AMZ.API/actions/runs/34205661390)，同一 exact SHA；artifact `10048078203`；attempt 1 的 timeout 診斷與唯一 failed-job rerun 保留於下表 |

最終 Pages 證據保存於本機 `/tmp/amz-api-v0159-verified/pages-final/pages-byte-verification.json`。`price-list-panel-By4dm5O8.js` SHA-256 為 `fb9d86389bc71b0d12272cdae7b92c81c21d3ad4abddb63e8056e7c255b0bf94`；`variation-planner-drawer-tQ8Djwct.js` 為 `998328fd3ced066bc2f3fa5750fdeb5087d679a6af24054edf8ffa3c68e4f1fb`。`price-list-steps`、`尚未開始讀取`、`接回讀取進度` 三個 parity markers 皆存在。初次 `61315bef` 的 Pages 證據仍獨立保留於 `pages/`，artifact `10046800977`，未被最終證據覆寫。

最終 Windows artifact 的本機靜態驗證於 2026-09-08 08:49:36 UTC 完成，證據為 `/tmp/amz-api-v0159-verified/windows-final/verification-result.json`。下載 archive 為 245,192,182 bytes，SHA-256 `52964cda4dbaf883ff70bf72fa9ce5e4becac6e7fb04f72d3deda2305884b3ee`。Setup 與 ZIP 均符合可信 manifest；AMD64 PE、N-API export、addon unpacked／manifest packed 邊界與相同 SHA-256、ASAR 版本 `0.1.59`／update channel `disabled` 均通過。本機核對沒有執行 Windows binary；CI smoke 與真人 Windows Hello／正式簽章保持分開。

| Windows 產物 | bytes | SHA-256／狀態 |
|---|---:|---|
| `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 101,957,071 | ★ `5006e9d11b07622e22aa279e8934fdb014a646ad3a7bddb586773217db58f9bb` |
| `AMZ.API-Notebook-Key-Windows-x64.zip` | 143,234,415 | ★ `202782f6614f3aeb1d7990e67f5e00504a85f3764939b7b4bf300cd5ef23f442` |

最終 Mac archive 實際下載與 manifest 核對通過：468,737,991 bytes，SHA-256 `d71eed6b849f6947a1f00918c5c2ccbba5d1d261e589b1622da30ce797ca6af3`。證據為 `/tmp/amz-api-v0159-verified/macos/verification.json`；packaged settings 確認版本 `0.1.59`、update channel `disabled`。

| Mac 產物 | bytes | SHA-256／狀態 |
|---|---:|---|
| `AMZ.API-0.1.59-universal.dmg` | 246,694,530 | ★ `16e8d90cf2d43474155027ffb93ed90a78ea94e2d36f4c9d7d35163e83d4e117` |
| `AMZ.API-0.1.59-universal.zip` | 222,042,817 | ★ `8a480c5a18d21cf1afd3c5996d36485342208dca77597b5bc7b849afe728d289` |

`/Applications/AMZ.API.app` 已安裝此可信產物，版本 `0.1.59`、universal 與 deep strict ad-hoc codesign 通過；ASAR SHA-256 `18127147fa890082892cb0799ba3d894f1be72893144be1c67f1a6f54e86bce4`。舊版保留為 `/Applications/AMZ.API-v0.1.58-backup-20260908.app`，vault bytes 未變，userData 備份目錄為 `0700`。本機證據為 `/tmp/amz-api-v0159-verified/installation-verification.json` 及 `user-data-backup-verification.json`。首次 CUA App 讀取在 10 秒 timeout 後，後續正常取得首頁且 Amazon 已連線，沒有要求新的權限；這不是原生寫入確認或 Amazon mutation 證據。

## 修正與驗證界線

| 層級 | 狀態 | 證據 |
|---|---|---|
| 空 relationships regression | ★ RED→GREEN | 真正 family parser 接到 mounted picker；top-level／exact-market 空清單可以準備，缺失／畸形／foreign／fallback／incomplete 仍擋住 |
| matching theme regression | ★ RED→GREEN | 7 files／136 tests，含 73 個 production wire cases；相符主題省略 PATCH，9 類不安全資料停止，原生確認前後與 GET 回查 selector 漂移停止或維持 unknown，重送被拒，0.1.58 ledger recovery 通過 |
| production dependency audit | ★ 通過 | `npm audit --omit=dev`：0 vulnerabilities |
| PR #222 全 repo check／兩軸 review | ★ 通過 | 290 files／3,012 tests、typecheck、production build、stylesheet parity；Standards／Spec 均無待修 finding；`git diff --check` 通過 |
| Issue #223 文字價格修正 | ★ 通過 | 4 files／88 focused tests，公開 export、renderer 狀態與 mounted view RED→GREEN；最終 `npm run check` 290 files／3,067 tests、typecheck、build、stylesheet parity；audit 0 vulnerabilities，Standards／Spec 對 `61315bef` 均無待修 finding |
| 原資料＋最終程式差額 QA | ★ 通過；☆ 非新版實機 | 重用先前唯讀證據，176／176 個文字價格差額符合獨立 Decimal 核算，前三個相等案例為數值 0；原檔與先前 export bytes 未變 |
| PR #222／初次 main | ★ 歷史部署證據；☆ 未作最終交付 | `61315bef984bdd3fd5239a77aa17fedc0aaba87e`；Validate／Pages 成功，線上 index 與全部 9 assets bytes 相符。Windows 因未改動的 brand-sales 測試 5 秒 timeout 失敗；同 tree PR Windows 及本機原檔通過。保留失敗證據，沒有盲目重跑；PR #224 已加入價格差額修正，不混用初次產物 |
| 最終 Mac 工作流 attempt 1 | ☆ 失敗已診斷 | [run 34205661390](https://github.com/jspusa/AMZ.API/actions/runs/34205661390) 的 `dashboard-audit-workspace-interaction.test.tsx:62` 在 5,000 ms timeout，3,065 passed／1 failed／1 skipped，沒有 assertion mismatch；該 test／Dashboard 本輪未改，同 SHA 的 main Validate 862 ms、本機 full 376 ms、focused 403 ms 均通過。診斷後只執行一次 failed-job rerun，未改程式或 timeout；runner 時序／負載為可能原因，尚未證實 |
| 最終 Mac 工作流 attempt 2 | ★ 成功 | 同一 run／SHA 的 Validate 於 2026-09-08 08:49:35 UTC 通過，universal 打包、ad-hoc verify 與 DMG／ZIP 建立完成；可信產物 `10048078203` 已下載核對 |
| 最終 Mac artifact | ★ 驗證通過 | 最終 release-code SHA 的 run `34205661390` attempt 2／artifact `10048078203`，archive／manifest／DMG／ZIP bytes 與 SHA-256 相符，packaged 版本 `0.1.59`／update channel `disabled` |
| 最終 Windows artifact | ★ 驗證通過 | 同一最終 release-code SHA 的 run `34205661530`／artifact `10047859104`，Setup／ZIP bytes 與 SHA-256、AMD64／N-API／ASAR 邊界及 addon hash、版本／update channel 均通過；不是真人 Hello 證據 |
| 0.1.59 Mac 安裝 | ★ 安裝／啟動通過 | `/Applications/AMZ.API.app` 版本 0.1.59、universal／deep strict codesign／ASAR 核對通過；0.1.58 備份、vault bytes 與 0700 userData 備份保留，實機首頁正常且 Amazon 已連線 |
| 受保護下載入口上傳 | ★ 兩份成功；☆ 尚非完整交付 | 按 Windows→Mac 序列上傳，服務均回傳與可信產物相同的 bytes／SHA-256，避免 manifest 並行覆蓋；不能把上傳成功當成登入後下載成功 |
| 受保護登入後下載 | ☆ 等待驗證 | 登入已過期，等待使用者在目前頁面重新登入後實際下載兩份產物並核對 bytes／SHA-256；整個 portal 尚未標為完成 |
| 新版獨立 FBA 唯讀驗收 | ★ `1MGRD015A0` 清單入口通過；☆ TPZ 另案修正 | fresh audit 285／76／1；選取後顯示已確認獨立 SKU、FBA 1。TPZ preparation 的 theme 站點錯誤交由 Issue #225；未送 Preview／commit |
| 新版實機 Excel 匯出 | ★ 通過 | fresh 417 列讀取及實際 export 完成，原表／圖片／公式保留；176 文字價格差額全數正確，前三個相等售價差額為數值 0；兩份 Excel 入口亦完成原檔備份比對 |
| live Amazon mutation | ☆ 本次不執行 | 保留指定操作授權、native confirmation、durable idempotency、單次 PATCH／GET 回查 |

正式簽章、public feed、真人 Windows Hello／Windows 裝置安裝仍為獨立驗收；更新通道保持 `disabled`。不保留商業工作簿內容或憑證到 repository。
