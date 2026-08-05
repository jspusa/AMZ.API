# Architecture

```text
GitHub Pages launcher
        │ amazon-fba-os://launch（只喚醒）
        ▼
Signed macOS App
  ├─ renderer: bundled React UI, connect-src none
  ├─ preload: frozen, typed, allowlisted bridge
  └─ main
      ├─ credential vault → macOS Keychain / safeStorage
      ├─ API router → strict route and payload validation
      ├─ Amazon SP-API client → fixed regional endpoints
      ├─ local store → product master + idempotency ledger
      └─ optional R2 client → user's own public image bucket
```

## 為什麼不讓 GitHub Pages 直接連 localhost

HTTPS 網頁呼叫 `http://127.0.0.1` 會受到瀏覽器 Local Network Access、mixed-content 與 CORS 差異影響；更重要的是，任何同源 GitHub JavaScript 都可能看到 Amazon 回傳資料。把 UI bundle 和 bridge 一起放在簽章 App，才能維持同源與最小 IPC，讓所有 Amazon API／憑證網路只存在 main process，且不受 Safari／Chrome 差異影響。商品圖片預覽是唯一允許的 renderer HTTPS image 載入，不會帶 API 憑證。

## API 相容層

原控制台的 client components 仍呼叫相對 `/api/**`。Renderer 安裝一個 fetch adapter，將允許的 JSON／單檔 multipart request 序列化到 preload；main process router 重建 HTTP-like status、headers、JSON 或 bytes response。這讓現有 UI 保持不變，但沒有啟動 localhost server。

允許路由只有：

- Orders
- Listings price / batch
- Listing content / export
- Listing images / upload
- Sale price
- Subscribe & Save read
- Replenishment plan
- SKU command center
- Product master
- Health / Ads status

其他 path／method 回 `404`；renderer 無法指定 Amazon host 或任意 upstream URL。

## 儲存

- `credentials.enc`：Keychain-backed encrypted vault，只含密文。
- `fba-os-data.json`：商品補貨主檔與 idempotency ledger，不含 credential。
- Renderer session 使用非持久 partition；偏好資料不應承載秘密。

## 圖片

本機圖片無法被 Amazon 抓取。App 先驗 magic bytes、10 MB、JPEG／PNG、寬高至少 500px；若使用者設定自己的 R2，main 才以上鎖憑證上傳並產生公開 HTTPS URL。沒有 R2 時仍可拖拉預覽，也可貼既有 CDN URL，但不會把本機檔案假裝成 Amazon 可讀來源。

## 更新

GitHub Release 提供 DMG（初裝）、ZIP 與 `latest-mac.yml`（Squirrel.Mac 更新）。只有簽章、公證、fuse 與架構驗證全部成功，Draft Release 才會公開。
