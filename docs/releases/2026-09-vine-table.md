# Vine 表格與低頻入口

2026-09-14 Control Console Release。需求見 [核准規格](../specs/2026-09-vine-table.md)；開工來源 `73fc04ed9c1d4a36407f150d5e9045664065f7e9`。

Vine 進行中改為六欄橫列表格，使用已驗證的評論／註冊數計算三分之二門檻，未知保持紅燈及未回報。首頁低頻健檢新增入口，返回恢復展開、捲動與焦點；既有營運區入口保留，七項 run-all 不變。此輪只改 renderer，不提高 Notebook Key 版本，也不改 main／preload、Amazon route、加密資料或匯入格式。

## 驗證

- VinePanel 公開顯示回歸先以缺少表格失敗，再通過六欄、20/30、19/30、10/15、9/15、22/30、0/30、1/2、2/2 及未回報案例；保留本機 GET、明確匯入與 context 清除測試。
- Dashboard 互動核對預設收合、進入 Vine、返回原卡焦點與捲動位置且只觀察本機資料；樣式契約已按實際組成更新。
- 聚焦檢查：7 檔／40 tests 通過。完整 `npm run check` 通過 329 檔／4,177 tests、TypeScript、production build 及 stylesheet parity；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。Standards 與 Spec 獨立審查均為 0 actionable findings。Pages 發布證據待下方補記。
- 正式環境沒有匯入、同步或 Amazon mutation；合成資料的視覺結果不代表 live Amazon 行為或原生生物辨識驗收。

視覺初查涵蓋 1440／390 px、深淺色及大字；小螢幕大字的 ASIN／日期欄距偏窄，已將表格最小寬度加至 76rem，並重跑完整 check 通過。最終組成指紋 `41fef484eb8ddfbbbe6b4efb6f1e2019f6985ec3360292cf2cc3406df3bec930`。

最終 production browser QA 使用合成資料，1440／390 px × 深／淺色 × 標準／大字共 8 組皆無文件或儲存格溢位、無 browser errors。390 px 表格於自身容器內捲動；1440 px 完整六欄。長品名換行、未回報狀態、紅綠燈、門檻數字與低頻入口返回焦點已核對，Vine 僅 1 次 fixture GET。local 證據位於 `output/playwright/vine-table/`。
