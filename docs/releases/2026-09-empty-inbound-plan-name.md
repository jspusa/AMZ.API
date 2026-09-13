# 0.1.72 空名稱效期相容性交付帳本

接續 Issue #263 與[核准需求的修正契約](../specs/2026-09-empty-inbound-plan-name.md)。版本、CI、artifact、安裝及 live 結果須分別核對。

- .71 已正常退出舊版、建立 0700 userData 備份並安裝可信 universal App；ASAR `221f772a2d3f243e97de4850c0b3b1c9c272be863ac4117c4e5a83253912cfc6`，deep strict signature、來源 DMG 與 disabled updater 均符合已驗 artifact。保留 .70 App；換版期間 vault／ledger bytes 未變。
- 新版原生 Amazon 已連線；觀察一次同步 running 到 partial，固定原因為計畫名稱空字串，284 核心品號／32 銷售偏慢或待核對／284 未知批次／0 清售風險／0 預估可清完，未重試。沒有保存 raw upstream response；沒有 Amazon mutation。
- 人工公布欄仍 4 項，原人工效期 2027-04-30、即期品與促銷新增控制、既有促銷月曆均保留。圖片門檻仍 8。
- 員工登入後兩張 .71 下載卡的版本與完整 hash 符合可信 artifact，Mac→Windows 各點一次並顯示下載開始；本機尚未找到此輪新檔，不能把開始訊息當作實際下載驗證。`.71` 證據為 `/tmp/amz-api-v0171-r2-verified/native-acceptance-20260913.json`。
- .72 實作與 public seam 回歸進行中；尚未有 .72 CI、artifact、上傳、安裝或真實同步結果。

## 修正、發布與等待實機

- 真實 reader → coordinator → sync 回歸先重現空名稱 partial／固定原因，再確認空名稱讀到合成商品日期並完成；缺名稱／正常名稱、checkpoint 重開、100 次讀取分段與 101 頁商品接續均通過。只有 `name === ""` 使用既有缺名稱表示，未變更其他解析、安全或行事曆政策。
- 本機 `npm run check` 322 files／3,886 tests、typecheck／build／樣式驗證與 production audit 0 通過。第一次全檢發現兩個舊版本斷言，更新為 .72 後完整通過。Standards／Spec 對 `ae63057a1c9d8356727ce5fed3d40a166b5db505` 各 0 open。
- PR #270 已合併，final main `ad5a1e7080ed72025b50c774f9c11e52ec0fc998` 與 reviewed head 的 tree 都是 `578860951ce17c945ff0a4acb285211b44005819`。Validate `34751386188`、Pages `34751386145`、Mac `34751386120` 與 Windows `34751386204` 均已成功；全部 main push。
- Windows 第一次只因既有 `bounds durable operation inspections to the newest 32 exact entries` 測試 5 秒逾時而失敗，其 test／owner bytes 與 .71 完全相同。相同 tree 的 PR Windows 已成功，該案例 1,194 ms；一次定點本機 786 ms。完成診斷後只重跑一次既有失敗 job，attempt 2 全部 322 files 通過（3,882 passed／4 skipped），該案例 1,034 ms。沒有修改 timeout、測試或 production。排程／磁碟延遲只是符合證據的推論，沒有原失敗時刻的量測。
- Pages artifact `10316111501` 的 HTML＋全部 11 個 JS／CSS，共 12 檔皆 HTTP 200、bytes／hash 一致。
- Mac artifact `10316560781`：DMG 247,921,653 bytes，SHA-256 `7f959cf5cb5c5c78a80d40fe489893e174c3f0de69c3d6bafe979a8c146b7563`；ASAR `73fd82b82b82d83ab9793d8c54d470b0756bf9d8f37e07f64a9af95681b42154`。Archive、ZIP／manifest、universal、deep strict signature、兩種 architecture 的 8 項 fuses 與 disabled updater 均已驗。
- Windows attempt 2 artifact `10316680950`：Installer 102,057,911 bytes，SHA-256 `97a620f8b2863a3579ef0bda3e37b89fd5184d10b624004ec7e4c629432d9713`；archive／ZIP／manifest、ASAR／unpacked addon、AMD64／N-API 及 8 項 fuses 均已驗。不是實機 Windows Hello 證據。
- Mac→Windows 各上傳一次，這次 uploader 已保留並驗證伺服器實際 complete manifest，兩份 card receipt 與可信 artifact bytes／hash 一致。根目錄 `/tmp/amz-api-v0172-verified/` 保存所有分層證據。
- .71 員工下載已在本輪實際完成：先登記 Playwright download waiter 再按一般按鈕，兩份新本機檔案的大小、穩定性與 SHA-256 相符；證據 `/tmp/amz-api-v0171-r2-verified/portal-authenticated-download-verification.json`，取代上方早先尚無新檔的狀態。
- .72 上傳後重新整理下載頁，頁面暫存登入被清除並回到登入表單；因此 .72 的員工實際下載仍待登入。不能沿用 .71 下載 hash 或把 complete manifest 當成登入後下載證據。未擷取 token，未把 admin upload secret 用於員工登入。
- 可信 .72 DMG 已唯讀掛載於 `/private/tmp/amz-api-v0172-verified/mounted`，尚未退出／備份／替換目前 .71。準備安裝時 CUA 回報 Mac 鎖定且自動解鎖失敗，已請使用者解鎖；其後仍同樣鎖定，沒有繞過 UI 控制限制。新鎖定阻礙是本次 resumed run 的第一個 goal turn，不因同回合多次觀察累加。
- 待解鎖後正常退出、以既有 helper 備份並安裝，再完成一次原生效期同步、申報日期／來源／多日期與全庫存清售天數抽查、本機重新讀取及未知批次行事曆排除。若出現另一項具體錯誤仍保留 partial 接續修正。完整原始目標尚未驗收完成。

## 員工實際下載完成，等待原生安裝

- 2026-09-13 10:40 UTC 接續觀察下載頁「已安全登入」，兩卡均為 .72 且完整 SHA-256 正確。保留目前登入文件，沒有重新整理；先登記 download waiter 再按 Mac／Windows 一般下載按鈕，各一次，兩個事件均收到。
- 新本機 Mac 檔 `/Users/jasper/Downloads/AMZ.API-0.1.72-universal.dmg` 為 247,921,653 bytes；Windows 檔 `/Users/jasper/Downloads/AMZ.API-Notebook-Key-Windows-x64-Setup (4).exe` 為 102,057,911 bytes。兩檔均在本輪下載起點後建立、穩定且 SHA-256 完全符合上列各自可信 artifact。
- 分開保存 CUA 登入／事件證據 `portal-browser-download-evidence.json` 與檔案證據 `portal-authenticated-download-verification.json`，均在 `/tmp/amz-api-v0172-verified/`。檔案驗證器本身不聲稱能驗登入；兩層證據合併完成 .72 員工下載驗收，取代上方待登入的歷史狀態。沒有擷取憑證或下載簽名網址。
- 原生 CUA 再次回報 Mac 鎖定且無法自動解鎖，.72 尚未安裝，完整原生效期同步仍待。這是新鎖定的第 2 個 goal turn，不按同回合觀察次數累加；本輪下載是實際新進度。保留原解鎖請求，不再要求員工登入，也不重做成功的上傳、下載或圖片驗收。若下一個 goal turn 新鮮核對仍為同一鎖定、且已無獨立工作可推進，依三回合門檻標記 goal blocked。
