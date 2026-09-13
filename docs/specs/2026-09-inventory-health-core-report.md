# 效期與銷速的核心報表讀取

Issue [#263](https://github.com/jspusa/AMZ.API/issues/263)，版本 0.1.69，base `7b202675a72fcc2cbe38dc3bb371f9664952f5dc`，分支 `codex/inventory-health-core-report-20260913`。

## 問題與公開重現

可信 0.1.68 已安裝且原生首頁顯示 Amazon 已連線。第一次「同步全部 FBA 效期與銷速」仍以 `REPORT_FORMAT_UNSUPPORTED`／「0–30 天」缺值結束，未重試，未保留 live raw report。0.1.68 只在有完整替代庫齡組時回退；找不到完整組仍會拒絕。效期同步共用嚴格庫齡讀取，所以尚未整理申報效期就中斷。

`tests/inventory-health-report-path.test.ts` 使用真 `AgedInventoryReads` → `InventoryHealthSync.start/observe` → `InventoryHealthCoordinator`，一列合成資料具有有效庫存、各期銷量與報表日期，庫齡值空白。修正前公開測試重現同一錯誤；期待保留 1,000 件庫存／每日 10 件／100 天清完與入庫申報效期，未知庫齡及批次餘量為 null、行事曆不產生推定缺口。合成資料不是該真實 Amazon 列。

## 讀取與資料界線

- 新增明確的 `readInventoryHealth` 投影與 `InventoryHealthReportSnapshot`／`InventoryHealthReportReadsPort`；效期同步改用此入口。共用 main-owned ReportsRuntime 的固定 intent、同一 report/document handle、account／mode／marketplace／generation、取消與遲到結果防護，不增加任意網路入口或在 GET 重新建立報表。
- 原 `read`、嚴格庫齡 snapshot、180 天健檢、整份報表選非重疊庫齡組與全站費用完整性維持既有契約。新健康投影沒有全站補充費用總額，不以 partial sum 冒充完整數字。
- 新入口辨識 SKU 與核心欄位：保留既有 exact identity／重複列規則，需有 available header 及至少一個 canonical `units-shipped-t7/t30/t60/t90` header。數值缺漏為 null；缺漏的銷量期間不補零。庫存／銷速不足時不推算清完天數或宣稱安全。
- `snapshot-date` 缺漏為 null，不借 `inv-age-snapshot-date` 或目前日期。已回報且一致的銷量期間沿現有最快平均銷速計算；需要全部四期的已確認批次清售缺口規則不改。
- 補充證據分開判斷：有效冗餘與倉儲費原值保留；180 天以上數量只由同品項完整、非重疊且符合區域的 older buckets 計算，缺證據為 null；AIS 僅在所需官方 tiers 完整時合計，缺 tier 不作部分合計。近期庫齡空白不抹除可獨立證明的補充資料。
- 共用合法 TSV、列寬、欄位／列數上限、alias 重複與歧義、精確識別、已辨識數量／金額安全上限。非空非法值、損壞格式與安全 context 不一致仍拒絕，不能捕捉整個解析錯誤後硬造可用 snapshot。
- 健康 domain、加密保存及 public DTO 的 `agedOver180` 接受 number 或 null。舊 numeric 保存資料相容，非法值仍拒絕；畫面顯示「未提供」。這不改 sourceComplete 的入庫效期完整性含義，也不放寬確認餘量、日期新鮮度、清售缺口或行事曆資格。

## 驗收與交付

1. 原公開完整流程由紅轉綠，保留 stock／sales／expiry，unknown age 不補零；同一缺值 fixture 在原嚴格庫齡入口仍拒絕。
2. 核對 missing headers／blank values／明確零、部分銷量、不可辨識核心 schema、日期不借用、older buckets／storage／excess 原值保留、AIS partial 禁止部分總額，以及各格式／身分／context 防護。
3. 公開 coordinator refresh/read/save/reopen/confirm 與 renderer 測試證明未知庫齡可保存並顯示，完整核心資料仍可估算；manual expiry、confirmed remaining 與 calendar eligibility 既有防護全數保留。
4. `npm run check`、`npm audit --omit=dev`、Standards／Spec review 後，核對同來源 CI、Pages、Mac／Windows 產物，再安裝與原生驗收；不能從單列 fixture 或安裝成功推定全 FBA 成功。
5. 0.1.68 已驗的圖片門檻重開保存（10 → 重開仍 10 → 恢復 8）與健檢 → 變體完整讀取 → 返回相同 285／74／1 結果仍有效。保留完整原始需求中的效期／銷速、人工即期品與促銷、只收已確認正缺口的行事曆、兩種價目表、偏好、變體、圖片、Vine 與受保護下載交付範圍。

官方欄位依據：[Amazon FBA Manage Inventory Health report](https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-manage-inventory-health-report)。欄位清單不等於 live 資料完整性證明。
