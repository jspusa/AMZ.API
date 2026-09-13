# 0.1.69 效期與銷速核心報表

Issue [#263](https://github.com/jspusa/AMZ.API/issues/263)，[需求規格](../specs/2026-09-inventory-health-core-report.md)。Base `7b202675a72fcc2cbe38dc3bb371f9664952f5dc`；分支 `codex/inventory-health-core-report-20260913`。

## 本版證據

| 範圍 | 狀態 |
| --- | --- |
| ★ 公開失敗重現 | 真 reader → health sync → coordinator 的一列合成資料重現 `REPORT_FORMAT_UNSUPPORTED`／0–30 天缺值；沒有 live raw report，也未重試已失敗的真實同步 |
| ★ 實作／聚焦回歸 | 專用健康投影、未知庫齡的保存／DTO／畫面及真 reader → sync → coordinator 回歸通過；同一缺值 fixture 在原嚴格讀取仍拒絕。保存與畫面 3 files／50 tests、reader／sync／coordinator／audit 7 files／135 tests 通過；另核對新入口的站點幣別防護 |
| ★ 全案 check／audit／☆ 兩軸 review | 最終核心程式與站點幣別回歸通過 324 files／3,863 tests、typecheck、build、production audit 0 及 diff check；累計 diff 的獨立兩軸 review 待執行 |
| ☆ 同來源 CI／Pages／兩平台 artifact | 本版尚未發布 |
| ☆ 安裝／原生健康結果／員工下載 | 目前實際安裝 0.1.68，不能由前版成功推定本版交付 |

## 接續的實機狀態

0.1.68 的可信產物、Mac→Windows 下載卡上傳、正常退出／0700 備份／安裝、ASAR 與資料保存均已核對；首頁顯示 US 與 Amazon 已連線。圖片門檻 10 跨安裝重開仍為 10，之後已恢復 8。變體健檢單次完成 285 FBA／74 未綁／1 未完成，從清單進入工作台並完整讀取來源商品，再返回原清單，數字不變。沒有送 Amazon Preview、原生寫入批准或 mutation。

同版第一次全 FBA 效期同步仍以 0–30 天缺值結束，因此本版接續處理核心報表讀取的耦合。圖片服務加密登入與後續真人 Touch ID 仍待驗，員工下載頁仍需登入；再開圖片入口時 Mac 鎖定，尚未觀察操作結果。實際完成與未完成證據見 [0.1.68 帳本](2026-09-health-age-values.md) 及 `/tmp/amz-api-v0168-verified/native-acceptance-20260913.json`。

完整原始目標繼續保留：全部 FBA 效期／銷速與低庫齡商品、人工即期品／促銷保存、只收已確認正清售缺口的行事曆；兩種價目表、外觀保存、變體導覽、圖片批次／門檻／生物辨識、Vine 及兩平台受保護交付。0.1.65 的偏好／Vine／九張圖片直接準備與 0.1.67 的兩份實際 Excel 證據繼續有效，不重做已完成工作冒充本版驗收。
