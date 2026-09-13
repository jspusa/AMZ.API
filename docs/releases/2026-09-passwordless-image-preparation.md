# 0.1.70 圖片準備免登入交付帳本

Issue #265；規格見 [圖片準備免登入](../specs/2026-09-passwordless-image-preparation.md)。

- Source base: `54a6bb6b97f0c887ca0330ae64a96c99bb0e6984`（0.1.69 健康核心修正已合併）。
- 0.1.69 未安裝；Mac CI 首次因既有 dashboard test 5 秒 timeout 失敗，定點一次通過，未重跑。該版健康核心修正已包含在本版；其 artifact 與 Pages 不作本版證據。
- 本版 LocalImageUpload 公開重現先因 vault lookup 失敗，再移除 production 準備阶段 lookup；ApiRouter 證明正常 ready 與 context 失效拒絕，零批准及零 Amazon 呼叫。
- PR #266 已合併，release-code/main SHA `82d2739c708c3c371e4ece80721de742d9dac6b3` 與 reviewed HEAD `fba76bb4e09c301b034d17d5776ea7d77d9fdb87` tree 完全一致。本機 321 files／3,834 tests、typecheck／build／樣式檢查及 production audit 0 通過；AMZ.API 兩軸 review 各 0 open。首次全檢的刪除檔案索引及既有 B2B timeout 已分别定位、定點驗證，最終全檢通過，未放寬 timeout 或跳過測試。
- 四條 exact main/push CI 均 attempt 1 成功：Validate `34738727062`、Pages `34738727058`、Mac `34738727074`、Windows `34738727059`。Pages artifact `10311617434` 的 HTML 及全部 11 個 JS／CSS 與線上 bytes 相符。
- Mac artifact `10312271532` 與 Windows artifact `10311428099` 已核对 archive／manifest／payload／ASAR、版本 0.1.70、disabled update channel 及全部八項 fuses；Mac universal 兩架構與 deep strict ad-hoc codesign、Windows AMD64 N-API 封裝亦通過。這不證明正式簽章、Windows 實機或真人 Hello。
- Supply Boss final source `da9c9e01bed8e0add7fdbec3c6397937227e0ef1` 已推送並發布 version 8，deployment `appgdep_6aa62c3d2418819181f20c5a861122c6` succeeded，audience public 與 environment revision 11 保留。Server review 首輪兩項 P2 已各以 regression 修復，final 兩軸各 0 open。實際原始 JPEG 1,405,699 bytes 以一次免登入 PUT、status GET 與 public GET 均 200，原 bytes 完全一致；零 Amazon 呼叫。這項服務端 bytes 核對與下述原生 App 驗收分列。
- Mac→Windows 0.1.70 兩张既有下載卡上傳 receipt 均核對可信 payload。Mac DMG 246,884,632 bytes／SHA-256 `915b1f05e0f3005cd7e5f2781c621bb741a01fa7ce7264398ac006c85f8427ab`；Windows installer 102,057,244 bytes／SHA-256 `0487a7f1d84915b2080cd4ac4e78f0967768317023ee8d9f32d45171e48cdf19`。目前員工頁顯示空登入表單，尚無本版登入後實際下載 bytes 證據。
- 2026-09-13 使用者解鎖後已正常退出 .68，完成 0700 userData 備份並安裝 read-only mounted 可信 0.1.70；.68 App 保留，換版期間 vault／ledger bytes 相同。已安裝 ASAR SHA-256 `db15f8a26579e375721b225311d80b353fe8e789497fb4906541a0113135889d` 與可信 artifact 相符。
- 2026-09-13 08:14 UTC 原生首頁已觀察成功：安裝的 .70 顯示 US、Amazon 已連線、圖片門檻 8 與四則人工公告。這解除先前 macOS 啟動授權／視窗讀取等待；先前程序取樣、CUA 逾時、安全限制及 05:12 UTC 鎖定觀察只保留為歷史，不再列為目前啟動阻擋。Amazon 已連線徽章本身不作全部 Listings 能力證據；下述 exact 圖片查詢另有實測。
- 原生 .70 圖片準備已驗：AFA12AM／B09S5VY2JS／PET_FOOD／US／LIVE，選取原始 AFA12AM_07 JPEG，正確對應第 7 格「副圖 6」，套用後 ready 1／staged 0；選檔、準備及套用均未出現密碼或生物辨識提示，安全預檢可用。只送一次 Amazon 安全預檢並通過；最後確認頁顯示 exact SKU／ASIN／US／LIVE、第 7 格及更新 1 個位置，含 Touch ID／Windows Hello 說明，沒有重打 SKU 欄位。未按最後送出、未進行真人原生批准、零 PATCH；驗收草稿已經由介面確認關閉。這不宣稱圖片已更新至 Amazon。
- 本版第一次全 FBA 效期／銷速同步終態為 partial：保留 284 筆全 FBA 庫存／銷速核心列，29 筆銷速偏慢／待核對；舊 0–30 天缺值已不再阻擋核心結果。入庫申報效期仍因 `FBA_EXPIRY_FORMAT_UNSUPPORTED` 失敗，原生訊息為「Amazon 入庫效期資料缺漏、矛盾或超過安全讀取範圍，請重新核對。」；284 筆批次待核對、0 已確認清售風險／0 可清完，不將未知批次列入自動行事曆。這是核心結果可用、效期來源未完成，不是完整效期健檢成功；只啟動一次，未重試，接續診斷入庫效期解析。
- 尚待完整入庫申報效期／來源與多日期結果、同步後人工即期品與促銷保留的完整核對，以及員工登入後兩平台實際下載。清售行事曆的已確認正缺口及不納入未知規則已有既有自動化回歸；此次 live 沒有已確認正缺口，不建立假批次確認來製造範例。Issue #263／#265 與完整原始目標仍保留，不因圖片準備成功或部分健康結果結案。真人指紋／Windows Hello 及實際 Amazon mutation 的證據界線不變。
- 本輪證據根目錄為 `/tmp/amz-api-v0170-verified/`；主要索引為 `source-merge.json`、`review.json`、`site-deployment.json`、`site-live-image.json`、`portal-upload-verification.json`、`installation-verification.json` 與 `native-acceptance-resumed-20260913.json`。舊 `native-status.json`、`native-startup-pending.json` 及 `native-wait-20260913T051233Z.json` 保留為歷史，不作目前啟動狀態。原生圖片已送一次安全 Preview、未送 PATCH，不能繼續以舊紀錄的零 Preview 描述本輪。
- 原始目標全部保留：自動入庫申報效期與全 FBA 銷速、人工即期品/促銷、僅已確認正缺口行事曆、兩種價目表、外觀保存、變體工作區、圖片排序/門檻/最終批准、進行中 Vine。已驗兩份 XLSX、偏好、Vine、門檻和變體導覽不因本輪重置。
