# AMZ.API — Codex 專案交接入口

最後更新：2026-08-22
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前狀態：`v0.1.20` 已由 PR #45 squash merge 至 `main` commit `7425b8e49e027028efdfac6b101bb8d7480e5b02`；main Validate `32561974878`、Pages `32561974784`、macOS universal `32561974803` 與 Windows CI `32561974758` 均成功。可信 macOS artifact `9473081924` 已逐層驗證並安裝為 `/Applications/AMZ.API.app`，v0.1.19 原樣備份，Keychain vault 保留且系統資訊顯示 `目前本機 App 0.1.20`／`Amazon 已連線`；Windows 結果仍只是 CI，沒有 Windows 實機驗證。2026-08-22 只執行一次真實 US 30 天唯讀驗證：活動中貨件 31／31 票全部讀完，逐票商品跨過舊版第 25 筆續頁限制，完成 803 列；畫面仍正確標為活動清單 partial，不冒充所選日期完整範圍。已核對預期 335,091、Amazon 已接收 225,440、尚未接收 111,410、多接收 1,759；每日瑕疵報表仍 unavailable，沒有冒充 0 瑕疵。7-sheet Excel 已下載並通過 OOXML 完整性與 sheet／row 結構核對。沒有 Amazon mutation。Amazon Ads 獨立 LWA 尚未設定，因此廣告策略 Reporting v3 仍未 live 驗證。受密碼保護下載站的 Windows installer 仍為 v0.1.16；Mac 下載卡仍是舊版，更新前必須先另行完成 private R2 發布與驗證。
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

- 文案：查詢及修改產品名稱、產品亮點、五大產品要點、產品敘述與成分。
- 圖片：拖拉上傳、排序、主圖選擇、尺寸與格式驗證、Amazon Validation Preview。
- 一鍵健檢所選站點全部 FBA 文案並匯出依 variation family 分頁的 Excel；同一檔案可回傳做整批零寫入預檢，再經一次本機身分確認逐 SKU 安全更新。

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

v0.1.21 的 PR、main Actions、Pages、Mac artifact／安裝已完成；受保護員工 Mac 下載檔仍是 v0.1.17，Windows 固定 prerelease 仍是 v0.1.16，且尚未在員工真實 Windows 11 Pro 裝置做人機驗證。v0.1.21 的新文案健檢／Excel round trip 尚未對真實 Amazon 執行 mutation；既有 v0.1.17 首頁曾完成真實 US Sales 唯讀載入，但新增入庫與 Ads 策略仍沒有 live 完成。下列範圍必須分開理解：

1. v0.1.21 的可追溯 source／Pages／Mac artifact／安裝鏈與 live Pages asset 核對已完成；同一 main SHA 的 Windows runner 成功只證明封裝、Bridge 與 addon 可載入，不得冒充真實 Windows Hello 指紋／臉部／PIN 或 DPAPI 跨使用者驗證。員工 Windows 安裝來源仍是固定 v0.1.16 prerelease／受保護 installer。
2. 首頁可見 `Amazon 已連線`、Live 7 天 Sales、品牌／品類切換與「狀態收斂進度」。品牌 report 在驗證截圖時仍為整理中；品牌／品類共用 snapshot、cache fence 與 A→B→A 只建兩份不同日期 report 是測試證據，尚未取得 v0.1.15 真實八類分類數值，不得冒充 live 完成。
3. v0.1.14 的真實 US 6 個月 Subscribe & Save 已證明單列問題可隔離、其他 offer 繼續；它只能保留為舊版歷史快照，不能自動證明 v0.1.15 的新篩選、全站／SKU 折線或五張正常表加一張問題表。這些仍待 6／12／23 個月追加唯讀重測。
4. 全庫齡層級、AIS tier、評論首頁背景 observer、長 variation family、滑板動畫、36×36 關閉控制與健檢狀態 pill 已通過 production build、測試與 1280px／390px 假 Bridge 視覺驗收；不能以 mock 數值冒充 live Amazon。
5. 評論負向數值必須保持原始負號並標示為 impact；公開 API 仍不提供商品總星等、總評論數或完整 review 全文。v0.1.12 的 23,765 件品牌出貨、257 個 non-parent review candidates，以及 v0.1.14 的 S&S aggregate 都只是各自時間點快照，不得當作恆定現值。
6. 文案健檢 Excel rich-text 紅字、變體 family 分頁、同檔回傳、24 小時 hash-only evidence、整批零寫入 preview 與「立刻修改」的 fresh read／stale fallback 已通過本機／CI／LibreOffice 測試；真實 Amazon 文案批次 mutation 與 Windows Hello 實機確認仍未執行。商品內容、圖片、價格、Sale Price 與 Variation 不得因本次發布自動寫入。
7. 報表文件庫列的是 109 個官方公開 report types 與能力說明，不代表 App 已建立 109 種通用下載器；廣告策略 Reporting v3 已接線但尚未設定真實 Ads LWA，既有廣告覆蓋 Live Ads API 也未因此自動完成，FBA 帳務中心未接線能力仍須保持 unavailable／plan-only。
8. 目前仍是內部測試 App：Mac 為 ad-hoc、尚無 Apple Developer ID 簽章／公證；Windows fixed prerelease 為 unsigned、尚無 publisher-bound Authenticode，SmartScreen 可能警告且 in-app updater 已停用。所有新增驗證必須保持 FBA-only、唯讀，且不得使用 Seller Central 私有接口。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- v0.1.3 與修正 Merchant Token 前的 v0.1.4 候選版，真實 Listings probe／單一 SKU 均回 HTTP 400；Amazon Request ID 已保留於本機診斷紀錄。
- 已對照 Amazon 官方文件，完整與最小 `getListingsItem` 參數組合均合法；更新成同一授權帳號的正確 Merchant Token 後，probe 與 `AFA12AM` 商品內容皆成功，故此次 400 根因已確認為帳號識別值不一致。
- SKU 指揮中心曾在 Seller Central 明確有 FBA 庫存時誤報找不到 SKU；根因已確認是程式把官方 `payload.inventorySummaries` 錯讀成頂層 `inventorySummaries`，不是 LWA、Merchant Token 或 SKU 錯誤。
- 不應重建整個 Amazon App，也不應要求使用者輪替或公開 Secret。

---

## 6. 目前安裝檔

- v0.1.20 main macOS workflow run：`32561974803`；artifact：`9473081924`，名稱 `AMZ.API-unsigned-7425b8e49e027028efdfac6b101bb8d7480e5b02`；GitHub metadata digest：`sha256:fb5c205b7f23b1fa18f8075f51db72ec6ba7c04b8d1f711fe3b34321a4322757`。DMG 為 `AMZ.API-0.1.20-universal.dmg`（246,861,081 bytes；SHA-256 `89e3e1aa35e6878018aa09c06ec80e22eb369d4be418aacc0fc71aafa6c4e9d4`）；ZIP 為 `AMZ.API-0.1.20-universal.zip`（221,569,042 bytes；SHA-256 `8228d8a735a24af5b613d6defbe2c2b31b56e12b9393f6b4a3e44cbc22551009`）；`SHA256SUMS.txt` SHA-256 為 `fa5e91e6b1ad85bceb7fbf289e0c6644e17a59b36eb58df2d89d78e671f728c9`。
- 目前 `/Applications/AMZ.API.app` 是 v0.1.20 universal 內部測試 App；版本／build、bundle ID、executable、雙架構與 deep strict ad-hoc codesign 均在唯讀 DMG 與安裝後核對。v0.1.19 保留為 `/Applications/AMZ.API-v0.1.19-backup.app`；Keychain vault 保留、不需重輸密鑰，App 內顯示 `Amazon 已連線` 與版本 0.1.20，沒有 crash dialog。DMG 已安全卸載。
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

- v0.1.17 發布 main commit 為 `ef5bd04a8c87bf51743fe72e95e3a59073f14b4f`，對應 PR #41、Pages、macOS artifact與 main Windows CI；固定員工 Windows prerelease 仍是 v0.1.16。開始新工作前仍須 `git fetch origin` 並核對 merge base，不得把本機 `out/` 或未受信任 PR artifact 誤認成已發布 App；本機 `main` 若尚未 fast-forward，也不得直接從舊 local `main` 建立新分支。
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

v0.1.20 已發布、安裝且 Keychain vault 保留；入庫商品官方續頁與 7-sheet Excel 已完成單次真實 US 30 天唯讀驗證。下一步先處理 Amazon Ads 獨立 LWA／Reporting v3 的使用者側設定與 live 驗證，再另行處理 v0.1.16 Windows 11 Pro 員工裝置的人機驗證。不要在 Mac 反覆開 Chrome 冒充 Windows 驗證，不要清除既有 Mac Keychain vault，也不要做任何真實 Amazon 寫入：

### A. v0.1.20 廣告策略 live 待辦

1. Amazon Ads 獨立 LWA 尚未設定；先用 main-owned 本機安全 editor 完成 Ads LWA 與 US profile 驗證，不得把 Secret 或 profile ID 放入聊天／Pages。之後才用最近 30 個完整日核對 FBA SKU、Sales & Traffic、SP 實際花費／14 日歸因銷售／購買次數、實際 ACoS、花費排名與 T1–T4。
2. 廣告策略缺報表列必須保持「未回報」，不得補 0；價格、SB／SD 策略與規格保持人工欄位。下載後核對三張工作表與 29 欄、分開來源時間；關閉 drawer 再重開只能 GET 接回同一 job。只有第一次真實 Reporting v3 成功後才能標成已驗證。

### B. Windows 11 Pro x64 實機驗證

1. 只從固定 `notebook-key-windows` prerelease 下載 EXE 或 ZIP；安裝前依 `SHA256SUMS.txt` 核對 SHA-256。不要改抓 PR／fork／過期 Actions artifact。
2. 在一台員工 Windows 11 Pro x64 筆電核對 SmartScreen 警告、NSIS 安裝／移除、版本 0.1.16、Notebook Key Bridge ready、WebGate 開啟與一般瀏覽器無 Bridge 的鎖定狀態。Windows unsigned 版不得啟用 in-app updater。
3. 使用 main-owned 本機安全 editor；不得把 Client Secret、Refresh Token 或完整 Seller ID 貼到聊天、Pages 或瀏覽器。核對保存後 renderer 只看到 redacted status，另一個 Windows 使用者不能解密原使用者的 DPAPI vault。
4. 以 Windows Hello 實測成功、取消、未設定／不可用與 Windows 提供的 PIN fallback；記錄的只能是通過／拒絕與安全錯誤碼，不得記錄生物特徵種類或憑證。測試停在敏感操作授權邊界，不執行 Amazon mutation。
5. CI 已證明 addon 可載入、HWND 屬於目前程序且三種 package 可啟動；它沒有證明實際指紋／臉部／PIN UI。只有上述實機矩陣完成後，才能把 Windows Notebook Key 標為已完成員工驗收。

### C. 接回目前 Mac App

1. 目前執行中的是 exact main artifact v0.1.20；Keychain vault 已保留且不需重輸。曾崩潰的是手工重包的臨時 canary，不是正式 artifact；不要再開該臨時 App，也不要因短暫載入較慢而反覆重啟或建立相同 Amazon report。
2. 首頁 exact 版本、Amazon 已連線與 Live US 7 天 Sales 已核對。需要追加證據時使用既有 durable job／cache，避免按 terminal retry 或盲目重建。

### D. 依序完成 v0.1.15 新功能的真實唯讀證據

1. 品牌／品類：在同一日期範圍先看品牌、切至品類、再切回品牌；核對總額不變、八個品類依 Supply 最早關鍵字規則分類、未命中歸「其他」，且 main 沒有為回到品牌另建相同 report。範圍含站點今天時核對 `dataThrough`，不得把當天未完成資料冒充完整日。
2. Subscribe & Save：先用 6 個月核對「全部／0／5／10／15／20／有問題」篩選、正常卡片欄位、預設全站折線、選取 SKU、取消或重選同 SKU 返回全站；問題 SKU 只能出現在問題範圍，未知折扣不得進 0%。
3. Subscribe & Save Excel：核對 0／5／10／15／20% 五張無問題折扣表與獨立「問題 SKU」表。再視需要追加 12／23 個月；缺月、unknown discount、部分 coverage 與無法安全輸出 identifier 的範圍必須保持原樣，不得補 0 或顯示假的全站總額。
4. 首頁健檢狀態：核對成功、部分完成、失敗與未執行的外卡片狀態清楚；「狀態收斂進度」只表示步驟已結束，不得把全部失敗顯示為成功。
5. 追加核對全庫齡層級與 AIS tier 的真實 US report、評論 drawer 關閉後首頁進度，以及長 variation family 的實際內容；只做唯讀，不進 Preview／Touch ID／commit。

### E. 其餘既有唯讀矩陣

1. 評論主題：接回既有 job 後關閉 drawer，等待背景進度增加再重開；負數必須顯示為「負向影響值」且明示不是商品負星等。核對 parent 排除、child＋standalone non-parent 與六張 Excel。
2. 未綁變體：完成批次掃描與 Excel，確認缺 relationships／站點或 ASIN 衝突列為未完成；Seller SKU／ASIN family 查詢只做唯讀，結果都要顯示 exact Seller SKU。
3. 文案：核對 Excel 疑似錯字片段為紅字；以一個有問題欄位測「立刻修改」fresh read 與 stale fallback，只能走到 Amazon Validation Preview，未獲另行授權不得 commit。
4. 報表文件庫：核對 109 個官方 report types 的分類、說明與「已接線／尚未接線／不適用」狀態。文件列出不等於 App 已能下載全部 109 種。

### F. 若某一 endpoint 失敗

依 endpoint 分開診斷，不把所有失敗歸因於「API 沒串好」：文案／圖片／variation 看 Listings Items 與 PTD；FBA 庫存看 FBA Inventory；訂閱省看 Replenishment；品牌／品類／評論／Excel／健檢／庫齡看 Reports、Customer Feedback 與 Listings enrichment；會計先分辨 Finances JSON、FBA report、Amazon-generated report、人工前置與 unavailable。保留錯誤 code、Amazon message、Request ID、App version 與 marketplace，但不得記錄或輸出 Secret、Refresh Token 或完整 Seller ID。

---

## 11. 完成定義

只有適用平台與 Amazon 範圍的下列條件都成立，才能向使用者宣稱「已串好」：

- Notebook Key 顯示正確版本；Windows 版必須另在真實 Windows 11 Pro x64 完成安裝、Bridge、DPAPI 與 Windows Hello 成功／取消／不可用／PIN fallback 人工驗證，不能拿 CI 或 Mac 測試代替。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂 1–365 天與去年同期 AFN 銷售趨勢完整載入。
- 180 天以上 FBA 庫齡報表能唯讀載入，庫齡與 Amazon 預估冗餘不混為同一指標。
- 全站文案與圖片健檢能以真實 Amazon FBA 範圍載入，cache／編輯／返回流程正常；Excel 可下載且只含 FBA 商品，全商品工作簿維持既有格式。文案健檢 schema v2 必須含「說明與索引」、已證明的變體 family 分頁、「未綁變體」與 fail-closed「資料未完成」，並保留原始／更新欄、問題顏色與「類型／說明」。
- 回傳文案健檢 Excel 時，無變更、篡改、過期、跨站點／帳號、公式／巨集／外部連結與任何 SKU 預檢失敗都必須在第一筆 Amazon PATCH 前停止；通過後一次 native confirmation 只授權該 main-owned batch，逐 SKU ledger／readback 與遇不明停止後續不得放寬。
- Subscribe & Save 全站健檢能以完整 FBA Inventory 分頁證明 SKU，正確顯示目前有效訂閱、最多 23 個已完成月份與缺月；開啟顯示全站歷史並能切換／取消單一 SKU。Excel 必須產生 0／5／10／15／20% 五張無問題工作表與獨立「問題 SKU」工作表；未知折扣、問題列與缺值不得冒充 0 或完整總額。
- FBA 冗餘庫存只依 Amazon `estimated excess quantity`，庫齡不會被列為冗餘；storage cost／AIS 缺值不會產生假的 0 或部分全站總額。
- 未綁變體健檢能以真實 FBA relationships fail closed 載入並匯出 Excel；畸形、缺失或被改寫的識別碼不得被列為可安全操作。
- 品牌與品類營收能以同一份、同日期的真實 FBA Customer Shipment Sales report 核對總額；品牌保留未分類列，品類依 Supply 的最早關鍵字規則產生八類，切換不得另建相同 report。含站點今天時必須顯示實際 `dataThrough`；廣告覆蓋在 Ads API 尚未連線時必須維持 unavailable，不能宣稱已有真實 campaign 覆蓋結果。
- FBA 入庫貨件必須以真實 US 30 天背景 job 證明可完成；預期／Amazon 已接收／尚在接收／多接收、完整／部分 coverage、daily/problem-only 三層瑕疵邊界與 7-sheet Excel 均須驗證。安全失敗、空列或 unavailable 不得冒充 0 貨件、0 差異或 0 瑕疵。
- 廣告策略必須以真實 US 最近 30 個完整日證明目前 FBA、Sales & Traffic 與 SP Reporting v3 可完成；T1–T4、缺值不補 0、價格／SB／SD／規格人工欄保持空白，以及 3-sheet／29 欄 Excel 均須驗證。Ads LWA 未設定或 Reporting 未成功時只能標為未驗證。
- 首頁全站健檢外卡片必須區分未執行、執行中、成功、部分完成與失敗；「狀態收斂進度」不得因所有步驟都已結束而把全部失敗冒充成功。
- 會計中心只把公開 capability 與安全 access plan 標為完成；除非日後另行實作並驗證 report lifecycle，不得宣稱已下載報表、一般發票或 Seller Central 帳單。
- Variation family 與 CHILD PTD 必須先通過真實唯讀驗證；目前 mutation 只能標為 mock/demo 已驗證。只有在使用者另行明確授權指定 SKU，且 detach 與 attach 各自完成 preview、Touch ID、單次 PATCH 與唯讀回查後，才可對該次操作宣稱真實寫入成功。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID／Windows Hello。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在各 Notebook Key 的本機加密 vault：macOS Keychain 或目前 Windows 使用者的 DPAPI，不進 Pages、renderer、GitHub、日誌或回覆。
