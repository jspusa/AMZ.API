# AMZ.API 專用安全下載入口

2026-09-16 使用者要求將 AMZ.API 員工下載網址改為 AMZ.API 名稱，繼續使用 ChatGPT Sites，並輪替下載密碼。

同日使用者進一步確認「只需下載密碼，不必登入 ChatGPT」；新站的公開入口仍須由應用層密碼保護安裝檔。驗收分開核對一般瀏覽器登入／下載控制，以及 authenticated HTTP 完整安裝檔 bytes；瀏覽器訊息不替代本機落地檔案證據。

## 本次範圍

- Canonical 員工入口為 `https://amz-api-downloads.brave-prawn-0848.chatgpt.site/downloads`。WebGate、共用安裝說明與現行使用文件使用同一入口。
- 下載站沿用既有私有 R2 的 0.1.79 Mac DMG／Windows NSIS installer，透過下載專用串流代理提供受保護下載。保留兩張安裝卡、版本、大小與 SHA-256；不建立新版安裝檔。
- Sites owner 負責新站點、下載驗證設定與舊 `/downloads` 到新入口的相容導向。下載密碼、verifier 值與 session token 不進 repository、Issue、測試、文件或日誌。
- 這次 repo 變更是 Control Console Release：版本保持 0.1.79，不改 Notebook Key 的 Amazon／憑證／原生安全能力，不建立 tag 或桌面發行產物。
- 已安裝 Notebook Key 的 main process 仍可能顯示舊下載網址；相容導向需保持可用，直到後續正常 Notebook Key Release 帶入新的共用說明。
- 圖片、公布欄及 maintenance 的固定 Supply Boss origins 保持原值；保留歷史交付文件中的當時網址與證據。

## 驗收

| 層級 | 完成條件 |
|---|---|
| ★ Repo | WebGate 渲染及 update-policy 的公開輸出都指向 canonical URL；原 HTTPS 與 Bridge 安全邊界保留；現行 README 與 handoff 一致。 |
| ★ 本機檢查 | 聚焦 tests、完整 `npm run check`、production audit 與 `git diff --check` 通過。 |
| ★ Pages | exact source 的 CI 與 Pages 部署通過，正式入口實際指向新網址，發布 bytes 與來源一致。 |
| ★ Sites | 新入口只要求下載密碼，不跳轉 ChatGPT 登入；舊入口導向可用；未登入無法取得安裝檔；輪替後新驗證可用且舊權限不能沿用。 |
| ★ 下載 | 一般瀏覽器以新下載密碼登入後可使用兩平台下載按鈕；另外以 authenticated HTTP 串流核對完整 bytes、大小與 SHA-256 符合既有 0.1.79 可信產物。一般 UI 落地檔案若無獨立證據，保留未驗，不能由「下載已開始」推定。 |

每層證據分開記錄於[交付帳本](../releases/2026-09-download-portal-url.md)。Repo 測試或 Sites 發布本身不能證明員工下載成功，也不解除既有 Amazon／原生驗收待辦。
