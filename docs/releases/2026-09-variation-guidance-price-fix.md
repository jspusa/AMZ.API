# 0.1.58 變體建議與價目表操作修正

日期：2026-09-08。Spec：[本輪需求](../specs/2026-09-08-variation-guidance-price-fix.md)，Issue #218。固定基準 `d79f7ac18b7b8f964866da8cfa17a3bec1179b0f`。

## 問題與處理

- production variation seam 重現未修改 immutable 維度仍在 preparation 被拒。修正為完整原值保留、gateway 省略維度 PATCH；更改／缺少／歧義仍拒絕。新增 schema drift、selector drift、durable recovery 回歸，保留既有 ledger 不重送行為。
- 未綁建議沿用原 audit owner 公開快照，以 verified 同系列 SKU、Product Type 與 theme 計數排序；實際 slash theme 納入回歸。從清單及建議選擇一律 fresh-read，沒有自動 mutation。
- 已安裝 0.1.57 實際唯讀查價已完成使用者原表，使用者指定的前三個商品均取得 Amazon 售價／最低價格。因此本輪不改 transport 或猜 SKU；修正尚未讀取與進度的可見性、失敗原因、GET 重接、匯出條件及同次返回。
- Dashboard 返回價目表會保留相同面板實例；連線變更由既有 App reloadKey 卸載 Dashboard。來源檔、account/context 失效仍由 main 拒絕，renderer 提示重新匯入。

## 證據

| 層級 | 狀態 | 證據 |
|---|---|---|
| 指定 regression | ★ 已通過聚焦檢查 | production variation、未綁建議、價格狀態與返回工作区；完整檢查另列 |
| 原版 live 價格診斷 | ★ 唯讀完成 | 0.1.57 原表讀取及三個指定範例；資料只在本機，未提交 Amazon 更新 |
| 完整 check／audit | ★ 已通過 | 289 files／2,981 tests、typecheck、build、stylesheet parity；production audit 0 vulnerabilities，diff check 通過 |
| 固定基準兩軸 review | ★ 已完成 | Standards／Spec 獨立審查；公開錯誤清理、main 零價格匯出、重開焦點 finding 已修正並回歸 |
| 合成瀏覽器操作 | ★ 已通過 | 1440／390px 無整頁橫溢；價目表七欄可讀、返回保留同一 job；未綁選擇 fresh-read，Preview 1 次、PATCH 0 次 |
| main／Pages／Mac／Windows artifact | ☆ 尚未發布 | 不以本機 build 推定 |
| 受保護下載與 Mac 安裝 | ☆ 尚未更換 | 保留既有 vault 和 0.1.57 備份後進行 |
| 新版 live 唯讀 | ☆ 待安裝後核對 | 價格、未綁建議與 immutable preparation 分開確認 |
| live mutation／native biometrics | ☆ 本次未執行 | 需要另行 exact operation 授權；CI 不代表真人 Touch ID／Windows Hello |

正式簽章、public update feed 與 Windows 使用者實機驗收保持原有獨立邊界。內部 artifact 更新通道維持 `disabled`。
