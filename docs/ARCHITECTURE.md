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
      ├─ local store → product master + idempotency ledger + report leases
      └─ optional R2 client → user's own public image bucket
```

## 為什麼控制台在 App 視窗中解鎖

HTTPS GitHub 網頁直接呼叫 `http://127.0.0.1` 會受到 Local Network Access、mixed-content 與 CORS 的瀏覽器差異影響，因此一般 Safari／Chrome 分頁不連 localhost，也不會取得 Bridge。Mac App 自己載入精確的 GitHub Pages 文件，再透過 preload 提供最小 IPC。GitHub 改版會自動生效，但 Amazon API Secret、LWA token 交換與所有 upstream request 仍只存在 main process。

GitHub renderer 是受信任的操作介面：若 repository、GitHub 帳號或 Pages 供應鏈被入侵，惡意介面可能讀到 App 回傳的非 Secret Amazon 營運資料或誘導操作。因此所有寫入仍由 main process 依固定 route 重建 native Touch ID 理由並要求本機確認；remote renderer 永遠拿不到解密後的 API Secret。

## API 相容層

控制台的 client components 仍呼叫相對 `/api/**`。只有在 Mac App 視窗中，Renderer 才會安裝 fetch adapter，將允許的 JSON／單檔 multipart request 序列化到 preload；一般瀏覽器只渲染鎖定頁。main process router 重建 HTTP-like status、headers、JSON 或 bytes response，全程不啟動 localhost server。

允許路由只有：

- Orders
- Listings price / batch
- Listing content / export / FBA-only quality audit
- Listing images / upload / FBA-only whole-catalog image audit
- Variation family read + unbound audit + dedicated two-stage child move
- FBA non-parent ASIN Customer Feedback audit/export
- Public Reports API library/capability planning
- FBA shipment brand mix read
- Sale price
- Subscribe & Save single-SKU read + FBA-only whole-catalog audit/export
- Replenishment plan
- FBA inventory age report/export
- Public accounting capability and report-access planning
- SKU command center
- Product master
- Health / Ads status

其他 path／method 回 `404`；renderer 無法指定 Amazon host 或任意 upstream URL。

全站文案與圖片健檢沿用 Reports API 與 Listings Items 的 FBA-only 匯出資料，renderer 仍會核對回應站點後才顯示或快取；英文拼字再由 sandboxed preload 呼叫 Mac 內建 spellchecker，文案不會送往第三方。Subscribe & Save 全站健檢先由 FBA Inventory API 的完整同次分頁證明目前 FBA SKU，再與 Replenishment offer／完整月 metrics 合併；缺月不補 0，coverage 不完整不顯示部分總額，Excel 只由 main process 保存的短效快照產生。Seller Replenishment API 未支援的 SG／AU 在 renderer 送出前即停用掃描。

Reports 建立由 main process 的 account-scoped broker 協調。相同 account、marketplace、mode、report type 與 options 的 all-listings report 可由品牌、未綁變體、評論與內容／圖片匯出共用；日期型 shipment report 另外綁 exact window。Local store 只保存不含憑證的短效 report ID／狀態 tombstone，程序內用 single-flight 與單調狀態更新防止重複建立或完成狀態回退。`CANCELLED`、`FATAL` 或建立結果不明都不會由自動載入盲目重建；明確使用者再試仍受安全等待與 mode/account 驗證。

評論健檢先以 FBA all-listings report 建立 seed，再以 Listings `searchListingsItems` 每批最多 20 SKU 驗證 exact current-marketplace relationships。只有 child 與 standalone 會進 Customer Feedback；parent 明確排除，缺站點、ASIN 衝突、relationships 歧義或批次失敗都列為未完成。Customer Feedback 呼叫跨工作共用 1 request/second 節流；結果只稱為正／負主題星等影響，不冒充總星等、評論數或全文。

Variation family 本身仍是唯讀查詢。唯一 mutation 是固定的 `/api/sp-api/variation-move` PATCH：只接受可證明為 FBA 的 child，依目標 CHILD PTD 建立 allowlisted relationship／dimension patches，並拆成解除與加入兩筆獨立 operation。每一筆都先 Validation Preview，再由 main 產生 native Touch ID 理由，寫入持久 idempotency ledger，送一次 Listings Items PATCH 並唯讀回查；claim 後、正式 PATCH 前的重新讀取／PTD／preview 失敗會安全釋放 claim，真正 PATCH 或已接受後的 timeout、連線中斷或回查不明才留下 unknown 狀態並禁止重送。

會計中心不把 Finances JSON、Amazon-generated settlement、人工前置報表或不存在的發票／帳單 API 混為一談。Renderer 只取得 allowlisted capability 與安全工作狀態；一般站點發票、Seller Central 帳單及未完成 FBA 逐列過濾的 account-wide 文件保持停用，不使用私有接口。

## 儲存

- `credentials.enc`：Keychain-backed encrypted vault，只含密文。
- `fba-os-data.json`：商品補貨主檔、idempotency ledger 與不含憑證的短效 report lease/tombstone；維持可由上一版忽略的相容格式。
- Renderer session 使用非持久 partition；偏好資料不應承載秘密。

## 圖片

本機圖片無法被 Amazon 抓取。App 先驗 magic bytes、10 MB、JPEG／PNG、寬高至少 500px；若使用者設定自己的 R2，main 才以上鎖憑證上傳並產生公開 HTTPS URL。沒有 R2 時仍可拖拉預覽，也可貼既有 CDN URL，但不會把本機檔案假裝成 Amazon 可讀來源。

## 更新

GitHub 控制台每次推送即自動更新；只有新增底層 API capability 或安全修補才需要更新 Mac Key Bridge。正式 GitHub Release 提供 DMG（初裝）、ZIP 與 `latest-mac.yml`（Squirrel.Mac 更新）。
