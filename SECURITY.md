# Security policy

## 核心邊界

- GitHub Pages 是 launcher，不是 Amazon 控制台。
- Electron renderer 只載入 App 內建 `fba-app://bundle` 資產。
- Renderer 沒有 Node.js、raw IPC、`fetch`／XHR 外連或任意開啟網址能力。
- LWA、SP-API、R2 與未來 Ads API 請求只從 main process 發出；renderer 僅能以 `<img>` 顯示 HTTPS 商品圖片，不會附帶 Amazon 憑證或自訂 headers。
- Custom URL 只能顯示／聚焦 App，永遠不能直接執行 Amazon 寫入。

## 已套用保護

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- 預設拒絕所有 Chromium permissions
- CSP、navigation、window-open、webview 白名單
- IPC sender、main-frame、protocol、host 與 path 核對
- Keychain-backed `safeStorage`，不可用時 fail closed
- Amazon preview、舊值衝突、完整 SKU、幅度檢查、Touch ID／native confirmation
- 本機持久 idempotency ledger；未知結果不重送
- Lock screen／suspend 清除所有短效預檢票證
- Electron fuses：停用 RunAsNode、Node options／inspect，啟用 ASAR integrity 與 cookie encryption
- Hardened Runtime、Developer ID、notarization 與 stapling release workflow

## 不在 renderer 或 repository 保存

- LWA Client Secret
- SP-API Refresh Token
- SP-API Access Token
- Seller ID 完整值
- R2 Secret Access Key
- Amazon response payload 或 buyer PII

## 正式發布前必要驗收

1. 在乾淨的 Apple Silicon 與 Intel macOS 帳號安裝 DMG。
2. 執行 `codesign --verify --deep --strict`、`spctl --assess`、`stapler validate`。
3. 檢查 Electron fuses。
4. 測試 Touch ID 取消、鎖屏、睡眠、票證逾時、雙擊與斷網全部不重送。
5. 用 canary secret 搜尋 App bundle、renderer storage、userData、log 與 crash artifact；除加密 vault 外不得出現。
6. 測試舊版到新版更新仍能讀取 Keychain vault，且 designated code requirement 不變。

## 回報問題

請不要在 public issue 貼 API credentials、Amazon response body、訂單或商品敏感資料。以私下管道提供最小化重現步驟與 Amazon Request ID。
