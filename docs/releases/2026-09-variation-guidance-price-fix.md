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
| main／Pages | ★ 已發布並核對 | PR #219，source `9ce9bebba2dabcce82604a1d7a423c68608ad962`；push Pages `34197661166`、Validate `34197661083` 成功；Pages artifact `10044559944` 的 HTML 與全部 9 個 JS／CSS 符合線上 bytes |
| Mac artifact | ★ 已核對 | run `34197661044` attempt 2／artifact `10044895335`，GitHub archive digest、SHA256SUMS、universal 架構與 deep strict ad-hoc codesign 均通過；Mac CI 289 files／2,980 tests passed、1 skipped |
| Windows artifact | ★ 已核對 | run `34197661019` attempt 2／artifact `10044877536`，GitHub archive digest、SHA256SUMS、AMD64 N-API addon、ASAR manifest 與 0.1.58／disabled 均通過；Windows CI 289 files／2,977 tests passed、4 skipped |
| Mac 安裝 | ★ 已更換 | `/Applications/AMZ.API.app` 已為 0.1.58，ASAR 與可信 DMG 相符、universal、codesign／disabled channel 通過；0.1.57 備份及 encrypted vault 保留且原 bytes 未變 |
| 受保護下載 | ★ 登入後回驗完成 | 使用者完成登入；Mac／Windows 卡片均為 0.1.58，兩份實際下載 bytes 與 SHA-256 符合上表可信 artifact。證據在本機 `portal-authenticated-download-verification.json` |
| 新版 live 唯讀 | ☆ 部分通過，發現後續修正 | 使用者完成 Keychain 驗證後 App 已連線；原 immutable shape／size preparation 成功。未綁 picker 遺失合法空 relationships 證據、attach preview 又誤擋既有 theme，已以 production seam 重現並列入 Issue #221。新版原表查價已取得指定三個商品，整表匯出另待完成 |
| live mutation／native biometrics | ☆ 本次未執行 | 需要另行 exact operation 授權；CI 不代表真人 Touch ID／Windows Hello |

正式簽章、public update feed 與 Windows 使用者實機驗收保持原有獨立邊界。內部 artifact 更新通道維持 `disabled`。

本次 App 開啟期間 PR #217 更新 Pages，舊入口首次載入尚未快取的價目表 chunk 時遇到 404；完整重新載入後價目表恢復。新舊價目表 chunk 除入口 import 檔名外逐字相同，不能把此部署時序誤報為價格 transport 失敗。後續修正見 [standalone live spec](../specs/2026-09-08-standalone-live-preparation.md)。

## 可信安裝檔

| 檔案 | bytes | SHA-256 |
|---|---:|---|
| `AMZ.API-0.1.58-universal.dmg` | 246,691,338 | `ff00afafb76dd3b1ac69a4b8c0cdabda76c00291fae18f807b10291f038e404b` |
| `AMZ.API-0.1.58-universal.zip` | 222,043,403 | `c761c1a6ecc09a427642c58549645bf18c0b05eb754091f599b68fe2f525a1fe` |
| Windows x64 Setup | 101,954,385 | `171cc7e6c15721bd9af4f753467bba22dded2824d1af8e1fc5edca4117ca70e9` |
| Windows x64 ZIP | 143,236,131 | `b20199445df23e3ff7460a6972d9a6cb07c5e42d613bd02bc99942617ea96458` |

installed ASAR SHA-256：`961c3a1286b58ceee8b390c92c006c834d96147d81c8d19751440e46c4316860`。0.1.57 備份在 `/Applications/AMZ.API-v0.1.57-backup-20260908.app`；userData 私密備份目錄權限 0700。未取得或輸出任何憑證明文。

## CI 時序診斷

PR head `02d339489270b463b2f6e75f70aa3a51aff99491` 的 Validate 與 Windows 檢查均成功；合併後 main 與 PR tree 同為 `b2382cde5380f5eebac23718e091632efbd4f72a`。main 首次 Mac 檢查在既有 Orders 靜態依賴掃描超過 5 秒；Windows 在既有 disposed poll flight 測試的 1 秒 waitFor 視窗失敗。兩個測試與其 production owner 本輪未修改。聚焦重跑 113 tests 全部通過，保留失敗 log 後各執行一次 failed-job rerun，未放寬測試或跳過檢查。第二次兩平台均成功；最終 artifact 核對見上表。
