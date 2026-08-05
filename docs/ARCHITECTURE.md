# Architecture

```text
GitHub Pages control console
  ├─ ordinary browser: locked gate only
  └─ amz-api://launch（喚醒 Mac 鑰匙）
        ▼
Signed macOS Key Bridge
  ├─ renderer: exact GitHub Pages document, connect-src none
  ├─ preload: frozen, typed, allowlisted bridge（只在 App 視窗存在）
  └─ main
      ├─ credential vault → macOS Keychain / safeStorage
      ├─ API router → strict route and payload validation
      ├─ Amazon SP-API client → fixed regional endpoints
      ├─ local store → product master + idempotency ledger
      └─ optional R2 client → user's own public image bucket
```

## 為什麼控制台在 App 視窗中解鎖

HTTPS GitHub 網頁直接呼叫 `http://127.0.0.1` 會受到 Local Network Access、mixed-content 與 CORS 的瀏覽器差異影響，因此一般 Safari／Chrome 分頁不連 localhost，也不會取得 Bridge。Mac App 自己載入精確的 GitHub Pages 文件，再透過 preload 提供最小 IPC。GitHub 改版會自動生效，但 Amazon API Secret、LWA token 交換與所有 upstream request 仍只存在 main process。

GitHub renderer 是受信任的操作介面：若 repository、GitHub 帳號或 Pages 供應鏈被入侵，惡意介面可能讀到 App 回傳的非 Secret Amazon 營運資料或誘導操作。因此所有寫入仍由 main process 依固定 route 重建、顯示 native 摘要並要求 Touch ID；remote renderer 永遠拿不到解密後的 API Secret。

## API 相容層

控制台的 client components 仍呼叫相對 `/api/**`。只有在 Mac App 視窗中，Renderer 才會安裝 fetch adapter，將允許的 JSON／單檔 multipart request 序列化到 preload；一般瀏覽器只渲染鎖定頁。main process router 重建 HTTP-like status、headers、JSON 或 bytes response，全程不啟動 localhost server。

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

GitHub 控制台每次推送即自動更新；只有新增底層 API capability 或安全修補才需要更新 Mac Key Bridge。正式 GitHub Release 提供 DMG（初裝）、ZIP 與 `latest-mac.yml`（Squirrel.Mac 更新）。
