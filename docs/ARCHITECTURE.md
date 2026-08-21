# Architecture

```text
GitHub Pages control console
  ├─ ordinary browser: locked gate only
  └─ amz-api://launch（喚醒本機 Notebook Key）
        ▼
macOS / Windows 11 Notebook Key Bridge
  ├─ renderer: exact GitHub Pages document, connect-src none
  ├─ preload: frozen, typed, allowlisted bridge（只在 App 視窗存在）
  └─ main
      ├─ credential vault → macOS Keychain / Windows DPAPI / safeStorage
      ├─ native confirmation → Touch ID / Windows Hello；其他平台才使用 fail-closed dialog
      ├─ Ads credential vault → 獨立 `ads-credentials.enc`
      ├─ API router → strict route and payload validation
      ├─ Amazon SP-API client → fixed regional endpoints
      ├─ Amazon Ads client → fixed token / profiles / query endpoints
      ├─ local store → product master + idempotency ledger + report leases
      └─ optional R2 client → user's own public image bucket
```

## 為什麼控制台在 App 視窗中解鎖

HTTPS GitHub 網頁直接呼叫 `http://127.0.0.1` 會受到 Local Network Access、mixed-content 與 CORS 的瀏覽器差異影響，因此一般 Safari／Chrome／Edge 分頁不連 localhost，也不會取得 Bridge。Desktop App 自己載入精確的 GitHub Pages 文件，再透過 preload 提供最小 IPC。GitHub 改版會自動生效，但 Amazon API Secret、LWA token 交換與所有 upstream request 仍只存在 main process。

GitHub renderer 是受信任的營運控制介面，但不是任何憑證的輸入邊界。SP-API／R2／Skill 與 Ads 的敏感欄位只能在 main process 建立的 modal child BrowserWindow 輸入；本機 sheet 載入 packaged static data HTML、使用獨立非持久 session，CSP 禁止所有 network，各 save IPC 只接受對應 sheet 的 exact main frame。Pages 只能開啟 sheet、讀取 redacted status、測試或清除，直接呼叫 save 會被 main 拒絕。保存後 input 立即清空並關閉 sheet；Secret、access token、Profile ID 與完整帳號識別碼永遠不回傳 Pages renderer。

## API 相容層

控制台的 client components 仍呼叫相對 `/api/**`。只有在 Notebook 鑰匙 App 視窗中，Renderer 才會安裝 fetch adapter，將允許的 JSON／單檔 multipart request 序列化到 preload；一般瀏覽器只渲染鎖定頁。main process router 重建 HTTP-like status、headers、JSON 或 bytes response，全程不啟動 localhost server。

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
- FBA inbound shipment list／per-shipment received quantities＋daily noncompliance report
- FBA inventory age report/export
- Public accounting capability and report-access planning
- SKU command center
- Product master
- Health / Ads status + FBA-only Ads coverage

其他 path／method 回 `404`；renderer 無法指定 Amazon host 或任意 upstream URL。

全站文案與圖片健檢沿用 Reports API 與 Listings Items 的 FBA-only 匯出資料，renderer 仍會核對回應站點後才顯示或快取；英文錯字由 GitHub Pages renderer 內的版本化 SCOWL en_US 辭典與 `nspell` 檢查，再以窄範圍白名單保留品牌、成分與 Amazon 合法字詞。Mac 與 Windows 使用同一份辭典，不再依賴作業系統字典；字典在 Pages 介面內本地執行，文案不會送往第三方。Subscribe & Save 全站健檢先由 FBA Inventory API 的完整同次分頁證明目前 FBA SKU，再與 Replenishment offer／完整月 metrics 合併；缺月不補 0，coverage 不完整不顯示部分總額，Excel 只由 main process 保存的短效快照產生。Seller Replenishment API 未支援的 SG／AU 在 renderer 送出前即停用掃描。

Reports 建立由 main process 的 account-scoped broker 協調。相同 account、marketplace、mode、report type 與 options 的 all-listings report 可由品牌、未綁變體、評論與內容／圖片匯出共用；日期型 shipment report 另外綁 exact window。Local store 只保存不含憑證的短效 report ID／狀態 tombstone，程序內用 single-flight 與單調狀態更新防止重複建立或完成狀態回退。`CANCELLED`、`FATAL` 或建立結果不明都不會由自動載入盲目重建；明確使用者再試仍受安全等待與 mode/account 驗證。

FBA inbound shipment 工作在 main process 以 account、mode、marketplace 與精確日期區間綁定。Fulfillment Inbound v0 清單與逐貨件 items 只允許固定 GET path；逐貨件回應若出現官方操作無法承接的 continuation token，該貨件必須標為 partial。每日 noncompliance report 由同一耐久化 report broker 建立／輪詢，renderer 只取得已清理的 shipment／carton／product 問題列，不取得 report ID、document ID、帳號 scope 或任意下載 URL。

Amazon Ads 使用與 SP-API 分離的 LWA App 與 vault。main process 只允許官方固定的 NA／EU／FE token、`/v2/profiles`、`/adsApi/v1/query/campaigns` 與固定 Ads Reporting v3 endpoint；access token 保存在程序記憶體且用 single-flight 更新，Seller Profile 依 exact marketplace 自動發現並只留在 main。Profile 與 verified cache 同時綁 Ads vault scope 與目前 SP account scope；SP 憑證儲存或清除會立即失效 Ads cache，query 前後也會重新核對。OAuth scope 必須依 Amazon 官方使用 `advertising::campaign_management`，但實際使用者權限應為 Campaign manager Viewer；App 沒有 Ads write router 或 client method，`writeEnabled` 永遠為 false。覆蓋健檢只對已驗證且身分完整的 FBA all-listings 與 ENABLED Sponsored Products 進行比對；任何 listing error、缺 SKU 或無效 ASIN 都停止整次健檢，不會輸出偽裝成全站的部分 snapshot。

廣告策略工作由 main process 同時啟動 current-FBA all-listings、`GET_SALES_AND_TRAFFIC_REPORT`（DAY＋SKU）與 Ads `spAdvertisedProduct`（SUMMARY）三個固定唯讀來源；工作 identity 綁 SP／Ads account scopes、mode、marketplace、exact dates 與 report config。Sales SKU 必須連同 child ASIN exact match 目前 FBA 身分；Ads 先用 exact SKU，只有缺 SKU 且 ASIN 唯一時才 fallback。三種 report create 都經 durable lifecycle：active／known-DONE 可安全重用，建立結果不明、CANCELLED／FATAL 或 retry guard 內不自動重建。renderer 只取得已清理的策略 snapshot，不取得 profile、campaign、ad group、report／document ID、account scope 或 signed URL；Excel 在 renderer 由同一 snapshot 產生，資料量超限時整份拒絕而不截斷。

評論健檢先以 FBA all-listings report 建立 seed，再以 Listings `searchListingsItems` 每批最多 20 SKU 驗證 exact current-marketplace relationships。只有 child 與 standalone 會進 Customer Feedback；parent 明確排除，缺站點、ASIN 衝突、relationships 歧義或批次失敗都列為未完成。Customer Feedback 呼叫跨工作共用 1 request/second 節流；結果只稱為正／負主題星等影響，不冒充總星等、評論數或全文。

Variation family 本身仍是唯讀查詢。唯一 mutation 是固定的 `/api/sp-api/variation-move` PATCH：只接受可證明為 FBA 的 child，依目標 CHILD PTD 建立 allowlisted relationship／dimension patches，並拆成解除與加入兩筆獨立 operation。每一筆都先 Validation Preview，再由 main 產生本機身分確認理由，寫入持久 idempotency ledger，送一次 Listings Items PATCH 並唯讀回查；claim 後、正式 PATCH 前的重新讀取／PTD／preview 失敗會安全釋放 claim，真正 PATCH 或已接受後的 timeout、連線中斷或回查不明才留下 unknown 狀態並禁止重送。

Windows 的 native confirmation 不由 renderer 或遠端 Pages 執行。Windows x64 workflow 以鎖定的 `node-gyp` 和 Electron 43.3.0 x64 headers，將 repository 內的第一方 C++ WinRT desktop interop source 編譯成 N-API addon。electron-builder 只把 `windows-hello.node` 放在 `app.asar.unpacked/out/main/native/` 的固定路徑；`app.asar` 內的 manifest 記錄固定檔名與 SHA-256，不使用 `extraResources`。main 限制 addon 檔案型態／大小、重算 manifest SHA-256 後才載入，並只接受固定結果 token。這可偵測打包錯配，但 Electron 的 embedded ASAR integrity 只在 macOS 生效；Windows 未簽章版不能抵抗同一使用者修改 App 檔案。Hello 未設定、取消、裝置忙碌、重試耗盡或 addon 異常都 fail closed，Windows 不會降級成一般確認按鈕放行敏感操作。

會計中心不把 Finances JSON、Amazon-generated settlement、人工前置報表或不存在的發票／帳單 API 混為一談。Renderer 只取得 allowlisted capability 與安全工作狀態；一般站點發票、Seller Central 帳單及未完成 FBA 逐列過濾的 account-wide 文件保持停用，不使用私有接口。

## 儲存

- `credentials.enc`：OS-backed `safeStorage` encrypted vault，只含密文；macOS key 在 Keychain，Windows key 由當前登入使用者的 DPAPI 保護。
- `ads-credentials.enc`：獨立的 Ads OS-safeStorage-backed encrypted vault；不改寫 `credentials.enc`，也不改變既有 LocalStore 格式。
- `fba-os-data.json`：商品補貨主檔、idempotency ledger 與不含憑證的短效 report lease/tombstone；維持可由上一版忽略的相容格式。
- Renderer session 使用非持久 partition；偏好資料不應承載秘密。

## 圖片

本機圖片無法被 Amazon 抓取。App 先驗 magic bytes、10 MB、JPEG／PNG、寬高至少 500px；若使用者設定自己的 R2，main 才以上鎖憑證上傳並產生公開 HTTPS URL。沒有 R2 時仍可拖拉預覽，也可貼既有 CDN URL，但不會把本機檔案假裝成 Amazon 可讀來源。

## 更新

GitHub 控制台每次推送即自動更新；只有新增底層 API capability 或安全修補才需要更新 Notebook Key。macOS 正式 GitHub Release 提供 DMG（初裝）、ZIP 與 `latest-mac.yml`（Squirrel.Mac 更新）。Windows x64 內部 build 提供固定檔名的 NSIS installer、解壓即用 ZIP 與 `SHA256SUMS.txt`；尚未建立 Authenticode 簽章或 Windows 自動更新鏈，因此 Windows main 明確停用 App 內更新，只允許從固定 `notebook-key-windows` Release 手動下載並核對 SHA-256。SmartScreen 警告與 Windows Hello 實機驗證不可用 CI smoke 取代。
