# 0.1.72 空名稱效期相容性交付帳本

接續 Issue #263 與[核准需求的修正契約](../specs/2026-09-empty-inbound-plan-name.md)。版本、CI、artifact、安裝及 live 結果須分別核對。

- .71 已正常退出舊版、建立 0700 userData 備份並安裝可信 universal App；ASAR `221f772a2d3f243e97de4850c0b3b1c9c272be863ac4117c4e5a83253912cfc6`，deep strict signature、來源 DMG 與 disabled updater 均符合已驗 artifact。保留 .70 App；換版期間 vault／ledger bytes 未變。
- 新版原生 Amazon 已連線；觀察一次同步 running 到 partial，固定原因為計畫名稱空字串，284 核心品號／32 銷售偏慢或待核對／284 未知批次／0 清售風險／0 預估可清完，未重試。沒有保存 raw upstream response；沒有 Amazon mutation。
- 人工公布欄仍 4 項，原人工效期 2027-04-30、即期品與促銷新增控制、既有促銷月曆均保留。圖片門檻仍 8。
- 員工登入後兩張 .71 下載卡的版本與完整 hash 符合可信 artifact，Mac→Windows 各點一次並顯示下載開始；本機尚未找到此輪新檔，不能把開始訊息當作實際下載驗證。`.71` 證據為 `/tmp/amz-api-v0171-r2-verified/native-acceptance-20260913.json`。
- .72 實作與 public seam 回歸進行中；尚未有 .72 CI、artifact、上傳、安裝或真實同步結果。
