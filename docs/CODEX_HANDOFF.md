# AMZ.API — Codex 專案交接入口

最後更新：2026-08-23
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前正式基線：`v0.1.27` 已發布、部署並由 exact release-code main macOS artifact 安裝為 `/Applications/AMZ.API.app`；原 v0.1.26 保留為 `/Applications/AMZ.API-v0.1.26-backup.app`，更舊備份、原 userData 與既有 encrypted vault file 均未清除。live Pages 七個檔案與 exact main production output byte-for-byte 相同；已安裝 App 的版本／build、bundle、雙架構、deep strict codesign 與 `app.asar` 均匹配 artifact。Mac 目前鎖定，主程序停在原生 Keychain 重新授權等待且尚未建立 renderer；尚未執行 v0.1.27 的正式 Amazon 唯讀 canary、Touch ID 或任何 mutation。受保護員工 Mac 下載卡仍是舊版，Windows 固定 prerelease 仍為 v0.1.16，且沒有真實 Windows Hello 硬體驗證。

目前工作樹：`v0.1.27` 功能已由 PR #60 squash merge，release code main SHA 為 `d7136660eb71a4308625f49334a159c5351f7c08`；同一 SHA 的 Validate、Pages、macOS universal 與 Windows x64 workflows 均成功，source、CI、Pages、Mac／Windows artifacts 與 exact Mac 安裝已完成。v0.1.27 修正 A+ optional subtype、B2B exact Business Price 唯讀 fallback、run-all 直接 fan out 至七張既有卡片、A+／B2B 單一可點摘要，以及「所有變體」深淺藍 family 色塊與外框；同時保留 v0.1.26 的文案原因不重複、立刻修改／完整編輯與同檔 Excel round trip。使用者原始 Excel 的 273 列離線完整性已通過；正式 Amazon 唯讀 canary、任何 PATCH／readback、文案或圖片 mutation，以及真實 Windows Hello／DPAPI 裝置矩陣仍未執行，不得以 CI、舊版唯讀 canary 或 fake Bridge 證據取代。
交接目的：讓新的 Codex 對話不需要重讀原始聊天，也能安全地繼續開發、除錯與發布。

---

## 0. 給新 Codex 的第一句指令

使用者可以直接貼上：

> 請先完整讀取 `docs/CODEX_HANDOFF.md`，再依照其中的「必讀檔案順序」讀完相關檔案。先執行唯讀檢查與 `npm run check`，確認目前 GitHub `main`、本機分支、版本與 Actions 狀態，不要重建專案。這是正式的 AMZ.API Amazon FBA 控制台；不得把任何 API Secret、Refresh Token 或 Seller ID 寫入 GitHub、日誌或回覆。完成盤點後，先告訴我目前狀態、未完成驗證與你建議的下一步，再繼續修改。

---

## 1. 專案一句話

AMZ.API 是 Jasper 公司自用的 **Amazon FBA-only 營運控制台**：GitHub Pages 自動更新介面，macOS／Windows Notebook Key Bridge 在本機系統安全儲存區保存 Amazon SP-API 憑證並執行本機 API 請求；一般瀏覽器沒有受信任 Bridge 時保持鎖定。

這不是公開 SaaS、不是多租戶產品、不是 FBM 工具，也不是 Helium 10 的替代品。

---

## 2. 使用者真正想解決的痛點

使用者不想反覆進 Seller Central 點選繁瑣頁面，希望能輸入 Seller SKU 後完成大部分日常工作：

### 策劃區

- 廣告：SP 主要留在 Helium 10；AMZ.API 只需簡化 SB／SD 授權狀態與官方入口。
- 補貨：自動整合 FBA 可售、在途、銷速、交期、安全庫存、箱規與 AWD 路徑。
- 既有 Amazon 補貨 Skill 若可安全接入可列為選配，但內建補貨不能依賴外部 Skill 才能運作。

### 產品區

- 文案：查詢及修改產品名稱、產品亮點、五大產品要點、產品敘述與成分；全站門檻為 60／110／每項 150–200／1,800 Unicode 字元，原因只顯示一次，且能帶入相符的立即修改欄位。
- 圖片：拖拉上傳、排序、主圖選擇、尺寸與格式驗證、Amazon Validation Preview；全站少於 6 張才列為不足。
- 一鍵健檢所選站點全部 FBA 文案並匯出依 variation family 分頁、問題欄有色標示的 Excel；同一檔案可選檔或 drag/drop 回傳做整批零寫入預檢，再經一次本機身分確認逐 SKU 安全更新。Excel 特殊換行需無損 round trip。成分宣稱只採同次完整 Amazon `ingredients` 證據：多成分否定 single ingredient、文案 Tendon／Tendons 必須有對應成分，且含 Chicken 時會標示 hypoallergenic 宣稱待核對。
- 首頁 run-all 在背景並行執行文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；一般健檢卡與 run-all 共用完全相同名稱與固定順序。180 天以上庫存與評論屬低頻工作，依此順序預設收合且不加入 run-all。

### 價格區

- 定價：依 Seller SKU 查價與安全調價。
- Amazon Business Price：全站只健檢目前 FBA SKU，並獨立標示 B2B 高於一般售價；只有 seller-specific PTD 明確開放時才能預檢或更新 exact `audience=B2B` contribution。預設 price-only 固定省略 `quantity_discount_plan`；只有使用者明確選用且 QDP PTD 能力另行證明時，才可在同一次 combined 預檢／PATCH 更新完整 percent tiers。一般售價與其他 audiences 永遠不改。
- Subscribe & Save：目前公開 SP-API 能力不足的部分維持唯讀／官方頁完成人工設定。
- 促銷：限時售價 API；Coupon 及部分促銷資格在 Amazon 官方頁完成。

### 操作設計

- Apple 式極簡、人性化、美觀。
- 能自動化就自動化；能一鍵就不做成多步驟。
- 自動＝淺綠、一鍵＝淡藍、需人工＝黃色。
- 必須有防呆、衝突檢查、自我檢查與可理解的中文錯誤。
- FBA only；不得加入 FBM 操作入口或混入 FBM 商品。
- FBA 入庫貨件追蹤只放在頂部「報表區」，不在首頁或「營運區」重複顯示。

---

## 3. 已確定的架構

```text
GitHub repository / Actions
├─ GitHub Pages：最新 renderer UI
├─ Validate workflow：型別、測試、build
├─ macOS workflow：universal App、啟動檢查、DMG/ZIP
└─ Windows workflow：Windows 11 x64 App、原生 addon、NSIS/ZIP smoke

macOS／Windows AMZ.API Notebook Key
├─ 載入精確允許的 GitHub Pages origin
├─ Preload 提供窄化、白名單式 Bridge
├─ Main process 執行 Amazon SP-API
├─ safeStorage 以 macOS Keychain／Windows DPAPI 加密 Secret
└─ Touch ID／Windows Hello 保護敏感操作
```

重要邊界：

- GitHub 不保存也不應接收到 LWA Client Secret、Refresh Token 或完整 Seller ID。
- Amazon Access Token 只應短暫存在 main process 記憶體。
- 一般瀏覽器打開 GitHub Pages 只顯示鎖定／啟動頁；真正控制台在 AMZ.API App 視窗操作。
- Renderer 不應取得解密後 Secret，也不應擁有通用任意 IPC 或任意 Amazon URL 請求能力。
- Custom deep link 只用於啟動／聚焦 App，不得直接觸發 Amazon 寫入。
- 寫入固定走：讀舊值 → Amazon Validation Preview → 本機票證 → 防呆 → Touch ID／Windows Hello → 再檢查 → idempotency → 單次寫入 → 回查。

詳細安全邊界以 `SECURITY.md` 與 `docs/ARCHITECTURE.md` 為準。

---

## 4. Amazon 串接決策

目前以 Jasper 自家公司、Private Seller App、US marketplace 為第一優先。

需要的四項本機資料：

1. LWA Client ID
2. LWA Client Secret
3. NA Refresh Token
4. NA Seller ID / Merchant Token

Amazon App：

- 名稱：`AMZ.API`
- App Type：Production
- Business entity：Seller
- 不使用 Sandbox 作為正式資料來源
- 不委派 PII／RDT
- 建議角色：Product Listing、Pricing、Amazon Fulfillment、Inventory and Order Tracking
- 不需要 FBM、Buyer Communication、Buyer Solicitation 或其他 Restricted／PII 角色

完整申請與填寫流程見 Library／工作區文件 `AMZ.API_API串接SOP.md`。

已遇過的 Amazon 後台岔路：

- `Existing consolidated SPP Profile`：使用既有 Jasper Profile，不要建立重複 Profile。
- `No authorization allowed`：舊 Developer Central／錯誤 Profile；應使用已移轉並通過審核的 Solution Provider Portal Profile。
- Developer registration under review：等待審核，不要重建 App。
- `amzn1.sp.solution...` 是 Application ID，不是 LWA Client ID。

---

## 5. 目前最新狀態（重要）

### 已完成

- Repository 已正式命名為 `jspusa/AMZ.API`。
- GitHub Pages Source 使用 GitHub Actions。
- GitHub UI／Mac Key Bridge 雙成品架構已完成。
- Amazon Orders API 已在使用者真實帳號讀到 FBA 訂單，代表 LWA／Refresh Token 基本可用。
- v0.1.2 修正單一 SKU `getListingsItem` 不應帶 `productTypes` 的參數錯誤。
- v0.1.3 新增：
  - Mac 連線測試同時驗證 Orders 與 Listings，不再因 Orders 成功產生假綠燈。
  - Excel 批次 Listings 查詢回 400 時，自動安全降級為逐 SKU `getListingsItem` 只讀查詢。
  - App 內 SOP 角色名稱改為 `Inventory and Order Tracking`。
  - 版本升至 `0.1.3`。
- v0.1.3 已在真實 Mac／Amazon 帳號重現：Orders 成功，但 Listings probe 與 SKU `AFA12AM` 的 `getListingsItem` 均回 HTTP 400 `Invalid parameters`。
- v0.1.4 候選修正已完成：
  - Listings 單品查詢在完整官方參數回 400 時，只對唯讀 GET 依序測必要資料集與真正最小必填參數；任何寫入都不走降級路徑。
  - 連線 probe 可由標準參數降級為最小唯讀參數，並保留實際 operation、Amazon error code 與 Request ID。
  - Seller ID 輸入會拒絕 Marketplace ID、空白及不可見字元；更換 Refresh Token 時必須同時提供同帳號 Seller ID，避免跨帳號殘留。
  - Product Type Definitions 無法使用時，文案／圖片仍可唯讀，但所有編輯與 PATCH 明確停用。
  - 商品內容最終確認欄位不再用目標 SKU 當作假預填 placeholder；空白、字元不符、完全一致與送出中都有明確狀態，仍要求使用者手動輸入完整 SKU，不放寬寫入確認。
  - 沒有改動既定架構、沒有新增 FBM，也沒有放寬寫入安全邊界。
- v0.1.4 候選版已在同一台真實 Mac／同一加密 vault 重測：
  - Orders 仍可正常讀取。
  - 只帶 `marketplaceIds` 的最小 Listings probe 仍回 HTTP 400。
  - SKU `AFA12AM` 的完整、必要資料集，以及只含必填 `marketplaceIds` 的真正最小 `getListingsItem` 均回 HTTP 400；最後一次最小請求的 Request ID 已保留於本機診斷紀錄。
  - 同一 Refresh Token 的 Orders 可讀且包含 `AFA12AM`，US marketplace 也正確，因此將根因收斂為本機 Merchant Token／Refresh Token 的 Seller 帳號一致性。
  - Amazon Sellers API 在 NA 沒有可由 token 回傳 Seller ID 的 operation，程式不能安全自動猜測 Merchant Token；不得再盲目改參數或輪替 Secret。
  - 已在登入中的 Seller Central 本機核對，確認原先保存的 NA Merchant Token 與該帳號的官方 Merchant Token 不同；完整值未寫入 GitHub、文件或回覆。
  - 只在 Mac App 加密 vault 更新為正確 Merchant Token 後，「Orders 與 Listings 連線成功」與「Amazon SP-API 連線成功」均已通過。
  - SKU `AFA12AM` 的真實商品內容已成功載入：ASIN、FBA 履約、`PET_FOOD` 商品類型、標題、五大賣點與成分均有回傳；PTD 字數／欄位能力也正常顯示，不再回 HTTP 400。
  - SKU `AFA12AM` 的價格／訂閱唯讀查詢成功：LIVE／可購買狀態、標準價、有效價、最低價限制、S&S 資格、折扣與訂閱數均有回傳。
  - SKU `AFA12AM` 的促銷唯讀查詢成功：LIVE 狀態、標準價與目前無限時折扣均正確顯示；未填新折扣時建立按鈕保持停用。
  - US 全部商品 Excel 已由 Amazon Reports 建立並自動下載：商品內容表含 265 筆資料，`AFA12AM` 存在；兩筆無法確認為 FBA 的系列被排除並列於「錯誤與缺值」，另有 6 筆缺少成分提示。
  - Excel 未包含 Seller ID、Token、買家或訂單資料，且沒有公式錯誤。
  - SKU `AFA12AM` 的五大賣點 Amazon Validation Preview 已通過；最終確認欄位實際仍為空白，確認按鈕未啟用，因此沒有送出非預檢的真實 Amazon 寫入，商品內容未變更。
  - 最終確認 UI hotfix 已由 PR #3 合併至 `main` 並成功部署 GitHub Pages；真實 Mac App 已確認欄位保持空白、placeholder 改為通用指示、空白狀態有明確說明，正式更新按鈕保持停用。
  - hotfix 上線後重新唯讀查詢時，Amazon Listing attributes 只回傳一項 `Lean & Clean` 賣點；已依使用者先前提供內容在本機重建五項賣點並再次通過 Validation Preview，但未輸入最終確認 SKU、未執行真實寫入。
  - 已將驗證通過的 v0.1.4 安裝為 `/Applications/AMZ.API.app`，安裝後再次通過「Orders 與 Listings 連線成功」與 `AFA12AM` 商品內容回讀；原 v0.1.3 保留為 `/Applications/AMZ.API-v0.1.3-backup.app`。
- v0.1.5 修正已完成：
  - 整合尚未正式發布的 v0.1.4 Listings 核心修正，避免與已安裝的較早 v0.1.4 候選 build 混淆。
  - 修正 FBA Inventory v1 成功回應的 envelope：庫存摘要位於 `payload.inventorySummaries`，不再錯讀頂層欄位並誤報 `FBA_SKU_NOT_FOUND`；畸形 2xx 與合法空清單已分開處理。
  - 「近期營運」不再以單一 Orders 分頁計算「本頁銷售」；新增 Sales API `getOrderMetrics` 每日折線圖，預設 7 天並可切換 14／30 天。
  - 銷售趨勢固定 `fulfillmentNetwork=AFN`，以各站 IANA 時區處理日界與 DST，缺日補零且今日標示為未完成日；沒有加入 FBM。
  - 圖表日期與原有訂單查詢日期互相獨立；下方訂單仍保留 7／14／30／60／90 天範圍。
  - 沒有改動既定架構，也沒有放寬任何 Amazon 寫入安全邊界。
- PR #1 已 squash merge 到 `main`。
- 合併 commit：`c03514c53c537c4a44cf367b4783a62c45f06e08`。
- GitHub Actions：Validate、Pages、macOS universal build 均成功。
- 本機驗證：40/40 tests、TypeScript、main/preload/renderer build、`npm audit --omit=dev` 0 vulnerabilities。
- v0.1.5 PR #4 已 squash merge 到 `main`：`https://github.com/jspusa/AMZ.API/pull/4`；合併 commit：`41cbb5ffc0b1098450a562dc973262ec27c44846`。
- 分支上的 unsigned universal Mac workflow run `31079166726` 已完整通過打包、ad-hoc 簽章、Bridge 啟動 smoke test、DMG／ZIP 與 artifact 上傳。
- main 的 Validate run `31080698675`、Pages run `31080698660` 與 macOS universal run `31080698700` 均成功。
- v0.1.5 universal App 已安裝至 `/Applications/AMZ.API.app`；舊 v0.1.4 原封不動保留為 `/Applications/AMZ.API-v0.1.4-backup.app`。
- 真實 US 帳號唯讀驗證已通過：`AFA12AM` 的 SKU 指揮中心恢復 5/5 資料源，顯示非零 FBA 可售庫存與補貨結果，不再出現 `FBA_SKU_NOT_FOUND`。
- 真實 US Sales API 的 7／14／30 天 AFN/FBA 每日折線圖均完整載入，今日正確標示為即時／未完成資料；下方 Orders 日期範圍保持獨立。
- v0.1.6 銷售趨勢更新已完成：
  - 「近期營運」只保留 FBA 銷售折線圖，不再啟動 `/api/sp-api/orders`，也不再顯示訂單搜尋、訂單列表、分頁或單筆詳情。
  - 新增 90 天與自訂 1–90 天；自訂日期會在 renderer 與 main 雙重驗證，不可超過目前資料日，也不可超出 Sales API 去年同期可查範圍。
  - 每次查詢固定讀取本期與同月同日的去年同期，兩次都使用 Sales API `getOrderMetrics`、`granularity=Day`、站點 IANA 時區與 `fulfillmentNetwork=AFN`；沒有 FBM 或 Amazon 寫入。
  - 本期使用橘黃色實線與面積、去年同期使用灰色虛線；滑鼠／觸控／鍵盤可逐日顯示兩期金額，手機圖區在內部橫向捲動而不撐寬頁面。
  - 去年閏年的額外 2 月 29 日會排除；本期 2 月 29 日若去年沒有相同月日則明確留空，不會拿 2 月 28 日冒充。
  - 回傳 schema、日期、range、幣別與 totals 會 fail closed；同步或格式失敗會清除舊圖與舊 Live 狀態，不把過期數字顯示成即時。
- v0.1.6 PR #6 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/6`；feature head：`6091ff0b9fd649d816c07c8ca7d1504724a5093f`；main merge commit：`d288ac40640c92e42e11474068a879625ed7212a`。
- feature 與 main tree SHA 均為 `51acbe37a642b8bf5e5537d91d6832bc6d004c39`，已確認安裝前 build 與部署後 main 的 source tree 完全相同。
- v0.1.6 分支 Mac build run `31085746949`、main Validate run `31086616683`、Pages run `31086617355`、main Mac build run `31086616734` 均成功；Pages deployment `5776424283` 已成功發布 `https://jspusa.github.io/AMZ.API/`。
- 本機驗證：62/62 tests、TypeScript、main/preload/renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；另完成 Playwright 桌面／390px 行動版、hover、鍵盤、90 天、自訂與錯誤邊界測試。
- v0.1.6 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.5 原封不動備份為 `/Applications/AMZ.API-v0.1.5-backup.app`；安裝前後均確認 bundle ID `com.jspusa.amz-api`、`arm64`／`x86_64` 與 `codesign --verify --deep --strict`。
- 真實 Mac／Amazon 唯讀驗證已通過：App 正常啟動未閃退；US 站 7／14／30／90 天與自訂 90 天均載入本期及去年同期；每日提示同時顯示兩期金額；頁面底部沒有可見訂單明細區；回傳 notice 明確標示 AFN/FBA。
- 此次沒有讀取、修改或輸出 LWA Client Secret、Refresh Token 或完整 Seller ID，也沒有執行任何 Amazon 寫入。
- v0.1.7 已完成、合併、部署並安裝：
  - 商品內容更新移除重輸完整 SKU；支援 Touch ID 時直接顯示系統驗證，不先顯示額外確認對話框。Validation Preview、短效票證、舊值衝突、idempotency、單次寫入與送出後回查仍保留；無 Touch ID 時仍有原生確認 fallback。
  - Sale Price 明確對應 Seller Central「產品 → 管理所有庫存 → 編輯 SKU → Offer／商品報價 → Sale Price」，並說明不是廣告選單的價格折扣、管理促銷、Deals 或 Coupon；只更新 `discounted_price`。
  - Subscribe & Save 數字改稱「目前有效訂閱」：它是 Replenishment `listOffers` 查詢當下的 active subscriptions 快照，不是單月新增、歷史累計、配送次數或唯一顧客數。
  - 新增全站 FBA 內容健檢：Reports 清單搭配 Listings enrichment，檢查疑似錯字、少於五個賣點與成分狀態；Mac 內建字典每次最多檢查 5,000 個不重複英文單字，文案不送第三方也不自動改字。
  - 內容健檢採 fail closed：Listings 讀取失敗列為「讀取失敗／未完成」且不計入缺值或拼字統計；只有可確認為 `PET_FOOD` 的空成分算「缺成分」，其他商品類型列為「成分未驗證／需人工確認 PTD」。
  - 新增 Variation Family 唯讀地圖與拖拉規劃，只接受可證明為 FBA 的 child；跨站、product type、theme、缺維度、重複維度或 family 不完整會阻擋。Parent 只作唯讀容器，沒有 PUT／PATCH／DELETE，也沒有 FBM。
  - Electron 操作驗證曾抓到 variation lookup 一啟動就自行取消；根因是 Escape 鍵 effect 在 `busy` 變更時執行 cleanup 並誤 abort 目前 GET。現已把鍵盤 listener cleanup 與僅限卸載的 request abort 拆開，來源、目標與唯讀規劃均已在 Electron 展示模式通過。
  - 最終安全審查另補四項 fail-closed 防護：Reports 已證明為 FBA 的 SKU 不會因 Listings 缺 fulfillment 而消失；2xx 缺 attributes 會列為讀取未完成；renderer 遇到壞列、缺 SKU 或總數不一致會停止顯示；parent 宣告但搜尋漏回的 child 會讓 family 標為不完整。
  - 本機驗證：111/111 tests、TypeScript、main／preload／renderer production build、`git diff --check`、Electron 展示模式四項互動與 `npm audit --omit=dev` 0 vulnerabilities。
  - v0.1.7 PR #8 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/8`；main merge commit：`a9a9468cdfb42ae4d1e0e1b268027bf9ca7220a0`。
  - PR Validate run `31098052301`、main Validate run `31098122975` 與 main macOS universal run `31098122782` 均成功。原 main Pages run `31098122375` 的 deploy 步驟在 GitHub 端逾時；全新 workflow dispatch run `31098952558` 已成功，Pages deployment `5778814747` 已發布 `https://jspusa.github.io/AMZ.API/`，且 live HTML 已核對為本次 renderer 資產。
  - main artifact 已核對 checksum、版本 `0.1.7`、bundle ID `com.jspusa.amz-api`、`arm64`／`x86_64` 與 `codesign --verify --deep --strict`；v0.1.7 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.6 保留為 `/Applications/AMZ.API-v0.1.6-backup.app`。安裝後主程序可持續執行、未啟動即崩潰；真實 UI／Amazon 唯讀功能驗證仍待 Mac 解鎖。
- v0.1.7 頂部導覽與對稱版面 refinement 已由 PR #10 squash merge：`https://github.com/jspusa/AMZ.API/pull/10`；main merge commit：`4ebfb57357a1338cb2bb396c4a1d3abb9d8c88cf`。
  - 移除固定 `244px` 左側功能欄與手機底部三區捷徑；品牌與帳號使用等寬兩側，七個既有 FBA 工具在螢幕真正中心的頂部直接開啟原 drawer，全域 SKU、SKU 總覽、站點與系統健康留在第二列。
  - 手機工具列只在自身橫向捲動，沒有整頁水平溢出；新增 44px 觸控目標、鍵盤 focus、skip link 與 sticky header offset。沒有改動 Amazon API、Touch ID、Validation Preview、idempotency、憑證邊界或 FBA-only 規則。
  - 本機驗證：113/113 tests、TypeScript、main／preload／renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已檢查 1440／1024／390／320px、sticky header、七工具可達、促銷 drawer 開啟與 Escape 關閉。
  - PR 與 main Validate 均成功。首次 Pages run `31101756336` 的 build／artifact 上傳成功但 GitHub `deploy-pages` 逾時；同一 main SHA 的 workflow dispatch runs `31102544468`、`31102720169`、`31103081735` 隨後被 Pages 服務取消，官方 Pages API 對該 `pages_build_version` 回傳 `deployment_cancelled`。不得為此重建專案或改用非既定部署架構；應以新的文件／程式 commit 產生新 main SHA 後再從 `pages.yml` 乾淨部署，並以 live HTML 資產核對實際上線結果。
  - 新 main SHA `83ee7a91f993f5bf082cf3c1805e26ca45b67b3b` 的 run `31103608648` 已證明可正常建立並排入新 Pages deployment，但 GitHub 後端排隊超過 `actions/deploy-pages` 的 600,000ms 硬上限後再次逾時。run `31104818870` 也確認較大的 `timeout` 會被官方 action 強制封頂，因此不得把無效的 900,000ms 當成解法；`pages.yml` 改用官方 Node 24 的 `actions/deploy-pages@v5` 並保留預設上限。同 SHA 的 run `31105865973` 會直接讀到既有的 `deployment_cancelled`，不可反覆 dispatch；必須確認前次已取消，再以有意義的新 main commit 產生新的 `pages_build_version`。沒有更換環境、artifact、權限或部署架構。
  - 新 SHA `8863f052d898511f66646d8202cdbd487a77281f` 的 v5 run `31106153276` 仍因相同硬上限取消。最終部署步驟因此改成官方 `actions/github-script@v9` 直接呼叫同一組 GitHub Pages Create／Get／Cancel REST endpoints：沿用 `upload-pages-artifact@v4` 的 `artifact_id`、`github.sha`、既有 OIDC 與 `github-pages` environment，不新增 PAT／secret，也不輸出 OIDC token；每 15 秒輪詢，45 分鐘才取消，step 上限 50 分鐘。`cancel-in-progress` 同時改為 `false`，避免下一次 main push 中斷仍在 Pages queue 的 deployment。
- v0.1.7 全站內容健檢工作流 refinement 已完成：
  - 首頁在 SKU 指揮中心下方新增顯眼的「全站內容健檢」入口；完成後顯示待確認項目數，能直接繼續上次結果。
  - 健檢結果依站點保存在 Dashboard 記憶體，只在這次 App 使用期間存在；關閉 drawer、切到特定 SKU 編輯再返回，都不必重新掃描，且保留原篩選與搜尋文字。沒有把商品文案寫入 `localStorage`，App 重新啟動後仍需重掃。
  - 新增「匯出全部待確認項目 Excel」：只匯出疑似錯字、賣點不足、缺成分、成分未驗證或讀取未完成的 SKU，工作簿包含商品內容與逐項說明；純 renderer 本機產生，不新增 Bridge API、不需重裝 Mac App，也不執行 Amazon 寫入。
  - `GooToE` 已加入 Mac 拼字檢查白名單；即使本機字典回傳 `Goatee` 建議，也不會建立疑似錯字項目。
  - 本機驗證：117/117 tests、TypeScript、main／preload／renderer production build、`git diff --check` 與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已確認桌面流程、有效 `.xlsx` 下載、編輯後返回、drawer 關閉後重開保留結果，以及 390px 無整頁水平溢出。
- v0.1.8 experience／inventory refinement 已發布並安裝：
  - 全站內容健檢白名單新增 `Decapterus`、`Gluconate`、`Niacinamide`、`Reishi`、`purr-fectly`；疑似錯字在標題、賣點與成分原文中紅字定位。`U+200B` 等不可見字元集中在單一說明區，列出 SKU、欄位、前後詞與可讀上下文，不會自動修改文案。
  - 舊版健檢 Excel 曾使用唯一「內容健檢」工作表；目前未發布工作樹已升級為 schema v2 的「說明與索引」＋變體 family／未綁變體／資料未完成工作表，最後兩欄仍為「類型／說明」。既有全商品 Excel 維持原格式。
  - 銷售自訂日期擴為 1–365 天，renderer 與 main 雙重拒絕 366 天；去年同期仍受 Sales API 兩年 horizon 保護。補貨的 SKU 銷速改用 Sales API exact `sku`＋`AFN`，不再因 Orders 前五頁掃描上限漏掉高銷量 SKU。
  - 主頁新增唯讀「180 天以上庫存」：請求 `GET_FBA_INVENTORY_PLANNING_DATA`，分開顯示官方庫齡、`estimated-excess-quantity` 與 `days-of-supply`。解析器依報表實際欄位選擇區域 366–455／456+ 尾段或非區域 `365-plus` 尾段，缺少完整區間即 fail closed；沒有推測、促銷、移除或 FBM 寫入。
  - 首頁與頂部導覽依「產品 → 價格 → 策劃」重排；七個工具順序固定為文案、圖片、變體規劃、定價、促銷、補貨、廣告。大段自動化／系統資訊預設收合，Product Master UI 暫時隱藏，所有 drawer 與 Mac ConnectionPanel 改為中央 Modal。
  - 促銷主要頁只保留 Listings Items `discounted_price` 對應的 Sale Price；Coupon、Subscribe & Save、Deals 與 Ads 的官方入口集中在「Amazon 官方完成」，沒有假 Coupon 設定表單。
  - App 圖示保留原藍色背景，白色 `A` 改為 `J`，底部箭頭改為紅色；Touch ID、Validation Preview、idempotency、Keychain、FBA-only 與 no-FBM 邊界未放寬。
  - PR #16 已 squash merge 到 `main`；合併 commit 為 `dcb57dfd20f240a3c1bb0f0dfffa5f2324aa0b91`。main Validate run `31242263937`、Pages run `31242263943` 與 macOS universal run `31242263938` 均成功；live Pages 已核對 `index-D0omFruY.js`／`index-CppLgiXq.css` 與 v0.1.8 功能字串。
  - main artifact 的 DMG／ZIP SHA-256 與 workflow 清單一致；App 版本為 `0.1.8`、bundle ID 為 `com.jspusa.amz-api`、包含 `arm64`／`x86_64`，deep ad-hoc codesign 驗證通過。v0.1.8 已安裝為 `/Applications/AMZ.API.app`，v0.1.7 原封不動保留為 `/Applications/AMZ.API-v0.1.7-backup.app`；啟動後主程序與 helper 持續執行，未重現未預期結束。
  - 本機與 CI 驗證：137/137 tests、TypeScript、main／preload／renderer production build、`git diff --check`、敏感資料差異掃描與 `npm audit --omit=dev` 0 vulnerabilities；Playwright 已確認中央 Modal、產品優先層級與 390px 無整頁水平溢出。
- v0.1.9 已發布並安裝；下列實作已通過自動／展示驗證，但仍不代表通過真實 Amazon：
  - 「全站內容健檢」改稱「全站文案健檢」；待確認項目 Excel 改成顯眼的全寬入口，不可見字元只展開一筆範例，其餘收合。保留同次 App 使用期間的結果、搜尋與篩選，能進入 SKU 編輯再返回；拼字白名單保留 `GooToE` 並加入 `Decapterus`、`Gluconate`、`Niacinamide`、`Reishi`、`purr-fectly`。
  - 主頁新增全站 FBA 圖片健檢，將少於五張圖片與讀取未完成分開顯示；結果在同次 App 使用期間保留，能進入圖片編輯再返回。全程沿用 FBA-only Reports／Listings 證據，不加入 FBM。
  - Subscribe & Save 全站健檢以同次完整分頁的 FBA Inventory 證明 SKU，再讀 Replenishment offers 與最多 23 個已完成月份 metrics；畫面提供 6／12／23 個月、目前有效訂閱、可證明的訂閱營收與逐 SKU 折線，缺月省略而不補 0。只有每個納入 SKU × 所選月份都有營收值才顯示完整總額，否則明示 coverage 並保留缺值。Excel 匯出全部所選月份並固定建立 0／5／10／15／20% 五張工作表；Amazon 未回傳 Seller 折扣時儲存格保持空白且明示並非 0%。Seller Replenishment API 不支援 SG／AU，因此這兩站只顯示能力說明並在送出前停用掃描。
  - FBA 庫齡報表改為非重疊完整庫齡桶，分開顯示 Amazon 官方庫齡、estimated excess、days of supply、下月倉儲成本與 AIS 預估附加費，並可匯出 Excel。estimated excess、storage cost 或 AIS 任一商品缺值時都不顯示部分全站總額。現有 FBA Inventory／Reports 公開欄位不提供逐 SKU 或批次 lot expiration date，因此 UI 只說明能力邊界，不會拿庫齡冒充近效期／已過期清單。
  - 會計中心已建立公開 SP-API allowlist、能力清單與下載「規劃」route。Renderer 只會收到 capability、state、notice 與 next step，不會收到 upstream path／body；目前沒有真正建立、輪詢或下載會計報表。Fee Preview 只接受至少早於送出當下 72 小時的開始時間，結束時間由 main process 固定為 request NOW；日期／站點變更會取消舊規劃回應。Finances JSON、Amazon-generated settlement、人工前置、Brazil-only 與不可用能力分開標示；一般 US／CA／JP／SG／AU／UK／DE 發票及 Seller Central 帳單沒有通用公開下載 API，也不使用私有接口。
  - Variation Family 已建立雙 family 並排、child 暫存拖拉、目標 CHILD PTD 動態必要欄位，以及解除舊 parent／加入新 parent 的兩階段專用 route。每階段的程式契約包含重新讀取、Amazon Validation Preview、直接 Touch ID／系統確認、持久 idempotency、單次 PATCH 與唯讀回查；真正 commit PATCH 前的重新讀取／PTD／preview 若失敗，會明示尚未送出並安全釋放 claim，正式 PATCH 或已接受後回查不明才保留 unknown 防重送。目前只完成單元、router、SP-API mock 與 demo 互動驗證，從未在真實 Amazon 執行這條變體寫入。未取得使用者對指定 SKU 的另行明確授權前，嚴禁用真實帳號測試 detach 或 attach。
  - 定價與策劃區改成水平排列；主 UI 預設字級放大，系統資訊新增字級選擇；renderer 與 App 圖示的 `J`／紅色勾箭頭重新置中。銷售自訂天數仍由 renderer 與 main 雙重限制 1–365 天。
  - 最終本機 tree 已通過 `npm run check`：41 個測試檔、243 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與敏感資料掃描通過。Playwright 以 1440px／390px 大字體實走首頁、120 天自訂換算、滑鼠／鍵盤圖表 tooltip、文案健檢 Excel／快取／編輯返回、帳務邊界與變體暫存拖拉／CHILD PTD；390px 無整頁水平溢出。
  - PR #18 已 squash merge；main Validate run `31249715994`、Pages run `31249715991` 與 macOS universal run `31249715993` 均成功。live HTML 已核對為 `index-CeGzNNQP.js`／`index-BWn9y9lU.css`，且新 JS 包含全站文案、圖片、訂閱省健檢、FBA 帳務中心與 1–365 天功能字串。
  - main artifact `9019652910`（`AMZ.API-unsigned-3fa27e165a42a441be67abb44e5fcfcc37d264bc`）已核對 workflow digest、DMG／ZIP SHA-256、版本 `0.1.9`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。v0.1.9 已安裝並持續執行，沒有立即崩潰；舊 v0.1.8 原封不動保留為 `/Applications/AMZ.API-v0.1.8-backup.app`。
- v0.1.10 已發布、部署並安裝：
  - 首頁改為三個置中頂部選單「產品區／價格區／營運區」，只保留近期 FBA 銷售、同日期品牌營收與五個一鍵健檢入口；Mac 安全連線整合至右上角。字級偏好只放大文字、不縮放卡片或控制項；390px 大字級沒有整頁水平溢出。
  - 連線證據分成「Live 憑證已設定／尚未驗證」與同站點成功 API read 後的「Amazon 已連線」；System Health 只核對本機設定，不再把已設定憑證冒充即時連線成功。
  - 圖片健檢新增與同次掃描 snapshot 綁定的 Excel：唯一 export ID 同時綁 account scope、marketplace 與短效結果，下載不重跑整站 Listings；工作簿分為「圖片健檢」與「範圍與狀態說明」，讀取未完成不填假圖片數。
  - Subscribe & Save 對缺 Seller SKU／缺 offer／缺月份採 fail closed；保留已證明 FBA、可核對 offer 與未回 offer 的精確範圍，未知不推論為 0 訂閱或不符合資格。來源不完整時只顯示已核對值並讓營收總額保持空白；Excel 同步明示部分範圍。
  - 冗餘庫存健檢只依 Amazon `estimated excess quantity`，不以庫齡判斷冗餘；完整庫齡仍可另行查看。倉儲成本或 AIS 空值只有在對應官方數量為 0 時才能當 0，其餘維持 partial／unavailable，不套自訂費率。
  - Variation 改掛置於工具頂端，解除舊 parent 與加入新 parent 明確分成兩階段；attach 必須由 relationships 與 attributes 同時證明已 standalone，detach 回查也必須核對 normalized relationships。相同 idempotency key 可 replay，新的操作 key 不會誤用 24 小時內舊完成結果；正式 PATCH 的 401／429／transport 不自動重送。
  - 新增全站未綁變體健檢與 Excel；只有完整且格式正確的 Amazon relationships 明確沒有 parent 才列入，畸形列、空白或被改寫的 Seller SKU 一律停止／列為未完成。
  - 新增品牌營收甜甜圈：依所選銷售日期讀官方 FBA Customer Shipment Sales report，固定品牌顏色、保留未分類 FBA 出貨列，滑鼠／鍵盤顯示金額與占比；renderer 不跨帳號快取。新增廣告覆蓋能力頁，只接受符合 ProductAI 命名的 ENABLED Sponsored Products 證據，以 SKU 優先、同 ASIN 補充；Live 尚未連接 Ads API 時固定停止並不顯示推測結果。
  - 會計入口移至營運頂部導覽並改稱 FBA 帳務中心；一般站點不顯示 Brazil/V2 能力。Fee Preview 只收至少早於 request NOW 72 小時的開始時間，結束時間由 main 固定為當下；目前仍只有公開能力與安全規劃，沒有真正下載會計報表。
  - 發布前本機驗證為 53 個測試檔、300 tests、TypeScript 與 production build 全通過；`npm audit --omit=dev`、`git diff --check`、試算表實際匯入／render 與 Playwright 1440px／390px 大字級均通過。沒有加入 FBM，也沒有讀取或輸出 Secret、Refresh Token 或完整 Seller ID。
  - PR #20 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/20`；release main commit 為 `5949f605da420f7664bcaf9507f9fc9cde16dcf1`。main Validate run `31271753649`、Pages run `31271753667` 與 macOS universal run `31271753671` 皆成功。
  - live Pages 已核對為 `index-BU633FN_.js`／`index-Dl_rQ4s3.css`，兩者與 release commit 本機 production build 的 SHA-256 完全一致，不是只根據 build／upload 成功就宣稱已上線。
  - main artifact `9025861198`（`AMZ.API-unsigned-5949f605da420f7664bcaf9507f9fc9cde16dcf1`）已核對 GitHub digest、DMG／ZIP checksum、版本 `0.1.10`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。
  - v0.1.10 已安裝為 `/Applications/AMZ.API.app`；舊 v0.1.9 已備份為 `/Applications/AMZ.API-v0.1.9-backup.app`。安裝後 App 可正常啟動且未閃退。
  - 真實 US 帳號唯讀驗證已讀取 Sales 7 天折線與去年同期；`AFA12AM` 的 Listings、FBA Inventory、價格、文案、圖片與 Subscribe & Save 均有載入。測試當下 FBA 數量為 9,745，文案完整度 5/5，圖片 7 張；這些數值是當時快照，不得當作恆定現值。
  - 全站文案健檢真實掃描 266 個 FBA SKU：265 個完成、1 個未完成，共 72 個待確認項目；`GooToE` 白名單、同次 App cache 與 Excel 儲存均已實測。全站圖片健檢真實掃描 266 個 FBA SKU：19 個少於 5 張、1 個讀取未完成，cache 可繼續使用。
  - v0.1.10 當時的未綁變體全站掃描仍在真實驗證，品牌營收也曾發現報表日期視窗的時區錯誤。相關程式修正已納入 v0.1.11 並發布；新的 main artifact 仍須解鎖後以真實 Amazon 唯讀流程重新核對，不能把單元測試取代 live 證據。
  - Variation detach／attach、價格、Sale Price、文案與圖片的任何真實寫入均未執行，也未獲使用者對特定操作的明確授權。
- v0.1.11 已發布、部署並安裝：
  - 頂部新增「報表區」與 Amazon API 文件庫，依 2026-08-09 官方清單列出 109 個唯一公開 report types、15 類用途、角色／FBA 邊界、官方連結與 App 接線狀態；目前 App 可直接匯出的六項健檢 Excel 與「Amazon 有文件但尚未接線」明確分開，不使用 Seller Central 私有接口。
  - 首頁的近期 FBA 銷售與品牌營收縮成精簡並排區；品牌會隨同一日期範圍自動載入，不再要求手動同步。品牌仍使用官方 FBA shipment report 加上目前 Listing 標題前綴分類，因 Sales API 聚合趨勢不含 Seller SKU／ASIN／標題，不能安全拿同一筆 Sales API 資料推測品牌。
  - Reports 建立加入 account scope、marketplace、mode 與 report options 的 durable lease／single-flight；品牌、未綁變體、評論與內容／圖片匯出會共用相容的 all-listings report。Terminal／建立結果不明時不自動盲目重建；只有明確的使用者再試才可在安全等待後重建。
  - 未綁變體改用 `searchListingsItems` 每批最多 20 SKU，同批讀 relationships／summaries／fulfillmentAvailability／productTypes；沒有逐 SKU fallback。Seller SKU、目前站點 summary、seed／live ASIN 與 relationships 任一缺失、歧義或衝突都列為未完成。
  - 新增 FBA 評論主題健檢：只有 Listings relationships 證明為 child 或 standalone 的非 parent FBA ASIN 才會讀 Customer Feedback；parent 明確排除。畫面與 Excel 提供正向前五、負向後五、全部主題與未完成範圍，但明示公開 API 不提供商品總星等、總評論數或完整 review 全文。
  - Subscribe & Save 遇到 FBA Inventory Seller SKU 缺少、被改寫、過長或含控制／不可見字元時不再讓整站死亡；異常列只計入來源不完整，既有可辨識 FBA SKU 繼續核對，營收與 Excel 不冒充全站完整數字。
  - 文案健檢 Excel 會以 rich text 將疑似錯字片段標紅；結果中的「立刻修改」只顯示有問題欄位，但會用 audit 時原文／token／fingerprint 對新讀 Amazon 文案重新定位。內容已被其他系統修正、移動、重複歧義或 identity drift 時退回完整編輯，不會把舊索引寫到錯誤賣點。
  - Variation Family 可選 Seller SKU 或 10 碼 ASIN 查詢，結果仍顯示 exact Seller SKU；解除／綁定區改為不裁切的桌面與 390px 版面。ASIN 找不到或不唯一會 fail closed，不改變既有兩階段 Preview／Touch ID／單次 PATCH／回查安全鏈。
  - 銷售趨勢新增預設關閉的迷你滑板，可用按鈕／方向鍵移動與跳躍；系統資訊新增「API 版本更新建議」與只依本次 App 內已開啟健檢入口產生的下一步靈感，不分析 SKU、銷售或憑證。
  - 品牌日期修正延續 RFC3339／marketplace timezone 守門，Amazon metadata 也採相同 strict parser；`CANCELLED` 與 `FATAL` 分開說明，CANCELLED 不自動重送。新的 main artifact 尚未完成真實 Amazon 報表重測，不能宣稱 live 通過。
  - 本機最終 `npm run check` 已通過 63 個測試檔／392 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與 renderer／diff 敏感資料掃描通過。1280px／390px Playwright 已實走首頁、報表下拉／文件庫、評論 cache／前五後五、SKU／ASIN 變體抽屜、版本建議與迷你滑板，沒有整頁水平溢出；品牌自動流程以無憑證假 Bridge 精確建立一次。
  - PR #22 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/22`；release main commit 為 `ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`。PR Validate run `31279053866`、main Validate run `31279106129`、Pages run `31279106107` 與 macOS universal run `31279106105` 均成功。
  - live Pages 已核對為 `index-BipfoazU.js`／`index-CxJSY15F.css`；SHA-256 分別為 `3a80fbfb817a2e2fe3b25ceada876ff81f7e1ae7dd52f6a50c36c6a699e52811`／`ce45944a74eddccdc45a1b8ddcc2a0944b8bb5ff27612e30ddfb5b84317cf9d4`，與 release commit 本機 production build 完全一致。
  - main artifact `9027927355`（`AMZ.API-unsigned-ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`）已核對 GitHub digest、DMG／ZIP checksum、版本 `0.1.11`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign；短期保存至 2026-08-22。
  - v0.1.11 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.10 已可回復地保留為 `/Applications/AMZ.API-v0.1.10-backup.app`。安裝後主程序與 helpers 持續執行、沒有立即崩潰；Mac 因鎖定無法完成 UI 與真實 Amazon 唯讀驗證。
- v0.1.12 已發布、部署並安裝：
  - 將 SP-API／R2／Skill 與 Ads 敏感資料輸入全部移入 packaged main-owned local editor；remote Pages renderer 只取得 redacted status、開啟本機 editor、測試與清除能力，不再接收或保存 Secret／Refresh Token。
  - 首頁加入「一鍵執行全部 FBA 健檢」背景 coordinator、Amazon Ads 唯讀連線／覆蓋能力、評論主題、未綁變體、庫齡、文案、圖片與 Subscribe & Save 的 fail-honest 範圍；報表建立由 durable lease／single-flight 共用，terminal／建立不明不會因首頁自動載入而盲目重建。
  - PR #24 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/24`；release main commit 為 `e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`。PR Validate run `31297884608`、main Validate run `31298271175`、Pages run `31298271176` 與 macOS universal run `31298271179` 均成功。
  - live Pages HTML／JS／CSS 已取得 200 並核對 production output；main artifact `9033689855`（`AMZ.API-unsigned-e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`）的 GitHub digest為 `sha256:be8c76a607f78a575ab9cbe0c85d76221e638e0e1f13ecfb04fc46070886b09c`。DMG SHA-256 為 `0f4bf46669180fbb6086aba2d9358ee4da09ad6e57f7a3872c83fced65185038`；ZIP SHA-256 為 `c4d4db8c139bef6d0be755f8df033ec2202eb1c8595dbc1c3e4c126460fa853c`。App 版本、bundle ID、universal 架構與 deep strict ad-hoc codesign 均通過。
  - v0.1.12 已安裝為 `/Applications/AMZ.API.app`，舊 v0.1.11 保留為 `/Applications/AMZ.API-v0.1.11-backup.app`；啟動後沒有 Apple crash dialog。真實 US 唯讀載入取得 7 天 Sales 與品牌營收，品牌區顯示 23,765 件 FBA 已出貨；評論背景 job 完成 257 個 non-parent candidates，其中 8 個列為未完成。這些是 2026-08-09 當次快照，不得當作恆定現值。
  - 真實 Subscribe & Save 掃描發現 Amazon Replenishment 分頁對 exact SKU `ADT03AM` 重複回傳；v0.1.12 會因此整站停止。品牌圖例未依占比排序且文字受壓縮、頂部導覽箭頭重複、評論負向 impact 容易被誤解成商品負星等，均已轉為 v0.1.13 修正項目。
- v0.1.13 已發布、部署並安裝：
  - 品牌占比依金額由高到低，改為上方大型實心圓餅與下方兩欄完整圖例；零值仍保留於圖例。產品／價格／營運／報表四個頂部選單各只保留一個置中 chevron。
  - 首頁健檢順序改為文案、圖片、未綁變體、FBA 180+ 庫齡、Subscribe & Save、Ads、評論，讓互相關聯的兩組入口相鄰。
  - Subscribe & Save 對 exact SKU 的 offer／單月份 metric 重複、衝突或資料值無效採 row-level 隔離：該 SKU／月份列入「問題 SKU」，其他正常 FBA SKU 繼續；整體與營收 coverage 降為 partial，總額保持缺值，不補 0、不重複加總。Marketplace、program、Amazon fulfillment、月份區間、pagination 與 root 契約錯誤仍整體 fail closed。
  - 評論負值改稱「負向影響值」，明示是 Amazon 負向主題對星等下降方向的原始 impact，不是商品負星等或 1–5 星制；關閉 drawer 後 main process 會保持官方 1 request/second 節流在背景續跑，重開只接回既有 job。
  - 本機已通過 `npm ci`、`npm run check`（71 個測試檔／474 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regression、`git diff --check` 與 1280px／390px 假 Bridge 視覺驗收。
  - PR #25 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/25`；release main commit 為 `74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`。PR Validate run `31305731260`、main Validate run `31305784898`、Pages run `31305784896` 與 macOS universal run `31305784906` 均成功。
  - live Pages production assets 為 `index-DDQbFOo0.js`／`index-BPWCqre2.css`；SHA-256 分別為 `728c618568984a3c788524b8cb043bd5652f3043b8e0178d17f318bfb0e0d7f2`／`ab1eda8c5521533b20b8accf4b18416484970dbb9d4ad2b5312e93e8f9802ca7`，與 release production output 完全一致。
  - main artifact `9035956569`（`AMZ.API-unsigned-74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`）GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.13`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均已驗證；v0.1.13 已安裝並啟動。真實 UI／Amazon 唯讀重測仍待 Mac 解鎖後完成。
- v0.1.14 已發布、部署、安裝並完成核心真實唯讀重測：
  - Subscribe & Save 的官方完整月區間改採月末日 `T00:00:00Z`；exact SKU 後的單列 interval／offer／metric／duplicate 問題改為逐列隔離，其他正常 FBA SKU 與月份繼續。Marketplace、program、Amazon fulfillment、pagination 與 root contract 仍整體 fail closed；沒有補 0、改寫 identifier 或冒充完整營收。
  - 庫齡畫面新增站點實際完整庫齡層級與 AIS 預估附加費層級；US 顯示 0–30、31–60、61–90、91–180、181–270、271–365、366–455、456+ 天，AIS 另顯示各官方 tier、已回傳 SKU coverage 與部分合計。主清單仍只列實際 180+，不把 estimated excess 或 AIS basis 當成已老化庫存。
  - 評論 job 在 drawer 關閉時由首頁只用既有 `jobId` 做 GET observer，直接顯示百分比與 `x / total`；main 背景 runner 不受 drawer 影響。Terminal snapshot、marketplace、mode、job identity 均 fail closed，短暫 network／429／5xx 只做 bounded GET retry，不會 POST 建立新 job。
  - 迷你滑板圖提高垂直空間，新增明確輪子與左右滑行／滾動動畫；WASD、方向鍵、editable element 與 reduced-motion 守門保留。Variation 長 family 改為內部捲動，解除區 sticky 且以紅／藍／綠區分解除、來源與目標，避免拖曳最下方 child 時整頁過長。
  - 本機已通過 `npm ci`、`npm run check`（72 個測試檔／485 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regressions、`git diff --check` 與 1280px／390px 假 Bridge 視覺驗收。
  - PR #27 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/27`；release main commit 為 `2b9a8585daf1cfb3ed95ed72add916a142864d6f`。PR Validate run `31320775118`、main Validate run `31320824609`、Pages run `31320824620` 與 macOS universal run `31320824613` 均成功。
  - live Pages production assets 為 `index-k-6ZStSt.js`／`index-BCiGbUcL.css`；SHA-256 分別為 `29e88dea57aaf3522506fddcb410aeea6ec4f04d93a970d6a46ba7fc1a150bde`／`a30519ee0e9a978c3888102c4672ec916acbd57a03fd7d56f9ca4e18feaeff2e`，與 release production output 完全一致。
  - main artifact `9040153961`（`AMZ.API-unsigned-2b9a8585daf1cfb3ed95ed72add916a142864d6f`）GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.14`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均已驗證；v0.1.14 已安裝並正常啟動。
  - 2026-08-09 真實 US 6 個月 Subscribe & Save 唯讀重測不再整站停止：325 個 FBA Inventory rows 中 1 列無法原樣辨識；151 個 offer 可核對，89 個具 CURRENT_FBA 證據的精確問題 SKU 被隔離，其他結果正常顯示；coverage 保持 partial，完整營收／幣別保持缺值。這是當次快照，不得當作恆定現值。
- v0.1.15 已發布、部署並安裝：
  - 品牌／品類共用同一份 FBA Customer Shipment Sales report 快照；品類依 Supply BUSINESS REPORT 的最早關鍵字規則分類為 Turkey Tendons/Tendon、Turkey、Chicken、Salmon、Buffalo、Fish、Air Dried 與其他，平手依固定順序，切換不會另建報表。main 綁定 jobId、mode、marketplace、精確日期與 expiry；A→B→A 測試只建立兩份日期不同的報表。含站點今天時顯示實際 dataThrough，不冒充完整日。
  - Subscribe & Save 改為「全部／0／5／10／15／20／有問題」篩選；正常卡片直接顯示 SKU、Seller 折扣、目前價格與目前有效訂閱。開啟即顯示全站月底有效訂閱折線，選 SKU 顯示單品，再選同一 SKU 或取消可回全站；滑鼠與鍵盤均可讀值，缺值不補 0。
  - Subscribe & Save Excel 固定建立五張無問題的標準折扣表與一張「問題 SKU」表；未知／非標準折扣、具 CURRENT_FBA 證據的上游問題與只能安全輸出計數的問題不會塞入 0%、重複加總或冒充完整總額。
  - 所有 drawer 關閉控制統一為 36×36；迷你滑板數值固定顯示在折線圖下方。首頁健檢卡加入明確狀態色、狀態 pill 與「狀態收斂進度」，避免 7/7 失敗被誤認為成功。
  - 本機已通過 `npm ci`、`npm run check`（72 個測試檔／496 tests、TypeScript 與 production build）、`npm audit --omit=dev` 0 vulnerabilities、targeted regressions、`git diff --check`、1280px／390px 假 Bridge 視覺驗收與 Subscribe & Save 工作簿實際開啟驗證。
  - PR #29 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/29`；release main commit 為 `ac5c18b2319061bcb06600967d4acec84c55d5f3`。PR Validate run `31325089229`、main Validate run `31325158196`、Pages run `31325158204` 與 macOS universal run `31325158197` 均成功。
  - live Pages production assets 為 `index-BQAL3keX.js`／`index-DjizWppD.css`；HTML、JS、CSS SHA-256 分別為 `d51a07348a48fa9505d61563cc805d820d2a77f3a71a24ad8bf72bee703d09dd`、`d7a26c926b2ce3efd066e12648116cadf2baba1e6db613c7efbd66d3f0afee5a`、`397fc523727b1805f3aff3ef5c512cfc67a97031484fd4e59e7c428d650dcddf`，與 release production output 完全一致。一般瀏覽器仍停在安全 WebGate，沒有 Amazon API 請求。
  - main artifact `9041374594`（`AMZ.API-unsigned-ac5c18b2319061bcb06600967d4acec84c55d5f3`）已核對 GitHub digest、內部 DMG／ZIP checksum、版本 `0.1.15`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign。
  - v0.1.15 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.14 保留為 `/Applications/AMZ.API-v0.1.14-backup.app`。首次啟動在 Keychain 解密前等待且尚未建立視窗；確認無 Amazon 請求後只重啟一次，隨後 App 正常顯示首頁、`Amazon 已連線`、Live 7 天 Sales、品牌／品類切換、「狀態收斂進度」與系統資訊版本 0.1.15，沒有 crash dialog。
  - v0.1.15 只完成首頁自動 US Sales 唯讀載入與品牌 report 整理中的可見證據；品類實際分類數值、Subscribe & Save 新篩選、全站／SKU 折線與六張 Excel 仍待追加真實唯讀驗證。沒有執行 Amazon 寫入。
- v0.1.16 Windows Notebook Key 已發布：
  - WebGate 與本機連線文案由 Mac 鑰匙改為平台中立的「Notebook 鑰匙」；一般瀏覽器仍沒有 Bridge／Amazon API。Windows 下載固定指向 `https://github.com/jspusa/AMZ.API/releases/tag/notebook-key-windows`，Mac 仍保留既有 `amz-api://launch`。
  - Windows 11 x64 版沿用同一 renderer、窄化 preload、main API router、FBA-only 範圍與寫入安全鏈。Secret 只進 main-owned 本機 editor，Electron `safeStorage` 在 Windows 使用 DPAPI；沒有明文 fallback，也沒有把憑證送到 Pages。
  - 新增 first-party x64 N-API addon，以 `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` 綁定目前 AMZ.API 視窗；HWND 必須有效且屬於目前程序。只有 Windows 回傳 `Verified` 才放行，取消、未設定、錯誤或逾時一律 fail closed，沒有按鈕 fallback。
  - Packaged App 啟動會驗證 addon 固定 ASAR-unpacked 路徑、manifest SHA-256、AMD64 架構與 N-API export，但 preflight 不會主動彈出 Windows Hello。Windows 未建立 publisher-bound Authenticode 鏈前，in-app check／install updater 固定停用。
  - Windows 2025 workflow 會實際編譯 addon、讀回 8 個 Electron fuses，並分別啟動 win-unpacked、展開後 ZIP 與 NSIS 實際安裝版；三者都必須同時出現 Bridge ready 與 addon-ready sentinel。PR 不上傳可執行 artifact；只有 main／manual trusted run 會上傳。
  - 本機最終 `npm run check` 通過 76 個測試檔／517 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #31 已 squash merge：`https://github.com/jspusa/AMZ.API/pull/31`；release main commit 為 `654d70c0ed554b1b9cdd078fc0587d15274c2500`。main Validate run `31351732388`、Pages run `31351732381`、macOS run `31351732405` 與 Windows run `31351732415` 均成功。
  - live Pages production assets 為 `index-CgWtRJve.js`／`index-BuIzmwBr.css`；HTML、JS、CSS SHA-256 分別為 `30e1d0b98cfa785c02a2123d5c54e0ee5589648556d89140521c79e654d640bf`、`833704b3d89a9ebaddf9e111ff3e192fe37638815ee3ec6ab379fba9cf617f06`、`5563b1c6567b8b63a408492721d1887078738188a3d897e863d37f2e3b25d30f`，與 release production output byte-for-byte 相同；全程以 `curl` 驗證，沒有再開瀏覽器。
  - 固定 Windows prerelease 的 NSIS EXE SHA-256 為 `997209481a290a4e05dfc5111222d3deee9f2ff55bd5bff247deef06bbd8a3c0`，portable ZIP 為 `2b086fbd36c2ca8be7891a53a0d70cebc243b909b6ba2b9ba0c862799ab83b0a`；公開 `SHA256SUMS.txt` SHA-256 為 `426ff11bacc76166de15100ccd1e8dd6bc1d43cfb84428da25248bb8d5b7f12d`，與 trusted Windows run 原檔 byte-for-byte 相同。真正員工 Windows 11 Pro 裝置的 Hello UI／硬體與 DPAPI 使用者隔離尚未實測，不能用 CI smoke 冒充完成。
- v0.1.20 FBA 入庫商品明細官方續頁已發布、安裝並 live 驗證：
  - v0.1.19 真實 US 30 天唯讀工作已證明活動中清單備援可讀 31 票，但每票第一頁 25 筆商品後的官方 `NextToken` 被舊程式當成局部異常；前三票連續發生後觸發既有熔斷，因此只保留 75 列已核對資料，目標貨件若排在後面就不會讀到商品明細。這不是憑證遺失，也沒有 Amazon 寫入。
  - 修正後，第一頁固定呼叫 `/fba/inbound/v0/shipments/{shipmentId}/items`；只有該回應提供安全 opaque token 時，才固定呼叫 `/fba/inbound/v0/shipmentItems` 並帶 `QueryType=NEXT_TOKEN`、原 token 與 exact marketplace。renderer、URL、log 與工作簿都不取得 token。
  - 續頁若回傳 `ShipmentId` 必須與原貨件完全一致；Amazon 官方 model 允許省略時，仍只接受由 exact by-shipment 回應建立的同一 token chain。重複／無前進 token、跨頁重複商品、頁數或筆數超限都停止該票並保留先前已核對列；401／403／429／5xx、網路與 abort 仍依既有全域邊界停止，不盲目新增 Amazon 請求。
  - 本機 `npm run check` 通過 100 個測試檔／812 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #45 head `a2a80dc3360859052b726a2054081113b6e350bf` 已 squash merge，main 為 `7425b8e49e027028efdfac6b101bb8d7480e5b02`；PR Validate `32561751139`、PR Windows CI `32561751161`、main Validate `32561974878`、Pages `32561974784`、macOS `32561974803` 與 Windows CI `32561974758` 均成功。Windows 結果仍只是 CI，沒有實機測試。
  - main macOS artifact `9473081924` 名稱為 `AMZ.API-unsigned-7425b8e49e027028efdfac6b101bb8d7480e5b02`，GitHub digest 為 `sha256:fb5c205b7f23b1fa18f8075f51db72ec6ba7c04b8d1f711fe3b34321a4322757`。DMG 為 246,861,081 bytes、SHA-256 `89e3e1aa35e6878018aa09c06ec80e22eb369d4be418aacc0fc71aafa6c4e9d4`；universal ZIP 為 221,569,042 bytes、SHA-256 `8228d8a735a24af5b613d6defbe2c2b31b56e12b9393f6b4a3e44cbc22551009`；均與 manifest 一致。外層／內層 ZIP、DMG CRC、版本／build 0.1.20、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過。
  - `/Applications/AMZ.API.app` 已由 v0.1.19 正常退出後安裝 exact artifact v0.1.20；備份為 `/Applications/AMZ.API-v0.1.19-backup.app`。啟動無 crash dialog，沿用 Keychain vault且未重輸密鑰，首頁為 `Amazon 已連線`，系統資訊顯示 0.1.20。曾崩潰的手工 canary 沒有再使用。
  - 2026-08-22 真實 US 30 天（2026-07-24 至 2026-08-22）只啟動一次：11／31 時已越過舊版第三票熔斷點，最後 31／31 票與 803 列商品全部完成；多票顯示 26／27／30 個 SKU，證明第 25 筆後續頁已承接。總計預期 335,091、Amazon 已接收 225,440、尚未接收 111,410、多接收 1,759。清單來自活動中備援，所以 job／UI 仍誠實標為 partial；每日問題報表 unavailable，不能宣稱 0 瑕疵。沒有 Amazon mutation。
  - `FBA-入庫貨件-US-2026-08-22.xlsx` 已下載；OOXML 與 7 個 worksheet 均通過完整性檢查。工作表為「貨件摘要」32 rows、「商品接收明細」804 rows、「僅顯示差異」525 rows、三層瑕疵各 2 rows，以及「資料來源與限制」15 rows；瑕疵表只有 unavailable 說明，不能冒充零問題。
- v0.1.19 FBA 入庫清單備援已發布並安裝：
  - 真實診斷已排除「金鑰遺失」：同一已連線 Notebook Key 對 v0 日期清單得到固定 HTTP 400，但固定 2024-03-20 `listInboundPlans` 唯讀探測成功。v0 日期序列化改為 UTC `Z` 後仍是 400。
  - v0 日期清單只有明確 400／422 時，才先嘗試固定 `QueryType=SHIPMENT`＋活動狀態清單；若該清單也明確 400／422，才改用固定 2024-03-20 plan／shipment GET。401／403／429／5xx、網路或未知失敗不會跳過安全邊界繼續備援。
  - 活動狀態清單不受使用者日期限制，且可能缺少 CLOSED／CANCELLED／DELETED；新版 plan 清單依 plan `lastUpdatedAt`，也不等同舊版貨件最後更新日期。兩種備援即使逐貨件 items 與每日問題報表都完整，job 仍固定是 partial；畫面、parser 與 Excel 都明示範圍限制。
  - 新版 plan／shipment 內部 ID 只留在 main，renderer 只收到安全 shipment confirmation ID。所有請求仍是固定 GET、signal-aware、一次 401 refresh 與有限 GET 重試；沒有 Amazon mutation。
  - 本機 `npm run check` 通過 100 個測試檔／807 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #44 已 squash merge，main 為 `cae2bd51cfeebc3bc9a8a4e77deaabd5af4e4bc1`；main Validate `32560390860`、Pages `32560390900`、macOS `32560390832` 與 Windows CI `32560390825` 均成功。Windows 結果仍只是 CI，未做 Windows 實機驗證。
  - main macOS artifact `9472647652` 的 GitHub digest 為 `sha256:22a3beb9243dae7cf2bda76dc3235422de1325e271d5da6e62301a1e31a45781`；DMG SHA-256 為 `bf9cc3931e20236357b348cc2e7f6e389ad07908a152aba5b59d177da83813f1`，universal ZIP 為 `ff3837763485fcd9b49cf073bccbf104a86d0f38b54ebf1fa2068ee6bf83ecf8`。版本／build 0.1.19、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；正式 artifact 已安裝，v0.1.18 保留為備份，Keychain vault 未清除。
  - 2026-08-22 真實 US 30 天結果為 partial：31 票活動中貨件；前三票各讀到 25 列後遇官方續頁 token，舊程式熔斷並保留 75 列。已核對預期 33,747、Amazon 已接收 33,592、尚在接收 403、多接收 248；這些只涵蓋已核對列，不能冒充完整 31 票總計。每日問題報表 unavailable，不能宣稱 0 瑕疵。沒有 Amazon mutation。
- v0.1.18 FBA 入庫診斷修正版已發布並安裝：
  - 根因：v0.1.17 將多種安全失敗壓成同一句 generic notice，且逐貨件商品明細連續三票異常時會丟掉前面已核對的部分結果；首頁再把任何 terminal failure 誤標為「需要重新接回」。這不能證明憑證真的斷線。
  - 修正後，global 401／403／429／5xx／網路失敗仍立即停止；逐貨件 local 失敗連續三票時只停止後續商品明細請求，保留已核對列，其餘貨件明確標成未知，不補 0。failed job 只回固定公開文案、安全診斷代碼與經 allowlist 的 Amazon Request ID，不回 raw upstream message、URL、report/document/account scope。
  - 首頁狀態改成「同步未完成」。renderer 對沒有新 diagnosis 欄位的 v0.1.17 reply 保持相容；只有 v0.1.18 Notebook Key 才能產生新診斷證據。
  - 本機 `npm run check` 通過 99 個測試檔／800 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #43 已 squash merge，main 為 `494c6c50e36c2e7b751e64526b98e8e40c5b0435`；四條 main workflows 全綠，macOS artifact 已安裝為 v0.1.18 且 Keychain vault 保留。Windows 仍只有 CI，沒有實機測試。
- v0.1.17 FBA 入庫貨件追蹤與廣告策略表已發布、部署並安裝：
  - 營運區與首頁新增 30／90／180 天一鍵唯讀同步。main 背景工作依 account scope、mode、marketplace 與 exact date range 綁定；關閉 drawer 只停止 renderer observer，Notebook Key 仍會讀完全部所選貨件與每票商品。切換日期會取消舊 active range，相同 active range 才 single-flight。
  - 數量只採官方 Fulfillment Inbound v0 的 `QuantityShipped`／`QuantityReceived`，分別顯示預期、Amazon 已接收、尚在接收與多接收；接收中不稱短少或遺失，已關閉且仍有差異才建議回 Seller Central 核對。API 未提供的 title／ASIN／EAN 維持空白，不猜值。
  - 貨件／包裝箱／產品層級原因來自每日 `GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA`。報表不可用、部分或沒有回傳列時不冒充 Seller Central 即時「零瑕疵」；區間外 problem shipment 只保留匿名計數，不把識別碼送到 renderer。
  - 新增狀態／關鍵字／僅差異篩選、逐貨件 SKU 明細與 7 張中文 Excel。全域 401／403／429／5xx／網路錯誤會停止；逐貨件資料連續三次異常會熔斷，避免對全部貨件大量重試。未來日期在任何 account／report／shipment read 前依站點時區拒絕。
  - 廣告區新增「廣告策略表」：同一個 1–31 個完整日區間，main 分別取得目前 FBA SKU、Sales & Traffic SKU 銷量／營收與 Sponsored Products advertised-product 報表。只按 exact Seller SKU，或在缺 SKU 時按唯一的目前 FBA ASIN 歸因；不確定列進「未完成明細」，不複製或猜測數值。
  - 策略表依同期銷售額由高到低、SKU 由小到大破同額，按 ceil 20／50／80% 分成 T1–T4；預設 SP 日預算／目標 ACoS 為 T1 300／35%、T2 100／30%、T3 50／30%、T4 50／50%，均明示為可覆寫建議。SB／SD 攻守、再行銷、規格與其他廣告保持人工欄位；價格沒有可信同快照來源時固定空白，絕不以銷售額除以件數推算。
  - Sponsored Products 報表只自動產生實際花費、14 日歸因銷售、14 日購買次數、實際 ACoS 與花費排名；缺值保持未回報，不補 0。輸出為 29 欄中文策略表、「資料來源與規則」、「未完成明細」三張工作表，中文檔名為 `FBA-廣告策略-站點-日期.xlsx`。
  - Ads create POST 不盲目重送；帳號、profile、mode、站點、日期與報表設定均由 main 綁定。reportId、profileId、account scope 與 signed URL 不進 renderer。關閉 drawer 不取消 main 背景工作，重新開啟只 GET 接回；明確 terminal 失敗須等安全間隔並由使用者按重試。
  - 本機 `npm run check` 通過 99 個測試檔／796 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。PR #41（feature head `9ff8b1dc1298315796265c78fa2e73eca259f96d`）已 squash merge，main 為 `ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`；PR Validate `32455147085`、PR Windows CI `32455147120`、main Validate `32455530327`、Pages `32455530245`、macOS `32455530465` 與 Windows CI `32455530213` 均成功。Windows 結果仍只是 CI，未做 Windows 實機驗證。
  - live Pages 使用 `index-gQ4mCeON.js`／`index-DGiYkoEJ.css`；HTML、JS、CSS SHA-256 分別為 `6ffdac2a898c5487d569f7438e89fa96875f566e8a23a096c25b4cbb668c8bb7`、`1c528959a628d27cd925469c16a27bc2ce23877b4411e310a30d50cd140258ef`、`f28c0df72f5d1c541de48f82bcc616a869cd3910db1c25d1b66d5852cc11a511`，三者與 exact main production output byte-for-byte 相同。
  - main macOS artifact `9437191218` 名稱為 `AMZ.API-unsigned-ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`，GitHub metadata digest 為 `sha256:6ee034932ca5043774ea5110bd6c7133d93b72fd9b7c90dc434a9aa756209ea1`。DMG 為 246,079,435 bytes、SHA-256 `1f01c0455d0f7ca506a537e889be5d3de2443e571e27cfc59d332e0c1e8b3ab2`；universal ZIP 為 221,564,636 bytes、SHA-256 `1267d63573ccb54e825ca9cf3cc8d510fa2c100694de9d3abca8741859b24c82`；兩者與 `SHA256SUMS.txt` 完全一致，inner ZIP、DMG CRC、版本／build 0.1.17、bundle `com.jspusa.amz-api`、executable `AMZ.API`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過。
  - `/Applications/AMZ.API.app` 已由 v0.1.16 安全備份後安裝 v0.1.17；備份為 `/Applications/AMZ.API-v0.1.16-backup.app`。啟動沿用原 Keychain vault且未重輸密鑰，同一程序在初次視窗讀取短暫等待後正常顯示首頁，沒有反覆重啟；系統資訊顯示「目前本機 App 0.1.17」。
  - 2026-08-21 真實 US 唯讀邊界：2026-07-23 至 2026-08-21 入庫同步只啟動一次，隨即以安全失敗通知收斂，沒有貨件／SKU／數量／三層瑕疵或 7-sheet Excel 可驗證，也沒有 Amazon mutation；不得寫成 0 貨件或 0 瑕疵。廣告 drawer 可見，但獨立 Amazon Ads LWA 尚未設定，故 Reporting v3、策略表與 3-sheet／29 欄 Excel 均保持未驗證。
  - Supply Boss API v4 production 沿用 server-side 兩檔 public allowlist；已將 private R2 的 `macos-dmg` 更新為 `AMZ.API-0.1.17-universal.dmg`（246,079,435 bytes；SHA-256 同上），Windows NSIS 卡維持 v0.1.16。portable ZIP 與 checksum manifest 仍只作內部 artifact，不顯示成員工下載卡；下載頁密碼與 session 規則未更改。
- 2026-08-23 v0.1.27 全站健檢修正已發布、部署並安裝：
  - 文案卡維持每項原因只呈現一次；立刻修改仍以 fresh Amazon 原文與 ingredients fingerprint 聚焦相符欄位，證據不足或漂移才 fail closed 回完整編輯。同一份文案 Excel 回傳仍使用 main-owned digest bounded recovery，識別、變體分類或原文真正變更才停止。
  - 「一鍵執行全部」不再建立第二套結果區或啟動 legacy suite 重複掃描；它直接 fan out 至七張既有卡片的 main-owned job。任一 active job 由 main single-flight 沿用，仍可補啟動其餘項目；啟動失敗與 terminal failure 都留在對應卡片，舊 cache 不得冒充本次結果。legacy `/audit-suite`／合併匯出 route 暫留相容性但首頁不可達。
  - A+ publish record parser 接受官方 optional `contentSubType: null`，但核心 marketplace／ASIN／reference／content type／locale 仍嚴格驗證；畸形 object／number 不會被當成 published。B2B 在 Listings 缺 exact B2B contribution 時，可用同次 FBA all-listings 的 exact positive Business Price 作唯讀設定證據；canonical Listings 優先，兩者衝突或報表價格畸形時保持 incomplete。
  - 「所有變體」Excel 依連續 family 交替深藍／淺藍整區底色並加 medium 外框；其他工作表的既有 style indices 不變。A+／B2B 摘要與篩選各只保留一組可點擊數字，B2B 在 960px 實測七顆同列。
  - 版本為 0.1.27；本機 `npm run check` 通過 119 個測試檔／1,104 tests、TypeScript 與 production build，`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。
  - PR #60 已 squash merge；唯一綁定本次發版程式碼的 release code main SHA 為 `d7136660eb71a4308625f49334a159c5351f7c08`。Windows `32622496558`、Validate `32622496640`、macOS `32622496513`、Pages `32622496523` 均以該 exact SHA 完成且成功。後續 handoff 證據若由 docs-only PR 合併，較新的 main SHA 只代表文件更新，不得取代 `d7136660eb71a4308625f49334a159c5351f7c08` 或冒充新的 release artifact SHA。
  - Pages artifact `9488775387` 的 GitHub metadata digest 為 `sha256:3227c75144037825e560dbe36fdfe6ce2072df4ac0c17331c1724e761b6907c6`。live Pages 七個檔案與 exact release-code production output byte-for-byte 相同：`index.html` 為 `c959e87fb4bfc0daa548f97e9bfd9886d48b730a7e243836c5c7b2e60adbfa74`；`assets/index-BHFBc7TA.js` 為 `8bafaf9e136743c17178e3fa41bf913d29b09b64cb3d6ccdbbfc1851830bf0e1`；`assets/index-B6K8uvya.css` 為 `7a37cae20691079c07f955bb4777ad70966bdaed94203aac8a892c68b239eee5`；`assets/content-spelling-rules-D5UQWRoO.js` 為 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`；三份 spellcheck license 分別為 `2a7e8d8ae9e8facc84818546ae2a8d83aec5e9c80a675ff789acd1c338b53b3d`、`c7cc929b57080f4b9d0c6cf57669f0463fc5b39906344dfc8d3bc43426b30eac`、`ca4662cb5d1b738fbe5350c0d5485ba11773b4b7208974082ae6e129a52d631d`。
  - macOS artifact `9488815906` 名稱為 `AMZ.API-unsigned-d7136660eb71a4308625f49334a159c5351f7c08`，467,981,932 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `2e45d0e0649aa1be040fcd795dfd04e2916b928455744f366db6be5037fc490e`。DMG 為 246,272,513 bytes、SHA-256 `1817b0ace15b1eee401eb6550e7358a0688850c63f89ae420560a2b6d8694bc8`；universal ZIP 為 221,708,775 bytes、SHA-256 `554219f1a206dd957ecfa930f950f7f45d504a7de509102b3b2648ed0f332e6d`。outer／inner ZIP 與 DMG checksum 均通過；artifact 內 `app.asar` 為 18,438,690 bytes、SHA-256 `81afa93c7784fa15588b60731d1ef546951f9a548c45c8d2ccd68a7c5eca18a3`。
  - exact verified v0.1.27 App 已安裝為 `/Applications/AMZ.API.app`；版本／build 0.1.27、bundle `com.jspusa.amz-api`、`x86_64`／`arm64`、deep strict codesign 與 installed `app.asar` 均匹配 artifact，原 v0.1.26 保留於 `/Applications/AMZ.API-v0.1.26-backup.app`。既有 userData、encrypted vault 與更舊備份未清除或重建。
  - Windows artifact `9488849759` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-d7136660eb71a4308625f49334a159c5351f7c08`，244,644,529 bytes；GitHub metadata digest 與 outer ZIP SHA-256 同為 `3ecdad334e7c7eb947ecf6140b288131bab58b401a1a5a6020e3ea2d87844d06`。內層 portable ZIP 為 `d8eb011742247e807310baf8df8fdf360d51cfc360af0f9b534495abdc060213`，Setup EXE 為 `2c4e01330c2d48fe9e59e8c832e3ebc70b61804590d4a4f5f06b30f74bd7323`；這仍只有 GitHub Windows runner 的 CI／封裝證據，不是真實 Windows 11、Windows Hello 或 DPAPI 實機驗證。
  - 使用者原始 `FBA-文案健檢-US-2026-08-22.xlsx` 已由 v0.1.27 parser 與同一 main-owned snapshot digest 做離線完整性核對：273／273 列的識別欄、變體分類與原始文案均接受，0 列誤判竄改；其中 9 列由 bounded 舊換行相容邏輯唯一復原，2 列只有允許編輯的「更新…」值不同。這證明先前的假竄改會被正確復原，但尚未執行 Amazon Validation Preview 或任何寫入。
  - v0.1.27 正式 Amazon 唯讀 canary 尚未完成：目前 Mac 鎖定，Notebook Key 停在原生 Keychain 重新授權等待；程序尚未建立 renderer。不得清除或重建 vault，也不得要求、記錄或公開 LWA Secret、Refresh Token、完整 Seller ID 或 access token；本次尚未執行 Touch ID／Windows Hello、PATCH、readback 或任何 Amazon mutation。
- 2026-08-23 v0.1.26 單項健檢可用性已發布、部署並安裝：
  - 文案、圖片、未綁變體、Subscribe & Save、B2B、廣告覆蓋與庫齡統一改由 main-owned standalone job coordinator 執行；A+ 與評論沿用各自 main-owned coordinator。每個工作都綁 account scope、mode、marketplace、job/context ID 與短效 lease。關閉抽屜只停止 renderer observer，Notebook Key 主程序仍會繼續，首頁以 GET-only observer 顯示即時進度並接回 terminal snapshot；切換帳號、站點、模式或 credential lifecycle 時舊結果 fail closed。
  - B2B 唯讀列改成「請到 Amazon 後台編輯」，每個 SKU 透過窄化 IPC 開啟固定 Seller Central inventory URL，`searchTerm` 只接受精確 SKU 並以 `encodeURIComponent` 編碼；不允許 renderer 傳入任意 URL。每列顯示一般售價減 USD 1 的建議 B2B 價格、5／5%、10／10%、15／15%、20／20% 建議階梯，以及 Amazon 回傳的 canonical QDP／未設定／不明證據；原有 Preview、native confirmation、idempotency、單次 PATCH、readback 與 no-blind-retry 邊界沒有放寬。
  - A+ 只回答是否有官方 publish record；移除所有 Brand Story／From the brand 功能與 UI，以及類型／語系／筆數雜訊。warning-only 空頁會繼續翻完合法 page token 並保持未知；後頁找到 exact publish record 時保留正向證據。問題列可前往固定白名單的 Amazon A+ Content Manager 核對。
  - 文案錯字例外新增 `differentiator`、`GANODERMA`、`CORNUCOPIAE`、`Staffordshire`、`American`、`Siberian`；`Cocker` 只有在同一段連續 `Cocker Spaniel` 中才豁免。既有 60／110／150–200／1,800 Unicode 字元門檻不變。
  - 未綁變體 Excel 新增第三張「所有變體」工作表；每個 family 固定先列精確 Parent SKU，再依 SKU 排序列出已驗證 child SKU。若 parent 不在 FBA 報表，只用 child relationship 回傳的精確 parent SKU 建立空白標題列，不猜商品名稱、Product Type 或 ASIN。
  - 本機 `npm run check` 通過 118 個測試檔／1,095 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。1440×1000 本機 fake Bridge Playwright 已驗證關閉 B2B drawer 後首頁持續顯示 1／3 背景進度、重新接回完成結果、B2B 建議價／QDP／Seller Central handoff、A+ presence-only 與三張變體工作表，整頁無水平 overflow，外部 request 與 PATCH／PUT／DELETE 均為 0。另一組文案桌面 QA 證明舊「本次錯誤原因」標題為 0、兩項 fixture 原因各只出現一次；「立刻修改」fresh GET 後只顯示相符的亮點與敘述欄，「完整編輯」fresh GET 後顯示全部九個欄位，兩條路徑都沒有寫入或外部 request。同檔 Excel 特殊換行 bounded recovery 與識別欄 fail-closed 由自動測試覆蓋。依使用者指示沒有做 mobile 視覺測試；正式 Amazon 唯讀 canary、任何 Preview／mutation 與真實 Windows Hello 仍未執行。
  - GitHub PR #58 已 squash merge；release code main SHA 為 `9d8a445b4d1d9285f2bb13530dd00b0e92342488`。main Validate `32616632575`、Pages `32616632534`、macOS universal `32616632654` 與 Windows x64 `32616632536` 均成功。
  - live Pages 七個檔案與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `f4345ef85e358fa1529d2fb93569ed8447622f0aa20cd6f7a7195c7c9afc9e03`；`assets/index-D4-Ocoj_.js` SHA-256 `d2cd61844fcb40220241682b9ec75026a2b5bd9e8c7ec8648f6d37fe2979ff96`；`assets/index-DMwIbyEH.css` SHA-256 `8f46f6d961ffe61acb457a8ad101181667847e666bd6b78827c473e05129f7c4`；`assets/content-spelling-rules-D5UQWRoO.js` SHA-256 `8ceffb80713771a64e53ece53bb47cc47321f46c8ebe713d6c7ee7e564762cd2`；三份 spellcheck license SHA-256 也逐檔相同。
  - main macOS artifact `9487205056` 名稱為 `AMZ.API-unsigned-9d8a445b4d1d9285f2bb13530dd00b0e92342488`，467,972,891 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `e56103011fde02abbbe8a849bb1f12ef132513b5d1e68be0b1f7bdf17b35effb`。DMG 為 246,263,511 bytes、SHA-256 `5056a3178dfec98eb1ef8789cb2010a5d1cef63259d5d152517db5b7d7b28dd5`；universal ZIP 為 221,708,736 bytes、SHA-256 `b76928a5d1b8836f2c132900ce05004a5b4e8262820b234c6ebac193d9cfe048`。outer／inner ZIP、DMG CRC、版本／build 0.1.26、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；DMG／ZIP 內 `app.asar` 完全相同，18,441,782 bytes、SHA-256 `f84ff2b33abcc360da7dedc0657c4c5707e4711ab16a770809f429dfe3cd3d53`。
  - exact verified v0.1.26 DMG 已原子安裝為 `/Applications/AMZ.API.app`；原 v0.1.25 可復原地保留為 `/Applications/AMZ.API-v0.1.25-backup.app`，既有 userData、Keychain vault 與更舊備份均未清除。已安裝 App 再次通過版本／build、bundle、雙架構、deep strict codesign 與 `app.asar` 比對，主程序啟動 12 秒後仍穩定且 AppleScript 回報 0.1.26。這次沒有主動啟動 Amazon 健檢、Preview、生物辨識或 mutation。
  - main Windows artifact `9487189929` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-9d8a445b4d1d9285f2bb13530dd00b0e92342488`，244,644,439 bytes；GitHub metadata digest 為 `sha256:e04de0b318f560598e6566f192f5956c87c3e855f5bf9af52896f399eb1ebbd9`。Windows workflow 與 packaged Bridge smoke 成功，但這不是員工 Windows 11／Hello／DPAPI 實機證據，固定 prerelease 仍為 v0.1.16。
- 2026-08-23 v0.1.25 全站七項健檢已發布、部署並安裝：
  - 首頁一般健檢卡與 run-all 共用同一個 canonical schema v3，固定依序執行文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；七個 worker 在 main 背景並行，A+ 與 variation 共用同次完整 all-listings／relationships 證據。舊 schema v2 Pages／Notebook Key 組合會顯示明確升級訊息，不會靜默少跑兩項。
  - 新增 FBA-only A+ 全站唯讀健檢：只有 relationships 已證明為 child／standalone 且身分完整的 Seller SKU 才會依 marketplace＋ASIN 去重讀取全部 official publish-record pages；parent 排除，relationship／身分不完整列保留為 incomplete 且不發 A+ request。只有 warning-free 完整空頁可標沒有 A+；403、warning、pagination／schema 缺口保持 unavailable／incomplete。公開 API 無法驗證 From the brand／Brand Story，固定明示不可驗證。main-owned job 綁 account／mode／marketplace／context，支援長時間 observer reconnect、rate／Retry-After pacing、heartbeat lease 與 stale active abort。
  - B2B 健檢新增高於一般售價狀態；編輯器預設只改價格並完整保留既有 `quantity_discount_plan`。只有使用者明確切換 combined 模式，且 seller-specific PTD 的 exact B2B price／QDP branch、1–5 階 percent tiers 與每個 requested numeric constraint 都能證明時，才會帶數量折扣。建議預設為一般售價減 USD 1，以及 5／10／15／20 件各 5%／10%／15%／20%；多個 levels 本身是正常結構。Preview、native confirmation、idempotency、單次 PATCH、完整 offer guard、price／tiers canonical readback 與 no-blind-retry 邊界均保留；本次發布沒有執行 Amazon Preview 或 mutation。
  - 文案健檢摘要數字本身可直接篩選，全部待確認精確包含 issue 與讀取未完成列；原因仍只顯示一次。成分規則前台統一顯示「成分宣稱不一致」，並在完整且非空的 Amazon ingredients 證據下額外核對 Tendon／Tendons 與 Chicken＋hypoallergenic 文案。WebGate 兩行標題已改為獨立 block，桌面 1440×1000 真實 layout rect 間距 7px、沒有重疊或水平 overflow。
  - 本機 `npm run check` 通過 113 個測試檔／1,046 tests、TypeScript 與 production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 與固定敏感字串掃描通過。桌面 fake Bridge QA 已實走七項順序、文案摘要篩選／不重複、A+ POST→GET job 與 B2B price-only／combined 切換；combined 四階全部在 1440×1000 drawer 可見，外部 request 與 PATCH 均為 0。依使用者指示沒有做 mobile 視覺測試。獨立 final review 沒有剩餘 P0／P1／P2。
  - GitHub PR #56 已 squash merge；release code main SHA 為 `06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`。main Validate `32594914170`、Pages `32594914229`、macOS universal `32594914224` 與 Windows x64 `32594914169` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `2be2dfdc0d1e2f673023c6d46124748ee9b08de2c7b8fd62bc8031001551f379`；`assets/index-DsvRqMPA.js` SHA-256 `67e89e831625dca40d8069417e19c7580391c50cb02043eab02ae3cab5c78aaf`；`assets/index-dXe1Fas3.css` SHA-256 `4fb0add0bb4d0a78029135779d869deaa548c1e6a7a2e7b5fe483b2740dd09fd`；`assets/content-spelling-rules-BcfLoQVC.js` SHA-256 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9481336965` 名稱為 `AMZ.API-unsigned-06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`，467,974,842 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `5006ad249a0f8ff1ce738530213cefc415700363a53bb2afb06c6cea70d2baf1`。DMG 為 246,275,909 bytes、SHA-256 `a09641f4770f4e73f922f13e83cf4c19d6de9f153084639bd9b60f43b1ec2e31`；universal ZIP 為 221,698,289 bytes、SHA-256 `9aa487b9ada5322aca3046ad326fb47b621431d2540b482cee90b8b95a7da76c`。inner／outer ZIP CRC、DMG CRC、版本／build 0.1.25、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過；DMG／ZIP 內 `app.asar` 皆為 18,372,836 bytes、SHA-256 `26672e2f5dfe355c2ca5f2b1997e1296c1dcc31f3265a8668edbc92a49db4ae3`。
  - main Windows artifact `9481356277` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-06f6a6887eb1624f40dd4eb4f9920665b6d85ec6`，244,628,701 bytes；GitHub metadata digest 與下載 outer ZIP SHA-256 同為 `a8858349dc36b85e5b9f0177a8db0a6fc9d76d7de10573fac9621b0feb9dd7a4`。NSIS EXE 為 101,719,536 bytes、SHA-256 `eaa42b2a4fe6d7e12a4d1da3ee90a96b3ccf2e05df7ef8bfcc90ce923b949899`；portable ZIP 為 142,908,469 bytes、SHA-256 `aa3a78c53d793a1dd8a3a7f31558d5a48699915ddc446338b533fab8ed78fc47`。package 版本為 0.1.25 且 Windows Hello native addon 可由 CI 載入；這不是員工 Windows 11／Hello／DPAPI 實機證據，固定 prerelease 仍為 v0.1.16。
  - exact verified v0.1.25 DMG 已安裝為 `/Applications/AMZ.API.app`，原 v0.1.24 可復原地保留為 `/Applications/AMZ.API-v0.1.24-backup.app`；既有 userData、Keychain vault 與更舊備份均未清除。已安裝 App 的版本／build、bundle、雙架構、deep strict codesign 與 `app.asar` 均匹配 artifact，主程序可正常啟動。Mac 當時鎖定且自動解鎖未成功，因此沒有核對 v0.1.25 UI 的 Amazon 連線、US／Live 或執行 A+／B2B 唯讀 canary；沒有 Amazon request、Preview、生物辨識或 mutation。
- 2026-08-23 v0.1.24 B2B live-shape hotfix 已發布、部署並安裝：
  - 真實 v0.1.23 唯讀 canary 共 274 列，當時 missing 0、configured 0、unsupported 42、incomplete 232。根因不是使用者沒有商品，而是 B2B parser 把 Listings Items 的 derived `offers` view 當成 explicit 設定真相、要求 optional audience、讀錯 canonical `price.currencyCode`，並把非價格 Issue 與 seller-specific PTD 的 ancestor flags 過度合併。v0.1.24 改以 `attributes.purchasable_offer` 的 exact marketplace／currency／`audience=B2B` contribution 判斷 explicit configured／missing；optional `offers`／`issues` 缺省可接受，present-but-malformed 仍 fail closed，IVP audiences 不再混入 base B2B。
  - Listings 身分必須由目標站 summary 證明 exact SKU／ASIN／非 generic Product Type；一致的重複 productTypes 證據可接受，跨站-only、缺失或衝突皆在 PTD／Preview 前停止。Issue 依 marketplace、官方 price categories 與 exact offer attributes 分流；INVALID_IMAGE 等明確非價格錯誤不再污染 B2B 健檢，無 scope、雙欄矛盾或 malformed ERROR 仍 fail closed。一般 ALL 與 B2B base price 都只接受一個無日期 metadata 的 canonical block／schedule，未證明 current value 時不提供編輯。
  - seller-specific PTD 寫入能力改為 bounded、selector-aware、conservative proof：只接受 exact B2B branch 的 `value_with_tax` leaf 明示 `editable:true`，任何 relevant `editable:false`／`readOnly:true`、不明 applicator、無法組合的 `$ref`／allOf／oneOf／anyOf、錯誤 type／cardinality 或 budget exhaustion 都只讀。Schema 只接受可信 Amazon host 與 checksum，12 秒／16 MiB／global work-path budget 超限均 controlled fail closed；不會因 syntactic branch 誤開寫入。
  - Validation Preview 與正式 receipt 皆要求 exact SKU、well-formed Issues 與 non-empty `submissionId`。正式 PATCH 只有 exact `INVALID` 才是明確拒絕；缺失／未知／空白 status、`ACCEPTED` 加 ERROR 或任何矛盾 receipt 都是 `UPDATE_STATUS_UNKNOWN`，鎖住 ledger 且不盲目重送。寫入鏈仍保留完整非目標 offer guard、commit 前 fresh read／PTD／Preview、一次 PATCH 與 canonical readback；本次發布沒有執行任何 B2B Preview 或 mutation。
  - 發布前 `npm run check` 通過 108 個測試檔／956 tests、TypeScript 與 production build；B2B 最終聚焦矩陣 118／118 全綠；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。獨立 PTD／write-readback／release review 均沒有剩餘 P0／P1／P2。測試檔曾被一個唯讀 Vitest list 命令誤覆為 JSON，發布當下即停止；之後從 main session 的 53 個成功 patch 紀錄 lossless 重建，再完整重跑 956 tests 才放行，產品碼與 Amazon 狀態未受影響。
  - GitHub PR #54 已 squash merge；release main SHA 為 `1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`。main Validate `32587051334`、Pages `32587051388`、macOS universal `32587051327` 與 Windows x64 `32587051348` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` 917 bytes、SHA-256 `daae918c4b4e50648f12c4ae8d6e3c863130aae7cfc8ec2aed90dcbb30d3d480`；`assets/index-ivFp6W-b.js` 1,695,285 bytes、SHA-256 `7d84687aa897fdc732d87a0f2fb058f15486bfb2f16099efd3521d417b280bdb`；`assets/index-CkA1HDGF.css` 295,811 bytes、SHA-256 `1ae58d0481fbbbb3dad56cf51efd9c24140c8c62aef0a2e527c097dfd0d6a565`；`assets/content-spelling-rules-BcfLoQVC.js` 622,239 bytes、SHA-256 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9479371387` 名稱為 `AMZ.API-unsigned-1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`，467,656,736 bytes，GitHub metadata／下載 ZIP SHA-256 同為 `b1116c39b6140e0fca88b030e9560c5571802956775f6b7a10e64cc6834f0aae`。DMG 為 245,984,456 bytes、SHA-256 `66cb5b9b33de17bac67a858168b30904abedebed07b1e6fa892fdd7689080561`；universal ZIP 為 221,671,636 bytes、SHA-256 `bda7f1cfd422b5c54434a31799bf4ccf186dc67fe420e224fa0c9e79c08fdfd8`。manifest、inner／outer ZIP CRC、DMG CRC、版本／build 0.1.24、bundle `com.jspusa.amz-api`、executable、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 全通過；DMG／ZIP 內 `app.asar` 皆為 18,233,985 bytes、SHA-256 `1562fc9d5646c0a27f7d82c4509ac1c0e33d8e5bcac7eef0bebbf6824e035f2a`。
  - main Windows artifact `9479380546` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-1675ceafd5f22ca02dd962cc3e855b2c2d1f1940`，244,580,643 bytes，GitHub metadata digest `sha256:6719c0a3e2903841f89c38515997450df01ae36aa23145de5d4a6e5b78a1cd69`。這只證明 CI 封裝，不是 Windows Hello／DPAPI 實機證據，員工固定 prerelease 仍為 v0.1.16。
  - exact verified DMG 已安裝為 `/Applications/AMZ.API.app`；原 v0.1.23 保留為 `/Applications/AMZ.API-v0.1.23-backup.app`，更舊備份、userData 與 Keychain vault 都未清除。已安裝 App 版本／build 0.1.24、bundle、雙架構、deep strict codesign 與 `app.asar` 均逐項匹配 artifact；UI 顯示 Amazon 已連線、US 美國站與 Live 7 天 Sales。FBA-only B2B 唯讀 canary 完成 274 列，互斥價格狀態為未設定 170、已設定 58、資料未完成 46；完成分類的 228 列皆唯讀，連同未完成列共 274 列不可直接修改。沒有開啟 Validation Preview、沒有生物辨識、沒有 Amazon mutation。
- 2026-08-22 v0.1.23 已發布、部署並安裝：
  - 導覽與排程：FBA 入庫貨件追蹤只保留在頂部「報表區」，不在首頁或「營運區」重複入口；首頁的「低頻健檢」預設收合，依序放 180 天以上庫存與評論。一鍵 run-all 在背景並行執行文案、圖片、未綁變體、訂閱省、廣告覆蓋五項，狀態固定依此順序顯示，低頻工作不會被自動帶入。
  - 圖片：全站不足門檻改為少於 6 張；0–5 張列為不足，6 張通過。讀取未完成仍獨立 fail closed，不補成 0 張。
  - B2B：新增 `/api/sp-api/business-pricing-audit` 的 FBA-only 全站健檢，以及 `/api/sp-api/business-pricing` 的單 SKU GET／零寫入 POST Preview／PATCH 更新。身分必須 exact match Seller SKU、ASIN、marketplace；可寫能力只採帶目前 Seller ID 的 seller-specific PTD。正式更新只 merge `audience=B2B` 的 `our_price`，保留一般 `ALL` offer、B2B quantity discount plan 與其他 audiences，並維持 fresh read／PTD checksum／Amazon Validation Preview／native confirmation／idempotency／單次 PATCH／canonical readback；任何不明結果停止且不盲目重送。
  - 文案：維持產品名稱 60、產品亮點 110、每項產品要點 150–200、產品敘述 1,800 Unicode 字元門檻；移除卡片中重複原因，並讓立即修改直接聚焦且顯示相符原因。只有 Amazon `ingredients` 可證明至少兩個不同成分時，標題／亮點／要點中的單一成分聲明才警示；括號逗號不拆項、讀取不完整不推論，相關原文或成分 fingerprint 漂移即 stale。
  - Excel：同一選檔區支援按鈕與 drag/drop，問題欄保留顏色；回傳原檔仍嚴格核對 account／站點／mode／識別欄／family／原始文案。CR／U+0085／U+2028／U+2029 無損 round trip；舊檔只有 main-owned 完整 digest 唯一命中時才 bounded recovery，公式、巨集、外部連結、歧義或被改過的原值仍整批零寫入停止。
  - 發布前檢查：`npm run check` 通過 108 個測試檔／901 tests、TypeScript 與 main／preload／renderer production build；B2B focused 63 tests 全綠；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過，變更檔敏感字串掃描未發現真實憑證。獨立唯讀 release review 沒有剩餘 P0／P1／P2；1440px／390px 本機 fake Bridge Playwright 已驗證導覽、五項 run-all、低頻收合、圖片 5／6 邊界、文案原因／立即修改／Excel drag-drop 與無整頁水平 overflow，全程沒有 Amazon 或 Excel 寫入。真實未修改工作簿 273／273 列另已走正式 ApiRouter no-op path 得到 `CONTENT_UNCHANGED`。
  - GitHub：PR #52 已 squash merge；feature commit `04137d9` 與 release main `d0e3255b53ad76306c78d8075e720a14e76367da` 的 tree 均為 `fa8bd51113a51c6a7b6d6a44ac17cd7b1ebfee06`。PR Validate `32577908909` 與 Windows `32577908903` 成功；main Validate `32578198343`、Pages `32578198322`、macOS universal `32578198324`、Windows x64 `32578198328` 均成功。
  - live Pages 與 exact main production output byte-for-byte 相同：`index.html` SHA-256 `2fff073f34008cd0937666a335618b8b952ba6c9a66cc9bf463f2a1730876b73`；`assets/index-BvQWF2fI.js` 為 `878ee20edc7dcd355de32814661518b4661a376f37408e97611e322b2ee2fa59`；`assets/index-CkA1HDGF.css` 為 `1ae58d0481fbbbb3dad56cf51efd9c24140c8c62aef0a2e527c097dfd0d6a565`；`assets/content-spelling-rules-BcfLoQVC.js` 為 `462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`。
  - main macOS artifact `9477138571` 名稱為 `AMZ.API-unsigned-d0e3255b53ad76306c78d8075e720a14e76367da`，GitHub metadata digest `sha256:501c4d5c770d690d4e9455a86d6ae5cdf0ced0f87f08fff17e0e43806adfc64d`。DMG 為 246,044,763 bytes、SHA-256 `33414ed4c4a1abbb0931e9782c08d06ed1f44f883c3317e095d1c599cf08384f`；universal ZIP 為 221,664,534 bytes、SHA-256 `1b4dfd39380d45f2cfed4c2291fabbd8c23724a019b9d89d8441f9adfe8411c2`；`SHA256SUMS.txt` SHA-256 為 `75028523d3beaecbe81148966f98b60afff4454e02cace9ceaa0deaeaac682f8`。上傳時 GitHub 將 manifest 的 `release/` 路徑前綴攤平，因此以逐檔計算核對；DMG verify、ZIP CRC、版本／build 0.1.23、bundle `com.jspusa.amz-api`、executable `AMZ.API`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過，DMG／ZIP 內 `app.asar` 同為 `6593b50506d6a7e540567ff09d3b7111357a0b5d1f1b9b2d91b83f1707dee136`。
  - main Windows artifact `9477152941` 名稱為 `AMZ.API-Notebook-Key-Windows-x64-d0e3255b53ad76306c78d8075e720a14e76367da`，GitHub metadata digest `sha256:e368b9d5fbdd5e5ad1d8b5cbbc25ea2ff420001429a36989f4cf56fca8d93a87`。這只證明 CI 封裝，未做真實 Windows Hello／DPAPI 員工裝置驗證。
  - `/Applications/AMZ.API.app` 當時由上述 verified DMG 安裝；原 v0.1.22 可復原地保留為 `/Applications/AMZ.API-v0.1.22-backup.app`，原 userData 未清除。第一次讀取既有 vault 曾停在 macOS SecurityAgent 系統提示，之後由使用者本人核准；v0.1.23 隨後顯示 Notebook Key／Amazon 已連線、US／Live 7 天 Sales，並完成 274 列 FBA B2B 唯讀 canary（missing 0、configured 0、unsupported 42、incomplete 232）。沒有 v0.1.23 Amazon mutation、生物辨識寫入確認或憑證變更；v0.1.23 現已保留為 `/Applications/AMZ.API-v0.1.23-backup.app`。
- 2026-08-22 v0.1.22 文案健檢 UI／Excel round-trip hotfix 已上線：
  - 健檢卡片不再同時顯示巨型原因彙總與逐項原因；每則原因只出現一次。單 SKU 立刻修改摘要只顯示聚焦欄位數，完整原因預設收合；產品亮點與產品敘述也建立 raw value／fingerprint／length evidence，fresh Amazon 原文、Seller SKU、ASIN、Product Type 或門檻任一變動仍 stale fail closed。Excel 選檔區只顯示一次檔名並保留鍵盤與螢幕閱讀器操作。
  - 真實未另存工作簿 273 列中有 9 列被誤判竄改；hash-only evidence 唯一命中根因是原始產品要點的 U+2028 LINE SEPARATOR 在舊 OOXML 讀回時被正規化成 LF。新版以 numeric character references 無損保存 CR／U+0085／U+2028／U+2029；舊 v2 只在 main-owned 完整 digest 唯一命中時 bounded 復原，exact digest 永遠先行，同一 recovered 欄若也被編輯則要求重新匯出，不猜內容或放寬 SKU／ASIN／family／原值核對。
  - Legacy candidates 改為逐筆產生，先套 request-wide rows／work／hash／bytes budget再核對；歧義或超限 fail closed。rich-text 顯示 marker 不再改寫 immutable raw，content-audit cell 若含 OOXML 無法無損保存的控制字元或超過 32,767 code points，匯出時明確拒絕而不靜默替換／截斷。
  - 本機 `npm run check` 通過 105 個測試檔／860 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。真實舊檔 273／273 列已走正式 ApiRouter no-op path 得到 `CONTENT_UNCHANGED`；1440px／390px Playwright 已驗證原因不重複、立即修改聚焦 8 個欄位、檔名只顯示一次且無水平 overflow。
  - PR #50 已 squash merge，main 為 `fc39db989d0703d317cf9e6385a11cdf449fee95`；PR Validate `32571733444` 與 Windows CI `32571733420` 成功，main Validate `32571978501`、Pages `32571978502`、macOS `32571978505` 與 Windows CI `32571978518` 也全部成功。Windows 結果仍只是 CI，未做真實 Windows Hello 硬體驗證。
  - live Pages 為 `index-Cujd3mng.js`／`index-BqPIRvz0.css`／`content-spelling-rules-BcfLoQVC.js`；HTML、JS、CSS 與 spelling chunk SHA-256 分別為 `58f27a7314a7c14caa278ed5ff5bb3f2dd31bf4171724aec33909a39f949e780`、`79ad4d7093eab10bc64378c1dbe6bd84f1491b9d4a64ef6741c5c89050d34a0c`、`c7748f4b124ceaafb034e5267fc4d4b11d1c070e7d14afc6fd4846640d11f70f`、`462e192e5b70d219095b87e4996b7910584fad8b58129554edfd7e93cdd04806`，四者與 exact main production output byte-for-byte 相同。
  - main macOS artifact `9475589086` 名稱為 `AMZ.API-unsigned-fc39db989d0703d317cf9e6385a11cdf449fee95`，GitHub metadata digest 為 `sha256:9d04966bc67a3cd35974fa52b76fcfbd1832cdd4aa6728b8f5437816ff8f0e0e`。DMG 為 246,626,167 bytes、SHA-256 `43d4baccce8cfe048680c03eefbb49425934470059878135fe57e32ef2dbf6ee`；universal ZIP 為 221,644,972 bytes、SHA-256 `e9a839e1bf4fa2ecd5120a54940d9515c3a2395468f80fe973750bbf11069d0e`。兩者與 manifest 一致，ZIP／DMG CRC、版本／build 0.1.22、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過。Windows artifact `9475598988` metadata digest 為 `sha256:e6aed9857aff140fc285d2160bc4c7d3142a19e3ee86416fd150054a903d7cdf`。
  - `/Applications/AMZ.API.app` 已由 v0.1.21 安全備份後安裝 v0.1.22；備份為 `/Applications/AMZ.API-v0.1.21-backup.app`。App 沿用原 Keychain／userData 並持續執行，首頁顯示 Amazon 已連線，系統資訊顯示「目前本機 App 0.1.22」。發布驗證沒有執行 Amazon 文案 mutation 或生物辨識確認；安裝後使用者另產生的一筆零寫入 Validation Preview 保持未勾選、未提交。
- 2026-08-22 v0.1.21 新增全站文案健檢與 Excel round trip：
  - `item_name`、`title_differentiation`、每項 `bullet_point`、`product_description` 分別套用內部目標 60／110／150–200／1,800 Unicode 字元；API 與前台保留實際字數、上下限與逐條要點索引，讀取未完成列不做缺值或字數推論。
  - 全站 relationships 以官方批次查詢分 child family，已證明 parent 排除；standalone 固定進「未綁變體」，缺列／400／ASIN 或關係衝突固定進「資料未完成」，不以名稱或 ASIN 相似度猜 family。
  - Excel schema v2 保留灰色原值與可編輯更新值；問題欄黃底、疑似錯字片段紅字。main parser 拒絕公式、巨集、外部連結、Defined Names、未知欄、重複 SKU、異常 ZIP/XML；工作簿不使用會在 Excel／LibreOffice 另存時產生 `_xlnm._FilterDatabase` 的 AutoFilter，已完成真實 LibreOffice 開啟／另存／重新匯入測試，公式樣式的 family key 仍可 inert round trip。
  - 掃描授權證據以 account／marketplace／live-demo／export／fetchedAt-scoped SHA-256 列摘要在裝置端保存固定 24 小時；不落地 Seller SKU、ASIN、文案、Excel 或 proposed edits。鎖屏、睡眠與 App 重啟後同檔仍可重新預檢，換帳號／站點／模式或到期則 fail closed；集合限制 8 份／50,000 列／8 MiB，超量確定性淘汰最舊證據而不碰 idempotency ledger。
  - 回傳 Excel 的 POST 只做逐 SKU fresh read／PTD／Amazon Validation Preview，任一失敗整批零寫入。renderer 會逐 SKU 展開完整 Amazon 原值／Excel 更新值與 Validation 提醒，使用者勾選已核對後，PATCH 才會在全批再預檢後要求一次 Touch ID／Windows Hello；每 SKU 仍各自有 ledger、單次 PATCH 與 canonical readback，拒絕或不明即停止後續，沒有跨 SKU 原子交易，也不自動重送。
  - 本機 v0.1.21 候選已通過 `npm run check`：105 個測試檔／854 tests、TypeScript 與 main／preload／renderer production build；`npm audit --omit=dev` 為 0 vulnerabilities，`git diff --check` 通過。實際 `.xlsx` 已通過 ZIP、LibreOffice 開啟另存再匯入、openpyxl sheet／freeze／顏色核對；前台逐欄 diff 已做 1440px／390px Playwright 視覺 QA且無整頁水平溢出。尚未用真實 Amazon／真實 Windows Hello 執行任何文案 mutation。
  - PR #48 已 squash merge，main 為 `c919cd9714095330c150879b0eb1bb474817e3dd`；main Validate `32568946207`、Pages `32568946205`、macOS `32568946198` 與 Windows CI `32568946195` 均成功。live Pages assets 為 `index-CFy0t-bz.js`／`index-CddE3IYJ.css`，SHA-256 分別為 `51a1d55ea4e96af41390f4f19fb319e54f42a901d5aa0b27de42a54e14b020a0`／`8b9335242a20aa2112b9d042ee63532d300381bbac2933838a672658e0c4725c`，已確認含新門檻與同 Excel 回傳入口。
  - main macOS artifact `9474859261` 名稱為 `AMZ.API-unsigned-c919cd9714095330c150879b0eb1bb474817e3dd`，GitHub metadata digest 為 `sha256:af9c17898c06b360b894ec91aba00e183c249b115881e93f9068d151e60ad686`。DMG 為 246,204,272 bytes、SHA-256 `3c3093e3c94d477b18baf491613f5eb15f3b2ac04cf45f392500cba299be169c`；universal ZIP 為 221,642,538 bytes、SHA-256 `930b2ad3c75acb8d961834b8e4d3b17c8acdcc93210dba17153f17e0c92afd29`。兩者與 manifest 一致，ZIP／DMG CRC、版本／build 0.1.21、bundle `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict ad-hoc codesign 均通過。v0.1.21 已安裝並持續執行，v0.1.20 原封不動保留為 `/Applications/AMZ.API-v0.1.20-backup.app`；Keychain／本機 userData 未清除。

### 已完成與仍待真實 Windows／Mac／Amazon 驗證

正式基線 v0.1.27 的 PR、main Actions、Pages、Mac／Windows artifacts 與 exact Mac 安裝均已完成；v0.1.27 的 A+／B2B 正式 Amazon 唯讀 canary 尚未執行。本次發布與安裝沒有 Amazon mutation。v0.1.24 的 274 列 B2B canary 只能保留為舊版歷史證據；seller-specific PTD 尚未由 v0.1.27 live read 證明任何 SKU 可直接修改，真實 B2B Preview／PATCH／readback 仍未執行。受保護員工 Mac 下載檔仍是舊版，Windows 固定 prerelease 仍為 v0.1.16，且尚未在員工真實 Windows 11 Pro 裝置做人機驗證。下列範圍必須分開理解：

1. v0.1.27 的 source／Pages／Mac／Windows artifact／Mac 安裝證據已補齊；Windows runner 只證明封裝、Bridge 與 addon 可載入，不得冒充真實 Windows Hello 指紋／臉部／PIN 或 DPAPI 跨使用者驗證。員工 Windows 安裝來源目前仍是固定 v0.1.16 prerelease／受保護 installer。
2. v0.1.24 曾顯示 `Amazon 已連線`、US／Live 7 天 Sales，並完成 274 列 B2B 唯讀 canary；它不是 v0.1.27 live 證據。v0.1.27 只證明 exact App 已安裝；目前 Mac 鎖定且程序在 Keychain 重新授權前尚未建立 renderer，正式 A+／B2B 唯讀 canary 仍未執行。更早歷史版本的品牌／品類與「狀態收斂進度」也只能作各自時間點證據；品牌 report 在既有截圖時仍為整理中，品牌／品類共用 snapshot、cache fence 與 A→B→A 只建兩份不同日期 report 仍只有測試證據，不得冒充 live 完成。
3. v0.1.14 的真實 US 6 個月 Subscribe & Save 已證明單列問題可隔離、其他 offer 繼續；它只能保留為舊版歷史快照，不能自動證明 v0.1.15 的新篩選、全站／SKU 折線或五張正常表加一張問題表。這些仍待 6／12／23 個月追加唯讀重測。
4. 全庫齡層級、AIS tier、評論首頁背景 observer、長 variation family、滑板動畫、36×36 關閉控制與健檢狀態 pill 已通過 production build、測試與 1280px／390px 假 Bridge 視覺驗收；不能以 mock 數值冒充 live Amazon。
5. 評論負向數值必須保持原始負號並標示為 impact；公開 API 仍不提供商品總星等、總評論數或完整 review 全文。v0.1.12 的 23,765 件品牌出貨、257 個 non-parent review candidates，以及 v0.1.14 的 S&S aggregate 都只是各自時間點快照，不得當作恆定現值。
6. v0.1.27 保留文案 drag/drop、逐欄原因／立即修改、同檔 Excel round trip 與成分宣稱核對，並維持可關閉抽屜繼續執行的單項健檢；本版完整回歸為 1,104 tests。使用者原始 Excel 的 273 列離線完整性已通過，但真實 Amazon Validation Preview、文案批次 mutation 與 Windows Hello 實機確認仍未執行。
7. v0.1.27 的 B2B price-only／combined tiers 已有正式 source、完整 PTD／Preview／receipt／readback 測試、exact artifact 與桌面 fake Bridge QA；price-only 不帶 QDP，只有明確 combined 才可送 1–5 階 canonical percent tiers。v0.1.24 的 274 列唯讀 canary（未設定 170、已設定 58、資料未完成 46）不是 v0.1.27 live 證據。沒有真實 v0.1.27 seller-specific PTD、B2B Preview、PATCH 或 readback；未取得 exact SKU／變更值的另行明確授權前只能做唯讀診斷，商品內容、圖片、一般價格、Sale Price、B2B Price、QDP 與 Variation 不得因發布而自動寫入。
8. 報表文件庫列的是 109 個官方公開 report types 與能力說明，不代表 App 已建立 109 種通用下載器；廣告策略 Reporting v3 已接線但尚未設定真實 Ads LWA，既有廣告覆蓋 Live Ads API 也未因此自動完成，FBA 帳務中心未接線能力仍須保持 unavailable／plan-only。
9. 目前仍是內部 App：Mac 為 ad-hoc、尚無 Apple Developer ID 簽章／公證；Windows fixed prerelease 為 unsigned、尚無 publisher-bound Authenticode，SmartScreen 可能警告且 in-app updater 已停用。所有新增驗證必須保持 FBA-only；任何寫入只限使用者明確授權的 exact SKU／欄位，且不得使用 Seller Central 私有接口。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- v0.1.3 與修正 Merchant Token 前的 v0.1.4 候選版，真實 Listings probe／單一 SKU 均回 HTTP 400；Amazon Request ID 已保留於本機診斷紀錄。
- 已對照 Amazon 官方文件，完整與最小 `getListingsItem` 參數組合均合法；更新成同一授權帳號的正確 Merchant Token 後，probe 與 `AFA12AM` 商品內容皆成功，故此次 400 根因已確認為帳號識別值不一致。
- SKU 指揮中心曾在 Seller Central 明確有 FBA 庫存時誤報找不到 SKU；根因已確認是程式把官方 `payload.inventorySummaries` 錯讀成頂層 `inventorySummaries`，不是 LWA、Merchant Token 或 SKU 錯誤。
- 不應重建整個 Amazon App，也不應要求使用者輪替或公開 Secret。

---

## 6. 目前安裝檔

- 目前 `/Applications/AMZ.API.app` 的正式基線是 v0.1.27；來源為 release code main `d7136660eb71a4308625f49334a159c5351f7c08` 的 macOS artifact `9488815906`。版本／build 0.1.27、bundle `com.jspusa.amz-api`、雙架構、deep strict codesign 與 `app.asar` 已逐項匹配，原 v0.1.26 保留於 `/Applications/AMZ.API-v0.1.26-backup.app`，既有 userData／Keychain vault 與更舊備份未清除或重建。App 主程序目前停在 Mac 鎖定期間的原生 Keychain 重新授權等待，尚未建立 renderer，因此 v0.1.27 正式 Amazon 唯讀 canary 尚未完成，也沒有執行 Touch ID 或任何 mutation。完整 workflow、digest、Pages、DMG／ZIP 與 Windows CI-only 證據見上方 v0.1.27 紀錄。
- v0.1.20 main macOS workflow run：`32561974803`；artifact：`9473081924`，名稱 `AMZ.API-unsigned-7425b8e49e027028efdfac6b101bb8d7480e5b02`；GitHub metadata digest：`sha256:fb5c205b7f23b1fa18f8075f51db72ec6ba7c04b8d1f711fe3b34321a4322757`。DMG 為 `AMZ.API-0.1.20-universal.dmg`（246,861,081 bytes；SHA-256 `89e3e1aa35e6878018aa09c06ec80e22eb369d4be418aacc0fc71aafa6c4e9d4`）；ZIP 為 `AMZ.API-0.1.20-universal.zip`（221,569,042 bytes；SHA-256 `8228d8a735a24af5b613d6defbe2c2b31b56e12b9393f6b4a3e44cbc22551009`）；`SHA256SUMS.txt` SHA-256 為 `fa5e91e6b1ad85bceb7fbf289e0c6644e17a59b36eb58df2d89d78e671f728c9`。
- v0.1.20 曾作為 universal 內部測試 App 完成版本／build、bundle ID、executable、雙架構與 deep strict ad-hoc codesign 核對；這是歷史 artifact 紀錄，不是目前安裝版本。
- v0.1.19 main macOS workflow run：`32560390832`；artifact：`9472647652`，名稱 `AMZ.API-unsigned-cae2bd51cfeebc3bc9a8a4e77deaabd5af4e4bc1`；GitHub metadata digest：`sha256:22a3beb9243dae7cf2bda76dc3235422de1325e271d5da6e62301a1e31a45781`。DMG SHA-256 為 `bf9cc3931e20236357b348cc2e7f6e389ad07908a152aba5b59d177da83813f1`；ZIP SHA-256 為 `ff3837763485fcd9b49cf073bccbf104a86d0f38b54ebf1fa2068ee6bf83ecf8`，均與 artifact 內 checksum manifest 一致。
- v0.1.19 已由本次安裝保留為 `/Applications/AMZ.API-v0.1.19-backup.app`。曾手工重包的臨時 canary 會被 macOS 終止且出現「重新打開／報告」對話框，已完全排除為正式安裝來源；不得再使用該臨時 App。
- v0.1.17 main macOS workflow run：`32455530465`；artifact：`9437191218`，名稱 `AMZ.API-unsigned-ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`；GitHub metadata digest：`sha256:6ee034932ca5043774ea5110bd6c7133d93b72fd9b7c90dc434a9aa756209ea1`，保存至 `2026-09-04T06:47:01Z`。DMG 為 `AMZ.API-0.1.17-universal.dmg`（246,079,435 bytes；SHA-256 `1f01c0455d0f7ca506a537e889be5d3de2443e571e27cfc59d332e0c1e8b3ab2`）；ZIP 為 `AMZ.API-0.1.17-universal.zip`（221,564,636 bytes；SHA-256 `1267d63573ccb54e825ca9cf3cc8d510fa2c100694de9d3abca8741859b24c82`）；`SHA256SUMS.txt` 自身 SHA-256 為 `05afb64ef24c5291126ef815c3b8f439a505f35d8b2572bf7f0a30bd0475ce13`，兩個 payload hash 均完全一致。
- 受保護的 Supply Boss API v4 下載站目前只提供 Mac DMG 與 Windows NSIS installer 兩個員工入口。Mac 卡的 private R2 物件已更新為上述 v0.1.17 DMG／SHA；Windows 卡維持 v0.1.16，portable ZIP 與 `SHA256SUMS.txt` 只保留為內部驗證 artifact。下載站密碼未更改。
- Windows v0.1.16 固定內部 prerelease：`https://github.com/jspusa/AMZ.API/releases/tag/notebook-key-windows`。NSIS 安裝檔為 `AMZ.API-Notebook-Key-Windows-x64-Setup.exe`（101,400,294 bytes；SHA-256 `997209481a290a4e05dfc5111222d3deee9f2ff55bd5bff247deef06bbd8a3c0`）；portable ZIP 為 `AMZ.API-Notebook-Key-Windows-x64.zip`（142,515,498 bytes；SHA-256 `2b086fbd36c2ca8be7891a53a0d70cebc243b909b6ba2b9ba0c862799ab83b0a`）。兩者與公開 `SHA256SUMS.txt`、GitHub asset digest 完全一致，匿名下載均回 200。此版本未簽章；員工安裝前必須核對 SHA，並預期 SmartScreen 警告。
- v0.1.16 main Windows workflow run：`31351732415`；artifact：`9049261782`，名稱 `AMZ.API-Notebook-Key-Windows-x64-654d70c0ed554b1b9cdd078fc0587d15274c2500`；GitHub artifact digest：`sha256:3902fb2eeec61b3e081391a4e7dcd43d02a9beec314a3c267b7187c277fe3c6d`，保存至 `2026-08-24T03:13:10Z`。用於固定 prerelease 的 trusted workflow run 為 `31351186684`，artifact `9049090358`，digest `sha256:684aa093428ff63df64d2e51c74ae3c086bbe74658b9ce0afa164c92b7035005`；其三個實檔已下載並逐一核對。
- v0.1.16 main macOS workflow run：`31351732405`；artifact：`9049246734`，名稱 `AMZ.API-unsigned-654d70c0ed554b1b9cdd078fc0587d15274c2500`；GitHub artifact digest：`sha256:303773960c146c94cf2f883381297c93c8051dd78eac642e8869be55bab3bb7f`。該版後來確實成為本次安裝前的 `/Applications/AMZ.API.app`，並已原樣移到 `/Applications/AMZ.API-v0.1.16-backup.app`；更舊備份若仍存在，也不得在未核對版本前覆蓋。
- v0.1.15 main macOS workflow run：`31325158197`；artifact：`9041374594`，名稱 `AMZ.API-unsigned-ac5c18b2319061bcb06600967d4acec84c55d5f3`；GitHub artifact digest：`sha256:1f13c1284c75942e15d9029bf2720ef0519a4a8786bc256bdff0b63c2ad1644d`，保存至 `2026-08-23T17:03:27Z`。DMG SHA-256：`3f3d52d7bcd2d33b973c81365308e011b56addfcb1e5c28676466fcc74bf1b9f`；ZIP SHA-256：`1acc5e3d36586d1091e604a9e2ce08aa96db338df84948c0f89de1f4c2a23695`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.14 main macOS workflow run：`31320824613`；artifact：`9040153961`，名稱 `AMZ.API-unsigned-2b9a8585daf1cfb3ed95ed72add916a142864d6f`；GitHub artifact digest：`sha256:0b7d41a687b27b0415c5ee5ee5e05c26f8c2ba72b7b024399912276b3a528d70`，保存至 `2026-08-23T15:23:29Z`。DMG SHA-256：`588e1263c5f0de4a7423ab4d88821a7dc1d24871518b22c6cc45c24ed46407ec`；ZIP SHA-256：`ade7265c4d5c990518dcbe98d3863205b62d7aacd7b88cc3cdbc439a8c08da45`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.13 main macOS workflow run：`31305784906`；artifact：`9035956569`，名稱 `AMZ.API-unsigned-74d13dc21d4b0e1fd8a2acf9294473c89c409e5f`；GitHub artifact digest：`sha256:fe1ab191997cb468159d38bc4780f5233cd85bee73cd22b79dd287a79484f760`，保存至 `2026-08-23T09:28:46Z`。DMG SHA-256：`60f58c24e08474161c2536fac0f756692aa235f563cea1d3423291f1c06c42e6`；ZIP SHA-256：`002ad700aab28d4fee9499350a2d77a088806bcd91fd388772aa1be58fca39ab`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.12 main macOS workflow run：`31298271179`；artifact：`9033689855`，名稱 `AMZ.API-unsigned-e5b6a12b967613da9bbd0c8817225fbf2c9bfab1`；GitHub artifact digest：`sha256:be8c76a607f78a575ab9cbe0c85d76221e638e0e1f13ecfb04fc46070886b09c`。DMG SHA-256：`0f4bf46669180fbb6086aba2d9358ee4da09ad6e57f7a3872c83fced65185038`；ZIP SHA-256：`c4d4db8c139bef6d0be755f8df033ec2202eb1c8595dbc1c3e4c126460fa853c`；兩者均與 artifact 內 `SHA256SUMS.txt` 一致。
- v0.1.11 main macOS workflow run：`31279106105`；artifact：`9027927355`，名稱 `AMZ.API-unsigned-ec1e971db25cbbb4db9a25386a8c1e2fdc46b021`；GitHub artifact digest：`sha256:abdabd850ffa4a68a1034c3a61495944206dfb86dc80c437e20a764cb609e3e4`，短期保存至 `2026-08-22T21:25:18Z`。DMG SHA-256：`7aa7001adc5a867740527a8d1788abc2cd6ab0d888c0557561ed1882b4d47fe3`；ZIP SHA-256：`e6a3f18fa3b880edbbce98722137fba50d85e1d2f4cfa32b9c8439ed51529753`；兩者均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.10 main macOS workflow run：`31271753671`；artifact：`9025861198`，名稱 `AMZ.API-unsigned-5949f605da420f7664bcaf9507f9fc9cde16dcf1`；GitHub artifact digest：`sha256:39bdc11f1bc78d4c680a93c1c204c65f2e8e82a4475e379bd21b3f81772051ed`。DMG SHA-256：`c02dccc1fdb3de253ced71a82e7d01fc885f0662b6ddf1f16d0cc0f7ac37643c`；ZIP SHA-256：`578e96dd7b5b465c9b9e44648de6fa1f9a7db3ee18f2e2c65de120a7644f6891`；兩者均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.9 main macOS workflow run：`31249715993`；artifact：`9019652910`，名稱 `AMZ.API-unsigned-3fa27e165a42a441be67abb44e5fcfcc37d264bc`；GitHub artifact digest：`sha256:d66863e149c0ab6a1c65394bb9dbcd93ebe58051bdff7c802613272e38fa0ce9`（短期保存至 2026-08-22）。DMG SHA-256：`7e74d7ba0dd31ce2a7ea7a795cb1a6b4f88ee922f847383a962fdae51f5d052c`；ZIP SHA-256：`d543b790527b13cc6b4836757bf9297405d37a24d961571be3e45cac931a9cbc`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.7 main macOS workflow run：`31098122782`；artifact：`8966405377`，名稱 `AMZ.API-unsigned-a9a9468cdfb42ae4d1e0e1b268027bf9ca7220a0`；GitHub artifact digest：`sha256:bf5c4a9cf79a59a8abc11ce25cf0db31bbe9c8c846316f7fc268969f49b370cf`（短期保存至 2026-08-20）。DMG SHA-256：`550cc0ed24f69f8661aed372f22ca22ac6f88ed9d8acb79d2af5573cc9ba2de3`；ZIP SHA-256：`c6ebda5b1631ee2d80058734667ef1a5a7b2ab6128edb463a883098198156609`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.6 當時的實際安裝來源：分支 workflow run `31085746949`、artifact `8961382972`，名稱 `AMZ.API-unsigned-6091ff0b9fd649d816c07c8ca7d1504724a5093f`；GitHub artifact digest：`sha256:a365a0d997abd53839ff64086ded2edd8479e11aafcafae380b4653fc7b782c4`。
- v0.1.6 分支 DMG SHA-256：`c9a20a9638088f43b690a762746efd034c8c8a05836f1d740c149a138c9c53ec`；ZIP SHA-256：`b369dba980de343527c6a602090e0a06c37d508870a690478dfac7bc45375a9c`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.6 main macOS workflow run：`31086616734`；artifact：`8961800029`，名稱 `AMZ.API-unsigned-d288ac40640c92e42e11474068a879625ed7212a`；GitHub artifact digest：`sha256:1ad52cb1ca34decec9f76805b129916725dcacac0588bc96f1be0a911f757c5e`（短期保存至 2026-08-20）。main DMG SHA-256：`0c45bf2720365d08f588c40b2c4f1e9e63a02bb1e950f66af80b43a078fbcff9`；ZIP SHA-256：`43faaf83c53ceebb031169874454bb36f78eaf108d5da415f18e7df809134ae3`；均與 main artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.5 桌面 DMG 若仍保留，其 SHA-256 為 `3f37a6a0fd520839ecb73d8344b3a048265e8e345289d4693fdd75a1a5b6ef38`。
- 舊 v0.1.3 Library 檔名：`AMZ.API-0.1.3-universal.dmg`；舊 DMG SHA-256：`12c709019558d2060e88a9f8af33d121040af3ae80a56748a1cc41c5769ea232`。
- 同一 bundle ID／Keychain vault，覆蓋安裝時應保留本機憑證。
- 目前為內部測試版／ad-hoc 驗證流程，不可宣稱已完成 Apple Developer ID 公證正式發布。

---

## 7. 必讀檔案順序

新 Codex 必須依序讀取，不要只看 README 就開始改：

1. `docs/CODEX_HANDOFF.md` — 本文件，狀態與交接入口。
2. `README.md` — 功能、第一次使用、發布方式。
3. `SECURITY.md` — 不可破壞的安全邊界。
4. `docs/ARCHITECTURE.md` — GitHub UI、Mac Bridge、程序與信任邊界。
5. `package.json` — 版本、scripts、Electron build 設定。
6. `src/shared/contracts.ts` — Renderer／Preload／Main 的資料合約。
7. `src/main/index.ts` — App 啟動、視窗、IPC、更新與請求協調。
8. `src/main/credential-vault.ts` — Keychain-backed secret vault。
9. `src/main/api-router.ts` — 所有 UI API 路由、preview／commit 與輸入驗證。
10. `src/main/amazon/sp-api.ts` — SP-API endpoint、正規化、錯誤、報表、Listings、Orders、FBA。
11. `src/main/local-store.ts` — 商品主檔與 idempotency ledger。
12. `src/preload/index.ts` — 窄化 Bridge。
13. `src/renderer/src/connection-panel.tsx` — Notebook Key 安全連線與 API SOP。
14. `src/renderer/src/components/sku-operations-drawer.tsx` — 文案與 Excel。
15. 其他 `src/renderer/src/components/*drawer.tsx` — 價格、促銷、圖片、補貨、廣告。
16. `.github/workflows/*.yml` — Validate、Pages、macOS 與 Windows build／release。
17. `tests/*.test.ts` — 已建立的安全與回歸契約。

---

## 8. 新 Codex 開始工作前的檢查

```bash
git status -sb
git remote -v
git fetch origin
git log --oneline --decorate -10
npm ci
npm run check
npm audit --omit=dev
```

注意：

- v0.1.27 release code main commit 為 `d7136660eb71a4308625f49334a159c5351f7c08`，對應 PR #60、Pages、macOS artifact 與 main Windows CI；固定員工 Windows prerelease 仍是 v0.1.16。開始新工作前仍須 `git fetch origin` 並核對 merge base；後續 docs-only main commit 不得冒充新的 release artifact SHA，不得把本機 `out/` 或未受信任 PR artifact 誤認成已發布 App，本機 `main` 若尚未 fast-forward 也不得直接從舊 local `main` 建立新分支。
- 工作區可能存在使用者或其他 agent 的變更；不得 `git reset --hard`、`git checkout --` 或直接覆蓋。
- 修改後應建立修復分支／PR，通過 Actions 再合併。
- 真實 Amazon 驗證只能由使用者在自己的 Notebook Key 本機加密憑證環境執行；Linux／CI 不得假裝已測過 SP-API live，Windows runner 也不得假裝已完成員工裝置的 Windows Hello／DPAPI 人工驗證。

---

## 9. 不可違反事項

- 不要要求使用者在聊天貼 LWA Client Secret、Refresh Token、完整 Seller ID。
- 不要把 Secret 寫入 GitHub、`.env`、localStorage、URL、console、crash log 或 Excel。
- 不要為了方便把 Amazon API 直接搬到 GitHub Pages browser JavaScript。
- 不要讓任意 GitHub／遠端 origin 取得 preload IPC。
- 不要提供通用 `amazon:request(method, path, body)` IPC。
- 不要在 timeout／429／5xx 後自動重送 Amazon 寫入。
- 不要把 Coupon、Subscribe & Save 或 Ads API 未開放能力假裝成已完成。
- 不要加入 FBM 功能或讓 FBM 商品混入補貨／內容匯出。
- 不要只因 Orders 成功就宣稱 Seller ID／Listings 已成功。
- 不要更名；產品名稱確定是 `AMZ.API`，不是 Amazon-FBA-OS。

---

## 10. 交接後建議的第一個任務

下一個安全任務是在使用者親自解鎖 Mac 後，先透過原生 Keychain 流程完成既有 Notebook Key 的重新授權，再核對 exact v0.1.27、Notebook Key／Amazon 連線、US／Live，並只執行正式 Amazon 唯讀 canary。不要在 Mac 冒充 Windows Hello、不要清除或重建既有 vault，也不要自動執行任何 Amazon 寫入。

### A. v0.1.27 發布與 live 證據

1. `npm run check` 119 files／1,104 tests、audit 0、diff check、PR #60、release code SHA `d7136660eb71a4308625f49334a159c5351f7c08` 的四個 main Actions、live Pages 七檔與 exact macOS artifact 安裝均已完成；後續 docs-only main SHA 只代表證據文件更新，不得冒充新的 release code 或 artifact SHA。
2. 960px 桌面 fake Bridge QA 已驗證 B2B 七顆摘要按鈕同列、首頁只有七張既有結果卡；A+ optional subtype、B2B report fallback、run-all fan-out、terminal failure cache fence 與變體 Excel family 色塊都有 focused regression。外部 request 與 PATCH 都是 0。
3. exact v0.1.27 App 已安裝，v0.1.26 備份與既有 vault 均保留；目前 Mac 鎖定且仍待使用者完成原生 Keychain 重新授權，因此正式 Amazon 唯讀 canary 尚未完成，不能沿用 v0.1.24 或其他舊版連線畫面冒充完成。
4. 解鎖與重新授權後，先核對 Notebook Key／Amazon 連線、US／Live 與目前 App 0.1.27，再執行 A+、B2B、文案立即修改入口與原 Excel 的零寫入預覽 canary。沒有另行明確授權 exact SKU、欄位與變更值前不得 PATCH；任何不明結果立即停止，不盲目重送。
5. Windows CI 不能替代真實 Windows 11 Pro 的 DPAPI／Windows Hello 驗證；目前員工固定 prerelease 仍是 v0.1.16。

### B. 廣告策略 live 待辦

1. Amazon Ads 獨立 LWA 尚未設定；先用 main-owned 本機安全 editor 完成 Ads LWA 與 US profile 驗證，不得把 Secret 或 profile ID 放入聊天／Pages。之後才用最近 30 個完整日核對 FBA SKU、Sales & Traffic、SP 實際花費／14 日歸因銷售／購買次數、實際 ACoS、花費排名與 T1–T4。
2. 廣告策略缺報表列必須保持「未回報」，不得補 0；價格、SB／SD 策略與規格保持人工欄位。下載後核對三張工作表與 29 欄、分開來源時間；關閉 drawer 再重開只能 GET 接回同一 job。只有第一次真實 Reporting v3 成功後才能標成已驗證。

### C. Windows 11 Pro x64 實機驗證

1. 只從固定 `notebook-key-windows` prerelease 下載 EXE 或 ZIP；安裝前依 `SHA256SUMS.txt` 核對 SHA-256。不要改抓 PR／fork／過期 Actions artifact。
2. 在一台員工 Windows 11 Pro x64 筆電核對 SmartScreen 警告、NSIS 安裝／移除、版本 0.1.16、Notebook Key Bridge ready、WebGate 開啟與一般瀏覽器無 Bridge 的鎖定狀態。Windows unsigned 版不得啟用 in-app updater。
3. 使用 main-owned 本機安全 editor；不得把 Client Secret、Refresh Token 或完整 Seller ID 貼到聊天、Pages 或瀏覽器。核對保存後 renderer 只看到 redacted status，另一個 Windows 使用者不能解密原使用者的 DPAPI vault。
4. 以 Windows Hello 實測成功、取消、未設定／不可用與 Windows 提供的 PIN fallback；記錄的只能是通過／拒絕與安全錯誤碼，不得記錄生物特徵種類或憑證。測試停在敏感操作授權邊界，不執行 Amazon mutation。
5. CI 已證明 addon 可載入、HWND 屬於目前程序且三種 package 可啟動；它沒有證明實際指紋／臉部／PIN UI。只有上述實機矩陣完成後，才能把 Windows Notebook Key 標為已完成員工驗收。

### D. 接回目前 Mac App

1. 目前安裝的是 exact main artifact v0.1.27；v0.1.26 備份、更舊備份與原 userData／Keychain vault 均保留。不要以工作樹 build 覆蓋目前安裝檔，也不要清除 Keychain item 或 encrypted vault。
2. App 主程序仍在等待使用者解鎖 Mac 並完成原生 Keychain 重新授權，尚未建立 renderer；解鎖後應接續同一程序核對，不要盲目重啟、重建 vault 或為了測試進入 Touch ID／commit。

### E. 依序完成既有新功能的真實唯讀證據

1. 品牌／品類：在同一日期範圍先看品牌、切至品類、再切回品牌；核對總額不變、八個品類依 Supply 最早關鍵字規則分類、未命中歸「其他」，且 main 沒有為回到品牌另建相同 report。範圍含站點今天時核對 `dataThrough`，不得把當天未完成資料冒充完整日。
2. Subscribe & Save：先用 6 個月核對「全部／0／5／10／15／20／有問題」篩選、正常卡片欄位、預設全站折線、選取 SKU、取消或重選同 SKU 返回全站；問題 SKU 只能出現在問題範圍，未知折扣不得進 0%。
3. Subscribe & Save Excel：核對 0／5／10／15／20% 五張無問題折扣表與獨立「問題 SKU」表。再視需要追加 12／23 個月；缺月、unknown discount、部分 coverage 與無法安全輸出 identifier 的範圍必須保持原樣，不得補 0 或顯示假的全站總額。
4. 首頁健檢狀態：核對成功、部分完成、失敗與未執行的外卡片狀態清楚；「狀態收斂進度」只表示步驟已結束，不得把全部失敗顯示為成功。
5. 追加核對全庫齡層級與 AIS tier 的真實 US report、評論 drawer 關閉後首頁進度，以及長 variation family 的實際內容；只做唯讀，不進 Preview／Touch ID／commit。

### F. 其餘既有唯讀矩陣

1. 評論主題：接回既有 job 後關閉 drawer，等待背景進度增加再重開；負數必須顯示為「負向影響值」且明示不是商品負星等。核對 parent 排除、child＋standalone non-parent 與六張 Excel。
2. 未綁變體：完成批次掃描與 Excel，確認缺 relationships／站點或 ASIN 衝突列為未完成；Seller SKU／ASIN family 查詢只做唯讀，結果都要顯示 exact Seller SKU。
3. 文案：核對 Excel 疑似錯字片段為紅字；以一個有問題欄位測「立刻修改」fresh read 與 stale fallback，只能走到 Amazon Validation Preview，未獲另行授權不得 commit。
4. 報表文件庫：核對 109 個官方 report types 的分類、說明與「已接線／尚未接線／不適用」狀態。文件列出不等於 App 已能下載全部 109 種。

### G. 若某一 endpoint 失敗

依 endpoint 分開診斷，不把所有失敗歸因於「API 沒串好」：文案／圖片／variation 看 Listings Items 與 PTD；FBA 庫存看 FBA Inventory；訂閱省看 Replenishment；品牌／品類／評論／Excel／健檢／庫齡看 Reports、Customer Feedback 與 Listings enrichment；會計先分辨 Finances JSON、FBA report、Amazon-generated report、人工前置與 unavailable。保留錯誤 code、Amazon message、Request ID、App version 與 marketplace，但不得記錄或輸出 Secret、Refresh Token 或完整 Seller ID。

---

## 11. 完成定義

只有適用平台與 Amazon 範圍的下列條件都成立，才能向使用者宣稱「已串好」：

- Notebook Key 顯示正確版本；Windows 版必須另在真實 Windows 11 Pro x64 完成安裝、Bridge、DPAPI 與 Windows Hello 成功／取消／不可用／PIN fallback 人工驗證，不能拿 CI 或 Mac 測試代替。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂 1–365 天與去年同期 AFN 銷售趨勢完整載入。
- 180 天以上 FBA 庫齡報表能唯讀載入，庫齡與 Amazon 預估冗餘不混為同一指標；它與評論健檢只放在首頁預設收合的「低頻健檢」，不進 run-all。
- 首頁 run-all 精確包含文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；七項在背景並行執行，名稱與一般健檢卡完全一致並固定依此順序顯示。任一失敗要保留自己的終局狀態，不能把「全部結束」冒充成功。
- 全站文案與圖片健檢能以真實 Amazon FBA 範圍載入，cache／編輯／返回流程正常；文案門檻精確為產品名稱 60、產品亮點 110、每項產品要點 150–200、產品敘述 1,800 Unicode 字元，圖片 0–5 張列不足、6 張通過，讀取未完成不推論。原因只能顯示一次，摘要數字本身可直接篩選，立即修改要聚焦並保留相符原因。成分宣稱只在完整且非空的 Amazon ingredients 證據下核對：至少兩個不同成分才可否定 single ingredient，Tendon／Tendons 需有同詞成分，ingredients 含 Chicken 時標示 hypoallergenic 待核對；括號逗號與不完整讀取不得誤判。
- 文案 Excel 可按鈕選檔或 drag/drop，且只含 FBA 商品；schema v2 必須含「說明與索引」、已證明的變體 family 分頁、「未綁變體」與 fail-closed「資料未完成」，並保留原始／更新欄、問題顏色與「類型／說明」。CR／U+0085／U+2028／U+2029 必須無損 round trip；舊檔只能用 main-owned 唯一完整 digest bounded recovery。
- 回傳文案健檢 Excel 時，無變更、篡改、過期、跨站點／帳號、公式／巨集／外部連結與任何 SKU 預檢失敗都必須在第一筆 Amazon PATCH 前停止；通過後一次 native confirmation 只授權該 main-owned batch，逐 SKU ledger／readback 與遇不明停止後續不得放寬。
- A+ 全站健檢必須以同次完整 FBA all-listings 與 relationships 證明 exact child／standalone Seller SKU，再依 marketplace＋ASIN 去重讀取全部官方 publish-record pages；parent、身分或 relationship 未完成列不得發 A+ request 或誤標 missing。只有 warning-free、完整分頁的空清單才可標沒有 A+；任一 exact record 可證明已發布，即使 optional warnings envelope 無法解析也不得丟失正向證據。403、warning-only 空清單、分頁／schema 缺口保持 unavailable／incomplete；產品介面只檢查是否有 A+ 發布紀錄，其他公開 API 無法證明的內容類型不建立功能或欄位。
- Subscribe & Save 全站健檢能以完整 FBA Inventory 分頁證明 SKU，正確顯示目前有效訂閱、最多 23 個已完成月份與缺月；開啟顯示全站歷史並能切換／取消單一 SKU。Excel 必須產生 0／5／10／15／20% 五張無問題工作表與獨立「問題 SKU」工作表；未知折扣、問題列與缺值不得冒充 0 或完整總額。
- FBA 冗餘庫存只依 Amazon `estimated excess quantity`，庫齡不會被列為冗餘；storage cost／AIS 缺值不會產生假的 0 或部分全站總額。
- 未綁變體健檢能以真實 FBA relationships fail closed 載入並匯出 Excel；畸形、缺失或被改寫的識別碼不得被列為可安全操作。
- 品牌與品類營收能以同一份、同日期的真實 FBA Customer Shipment Sales report 核對總額；品牌保留未分類列，品類依 Supply 的最早關鍵字規則產生八類，切換不得另建相同 report。含站點今天時必須顯示實際 `dataThrough`；廣告覆蓋在 Ads API 尚未連線時必須維持 unavailable，不能宣稱已有真實 campaign 覆蓋結果。
- FBA 入庫貨件必須只出現在頂部「報表區」，不在首頁或「營運區」重複入口；並以真實 US 30 天背景 job 證明可完成。預期／Amazon 已接收／尚在接收／多接收、完整／部分 coverage、daily/problem-only 三層瑕疵邊界與 7-sheet Excel 均須驗證；安全失敗、空列或 unavailable 不得冒充 0 貨件、0 差異或 0 瑕疵。
- 廣告策略必須以真實 US 最近 30 個完整日證明目前 FBA、Sales & Traffic 與 SP Reporting v3 可完成；T1–T4、缺值不補 0、價格／SB／SD／規格人工欄保持空白，以及 3-sheet／29 欄 Excel 均須驗證。Ads LWA 未設定或 Reporting 未成功時只能標為未驗證。
- 首頁全站健檢外卡片必須區分未執行、執行中、成功、部分完成與失敗；「狀態收斂進度」不得因所有步驟都已結束而把全部失敗冒充成功。
- B2B 全站健檢必須用同次完整 all-listings 證明 FBA 範圍，exact 核對 Seller SKU／ASIN／marketplace，並把 configured／missing／above-standard／readonly／incomplete 分開；只有帶目前 Seller ID 的 seller-specific PTD 明確開放 exact B2B price path 才能顯示價格可編輯。任何真實更新必須先呈現一般價與 B2B canonical diff，只 merge `audience=B2B` contribution 並保留一般 `ALL` 與其他 audiences。price-only 必須省略並守住既有 `quantity_discount_plan`；combined 只有在使用者明確選用、canonical 1–5 階 percent tiers 與完整 QDP PTD path 都可證明時才可帶 plan。兩者都要經 fresh read、Validation Preview、native confirmation、idempotency、單次 PATCH 與 price／tiers canonical readback；不明結果禁止重送。
- 會計中心只把公開 capability 與安全 access plan 標為完成；除非日後另行實作並驗證 report lifecycle，不得宣稱已下載報表、一般發票或 Seller Central 帳單。
- Variation family 與 CHILD PTD 必須先通過真實唯讀驗證；目前 mutation 只能標為 mock/demo 已驗證。只有在使用者另行明確授權指定 SKU，且 detach 與 attach 各自完成 preview、Touch ID、單次 PATCH 與唯讀回查後，才可對該次操作宣稱真實寫入成功。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID／Windows Hello。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在各 Notebook Key 的本機加密 vault：macOS Keychain 或目前 Windows 使用者的 DPAPI，不進 Pages、renderer、GitHub、日誌或回覆。
