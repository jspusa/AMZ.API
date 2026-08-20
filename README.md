# AMZ.API

JSPUSA 的 GitHub 控制台＋macOS／Windows 11 本機 Notebook Key Amazon 營運系統。只處理 FBA，不提供任何 FBM 入口。

這個 repository 會產生兩個成品：

1. `src/renderer/`：由 GitHub Actions 部署到 GitHub Pages 的主控制台。
2. `src/main/`、`src/preload/`：保存憑證並執行 Amazon SP-API 的 macOS／Windows Notebook Key Bridge。

一般瀏覽器開啟 GitHub Pages 時只顯示鎖定頁；按「開啟 Notebook Key」會呼叫 `amz-api://launch`。Desktop App 以自己的安全視窗載入同一套 GitHub 最新介面，並只對精確的 `https://jspusa.github.io/AMZ.API/` 文件提供本機 Bridge。API Secret 永遠不傳到 GitHub。

## 已整合功能

| 區域 | 功能 | 自動化程度 |
|---|---|---|
| 策劃 | FBA 銷售趨勢（7／14／30／90 天、自訂 1–365 天、去年同期、選配迷你滑板）、SB／SD 授權狀態、FBA 補貨計算 | 自動／人工授權 |
| 策劃 | 依所選日期自動載入 FBA shipment report，以目前 Listing 標題前綴分類品牌營收與未分類列 | Amazon 報表唯讀 |
| 策劃 | 全部 FBA 非重疊庫齡桶、Amazon 預估冗餘、下月倉儲成本與 AIS 預估附加費、Excel | Amazon 報表唯讀 |
| 產品 | SKU 查詢、標題、五大賣點、成分、Amazon 預檢與寫入 | 一鍵＋Touch ID／Windows Hello／系統確認 |
| 產品 | 全站 FBA 文案健檢（疑似錯字紅字定位、不可見字元位置、賣點不足、可證明適用的缺成分／成分未驗證、Excel 內紅字片段、只開啟有問題欄位的立刻修改） | Amazon 唯讀＋GitHub Pages 版本化美式英文辭典與 catalog 合法字詞表（Mac／Windows 一致） |
| 產品 | 拖拉圖片、格式／像素檢查、排序、選配自有 R2 上傳、Amazon 回查 | 自動檢查＋一鍵 |
| 產品 | 全站 FBA 圖片健檢（少於五張與讀取未完成分開標示、結果保留並可返回） | Amazon 唯讀 |
| 產品 | 全商品標題、五大賣點、成分匯出 Excel | 一鍵 |
| 產品 | 雙 Family 並排、FBA child 拖拉改掛、CHILD PTD 動態欄位 | 兩階段預檢＋本機身分確認＋回查 |
| 產品 | 全站未綁變體健檢（Listings relationships 每批最多 20 SKU、缺值／歧義 fail closed、Excel） | Amazon 唯讀 |
| 產品 | 非 parent FBA ASIN 評論主題健檢（child＋standalone、排除 parent、前五／後五與全量 Excel） | Amazon Customer Feedback 唯讀 |
| 價格 | 查價、上下限、舊值衝突、20% 大幅變動防呆、調價 | 一鍵＋本機身分確認 |
| 價格 | Listing Sale Price（SKU 限時售價）建立／取消 | 一鍵＋本機身分確認 |
| 價格 | 官方支援站點的全站 FBA Subscribe & Save 價格、折扣、目前有效訂閱、最多 23 個完整月趨勢與五分頁 Excel；具同次 current-FBA 證據的無效／重複 offer 或月度 SKU 獨立列為未完成，不拖垮其餘正常 SKU；未證明識別值只保留聚合計數 | 自動讀取；來源不完整時只顯示已核對範圍；SG／AU 顯示不支援邊界 |
| 促銷 | Coupon、S&S 管理與 Amazon Ads 集中於「Amazon 官方完成」 | 一鍵開啟、Amazon 內完成 |
| 營運 | Amazon Ads Profile 自動發現、Sponsored Products 活動唯讀查詢與全站 FBA 廣告覆蓋健檢；任何 Listing 身分缺口都整次停止 | 獨立 Ads LWA＋唯讀；無 Ads 寫入 route |
| 報表 | 文件庫列出 Amazon 官方 109 個唯一公開 report types、用途、角色、FBA 邊界與 App 接線狀態；Vendor 類型不顯示，並可依可用性快速篩選 | 公開文件＋唯讀規劃 |
| 健檢 | 首頁一鍵在 Desktop main process 背景執行訂閱、180+ 庫齡／預估冗餘、內容結構、圖片、未綁變體、評論主題與廣告覆蓋七項健檢；完成／部分完成可匯出十張工作表的同次快照 | 全部唯讀；各項失敗互不冒充成功 |
| 系統 | 作業系統安全儲存密文、防重送帳本、預檢票證、自我檢查、字級、API 版本更新建議、公開會計 API 能力與安全下載規劃 | 自動／能力邊界 |

能力邊界：目前 Amazon SP-API 可安全寫入 Listing 價格、Sale Price、文案、圖片，以及既有 FBA child 的 variation 關係。變體改掛不是原子操作，固定拆成「解除舊 parent」與「加入新 parent」兩階段；每階段都重新讀取、Amazon Validation Preview、本機身分確認、持久化防重送、單次 PATCH 與唯讀回查，任何不確定狀態都禁止直接重送。S&S 啟用／折扣、Coupon 建立及 SB／SD 正式開啟仍需要獨立資格、Ads API 或 Seller Central 人工確認。

Amazon 公開 API 目前不提供現有 FBA FC 庫存的逐 SKU／批次效期，因此 App 不會拿庫齡冒充近效期或已過期清單。一般 US／CA／JP／SG／AU／UK／DE 發票與 Seller Central 帳單也沒有通用公開下載 API；會計中心只啟用可證明為 FBA 的公開報表，Finances JSON、結算報表、人工前置與不可用能力會分開標示，不使用 Seller Central 私有接口。

Customer Feedback API 提供的是每週更新的正／負「評論主題影響值」（`starRatingImpact`），不是商品總星等、1–5 星制、總評論數或完整 review 全文。負值表示負向主題對星等下降方向的影響，不是「商品負星等」；App 保留 Amazon 原始正負號，不改成 0 或絕對值。評論健檢只對 Listings relationships 已證明為 child 或 standalone 的 FBA ASIN 排序主題；不會拿 parent 容器或推測值冒充商品評論排名。

## 第一次使用

1. 前往 [AMZ.API Notebook Key 安全下載頁](https://supply-boss.brave-prawn-0848.chatgpt.site/downloads)，通過內部密碼驗證後下載 Mac `.dmg`，或 Windows 11 Pro x64 的 NSIS installer／解壓即用 ZIP。安裝檔保存在私有 R2，不使用公開 GitHub Release 直連；GitHub Pages 也不包含密碼或真實檔案網址。
2. 目前 Windows artifact 是內部未簽章版；Windows SmartScreen 會顯示發行者未知警告。請只從上述安全下載頁取得並核對頁面提供的 SHA-256，不要從 PR 的測試結果下載，也不要關閉全系統 SmartScreen 來繞過警告。
3. 開啟 App，按右上角「Notebook Key 安全連線」，再開啟本機 SP-API 安全輸入。敏感欄位會在 main process 建立的本機 sheet 中開啟，不會進入 GitHub Pages renderer。
4. 在本機 sheet 輸入 Private Seller App 的：
   - LWA Client ID
   - LWA Client Secret
   - 各使用區域的 Refresh Token
   - 各區域 Seller ID / Merchant Token
5. macOS 使用 Touch ID；Windows 11 使用 Windows Hello（指紋／臉部／PIN 由 Windows 決定）。Windows Hello 未設定、取消或失敗時會停止敏感操作，不會降級成一般按鈕放行。
6. 在頂端輸入 Seller SKU，直接進入文案、圖片、定價、促銷或補貨。

SP-API 不是單一 API Key。北美（US／CA）、遠東（JP／SG／AU）、歐洲（UK／DE）各自使用區域 Refresh Token 與 Seller ID；同一個 LWA Client 可共用。

目前每個區域保存一組 Selling Partner 授權；只有同一 Seller authorization 實際涵蓋的 marketplaces 才能共用。若 JP、SG、AU 是不同 Seller accounts，v0.1 不會把它們合併成同一個遠東設定，未授權站點會由 Amazon 拒絕。

圖片要交給 Amazon 下載，必須有公開 HTTPS URL。App 可以：

- 直接貼現有 CDN 圖片 URL；或
- 在「Notebook Key 安全連線」輸入你自己的 Cloudflare R2 S3 credentials、bucket 與 public base URL。R2 Secret 同樣只存在作業系統安全儲存區。

## 憑證保存位置

- Secret 經 Electron `safeStorage` 的作業系統金鑰保護後，才寫入 App 的 `userData/credentials.enc`；macOS 使用 Keychain，Windows 使用當前登入使用者的 DPAPI。
- Amazon Ads 使用獨立 `ads-credentials.enc`；兩種憑證都只在 main process 的無網路本機 sheet 輸入，Pages 只能開啟 sheet、讀取遮罩狀態、測試或清除。
- 完整 Secret 永不回傳 renderer、永不寫入 GitHub、`.env`、URL、localStorage 或日誌。
- Amazon Access Token 只在主程序記憶體中短暫快取。
- 作業系統安全儲存不可用時保存會直接失敗，沒有明文 fallback。Windows DPAPI 保護不同 Windows 使用者之間的存取，不等於隔離同一使用者權限下的其他程式。
- 清除 App 設定不會改動 GitHub 程式；「清除本機憑證」會要求本機確認。

## 防呆流程

Amazon 寫入固定經過：

`讀取舊值 → Amazon Validation Preview → 兩分鐘本機預檢票證 → 必要的 SKU／幅度防呆 → Touch ID／Windows Hello／系統確認 → 再核對舊值 → Idempotency 帳本 → 單次寫入 → 只讀回查`

文案更新在 Validation Preview 後直接跳本機身分確認，不再要求重打 SKU；價格、圖片與 Sale Price 仍保留各自既定的額外防呆。

寫入不會因為 `429`、逾時或 `5xx` 自動重送。真正 PATCH 前的重新讀取／PTD／Validation Preview 若失敗，會明示尚未送出並安全釋放 claim；真正 PATCH 已送或 Amazon 已接受後結果不確定時，帳本才會標記 `unknown` 並阻止同一確認碼重送。

## 開發與驗證

需求：Node.js 24；macOS 用於 Mac App，Windows 11 x64 用於 Notebook Key，Linux 只用於型別／單元／renderer 建置。

```bash
npm ci
npm run dev
```

完整驗證：

```bash
npm run check
```

建立 Mac 安裝檔：

```bash
npm run dist:mac
```

在 Windows x64 上建立未簽章 NSIS installer 與解壓即用 ZIP：

```bash
npm run dist:win
```

Windows build 會用鎖定的 `node-gyp` 與 Electron 43.3.0 x64 headers 編譯第一方 C++ WinRT desktop interop N-API addon，再把 `windows-hello.node` 放在 `app.asar.unpacked` 的固定路徑；`app.asar` 內保存其固定檔名與 SHA-256 manifest，main 載入前會重算 SHA-256。這可偵測打包錯配，但 Windows 未簽章版沒有 macOS 的 embedded ASAR integrity，也不能抵抗同一使用者修改 App 檔案；下載後仍需核對 GitHub `SHA256SUMS.txt`。GitHub-hosted Windows CI 會驗證 addon 編譯、ASAR packed／unpacked 邊界、x64 package、NSIS／ZIP、SHA-256 與無憑證 Bridge smoke；CI runner 不是 Windows 11 Pro 使用者實機，不能冒充 Windows Hello 實際彈窗或生物辨識已通過。

Linux 只能驗證 TypeScript、單元測試與 renderer/main/preload bundle；`.dmg`、簽章、Touch ID、公證必須由 macOS runner 驗證，Windows Hello 必須由 Windows 11 Pro x64 實機驗證。

## 發布與更新

- 推送 `main`：驗證程式、自動部署 GitHub 控制台，並分別建立 macOS universal 與 Windows x64 內部測試 artifact。
- 建立和 `package.json` 完全相同的 tag（例如 `v0.1.0`）：簽章、公證、驗證後發布 GitHub Release。
- macOS 正式更新仍會建立 `.zip`、`latest-mac.yml` 與 `.dmg`；Windows 目前只產生固定檔名的 NSIS `.exe`、手動解壓 ZIP 與 `SHA256SUMS.txt`，尚未建立已簽章自動更新鏈，因此 Windows App 內更新會明確停用。提供給使用者的 Mac／Windows 安裝檔只放在 [Notebook Key 安全下載頁](https://supply-boss.brave-prawn-0848.chatgpt.site/downloads)，通過密碼驗證後下載並核對 SHA-256。
- 未簽章測試版只供內部測試，Gatekeeper 會警告，也不能當正式自動更新來源。
- Windows 內部 artifact 也未做 Authenticode 簽章，SmartScreen 顯示未知發行者是預期邊界；CI 會明確拒絕把它標成已簽章或 Windows Hello 實機通過。

正式 Release 需要 GitHub `mac-release` protected environment 與：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## GitHub Pages

第一次到 `Settings → Pages`，將 Source 選為 **GitHub Actions**。之後 `src/renderer/` 的更新會自動建置與部署，不需要重新下載 Notebook 鑰匙。

## Repository

正式 repository 為 [`jspusa/AMZ.API`](https://github.com/jspusa/AMZ.API)。GitHub Pages 請在 `Settings → Pages` 將 Source 設為 **GitHub Actions**。

更多安全邊界請看 [SECURITY.md](SECURITY.md) 與 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
