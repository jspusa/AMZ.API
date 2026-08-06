# AMZ.API — Codex 專案交接入口

最後更新：2026-08-06
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前版本：`v0.1.7` 候選開發中；GitHub `main` 與 `/Applications/AMZ.API.app` 仍為已驗證的 `v0.1.6`
交接目的：讓新的 Codex 對話不需要重讀原始聊天，也能安全地繼續開發、除錯與發布。

---

## 0. 給新 Codex 的第一句指令

使用者可以直接貼上：

> 請先完整讀取 `docs/CODEX_HANDOFF.md`，再依照其中的「必讀檔案順序」讀完相關檔案。先執行唯讀檢查與 `npm run check`，確認目前 GitHub `main`、本機分支、版本與 Actions 狀態，不要重建專案。這是正式的 AMZ.API Amazon FBA 控制台；不得把任何 API Secret、Refresh Token 或 Seller ID 寫入 GitHub、日誌或回覆。完成盤點後，先告訴我目前狀態、未完成驗證與你建議的下一步，再繼續修改。

---

## 1. 專案一句話

AMZ.API 是 Jasper 公司自用的 **Amazon FBA-only 營運控制台**：GitHub Pages 自動更新介面，macOS Key Bridge 保存 Amazon SP-API 憑證並執行本機 API 請求；一般瀏覽器沒有 Mac App Bridge 時保持鎖定。

這不是公開 SaaS、不是多租戶產品、不是 FBM 工具，也不是 Helium 10 的替代品。

---

## 2. 使用者真正想解決的痛點

使用者不想反覆進 Seller Central 點選繁瑣頁面，希望能輸入 Seller SKU 後完成大部分日常工作：

### 策劃區

- 廣告：SP 主要留在 Helium 10；AMZ.API 只需簡化 SB／SD 授權狀態與官方入口。
- 補貨：自動整合 FBA 可售、在途、銷速、交期、安全庫存、箱規與 AWD 路徑。
- 既有 Amazon 補貨 Skill 若可安全接入可列為選配，但內建補貨不能依賴外部 Skill 才能運作。

### 產品區

- 文案：查詢及修改商品標題、五大賣點、成分。
- 圖片：拖拉上傳、排序、主圖選擇、尺寸與格式驗證、Amazon Validation Preview。
- 一鍵匯出所選站點全部 FBA 商品的 Seller SKU、ASIN、標題、五點、成分 Excel。

### 價格區

- 定價：依 Seller SKU 查價與安全調價。
- Subscribe & Save：目前公開 SP-API 能力不足的部分維持唯讀／官方頁完成人工設定。
- 促銷：限時售價 API；Coupon 及部分促銷資格在 Amazon 官方頁完成。

### 操作設計

- Apple 式極簡、人性化、美觀。
- 能自動化就自動化；能一鍵就不做成多步驟。
- 自動＝淺綠、一鍵＝淡藍、需人工＝黃色。
- 必須有防呆、衝突檢查、自我檢查與可理解的中文錯誤。
- FBA only；不得加入 FBM 操作入口或混入 FBM 商品。

---

## 3. 已確定的架構

```text
GitHub repository / Actions
├─ GitHub Pages：最新 renderer UI
├─ Validate workflow：型別、測試、build
└─ macOS workflow：universal App、啟動檢查、DMG/ZIP

macOS AMZ.API.app
├─ 載入精確允許的 GitHub Pages origin
├─ Preload 提供窄化、白名單式 Bridge
├─ Main process 執行 Amazon SP-API
├─ macOS Keychain-backed encrypted vault 保存 Secret
└─ Touch ID／本機確認保護寫入
```

重要邊界：

- GitHub 不保存也不應接收到 LWA Client Secret、Refresh Token 或完整 Seller ID。
- Amazon Access Token 只應短暫存在 main process 記憶體。
- 一般瀏覽器打開 GitHub Pages 只顯示鎖定／啟動頁；真正控制台在 AMZ.API App 視窗操作。
- Renderer 不應取得解密後 Secret，也不應擁有通用任意 IPC 或任意 Amazon URL 請求能力。
- Custom deep link 只用於啟動／聚焦 App，不得直接觸發 Amazon 寫入。
- 寫入固定走：讀舊值 → Amazon Validation Preview → 本機票證 → 防呆 → Touch ID → 再檢查 → idempotency → 單次寫入 → 回查。

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
- v0.1.7 候選版已完成但尚未合併／部署／安裝：
  - 商品內容更新移除重輸完整 SKU；支援 Touch ID 時直接顯示系統驗證，不先顯示額外確認對話框。Validation Preview、短效票證、舊值衝突、idempotency、單次寫入與送出後回查仍保留；無 Touch ID 時仍有原生確認 fallback。
  - Sale Price 明確對應 Seller Central「產品 → 管理所有庫存 → 編輯 SKU → Offer／商品報價 → Sale Price」，並說明不是廣告選單的價格折扣、管理促銷、Deals 或 Coupon；只更新 `discounted_price`。
  - Subscribe & Save 數字改稱「目前有效訂閱」：它是 Replenishment `listOffers` 查詢當下的 active subscriptions 快照，不是單月新增、歷史累計、配送次數或唯一顧客數。
  - 新增全站 FBA 內容健檢：Reports 清單搭配 Listings enrichment，檢查疑似錯字、少於五個賣點與成分狀態；Mac 內建字典每次最多檢查 5,000 個不重複英文單字，文案不送第三方也不自動改字。
  - 內容健檢採 fail closed：Listings 讀取失敗列為「讀取失敗／未完成」且不計入缺值或拼字統計；只有可確認為 `PET_FOOD` 的空成分算「缺成分」，其他商品類型列為「成分未驗證／需人工確認 PTD」。
  - 新增 Variation Family 唯讀地圖與拖拉規劃，只接受可證明為 FBA 的 child；跨站、product type、theme、缺維度、重複維度或 family 不完整會阻擋。Parent 只作唯讀容器，沒有 PUT／PATCH／DELETE，也沒有 FBM。
  - Electron 操作驗證曾抓到 variation lookup 一啟動就自行取消；根因是 Escape 鍵 effect 在 `busy` 變更時執行 cleanup 並誤 abort 目前 GET。現已把鍵盤 listener cleanup 與僅限卸載的 request abort 拆開，來源、目標與唯讀規劃均已在 Electron 展示模式通過。
  - 本機驗證：103/103 tests、TypeScript、main／preload／renderer production build、`git diff --check`、Electron 展示模式四項互動與 `npm audit --omit=dev` 0 vulnerabilities。

### 已完成與仍待真實 Mac／Amazon 驗證

Listings 根因、`AFA12AM` 文案／價格／促銷／FBA 庫存唯讀、Excel 匯出，以及 7／14／30／90 天、自訂區間與去年同期 AFN 銷售趨勢均已完成。現在仍待：

1. v0.1.7 仍需建立 PR、通過 Actions、合併、部署 Pages、建置 universal App、備份 v0.1.6 後安裝，再確認版本、雙架構、簽章、啟動與既有本機 vault 正常。
2. 在真實 US 帳號執行全站 FBA 內容健檢，確認 Mac 字典、讀取失敗排除與「缺成分／成分未驗證」分類；唯讀核對至少一個 variation family 的 parent、children、theme 與維度並做一次不送出的拖拉規劃。
3. 唯讀確認 Sale Price 說明與目前排程，以及「目前有效訂閱」標籤；Touch ID 可用 demo 或取消流程驗證，未獲使用者另行明確授權不得送出真實商品內容或變體寫入。
4. 如需帳務級核對，仍可把同一 US 站／Amazon 當地日界的本期與去年同期逐日數字和 Seller Central 報表逐列比較；App 端 7／14／30／90／自訂載入與切換已驗證。
5. 商品內容真實寫入仍未執行；任何寫入都必須保留 Amazon Validation Preview、舊值衝突檢查、Touch ID、idempotency 與送出後回查。
6. 目前仍是 ad-hoc 內部測試 build；是否建立 Apple Developer ID 簽章／公證與 GitHub Release 尚未決定。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- v0.1.3 與修正 Merchant Token 前的 v0.1.4 候選版，真實 Listings probe／單一 SKU 均回 HTTP 400；Amazon Request ID 已保留於本機診斷紀錄。
- 已對照 Amazon 官方文件，完整與最小 `getListingsItem` 參數組合均合法；更新成同一授權帳號的正確 Merchant Token 後，probe 與 `AFA12AM` 商品內容皆成功，故此次 400 根因已確認為帳號識別值不一致。
- SKU 指揮中心曾在 Seller Central 明確有 FBA 庫存時誤報找不到 SKU；根因已確認是程式把官方 `payload.inventorySummaries` 錯讀成頂層 `inventorySummaries`，不是 LWA、Merchant Token 或 SKU 錯誤。
- 不應重建整個 Amazon App，也不應要求使用者輪替或公開 Secret。

---

## 6. 目前安裝檔

- 目前 `/Applications/AMZ.API.app`：v0.1.6 universal、ad-hoc 簽章；已完成真實 7／14／30／90／自訂與去年同期 AFN 銷售趨勢唯讀驗證。
- 可回復備份：`/Applications/AMZ.API-v0.1.5-backup.app`、`/Applications/AMZ.API-v0.1.4-backup.app` 與 `/Applications/AMZ.API-v0.1.3-backup.app`。
- 實際安裝來源：分支 workflow run `31085746949`、artifact `8961382972`，名稱 `AMZ.API-unsigned-6091ff0b9fd649d816c07c8ca7d1504724a5093f`；GitHub artifact digest：`sha256:a365a0d997abd53839ff64086ded2edd8479e11aafcafae380b4653fc7b782c4`。
- v0.1.6 分支 DMG SHA-256：`c9a20a9638088f43b690a762746efd034c8c8a05836f1d740c149a138c9c53ec`；ZIP SHA-256：`b369dba980de343527c6a602090e0a06c37d508870a690478dfac7bc45375a9c`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- main macOS workflow run：`31086616734`；artifact：`8961800029`，名稱 `AMZ.API-unsigned-d288ac40640c92e42e11474068a879625ed7212a`；GitHub artifact digest：`sha256:1ad52cb1ca34decec9f76805b129916725dcacac0588bc96f1be0a911f757c5e`（短期保存至 2026-08-20）。main DMG SHA-256：`0c45bf2720365d08f588c40b2c4f1e9e63a02bb1e950f66af80b43a078fbcff9`；ZIP SHA-256：`43faaf83c53ceebb031169874454bb36f78eaf108d5da415f18e7df809134ae3`；均與 main artifact 內的 `SHA256SUMS.txt` 一致。
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
13. `src/renderer/src/connection-panel.tsx` — Mac 安全連線與 API SOP。
14. `src/renderer/src/components/sku-operations-drawer.tsx` — 文案與 Excel。
15. 其他 `src/renderer/src/components/*drawer.tsx` — 價格、促銷、圖片、補貨、廣告。
16. `.github/workflows/*.yml` — Validate、Pages、Mac build／release。
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

- 先確認遠端 `main` 是否仍以 `d288ac4...` 或更新 commit 為首；不要用舊本機分支覆蓋遠端。
- 工作區可能存在使用者或其他 agent 的變更；不得 `git reset --hard`、`git checkout --` 或直接覆蓋。
- 修改後應建立修復分支／PR，通過 Actions 再合併。
- 真實 Amazon 驗證只能由使用者在自己的 Mac Keychain 憑證環境執行；Linux／CI 不得假裝已測過 SP-API live。

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

先完成 v0.1.7 的發布與真實唯讀驗證，不要再擴充功能：

### A. 發布與安裝

1. 確認 branch 與 `main` 沒有分歧，建立 PR，等待 Validate 與 macOS universal workflow 成功後才合併。
2. 等 Pages 與 main macOS workflow 成功；下載 artifact，核對 `SHA256SUMS.txt`、版本、bundle ID、`arm64`／`x86_64` 與 `codesign --verify --deep --strict`。
3. 原封不動備份 `/Applications/AMZ.API.app` 的 v0.1.6，再覆蓋安裝 v0.1.7；不得清除或輸出 Keychain vault。

### B. 真實唯讀驗證

1. 用至少一個 US FBA variation family 核對 parent、children、theme、維度與排除項目；完成一次拖拉規劃並確認沒有 Amazon mutation。
2. 執行全站 FBA 內容健檢；核對 Mac 字典、讀取未完成列、賣點不足，以及「缺成分／成分未驗證」分類。
3. 唯讀查詢 Sale Price 與 Subscribe & Save，確認 UI 的 Seller Central 對應與「目前有效訂閱」定義；不得為驗證而建立折扣。

### C. Touch ID 負向驗證

1. 商品內容預檢後應直接出現 Touch ID，不再要求重輸 SKU 或先顯示額外對話框。
2. 只做取消／拒絕的負向驗證，確認沒有 Amazon 寫入與 idempotency commit；真實文案寫入需使用者另行明確授權。

### D. 若某一 endpoint 失敗

依 endpoint 分開診斷，不把所有失敗歸因於「API 沒串好」：文案／圖片／Sale Price 看 Listings Items 與 PTD；FBA 庫存看 FBA Inventory；訂閱省看 Replenishment；Excel／健檢看 Reports 與 Listings enrichment。保留錯誤 code、Amazon message、Request ID、App version 與 marketplace，但不得記錄或輸出 Secret、Refresh Token 或完整 Seller ID。

---

## 11. 完成定義

只有以下條件都成立，才能向使用者宣稱「已串好」：

- Mac App 顯示正確新版本。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂與去年同期 AFN 銷售趨勢完整載入。
- Excel 可下載，且只含 FBA 商品；錯誤／缺欄位有清楚工作表或提示。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在使用者 Mac 的加密 vault。
