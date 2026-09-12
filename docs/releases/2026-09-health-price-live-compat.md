# 0.1.67 效期報表與價目表相容性修正

Issue [#258](https://github.com/jspusa/AMZ.API/issues/258)，[需求規格](../specs/2026-09-health-price-live-compat.md)。Source base `f91d236683c437ca6ba873ed1593121e3c865748`，分支 `codex/health-price-live-compat-20260913`。[PR #259](https://github.com/jspusa/AMZ.API/pull/259) 已合併至 release source `38f9bed050e0d9d33a7e69df8d34c410d547e069`。0.1.67 的網站、兩平台可信產物與受保護下載卡上傳均已完成；這台 Mac 仍安裝 0.1.66，新版安裝、完整原生驗收與員工下載 bytes 尚待完成。

## 原生發現

可信 0.1.66 已安裝於 `/Applications/AMZ.API.app`，啟動授權後原生首頁顯示 Amazon 已連線、US 與圖片門檻 8。這取代前份帳本中尚待啟動授權的狀態；不代表圖片服務首次保存或後續 Touch ID 已驗。

未選來源 Excel，第一次按「產生 Amazon 價目表」後找到 285 個 FBA 商品，曾觀察 67／285、160／285 及真實售價，最後以 Listing 身分不完整訊息失敗，未產生下載檔。第一次「同步全部 FBA 效期與銷速」則以 `REPORT_FORMAT_UNSUPPORTED` 重複／衝突欄位訊息失敗。兩項都未重新啟動，也沒有 Amazon Preview、原生寫入批准或 mutation。

Public seam 已重現單筆 `409 LISTING_IDENTITY_MISMATCH` 中斷價格工作，以及兩組官方不同語意欄位被當作同義 alias 的報表拒絕。實際失敗的商品欄位及報表完整 header 未保留，不能從測試推定這次 live 的精確第一個衝突欄。

## 分層證據

| 範圍 | 狀態 |
| --- | --- |
| ★ Source／聚焦驗證 | 已完成兩個 owner 的窄修正，新增 40 個 public 回歸；健康 56 tests、價格相關 116 tests 通過 |
| ★ 全案 check／audit／兩軸 review | 最終 head `0ae39e47e180238e8b243714bb64e7ffed2aacff` 的 `VITEST_MAX_WORKERS=4 npm run check` 通過 323 files／3,794 tests、型別與 build；production audit 0、diff check 通過。Standards／Spec 自 base 至該 head 均 0 open，包含後續 CI 等待修正 |
| ★ 同來源 CI／Pages／Mac／Windows artifact | main/push Validate `34708837585`、Pages `34708837576`、Mac `34708837619`、Windows `34708837581` 均 success。Windows 為診斷後唯一重跑的 attempt 2，其餘 attempt 1；Pages artifact `10301999270` 的 HTML／全部 11 個 JS／CSS 與線上 bytes 相同；Mac artifact `10302588753`、Windows artifact `10302119819` 已核對 |
| ☆ 0.1.67 Mac 安裝 | 可信 DMG 已唯讀掛載，bundle 版本、ASAR、universal 與 deep/strict adhoc codesign 均核對；尚未退出或替換目前 0.1.66。原生工具最新回報 Mac locked／自動解鎖失敗 |
| ☆ 修正後原生結果 | 待新版完整效期／銷速與免原表 XLSX |
| ★ 下載卡上傳 | Mac→Windows 依序 uploader exit 0、complete 回覆成功；保留 `macos-dmg`／`windows-installer` 卡片 ID、平台與名稱，改為 0.1.67 及下列可信 bytes／hash |
| ☆ 員工下載實體檔 | 目前下載頁仍為登入畫面，尚未啟動 0.1.67 員工下載。上傳成功不代表登入後卡片顯示或實體下載已驗 |

## 發布與產物證據

PR head `0ae39e47e180238e8b243714bb64e7ffed2aacff` 的 Validate `34708491579`／Windows `34708491572` 成功後合併。Reviewed head 與 release main 的 tree 都是 `08c43dfda70e81c7ec08627fb8f62067f6682c96`。

| 可信產物 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| ★ Mac 0.1.67 universal DMG | 246887246 | `5875eb0afa57e50d8a857ccf414c4c887620bd025033250f35a93c069144a727` |
| ★ Mac universal ZIP | 222186857 | `e55c9b53d8280b8a1e19545362d7efa331ebb5b456086bdcc0f6f827d9a55a59` |
| ★ Windows x64 Setup.exe | 102059268 | `65e3dfdcd2f2989e577a85ead6841656c14d7e1d6380068d8f0bc15f93ee2689` |
| ★ Windows x64 ZIP | 143372000 | `1cde0ec13c0914810dfb86074858c50a44442e7cb7523a69c53f9860585868e4` |

Mac ASAR `3a77b3faa0965665975c0883afe07f59b4e6a459f2dc947f99f37131749095e3`；Windows ASAR `550989864068585367d78e8f6d8162ceb9771d9838f93e1835c280e614e909f7`。兩平台 package 均為 0.1.67／update channel disabled；Mac 的 arm64／x86_64 與兩架構 8 項 fuses、Windows 的 AMD64 N-API addon／唯一 unpacked 路徑／packed manifest hash／8 項 fuses 均核對。CI 不代表真人 Touch ID／Windows Hello 或 live Amazon。

本機證據集中於 `/tmp/amz-api-v0167-verified/`：`source-merge.json`、`local-validation.json`、`review.json`、Pages bytes 核對、兩平台 CI／artifact／bundle 檢查，以及 `portal-upload-verification.json`。`native-pending.json` 保留目前實際安裝 0.1.66、無 Amazon Preview／mutation 與未完成範圍。安裝 helper 只能指向 clean、exact release source 的 checkout，不能用後續 docs commit 冒充產物來源。

## 原始目標仍待核對

全 FBA 效期與銷速結果、低庫齡商品、人工效期／促銷保留、只納入已確認正清售缺口的行事曆；免原表價目表實際 XLSX；健檢至變體並返回；圖片門檻選取／結果／匯出；0.1.66 新圖片加密登入及後續生物辨識、免重打 SKU 的原生確認頁；員工登入後兩平台下載 bytes。

0.1.65 的外觀偏好重開保存、Vine 11 筆進行中及九張圖片直接準備證據繼續有效，詳見前版帳本。Mac 最新仍由工具回報鎖定／自動解鎖失敗，已請使用者解鎖以接續安裝；下載頁目前仍需員工登入。不得因本輪發布完成而將完整目標縮小結案。

## CI 失敗與處理

PR [#259](https://github.com/jspusa/AMZ.API/pull/259) 首次 Validate `34708136725` 在既有 A+／變體 demo job 測試遇到固定輪詢次數耗盡；本次 40 個新增回歸皆通過。同 source 本機全案及 Windows validation 已通過；兩個原測試 public suites 再次單獨執行 7 tests 通過，並核對 demo 工作排程及本機非同步 I/O。只將兩處固定輪詢改為最多 3 秒的終態等待，收到非 202 即交原斷言核對，不重試錯誤終態；production timeout／retry 未改。

Release main Windows `34708837581` attempt 1 在既有 `advertising-strategy-router` 首項測試的 200×10ms 輪詢耗盡，終態仍為 running／fba，沒有 errorCode；其餘 3,789 tests 通過及 4 個既有略過。同一 release tree 已通過 PR Windows 全案／打包／smoke；原測試檔單獨執行 13／13 通過，核對完成 4／4、payload 與單次建立斷言。診斷為 runner 時間敏感的等待問題後，只重跑失敗工作一次，attempt 2 成功並核對產物。保留 attempt 1 logs 與 `windows/rerun-diagnostic.json`，沒有改 production retry，也沒有重啟兩項失敗的 Amazon 工作。
