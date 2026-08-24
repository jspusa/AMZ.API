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

main process 已為新抽離的 SP domain module 與 main-owned audit／report coordinator 建立不可變 execution context：marketplace、由 marketplace 推導的 region、demo／live mode、不透明的 account scope 與單調 generation；既有尚未抽離的 legacy facade route 維持原相容路徑，不冒充已全面遷移。production 與 scripted test adapter 共用同一契約，renderer 不能提供 region、帳號識別值或 generation。憑證儲存／清除、鎖屏、系統 suspend，以及偵測到帳號或 mode 改變時，main 會先讓舊 generation 失效，再清除 token、capability、demo override 與 router runtime cache；耐久的 LocalStore 證據與 app-session 級 A+／FBA inbound／Customer Feedback rate-limit pacing 不會被誤當成短效 context cache 清除。canonical SP errors 定義在獨立 leaf module，legacy facade 只 re-export；所有已接入的 SP error public seam 與連線測試都在跨 main／renderer 邊界前轉成 frozen、allowlisted descriptor，保留安全的 status、code、Request ID 與 rate-limit 資訊，同時移除 token、Seller ID、account scope、report／document ID、URL 與控制字元。pre-commit 錯誤的 `commitPatchSent=false` 仍只供 main 內部 no-blind-retry 判斷，不暴露給 renderer。

Listings Items 與 Product Type Definitions 的外部讀取已集中到 main-only fixed adapter。Facade 只能送出 `listing`／`variation-evidence` item、固定 SKU／ASIN／relationship／access-probe search，以及 `content-read`／`content-write`／`business-offer`／`variation-child` definition 等封閉語意；介面不接受 host、URL、method、query、included data、Seller ID、token 或任意 Amazon request。production adapter 固定官方 region endpoint、GET、query vocabulary、401 refresh 與用途限定的 bounded retry；單品 full→essential→minimal、access probe standard→minimal、variation relationships→attributes，以及 content-read seller-specific PTD→generic PTD 各自獨立，不能互相擴張。generic PTD fallback 的結果型別與 runtime contract 都不提供給 content write、B2B 或 variation CHILD；正式 PATCH preview／commit 使用另一個 write-only helper，沒有任何 read fallback。PTD 會在下載 schema 前核對 exact Product Type 與 marketplace，schema resource 只能跟隨 Amazon definition envelope，caller 不能指定 URL；scripted adapter 保留 raw fixture envelope並通過同一公開 identity normalization，單筆／批次 SKU、ASIN、Product Type、marketplace 與 variation parent evidence 均先 fail closed，FBA 與 schema domain normalization 再由 facade 維持原規則。architecture guard 禁止新 adapter 反向匯入 legacy `sp-api.ts`、router 或 main entrypoint。

Variation／catalog identity 的唯讀語意已進一步集中成一個小型 cluster：`variation-family-reads.ts` 負責 exact SKU／ASIN、member、declared children 與 opaque child pagination；`variation-relationship-evidence.ts` 負責最多 20 SKU 的 relationships batch 與逐列 fail-closed classification；`variation-catalog-reads.ts` 組合 FBA grouping、未綁變體與評論候選，並維持既有 public export。三者只依賴上述 `ListingsReadAdapter`，不接受任意 transport callback，也不自行讀取 env、vault、Seller ID、token、任意 URL 或 production transport wiring。Variation batch 固定 production `variation` profile；exact requested SKU 在 adapter boundary 綁定，ASIN／Product Type／站點 conflict 則由 domain classifier 逐列 incomplete，避免一列污染同批其他安全列。角色、parent 與 theme 只由 current-market relationships 證明，attributes 只能交叉核對。Parent、child 與 standalone 不會由商品名稱或相似 ASIN 推論；declared child、queried child 是否實際出現在 canonical search、跨頁總列數、重複 SKU、重複 page token 或 family theme 衝突都 fail closed。畸形 2xx nested payload 統一映射為 canonical SP-API error；成功 family DTO 的 upstream issue message 改成固定公開文案，code／severity／attribute names 與 Request ID 共用 canonical private-material sanitizer 和數量上限。報表建立／下載／seed parse、demo／live 選擇與 execution context 仍由 facade／router 擁有；detach／attach 的 PTD、Validation Preview、native approval、idempotency、單次 PATCH 與 readback 也留在 write seam，只重用新的唯讀 item／family evidence。`exact-seller-sku-batches.ts` 讓 Variation 與既有 B2B 批次共用不 trim／不 alias 的固定 planner；`listings-response-error.ts` 則保存既有 Listings status、issue、Request ID 與 no-blind-retry error vocabulary。任何會進入成功 DTO 的批次失敗訊息使用固定 allowlisted 文案與清理後 Request ID，不複製任意 upstream message。architecture tests 同時禁止這個 cluster 反向匯入 legacy facade、router、main entrypoint、write module、credential／store 或 production adapter，並禁止重新加入任意 relationship transport callback。

允許路由只有：

- Orders
- Listings price / batch
- FBA-only Business Price audit + B2B-audience-only preview/update
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

全站文案與圖片健檢沿用 Reports API 與 Listings Items 的 FBA-only 匯出資料，renderer 仍會核對回應站點後才顯示或快取；文案掃描再以批次 Listings relationships 排除已證明的 parent，child 依 parent SKU 分 family，standalone 與 relationship 不完整列各自隔離。文案的內部健檢門檻固定為產品名稱少於 60、產品亮點少於 110、每項產品要點少於 150 或超過 200、產品敘述少於 1,800 個 Unicode 字元；圖片少於 6 張才列為不足。英文錯字由 GitHub Pages renderer 內的版本化 SCOWL en_US 辭典與 `nspell` 檢查，再以窄範圍白名單保留品牌、成分與 Amazon 合法字詞。Mac 與 Windows 使用同一份辭典，不再依賴作業系統字典；字典在 Pages 介面內本地執行，文案不會送往第三方。成分宣稱規則由 main 與 renderer 共用：至少兩個不同 ingredients 才可否定 single ingredient；Tendon／Tendons 必須在 ingredients 有全詞證據；ingredients 含 Chicken 時，hypoallergenic／hypo-allergenic 會列為待核對。括號內逗號不拆項，空成分或讀取不完整不推論。前台每項原因只呈現一次，摘要數字本身就是同一個篩選入口，並把所選原因帶入相符的立即修改欄位；相關原文或成分 fingerprint 漂移即 stale fail closed。

全站 A+ 健檢同樣以目前 FBA all-listings 範圍為 seed。已證明為 parent 的容器排除；完整 child／standalone 依 marketplace＋ASIN 去重後逐一呼叫公開 A+ Content `contentPublishRecords`，再 fan-out 回 Seller SKU。relationships 未完成但 all-listings 已提供 exact FBA ASIN 的列不發該 ASIN 的 publish-record request，也不會以空結果判未發布；它只作為 account-wide `searchContentDocuments` 與 `listContentDocumentAsinRelations` 的 exact match target，只有 `CONTENT_PUBLISHED` 能補上正向發布證據，否則維持 incomplete。介面分開顯示文件名稱、文件審核狀態與 ASIN 關聯狀態；文件存在或 APPROVED 本身不等於已發布。只有完整走完所有 publish-record pages 且得到空清單，並同時完整覆蓋 Content Documents 與每份文件的 ASIN relations、無 warning、身分或 schema 衝突時才可標為未發布；任何 exact publish record 可正面證明已發布，即使 optional warnings envelope 異常也不丟棄這項正向證據。403、warning-only 空清單、分頁、文件／關聯覆蓋未完成、文件關聯衝突或回應缺口維持 unavailable／incomplete，並可透過固定白名單開啟 A+ Content Manager 核對；不使用 Seller Central 私有接口或猜測。

文案 Excel 的原始／更新雙欄、問題顏色與變體索引可回傳 main process；同一選檔區同時接受按鈕選檔與 drag/drop。main 嚴格解析 OOXML，對 CR／U+0085／U+2028／U+2029 做無損 round trip，舊工作簿只在 main-owned 完整 digest 唯一命中時做 bounded recovery；識別欄、family、原值、公式、巨集或外部連結仍 fail closed。裝置端只保存 24 小時的 account／marketplace／mode-scoped SHA-256 列證據核對原檔，不保存 Seller SKU、ASIN、文案、Excel 或 proposed edits，鎖屏／重啟不展延期限。整批 fresh-read／Validation Preview 全通過、renderer 展示完整逐欄前後值並由使用者核對後，才做一次 native confirmation；之後逐 SKU 使用既有 ledger、單次 PATCH 與 canonical readback。

FBA Business Price 健檢先由完整 all-listings 範圍證明目前 FBA Seller SKU，再以 exact SKU／ASIN／marketplace 讀取 Listings B2B offer，並以官方 Active Listings 的 Business Price 補足 all-listings 可能缺少的欄位。Active Listings 建立與輪詢由 main-owned `DurableReportLifecycle` 以 account／marketplace／mode／report type／options 綁定、single-flight 並持久沿用；data read 不會隱含再 POST。只有 Active report 明確 absence 或其他完整負面證據才可判未設定；單一來源 unavailable 時可由另一個 exact positive 保留已設定。Active exact 現行 Business Price 與 Listings attributes contribution 不同時，採 Active 並明示 attributes 尚未同步；若 Active 與 all-listings 兩份報表 exact 價格不同，或 Active 有重複欄／列、ASIN／身分衝突，則維持 incomplete，第三個 Listings positive 不能洗掉衝突。一般售價／Buy Box ERROR 與 Business Price 證據分開，不能抹除已確認的 B2B 正向證據；「不符建議 B2B 價格」與「未正確設定階梯折扣」由同一列的 exact 價格／QDP 證據獨立計算，可同時命中，未知不補成不符。五工作表 Excel 由 main 重新取得 account／mode／marketplace／job／context 綁定的已完成快照建立；renderer 只送識別碼並接收 bytes，不能指定匯出列。全站 audit 固定唯讀並只提供 Seller Central handoff。獨立單 SKU 寫入能力仍只接受帶目前 Seller ID 的 seller-specific PTD（`LISTING_OFFER_ONLY`）；更新只允許 merge `purchasable_offer` 中 exact `audience=B2B` contribution 並保留 `ALL` 與其他 audiences。價格單改不攜帶 QDP；只有明確 combined proposal 才能加入 canonical `quantity_discount_plan[0].schedule[0]` percent levels，並把完整舊／新 plan hash、獨立 PTD capability、preview payload 與 native 摘要綁進同一票證。POST 只做 fresh read、PTD checksum 與 Amazon Validation Preview；PATCH 前再 fresh read／preview、native confirmation、idempotency claim、單次 Amazon PATCH 與 price＋tiers canonical readback，timeout 或結果不明時停止且不盲目重送。

FBA Inventory 與 Seller Replenishment 的外部讀取已集中到 main-only invariant cluster。Facade 只能送出 `inventory:item`／`inventory:catalog-page` 與 `replenishment:single-offer`／`offers-page`／`metrics-page` 等封閉語意；介面不接受 host、URL、method、query、body、region、token 或 retry controls。production adapter 固定官方 Inventory GET 與 Replenishment POST vocabulary：單 SKU Inventory／offer 保留一次 401 refresh 與最多兩次 bounded transient read retry；全站 Inventory／offer／monthly metric page 每次只允許一次 401 refresh，429／5xx／timeout 不自動 replay。scripted raw envelope 走與 production 相同的 identity、pagination、normalization 與 FBA evidence 規則，architecture guard 禁止 cluster 反向匯入 legacy facade／router／main entrypoint。

單 SKU Subscribe & Save 現在必須先取得同次 exact FBA Inventory SKU 證據；合法空 Inventory 以既有 `FBA_SKU_NOT_FOUND` 停止，而且不會發出 Replenishment request。全站健檢仍先完整讀完同次 FBA Inventory 分頁，再與 current offers／完整月 metrics 合併；零庫存 exact SKU 仍是 current-FBA，無法原樣辨識的 Seller SKU row 只讓 coverage 降為 partial，duplicate SKU／token、空白非終頁或超過 200 頁則 fail closed。offer／metric duplicate、row-level failure 與缺月維持既有隔離語意，missing 不補 0，coverage 不完整不顯示部分總額，沒有 current-FBA proof 的 FBM／unproven identifiers 不進 snapshot 或 Excel。23 個完整月與 SG／AU unsupported 限制不變；Excel 仍只由 main process 保存的短效快照產生。

主導覽把 FBA 入庫貨件追蹤只放在「報表區」，不在首頁或「營運區」重複入口。首頁的一鍵全站 launcher 依 schema v3 的固定名稱與順序，直接 fan out 至全站文案、全站圖片、全站 A+、未綁變體、全站訂閱價格、全站 B2B 價格、廣告覆蓋七張既有卡片；不建立第二套進度／結果區，也不另外啟動會重複掃描的 legacy suite coordinator。單項文案、圖片、未綁變體、訂閱價格、B2B、廣告覆蓋與庫齡使用共用 main-owned standalone job coordinator；A+、評論沿用各自 main-owned coordinator。相同 selection 的 active 工作由 main single-flight 沿用；每個工作都綁 account scope、mode、marketplace 與短效 context，renderer 關閉抽屜只中止 observer，首頁仍以 GET 重新接回單調進度與 terminal snapshot。任一啟動失敗或 terminal failure 只進對應卡片，舊 cache 不得冒充本次結果；credential／帳號／模式／站點改變時舊工作失效。legacy `/audit-suite` 與合併匯出 route 暫留相容性但首頁不可達。耗時且低頻的 180 天以上庫存與評論依此順序收在獨立的「低頻健檢」收合區，不納入 run-all。

Reports 建立由 main process 的 account-scoped broker 協調。相同 account、marketplace、mode、report type 與 options 的 all-listings report 可由品牌、未綁變體、評論與內容／圖片匯出共用；日期型 shipment report 另外綁 exact window。Local store 只保存不含憑證的短效 report ID／狀態 tombstone，程序內用 single-flight 與單調狀態更新防止重複建立或完成狀態回退。`CANCELLED`、`FATAL` 或建立結果不明都不會由自動載入盲目重建；明確使用者再試仍受安全等待與 mode/account 驗證。

FBA inbound shipment 工作在 main process 以 account、mode、marketplace 與精確日期區間綁定。Fulfillment Inbound v0 清單與逐貨件 items 只允許固定 GET path；若 Amazon 對 v0 日期範圍清單回傳明確 400／422，main 才依序改用固定 v0 活動狀態清單與固定 2024-03-20 plan／shipment GET。備援清單不具完整所選日期證據，因此即使逐貨件 items 都讀完，整體工作仍必須是 partial。逐貨件第一頁若回傳 `NextToken`，main 只以同一 opaque token 呼叫固定 `/fba/inbound/v0/shipmentItems?QueryType=NEXT_TOKEN`，每頁檢查可見 Shipment ID、token 前進、重複 SKU、頁數與全域列數；任何衝突只保留已核對列並把該票標為 partial。每日 noncompliance report 由同一耐久化 report broker 建立／輪詢，renderer 只取得已清理的 shipment／carton／product 問題列，不取得內部 plan／shipment ID、report ID、document ID、帳號 scope 或任意下載 URL。

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
