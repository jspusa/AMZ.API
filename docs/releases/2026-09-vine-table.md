# Vine 表格與低頻入口

2026-09-14 Control Console Release。需求見 [核准規格](../specs/2026-09-vine-table.md)；開工來源 `73fc04ed9c1d4a36407f150d5e9045664065f7e9`。

Vine 進行中改為六欄橫列表格，使用已驗證的評論／註冊數計算三分之二門檻，未知保持紅燈及未回報。首頁低頻健檢新增入口，返回恢復展開、捲動與焦點；既有營運區入口保留，七項 run-all 不變。此輪只改 renderer，不提高 Notebook Key 版本，也不改 main／preload、Amazon route、加密資料或匯入格式。

## 驗證

- VinePanel 公開顯示回歸先以缺少表格失敗，再通過六欄、20/30、19/30、10/15、9/15、22/30、0/30、1/2、2/2 及未回報案例；保留本機 GET、明確匯入與 context 清除測試。
- Dashboard 互動核對預設收合、進入 Vine、返回原卡焦點與捲動位置且只觀察本機資料；樣式契約已按實際組成更新。
- 聚焦檢查：7 檔／40 tests 通過。完整 `npm run check` 通過 329 檔／4,177 tests、TypeScript、production build 及 stylesheet parity；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。Standards 與 Spec 獨立審查均為 0 actionable findings。Pages 發布證據見下方。
- 正式環境沒有匯入、同步或 Amazon mutation；合成資料的視覺結果不代表 live Amazon 行為或原生生物辨識驗收。

視覺初查涵蓋 1440／390 px、深淺色及大字；小螢幕大字的 ASIN／日期欄距偏窄，已將表格最小寬度加至 76rem，並重跑完整 check 通過。最終組成指紋 `41fef484eb8ddfbbbe6b4efb6f1e2019f6985ec3360292cf2cc3406df3bec930`。

最終 production browser QA 使用合成資料，1440／390 px × 深／淺色 × 標準／大字共 8 組皆無文件或儲存格溢位、無 browser errors。390 px 表格於自身容器內捲動；1440 px 完整六欄。長品名換行、未回報狀態、紅綠燈、門檻數字與低頻入口返回焦點已核對，Vine 僅 1 次 fixture GET。local 證據位於 `output/playwright/vine-table/`。

## 已發布

[PR #287](https://github.com/jspusa/AMZ.API/pull/287) 已於 2026-09-14 06:56:06 UTC squash merge 至 `7f33210ccf7e3412e9c889b76d5824c928e77462`。PR head `37a5c4f5a9ea11a307007f4514ab01f5bf0ef31e` 與 merge commit 的 tree 完全相同（`7c312486ebb8f3275a1b0e5dfa5baf1b832b42bf`）。PR [Validate](https://github.com/jspusa/AMZ.API/actions/runs/34815121224) 與 [Windows](https://github.com/jspusa/AMZ.API/actions/runs/34815121195) 均通過後才合併。

正式來源的 [Validate](https://github.com/jspusa/AMZ.API/actions/runs/34815547915) 與 [Pages](https://github.com/jspusa/AMZ.API/actions/runs/34815547933) 均成功。已下載該 Pages workflow 的 `github-pages` artifact，並逐一讀取公開首頁與全部 10 個 JS／1 個 CSS；12 個檔案皆 bytes 完全相符。UI build 注入 commit／建置時間，因此 local fixture 與 CI 的 JS 檔名會不同；線上核對使用 exact-source CI artifact，未拿 local output 冒充部署產物。

| 線上檔案 | Bytes | SHA-256 | 核對 |
|---|---:|---|---|
| `index.html` | 917 | `b91ceb3bcf75d0fa459e57d7689d35bd7775b17724232f8bd63fc29f05d86c2c` | ★ 相符 |
| `assets/accounting-center-panel-BwD8mNQG.js` | 20,839 | `c6fd7aaccdb176cf79fc1727c4e4d8790232f77d142326b617781b983f3683a5` | ★ 相符 |
| `assets/aged-inventory-panel-84hRphyN.js` | 45,951 | `b7c3d9884d7158e4ebc94bdd0b886a94ed2579b9068231ebff58dbde044e395b` | ★ 相符 |
| `assets/content-spelling-metadata-C1Qf4pPO.js` | 324 | `4a29c7a49453b8faa7b6df89a67c171f4c2e3c07c684de39540065e3ed5ae6a1` | ★ 相符 |
| `assets/index-BsBVslIo.js` | 2,062,535 | `592b3a84e7fab521993d78890822feda6064492dd481daa95535e1535b7c7d5c` | ★ 相符 |
| `assets/inventory-health-panel-BsIXHGx-.js` | 39,401 | `27df572632cd65d8a4fe09740a19c4e1f08069220f9fdc8f91c80e83d73ef66a` | ★ 相符 |
| `assets/price-list-panel-C-ZpF_s4.js` | 60,738 | `4c53a897f2247ead5e1fb9a83df08a3fc6b07452d91ec562daa4e3bd40340971` | ★ 相符 |
| `assets/report-library-panel-D8iAPM6C.js` | 23,979 | `2d378e00f0acf0020e7d259ff5a75865a0b800cf63fd7f21f093201ef1e3048b` | ★ 相符 |
| `assets/review-audit-panel-jDReYA0n.js` | 16,768 | `881083379bb2211afab747ef6d8a3cd133bae16a829022f58fd67fac7be43af1` | ★ 相符 |
| `assets/variation-planner-drawer-iGk-5FJE.js` | 128,024 | `3419c3e5ef3aceef9f69b0c19c5c2cdea3bbb343f42d482321a1797e2666c2a2` | ★ 相符 |
| `assets/vine-panel-BHP-e1SM.js` | 27,124 | `6db0799823aa931af47cf168192451fda9ed38237a177fc49181999300bbb8da` | ★ 相符 |
| `assets/index-G8uX38VA.css` | 874,090 | `aa8a86eab0cc6da52f5945e044a99d1871a82853cc7115879a3c116b44551e50` | ★ 相符 |

本次交付是已部署的 Control Console Release，既有 Notebook Key 重新載入 Pages 即可使用。自動觸發的桌面 CI 不構成本次 App 發版、下載卡更新、安裝或 live Amazon 驗收；未變更／重裝 Notebook Key、未更新員工下載卡、未匯入真實 Vine 資料或發送 Amazon mutation。
