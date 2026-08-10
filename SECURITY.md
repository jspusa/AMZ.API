# Security policy

## 核心邊界

- GitHub Pages 是主控制台；一般瀏覽器只顯示鎖定 gate，沒有 macOS／Windows 本機 Bridge。
- Electron renderer 只信任精確的 `https://jspusa.github.io/AMZ.API/` 或開發用固定 loopback 文件。
- Renderer 沒有 Node.js、raw IPC、`fetch`／XHR 外連或任意開啟網址能力。
- LWA、SP-API、R2 與 Amazon Ads API 請求只從 main process 發出；renderer 僅能以 `<img>` 顯示 HTTPS 商品圖片，不會附帶 Amazon 憑證或自訂 headers。
- SP-API／R2／Skill 與 Ads 敏感欄位只在 main process 建立的 packaged data-URL 本機 sheet 輸入。Sheet 使用 memory-only partition、無網路 CSP、sandbox 與 context isolation；save IPC 只接受 exact editor BrowserWindow 的 main frame。GitHub Pages 沒有 secret input state，也不能直接呼叫 save。
- Custom URL 只能顯示／聚焦 App，永遠不能直接執行 Amazon 寫入。
- GitHub UI 是受信任控制面；repository／Pages 若被入侵，remote UI 可能看到 Bridge 回傳的非 Secret 營運資料，因此寫入路徑、payload、native 摘要、Touch ID 與防重送全部由 main process 強制執行。

## 已套用保護

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- 預設拒絕所有 Chromium permissions
- CSP、navigation、window-open、webview 白名單
- IPC sender、main-frame、HTTPS protocol、GitHub hostname 與精確 repository path 核對
- OS-backed `safeStorage`：macOS 使用 Keychain，Windows 使用當前登入使用者的 DPAPI；不可用時 fail closed，不得改用明文
- Amazon preview、舊值衝突、必要路徑的完整 SKU／幅度檢查、Touch ID／Windows Hello／native confirmation
- Windows Hello 必須從 repository 內的第一方 C++ WinRT desktop interop source，以鎖定的 `node-gyp` 與 Electron 43.3.0 x64 headers 編譯成 N-API addon。`windows-hello.node` 只能位於 `app.asar.unpacked` 固定路徑；`app.asar` 內的 manifest 記錄固定檔名與 SHA-256，不得改成 `extraResources`。main 載入前重算 addon SHA-256，且只接受固定結果 vocabulary。這是打包一致性檢查；Windows 未簽章 artifact 沒有 macOS embedded ASAR integrity，不能冒充 Authenticode 或抵抗同一使用者修改 App 檔案
- 本機持久 idempotency ledger；未知結果不重送
- 全站文案使用 GitHub Pages renderer 內的版本化 SCOWL en_US 辭典、`nspell` 與窄範圍品牌／成分／Amazon 合法字詞表。Mac 與 Windows 套用同一份辭典；字典在 Pages 介面內本地執行，文案不傳送到外部拼字服務。第三方字典／引擎版本與 SHA-256 保存於 `src/renderer/src/vendor/spellcheck/`；完整授權公告保存於 `src/renderer/public/licenses/spellcheck/` 並隨 Pages artifact 發佈
- Variation family 查詢保持唯讀；唯一改掛 route 只允許 FBA child，固定兩階段 Amazon Validation Preview → 本機身分確認 → 持久 idempotency → 單次 PATCH → 唯讀回查。真正 PATCH 前失敗會安全釋放 claim；已送出或已接受後的未知狀態不得重送
- 全站文案／圖片／訂閱健檢只接收 main process 證明的 FBA SKU；訂閱的 exact-SKU offer／月度問題列只有帶同次 `CURRENT_FBA` 證據才可顯示／匯出，未證明識別值只保留聚合計數；問題列只能單列隔離並將範圍降為 partial，站點、program、FBA fulfillment、月份或分頁衝突仍整次 fail closed；訂閱 Excel 只能由 main 保存的短效快照建立
- 一鍵全部健檢由 main process 綁定 account scope、mode、marketplace 與短效 context；七個 section 各自 fail honest，renderer 不能上傳整份 snapshot 或 account scope，Excel 只由同一 main job 的已驗證結果建立
- Amazon Ads 使用獨立 OS-safeStorage-backed vault；只允許官方固定 token／Profiles／Campaign query endpoint、精確 Seller Profile 與 Sponsored Products 唯讀查詢。App 沒有 Ads write route，Listing 身分或來源不完整時不輸出全站覆蓋結論
- 會計能力使用固定公開 SP-API allowlist；未完成 FBA 過濾、人工前置、Brazil-only 與不存在的通用發票／帳單接口保持停用
- Lock screen／suspend 清除所有短效預檢票證
- Electron fuses：停用 RunAsNode、Node options／inspect，啟用 cookie encryption；embedded ASAR integrity 僅在 macOS 生效
- Hardened Runtime、Developer ID、notarization 與 stapling release workflow
- Windows x64 NSIS／ZIP 內部 build 驗證 addon 與 ASAR manifest 雜湊一致、packed／unpacked 邊界、Electron fuses、穩定 artifact 檔名、SHA-256 與無憑證 packaged smoke；這不等於 Authenticode、SmartScreen reputation 或 Windows Hello 實機驗證
- Windows 未建立 publisher-bound Authenticode 更新鏈前，main 必須停用 App 內更新檢查與安裝；使用者只能從 repository 的固定 `notebook-key-windows` Release 手動下載並核對 `SHA256SUMS.txt`

## 不在 renderer 或 repository 保存

- LWA Client Secret
- SP-API Refresh Token
- SP-API Access Token
- Seller ID 完整值
- R2 Secret Access Key
- Ads LWA Client Secret
- Ads Refresh Token、Access Token、Profile ID 與完整 Ads／Seller account identifier
- Amazon response payload 或 buyer PII

## 正式發布前必要驗收

1. 在乾淨的 Apple Silicon 與 Intel macOS 帳號安裝 DMG。
2. 執行 `codesign --verify --deep --strict`、`spctl --assess`、`stapler validate`。
3. 檢查 Electron fuses。
4. 測試 Touch ID 取消、鎖屏、睡眠、票證逾時、雙擊與斷網全部不重送。
5. 用 canary secret 搜尋 App bundle、renderer storage、userData、log 與 crash artifact；除加密 vault 外不得出現。
6. 測試舊版到新版更新仍能讀取 Keychain vault，且 designated code requirement 不變。
7. 在乾淨 Windows 11 Pro x64 使用者安裝 NSIS，並從 ZIP 解壓執行；核對 `SHA256SUMS.txt`、ASAR integrity、DPAPI 跨使用者邊界、Hello 成功／取消／未設定／裝置忙碌，並確認任何失敗都沒有 Amazon 寫入。
8. Windows 未完成 Authenticode 簽章與 SmartScreen reputation 前只能標為內部未簽章版；GitHub-hosted Windows runner 的 compile／package／smoke 不可冒充 Windows 11 Pro 或 Windows Hello 實機通過。

## 回報問題

請不要在 public issue 貼 API credentials、Amazon response body、訂單或商品敏感資料。以私下管道提供最小化重現步驟與 Amazon Request ID。
