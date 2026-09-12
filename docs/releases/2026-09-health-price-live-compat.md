# 0.1.67 效期報表與價目表相容性修正

Issue [#258](https://github.com/jspusa/AMZ.API/issues/258)，[需求規格](../specs/2026-09-health-price-live-compat.md)。Source base `f91d236683c437ca6ba873ed1593121e3c865748`，分支 `codex/health-price-live-compat-20260913`。

## 原生發現

可信 0.1.66 已安裝於 `/Applications/AMZ.API.app`，啟動授權後原生首頁顯示 Amazon 已連線、US 與圖片門檻 8。這取代前份帳本中尚待啟動授權的狀態；不代表圖片服務首次保存或後續 Touch ID 已驗。

未選來源 Excel，第一次按「產生 Amazon 價目表」後找到 285 個 FBA 商品，曾觀察 67／285、160／285 及真實售價，最後以 Listing 身分不完整訊息失敗，未產生下載檔。第一次「同步全部 FBA 效期與銷速」則以 `REPORT_FORMAT_UNSUPPORTED` 重複／衝突欄位訊息失敗。兩項都未重新啟動，也沒有 Amazon Preview、原生寫入批准或 mutation。

Public seam 已重現單筆 `409 LISTING_IDENTITY_MISMATCH` 中斷價格工作，以及兩組官方不同語意欄位被當作同義 alias 的報表拒絕。實際失敗的商品欄位及報表完整 header 未保留，不能從測試推定這次 live 的精確第一個衝突欄。

## 分層證據

| 範圍 | 狀態 |
| --- | --- |
| ★ Source／聚焦驗證 | 已完成兩個 owner 的窄修正，新增 40 個 public 回歸；健康 56 tests、價格相關 116 tests 通過 |
| ★ 全案 check／audit／兩軸 review | `9925c4f58e620401ce2c68f5bc6e48a0c2595679` 的本機 check 通過 323 files／3,794 tests、型別與 build；production audit 0、diff check 通過。Standards／Spec 自 base 至該 head 均 0 open；後續 CI 等待修正另行核對 |
| ☆ 同來源 CI／Pages／Mac／Windows artifact | 待發布及核對 |
| ☆ 0.1.67 Mac 安裝 | 待可信產物；目前實際安裝為 0.1.66 |
| ☆ 修正後原生結果 | 待新版完整效期／銷速與免原表 XLSX |
| ☆ 下載卡／員工下載 | 待本版發布、登入後下載及 hash 核對 |

## 原始目標仍待核對

全 FBA 效期與銷速結果、低庫齡商品、人工效期／促銷保留、只納入已確認正清售缺口的行事曆；免原表價目表實際 XLSX；健檢至變體並返回；圖片門檻選取／結果／匯出；0.1.66 新圖片加密登入及後續生物辨識、免重打 SKU 的原生確認頁；員工登入後兩平台下載 bytes。

0.1.65 的外觀偏好重開保存、Vine 11 筆進行中及九張圖片直接準備證據繼續有效，詳見前版帳本。Mac 最新曾鎖定，但 source 修正仍可進行，不能以此將完整目標縮小結案。

PR [#259](https://github.com/jspusa/AMZ.API/pull/259) 首次 Validate `34708136725` 在既有 A+／變體 demo job 測試遇到固定輪詢次數耗盡；本次 40 個新增回歸皆通過。同 source 本機全案及 Windows validation 已通過；兩個原測試 public suites 再次單獨執行 7 tests 通過，並核對 demo 工作排程及本機非同步 I/O。只將兩處固定輪詢改為最多 3 秒的終態等待，收到非 202 即交原斷言核對，不重試錯誤終態；production timeout／retry 未改。
