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
- SP Reports 只接受六種 main-owned 固定意圖：all listings、Active Business Listings、aged inventory、inbound noncompliance、exact-date DAY＋SKU sales/traffic，以及綁 immutable data window 的 FBA shipment sales。Production adapter 不接受 renderer／router 指定任意 transport；POST 不 replay，GET 的 401／transient retry、timeout、redirect、signed URL、壓縮與解壓大小皆有固定上限。account／mode／marketplace／report type／canonical options 綁定的 durable lease 統一保存 30 分鐘 no-blind-retry 與 terminal／unknown tombstone；read 不得隱含 create。跨 router／renderer 邊界只公開 `report-lease.*`／`report-document.*` handle；原始 report ID、document ID、account scope 與 signed download URL 只留在 main-owned runtime／adapter，domain parser 只接收已下載文字且不得重新輪詢或下載。帳號、mode 或 generation 改變的 context error 不得被 optional report fallback 或 AbortError 吞掉，必須 fail closed 回傳原始 409 fence；create 已開始才遇到此競態時，durable evidence 仍保存 outcome-unknown tombstone 而不是開放重送
- 全站文案使用 AMZ.API 共用的版本化 SCOWL en_US 辭典、`nspell` 與窄範圍品牌／成分／Amazon 合法字詞表。Mac 與 Windows 的 Notebook 鑰匙主程式套用同一份辭典並保存可匯出快照；文案不傳送到外部拼字服務。第三方字典／引擎版本與 SHA-256 保存於 `src/shared/vendor/spellcheck/`；完整授權公告保存於 `src/renderer/public/licenses/spellcheck/` 並隨 Pages artifact 發佈
- Variation family 查詢保持唯讀；唯一改掛 route 只允許 FBA child，固定兩階段 Amazon Validation Preview → 本機身分確認 → 持久 idempotency → 單次 PATCH → 唯讀回查。真正 PATCH 前失敗會安全釋放 claim；已送出或已接受後的未知狀態不得重送
- 全站文案／圖片／A+／訂閱／B2B 價格健檢只接收 main process 證明的 FBA SKU。A+ 只使用公開 A+ Content API：完整 child／standalone 才可依 exact marketplace＋ASIN 讀 publish records；relationship 未完成列不發該 ASIN 的 publish-record request，也不以空結果判未發布，但可用 account-wide Content Documents／ASIN relations 的 exact `CONTENT_PUBLISHED` 補上正向證據。任一 exact publish record 優先保留正向證據；文件存在、APPROVED、warning-only 空清單、文件／關聯覆蓋未完成或真正 published／not-published 關聯衝突仍保持未知並引導至固定白名單的 A+ Content Manager，不得冒充已發布或未發布。訂閱的 exact-SKU offer／月度問題列只有帶同次 `CURRENT_FBA` 證據才可顯示／匯出，未證明識別值只保留聚合計數。B2B Active Listings 必須經 account-scoped durable report lifecycle，data read 不得隱含 POST；Active 證據不可用或缺列且沒有其他 exact positive 時必須列為資料未完成。Active exact 現行 Business Price 可優先於尚未同步的 Listings attributes contribution；這個窄例外不適用於 Active 與 all-listings 兩份報表互相衝突。Active 重複欄／列、ASIN／身分、Active-vs-all-listings 衝突或 offer／QDP 歧義一律 fail closed，不得被第三個來源洗成已設定或未設定。兩個建議規則以列證據獨立計算且可重疊，未知證據不冒充不符；五工作表 B2B Excel 只能從 account／mode／marketplace／job／context 綁定且已完成的 main-owned snapshot 建立，不接受 renderer 傳入商品列。全站 B2B audit 固定唯讀；seller-specific PTD 只屬於另行明確啟動的單 SKU 寫入預檢。問題列只能單列隔離並將範圍降為 partial，站點、program、FBA fulfillment、月份或分頁衝突仍整次 fail closed；訂閱與綜合健檢 Excel 只能由 main 保存的短效快照建立
- 文案健檢 Excel 只接受 AMZ.API schema v2 `.xlsx`；選檔與拖放共用同一個檔案驗證入口，main process 拒絕公式、巨集、外部連結、Defined Names、未知欄、重複 SKU、異常 ZIP/XML 與超限內容。帳號、站點、live／demo、export ID、時間、SKU／ASIN／Product Type、變體分類與全部原始文案都必須和裝置端 24 小時 SHA-256 列證據精確一致；特殊換行必須無損 round trip，舊檔復原只接受 main-owned digest 唯一命中。持久檔不保存 SKU、ASIN、文案、Excel 或 proposed edits，鎖屏／重啟不展延期限。顏色與 rich text 不作授權依據，只採用「更新」欄的實際差異
- 成分宣稱核對只在同次 Amazon `ingredients` 完整且非空時執行：至少兩項不同成分才可否定「single ingredient」；文案提到 Tendon／Tendons 但 ingredients 未列 tendon，或 ingredients 明確含 Chicken 而文案宣稱 hypoallergenic，也會逐欄標示。全詞、大小寫與可證明的頂層分隔符由共用 deterministic 規則處理；括號內逗號、空成分或 Listing 讀取未完成都不得推測。立刻修改必須同時核對宣稱欄位與 ingredients 的原值／fingerprint，任何 drift 都退回完整編輯
- Excel 批次文案寫入在第一次 PATCH 前先鎖定全批 SKU、檢查每 SKU idempotency ledger、重新讀取並完成全批 Amazon Validation Preview；任一預檢失敗即零寫入。通過後只要求一次 Touch ID／Windows Hello，但 Amazon 仍沒有跨 SKU 交易：每 SKU 各自單次 PATCH 與 canonical readback，遭拒或結果不明即停止後續，`401`／`429`／`5xx`／逾時或回讀不明不得盲目重送
- B2B 價格／數量折扣寫入只接受 exact FBA SKU、同幣別標準價／B2B 舊值、完整舊 QDP hash 與 seller-specific PTD checksum；PATCH 只能 merge `purchasable_offer` 中 exact `audience=B2B` contribution，不得刪除或改寫 `ALL` 或其他 audience。價格單改固定省略 `quantity_discount_plan` 並證明既有 plan 未漂移；只有使用者在同一 immutable 預檢內容明確提交 canonical percent tiers、且 QDP PTD 能力已獨立證明時，combined PATCH 才可帶完整 plan。固定經 fresh read、Amazon Validation Preview、一次 Touch ID／Windows Hello、持久 idempotency、單次 PATCH 與 price＋tiers canonical readback；拒絕或結果不明即停止且不得盲目重送
- 一鍵全部健檢不建立第二套 renderer 結果或重複 Amazon 掃描；它依 schema v3 的固定名稱與順序，直接啟動或 single-flight 沿用文案、圖片、A+、未綁變體、訂閱價格、B2B 價格、廣告覆蓋七張既有卡片各自的 main-owned 工作。每項都綁定 account scope、mode、marketplace 與短效 context；關閉抽屜只停止該 observer，不得取消主程序工作，首頁以 fenced job／context ID 重新接回單調進度與結果。啟動失敗與 terminal failure 必須留在對應卡片且不得顯示舊 cache 冒充本次結果。180 天以上庫齡與評論依此順序放在首頁預設折疊的獨立低頻區，不得偷偷併入 run-all。renderer 不能上傳整份 snapshot 或 account scope；每份 Excel 只由其 main job 的已驗證結果建立。舊 `/audit-suite` 與合併匯出 route 只保留相容性，首頁不得同時啟動它而造成第二次掃描；帳號、模式、站點或 credential lifecycle 改變時舊工作必須取消或失效
- Amazon Ads 使用獨立 OS-safeStorage-backed vault；只允許官方固定 token／Profiles／Campaign query endpoint、精確 Seller Profile 與 Sponsored Products 唯讀查詢。App 沒有 Ads write route，Listing 身分或來源不完整時不輸出全站覆蓋結論
- FBA 廣告策略工作綁 SP account scope、Ads vault＋Seller Profile scope、mode、marketplace、exact date range 與固定 report config。Reports／Ads create 結果不明時保存 durable tombstone 且不盲目重送；report／profile／campaign／account IDs 與 signed download URL 不進 renderer，缺值不補 0，也沒有任何 Ads write method／route
- 會計能力使用固定公開 SP-API allowlist；未完成 FBA 過濾、人工前置、Brazil-only 與不存在的通用發票／帳單接口保持停用
- FBA 入庫貨件只允許固定 Fulfillment Inbound v0 GET、固定 2024-03-20 入庫計畫 GET 備援與固定 inbound noncompliance report type；工作綁 account／mode／marketplace／日期，切換安全 context 即取消。逐票第一頁只能由 exact shipment path 取得，後續 `NextToken` 只能交給固定 global `shipmentItems` NEXT_TOKEN GET，並檢查 token 前進、同票身分、重複 SKU 與頁數／列數上限。只有 v0 日期範圍清單可標為所選日期完整；活動狀態或新版計畫備援固定標成 partial。逐貨件明細或問題報表不完整時標成 partial／unavailable，不把缺值補 0，也不使用 Seller Central session 或私有接口
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
