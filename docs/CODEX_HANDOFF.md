# AMZ.API — Codex 專案交接入口

最後更新：2026-08-09
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前狀態：`v0.1.10` 開發候選位於 `agent/v0110-dashboard-audits`，起點為 `origin/main` commit `1c908f01a71ab480869e49fdc9d73361a2c0a39c`。尚未建立 PR、合併、部署 Pages、產生 universal artifact 或覆蓋安裝；`/Applications/AMZ.API.app` 仍是已發布的 v0.1.9，v0.1.8 已備份。v0.1.10 已通過本機自動／假資料驗證，但所有新 Amazon 資料流程仍待真實 Mac 唯讀驗證，變體寫入未獲授權且不得測試
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
  - 健檢 Excel 改成唯一「內容健檢」工作表，最後兩欄為「類型／說明」；既有全商品 Excel 仍維持原格式。
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
- v0.1.10 開發候選已完成，但尚未發布或安裝：
  - 首頁改為三個置中頂部選單「產品區／價格區／營運區」，只保留近期 FBA 銷售、同日期品牌營收與五個一鍵健檢入口；Mac 安全連線整合至右上角。字級偏好只放大文字、不縮放卡片或控制項；390px 大字級沒有整頁水平溢出。
  - 連線證據分成「Live 憑證已設定／尚未驗證」與同站點成功 API read 後的「Amazon 已連線」；System Health 只核對本機設定，不再把已設定憑證冒充即時連線成功。
  - 圖片健檢新增與同次掃描 snapshot 綁定的 Excel：唯一 export ID 同時綁 account scope、marketplace 與短效結果，下載不重跑整站 Listings；工作簿分為「圖片健檢」與「範圍與狀態說明」，讀取未完成不填假圖片數。
  - Subscribe & Save 對缺 Seller SKU／缺 offer／缺月份採 fail closed；保留已證明 FBA、可核對 offer 與未回 offer 的精確範圍，未知不推論為 0 訂閱或不符合資格。來源不完整時只顯示已核對值並讓營收總額保持空白；Excel 同步明示部分範圍。
  - 冗餘庫存健檢只依 Amazon `estimated excess quantity`，不以庫齡判斷冗餘；完整庫齡仍可另行查看。倉儲成本或 AIS 空值只有在對應官方數量為 0 時才能當 0，其餘維持 partial／unavailable，不套自訂費率。
  - Variation 改掛置於工具頂端，解除舊 parent 與加入新 parent 明確分成兩階段；attach 必須由 relationships 與 attributes 同時證明已 standalone，detach 回查也必須核對 normalized relationships。相同 idempotency key 可 replay，新的操作 key 不會誤用 24 小時內舊完成結果；正式 PATCH 的 401／429／transport 不自動重送。
  - 新增全站未綁變體健檢與 Excel；只有完整且格式正確的 Amazon relationships 明確沒有 parent 才列入，畸形列、空白或被改寫的 Seller SKU 一律停止／列為未完成。
  - 新增品牌營收甜甜圈：依所選銷售日期讀官方 FBA Customer Shipment Sales report，固定品牌顏色、保留未分類 FBA 出貨列，滑鼠／鍵盤顯示金額與占比；renderer 不跨帳號快取。新增廣告覆蓋能力頁，只接受符合 ProductAI 命名的 ENABLED Sponsored Products 證據，以 SKU 優先、同 ASIN 補充；Live 尚未連接 Ads API 時固定停止並不顯示推測結果。
  - 會計入口移至營運頂部導覽並改稱 FBA 帳務中心；一般站點不顯示 Brazil/V2 能力。Fee Preview 只收至少早於 request NOW 72 小時的開始時間，結束時間由 main 固定為當下；目前仍只有公開能力與安全規劃，沒有真正下載會計報表。
  - 本機最新驗證為 53 個測試檔、300 tests、TypeScript 與 production build 全通過；`npm audit --omit=dev`、`git diff --check`、試算表實際匯入／render 與 Playwright 1440px／390px 大字級均通過。沒有呼叫真實 Amazon、沒有加入 FBM，也沒有讀取或輸出 Secret、Refresh Token 或完整 Seller ID。

### 已完成與仍待真實 Mac／Amazon 驗證

Listings 帳號識別根因與 v0.1.8 的 `AFA12AM` 文案／價格／促銷／FBA 庫存唯讀、Excel、AFN 銷售趨勢已有真實驗證紀錄。v0.1.9 的 PR、Pages、artifact 與 Mac 安裝已完成；v0.1.10 則只有未提交工作樹、本機自動測試、假資料瀏覽器與試算表驗證，不能取代下列真實 Amazon 驗證：

1. 先建立並審查 v0.1.10 PR；只有 main Validate、單一 Pages deployment、live hashed assets、universal artifact、舊 v0.1.9 備份與 v0.1.10 安裝都完成後，才能在 App 內進行新功能真實驗證。目前不得把工作樹或本機 `out/` 當成已發布版本。
2. 在真實 Mac 解鎖既有 Keychain vault，確認 Listings／Sales 等同站點 API read 成功；「Live 憑證已設定／尚未驗證」只有成功 read 後才應升級為「Amazon 已連線」。不得要求重新輸入、清除或輸出敏感憑證。
3. 真實 US 帳號唯讀執行全站文案與圖片健檢：核對 FBA SKU 範圍、讀取未完成、快取／編輯／返回，以及圖片 Excel 與畫面為同次 snapshot；不得把 demo rows 當成 live 結果。
4. 唯讀執行 Subscribe & Save：核對完整 FBA Inventory、Replenishment offer 缺列、目前有效訂閱、6／12／23 個完整月份、缺月不補 0、營收 coverage 與五張 Excel；缺 Seller SKU 或 offer 不得被推論為 0／不符合資格。
5. 唯讀請求真實 FBA Inventory Planning report：逐欄核對 estimated excess、所有非重疊庫齡、days of supply、storage cost、AIS 與 Excel；庫齡不能冒充冗餘，近效期／已過期也不是公開欄位可證明的功能。
6. 唯讀執行未綁變體健檢與 Excel，並查真實 family／CHILD PTD；Variation detach／attach 只有 mock/demo 證據。未獲使用者對明確站點、child SKU、來源 parent 與目標 parent 的另行授權，不得送出任何真實 PATCH；即使獲授權也必須逐階段確認，unknown 結果不得重送。
7. 唯讀同步品牌營收，將日期、總額、品牌分類、未分類 FBA shipment rows 與 Seller Central／官方報表交叉核對。廣告覆蓋目前只完成名稱解析與能力邊界，Live Ads API 未連線，不得把 422、demo 或名稱推論描述成真實投放結果。
8. FBA 帳務中心仍只有公開 capability 與安全 access plan，沒有真正建立、輪詢或下載；不得把 READY 規劃、Brazil/V2 歷史能力或 Seller Central 私有頁面描述成已取得發票／帳單。
9. 商品內容、圖片、價格與 Sale Price 的真實寫入不因 v0.1.10 開發而取得授權；目前仍是 ad-hoc 內部測試流程，Apple Developer ID 簽章／公證與 GitHub Release 尚未決定。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- v0.1.3 與修正 Merchant Token 前的 v0.1.4 候選版，真實 Listings probe／單一 SKU 均回 HTTP 400；Amazon Request ID 已保留於本機診斷紀錄。
- 已對照 Amazon 官方文件，完整與最小 `getListingsItem` 參數組合均合法；更新成同一授權帳號的正確 Merchant Token 後，probe 與 `AFA12AM` 商品內容皆成功，故此次 400 根因已確認為帳號識別值不一致。
- SKU 指揮中心曾在 Seller Central 明確有 FBA 庫存時誤報找不到 SKU；根因已確認是程式把官方 `payload.inventorySummaries` 錯讀成頂層 `inventorySummaries`，不是 LWA、Merchant Token 或 SKU 錯誤。
- 不應重建整個 Amazon App，也不應要求使用者輪替或公開 Secret。

---

## 6. 目前安裝檔

- v0.1.10 尚未建立 artifact 或安裝；不得覆蓋目前 App。下一次安裝前先備份現有 v0.1.9，並從成功的 main macOS workflow artifact 核對版本、checksum、架構與 codesign。
- 目前 `/Applications/AMZ.API.app` 是已發布的 v0.1.9 universal 內部測試 App；版本 `0.1.9`、bundle ID `com.jspusa.amz-api`、`x86_64`／`arm64` 與 deep strict codesign 均已在安裝後再次核對。
- v0.1.8 原封不動保留為 `/Applications/AMZ.API-v0.1.8-backup.app`；v0.1.7／v0.1.6／v0.1.5／v0.1.4／v0.1.3 舊備份若仍存在也不得在未核對版本前覆蓋。
- v0.1.9 main macOS workflow run：`31249715993`；artifact：`9019652910`，名稱 `AMZ.API-unsigned-3fa27e165a42a441be67abb44e5fcfcc37d264bc`；GitHub artifact digest：`sha256:d66863e149c0ab6a1c65394bb9dbcd93ebe58051bdff7c802613272e38fa0ce9`（短期保存至 2026-08-22）。DMG SHA-256：`7e74d7ba0dd31ce2a7ea7a795cb1a6b4f88ee922f847383a962fdae51f5d052c`；ZIP SHA-256：`d543b790527b13cc6b4836757bf9297405d37a24d961571be3e45cac931a9cbc`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
- v0.1.7 main macOS workflow run：`31098122782`；artifact：`8966405377`，名稱 `AMZ.API-unsigned-a9a9468cdfb42ae4d1e0e1b268027bf9ca7220a0`；GitHub artifact digest：`sha256:bf5c4a9cf79a59a8abc11ce25cf0db31bbe9c8c846316f7fc268969f49b370cf`（短期保存至 2026-08-20）。DMG SHA-256：`550cc0ed24f69f8661aed372f22ca22ac6f88ed9d8acb79d2af5573cc9ba2de3`；ZIP SHA-256：`c6ebda5b1631ee2d80058734667ef1a5a7b2ab6128edb463a883098198156609`；均與 artifact 內的 `SHA256SUMS.txt` 一致。
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

- 本次 v0.1.10 開發分支 `agent/v0110-dashboard-audits` 起點是 `origin/main` 的 `1c908f01a71ab480869e49fdc9d73361a2c0a39c`；開始新工作時仍須重新 `git fetch origin`，不要用舊本機分支覆蓋更新後的遠端。
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

先審查、發布與安裝 v0.1.10，再逐項做真實唯讀驗證；不要再擴充功能，也不要先做真實 variation 寫入：

### A. 先完成可追溯發布

1. 完整審查 `agent/v0110-dashboard-audits` 對 `origin/main@1c908f0` 的差異，確認最新 `npm run check`、`npm audit --omit=dev`、`git diff --check` 與敏感資料掃描皆通過，再建立 PR；不得繞過既定 Actions／Pages／universal Mac workflow。
2. 合併後等待同一 main SHA 的 Validate、單一 Pages deployment 與 macOS artifact。Pages build/upload 成功不等於 live deployment；必須核對 live HTML 的 hashed JS／CSS。不要對仍在排隊的 deployment 重複 dispatch。
3. 核對 artifact checksum、版本 `0.1.10`、bundle ID、`arm64`／`x86_64` 與 deep strict codesign；備份現有 v0.1.9 後再安裝，不能直接使用本機開發 build 覆蓋 `/Applications/AMZ.API.app`。

### B. 真實唯讀與負向驗證

1. 由使用者解鎖 macOS Keychain 後只重試既有 vault；確認同站點 Listings／Sales read 成功與連線徽章升級，再依第 5 節重測文案、圖片 snapshot Excel、S&S coverage、冗餘／庫齡費用、未綁變體、品牌營收與會計 capability。不得清除憑證，也不得要求或輸出 LWA Client Secret、Refresh Token 或完整 Seller ID。
2. Variation 只做 family／CHILD PTD 唯讀與 Touch ID 取消／拒絕；確認取消後沒有 Amazon PATCH 或 completed ledger。未獲使用者另行明確授權不得測真實 detach／attach。
3. 廣告覆蓋 Live 目前應誠實停止於 Ads API 未連線；會計中心只核對公開能力與 access plan。不得把 422、demo、READY state 或規劃按鈕回報成已取得廣告、報表、發票或帳單。

### C. 若某一 endpoint 失敗

依 endpoint 分開診斷，不把所有失敗歸因於「API 沒串好」：文案／圖片／variation 看 Listings Items 與 PTD；FBA 庫存看 FBA Inventory；訂閱省看 Replenishment；Excel／健檢／庫齡看 Reports 與 Listings enrichment；會計先分辨 Finances JSON、FBA report、Amazon-generated report、人工前置與 unavailable。保留錯誤 code、Amazon message、Request ID、App version 與 marketplace，但不得記錄或輸出 Secret、Refresh Token 或完整 Seller ID。

---

## 11. 完成定義

只有以下條件都成立，才能向使用者宣稱「已串好」：

- Mac App 顯示正確新版本。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂 1–365 天與去年同期 AFN 銷售趨勢完整載入。
- 180 天以上 FBA 庫齡報表能唯讀載入，庫齡與 Amazon 預估冗餘不混為同一指標。
- 全站文案與圖片健檢能以真實 Amazon FBA 範圍載入，cache／編輯／返回流程正常；Excel 可下載且只含 FBA 商品，全商品工作簿維持既有格式，文案健檢工作簿只有一張「內容健檢」表並含「類型／說明」。
- Subscribe & Save 全站健檢能以完整 FBA Inventory 分頁證明 SKU，正確顯示目前有效訂閱、最多 23 個已完成月份與缺月，並產生 0／5／10／15／20% 五張 Excel 工作表。
- FBA 冗餘庫存只依 Amazon `estimated excess quantity`，庫齡不會被列為冗餘；storage cost／AIS 缺值不會產生假的 0 或部分全站總額。
- 未綁變體健檢能以真實 FBA relationships fail closed 載入並匯出 Excel；畸形、缺失或被改寫的識別碼不得被列為可安全操作。
- 品牌營收能以所選日期的真實 FBA Customer Shipment Sales report 核對總額、分類與未分類列；廣告覆蓋在 Ads API 尚未連線時必須維持 unavailable，不能宣稱已有真實 campaign 覆蓋結果。
- 會計中心只把公開 capability 與安全 access plan 標為完成；除非日後另行實作並驗證 report lifecycle，不得宣稱已下載報表、一般發票或 Seller Central 帳單。
- Variation family 與 CHILD PTD 必須先通過真實唯讀驗證；目前 mutation 只能標為 mock/demo 已驗證。只有在使用者另行明確授權指定 SKU，且 detach 與 attach 各自完成 preview、Touch ID、單次 PATCH 與唯讀回查後，才可對該次操作宣稱真實寫入成功。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在使用者 Mac 的加密 vault。
