# AMZ.API — Codex 專案交接入口

最後更新：2026-08-05  
Repository：`https://github.com/jspusa/AMZ.API`  
GitHub Pages：`https://jspusa.github.io/AMZ.API/`  
目前版本：`v0.1.3`  
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
- PR #1 已 squash merge 到 `main`。
- 合併 commit：`c03514c53c537c4a44cf367b4783a62c45f06e08`。
- GitHub Actions：Validate、Pages、macOS universal build 均成功。
- 本機驗證：14/14 tests、TypeScript、main/preload/renderer build、`npm audit --omit=dev` 0 vulnerabilities。

### 仍待使用者在真實 Mac／Amazon 帳號驗證

使用者尚未回報 v0.1.3 的新連線測試結果。下一步不是再改程式，而是：

1. 安裝 v0.1.3，完全關閉舊 App 後取代。
2. 打開「Mac 安全連線」，確認 footer 顯示 v0.1.3。
3. 按「重新測試」。
4. 若顯示 `Orders 與 Listings 連線成功`：先測單一 SKU `AFA12AM` 的文案只讀查詢，再測 Excel。
5. 若顯示 `Listings 驗證失敗`：優先核對 NA Seller ID 與 Product Listing role／重新 self-authorize；不要叫使用者重填或公開 Secret。

### 最近的真實錯誤

- 症狀：Orders 可讀，但文案、價格、促銷與 Excel 曾回 `Invalid parameters provided.`
- 最近 Excel Request ID：`c8907d99-12e1-4d62-8766-e6c31e0df848`
- 判斷：可能是先前單一／批次 Listings 參數，也可能是 Seller ID／Listing 授權不匹配。v0.1.3 的 Listings probe 用來把這兩類問題與 Orders 成功分開。
- 不應在未取得 v0.1.3 probe 結果前，武斷要求重建整個 Amazon App。

---

## 6. 目前安裝檔

- Library 最新檔名：`AMZ.API-0.1.3-universal.dmg`
- GitHub Actions workflow run：`31005573903`
- Artifact：`8930318161`（短期保存，可能到期）
- DMG SHA-256：`12c709019558d2060e88a9f8af33d121040af3ae80a56748a1cc41c5769ea232`
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

- 先確認遠端 `main` 是否仍以 `c03514c...` 或更新 commit 為首；不要用舊本機分支覆蓋遠端。
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

等待使用者貼上 v0.1.3「重新測試」結果：

### A. Orders 與 Listings 皆成功

1. 查 `AFA12AM` 文案。
2. 查價格／促銷。
3. 測 Excel 匯出。
4. 若只讀均通過，再選低風險 SKU 測一次 Validation Preview；未經使用者明確確認，不執行真實價格或文案寫入。

### B. Listings probe 仍回 400

1. 記錄錯誤 code、Amazon message、Request ID、App version、marketplace；不得記錄 Secret。
2. 檢查使用者填的是正確 NA Seller ID／Merchant Token，而不是 Marketplace ID、Application ID 或不同帳戶 ID。
3. 確認 Product Listing role 同時存在於 Developer Profile 與 App，角色更新後重新 self-authorize。
4. 若 Seller ID 與 role 均確認正確，使用 Request ID 向 Amazon Developer Support 查詢；不要繼續猜測或輪替所有金鑰。

### C. Listings probe 成功但某一功能失敗

依 endpoint 分開診斷，不再把所有失敗歸因於「API 沒串好」：

- 文案／圖片／價促：Listings Items API 與 Product Type Definitions。
- FBA 庫存：FBA Inventory API。
- 訂閱省：Replenishment API，能力可能只讀。
- Excel：Reports API → report document → Listings enrichment。
- 廣告：Amazon Ads API，與 SP-API 是不同授權。

---

## 11. 完成定義

只有以下條件都成立，才能向使用者宣稱「已串好」：

- Mac App 顯示正確新版本。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- Excel 可下載，且只含 FBA 商品；錯誤／缺欄位有清楚工作表或提示。
- 寫入前顯示 canonical diff、通過 Amazon Validation Preview、要求本機確認／Touch ID。
- 寫入後回查；結果不確定時阻止盲目重送。
- Secret 仍只存在使用者 Mac 的加密 vault。

