# 0.1.60 單站既有變體主題保留

日期：2026-09-08。Issue #225／[spec](../specs/2026-09-08-single-market-theme-preservation.md)。固定基準 `73ca77ec7b7ce6aab80fd5950949122a9b908d8a`，保留 PR #217、#222、#224。

0.1.59 已在使用者 Mac 安裝並連線，實際解決 `1MGRD015A0` 清單準備入口的錯誤。原始 `TPZ01AM-4` 與目標 `AF Turkey Tedon_Small` 都完整讀取後，仍在準備階段收到 variation_theme 站點條件不明；當時尚未執行 Validation Preview，也沒有 Amazon mutation。錯誤無法區分 selector 真正缺席與 malformed，不能從畫面推定私有原始資料的形狀。

官方範例允許 theme 沒有站點欄位，但現在 Listings GET 也支援多站。因此本次只在實際完整單站讀取、exact SKU 與原 attributes 物件都有 main-only provenance 時，容許保留完全缺席 selector 的唯一 matching theme。沒有補寫 selector，也不送 theme PATCH；malformed、foreign、mixed、duplicate、關係殘留與證據漂移仍停止。既有 native confirmation、durable ledger、unknown／no-blind-retry 與 canonical readback 保持。

| 層級 | 狀態 | 證據與界線 |
|---|---|---|
| Production 重現與聚焦 regression | ★ 通過 | omitted-selector public seam RED→GREEN；8 files／173 tests，含偽造與複製 scope、fallback、selector 雙向漂移、native 前後及 readback unknown／最多一個 PATCH |
| 最終本機全庫檢查 | ★ 通過 | `npm run check`：290 files／3,088 tests、typecheck、build、stylesheet parity；`npm audit --omit=dev`：0 vulnerabilities；本機記錄 `/tmp/amz-api-v0160-check.log` |
| Spec review | ★ 通過 | 對固定基準與凍結 code/test diff，0 actionable findings |
| Standards review | ★ 通過 | 同一固定基準與凍結 production/test diff，0 actionable findings；核對 renderer/main 邊界、原資料綁定及既有安全契約 |
| 最終 PR／main／平台 artifacts | ☆ 尚未發布 | 使用同一最終 release-code SHA 的成功 CI 與可信 artifacts，不混用 0.1.59 |
| Mac 安裝／受保護下載 | ☆ 等待新版 | 保留舊版與 encrypted vault；兩平台上傳需序列執行，登入後實際下載另核 bytes／hash |
| 原始 TPZ 實機驗收 | ☆ 等待新版 | 重新讀取並到 Amazon Validation Preview；沒有正式綁定授權，不執行 mutation |
| 價目表 | ★ fresh export QA 通過 | 本次沒有價格 code 變更。已安裝 0.1.59 完成 fresh 417 列／242 有價格／175 無價格及 Amazon 首圖匯出，原表 6,048 cells／235 formulas 等保留、176 文字價格差額全對；完整核對與兩份 Excel 實機結果另記於 0.1.59 帳本 |

真人 Windows Hello、正式簽章與正式 Amazon mutation 不由 CI 或靜態驗證推定；更新通道保持 disabled。私有工作簿、帳號憑證與 raw responses 不納入 repository。
