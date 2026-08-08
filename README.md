# AMZ.API

JSPUSA 的 GitHub 控制台＋macOS 本機金鑰 Amazon 營運系統。只處理 FBA，不提供任何 FBM 入口。

這個 repository 會產生兩個成品：

1. `src/renderer/`：由 GitHub Actions 部署到 GitHub Pages 的主控制台。
2. `src/main/`、`src/preload/`：保存憑證並執行 Amazon SP-API 的 macOS Key Bridge。

一般瀏覽器開啟 GitHub Pages 時只顯示鎖定頁；按「開啟 Mac 鑰匙」會呼叫 `amz-api://launch`。Mac App 以自己的安全視窗載入同一套 GitHub 最新介面，並只對精確的 `https://jspusa.github.io/AMZ.API/` 文件提供本機 Bridge。API Secret 永遠不傳到 GitHub。

## 已整合功能

| 區域 | 功能 | 自動化程度 |
|---|---|---|
| 策劃 | FBA 銷售趨勢（7／14／30／90 天、自訂 1–365 天、去年同期）、SB／SD 授權狀態、FBA 補貨計算 | 自動／人工授權 |
| 策劃 | 180 天以上 FBA 庫齡、Amazon 預估冗餘與官方 days-of-supply | Amazon 報表唯讀 |
| 產品 | SKU 查詢、標題、五大賣點、成分、Amazon 預檢與寫入 | 一鍵＋Touch ID |
| 產品 | 全站 FBA 內容健檢（疑似錯字紅字定位、不可見字元位置、賣點不足、可證明適用的缺成分／成分未驗證、單表 Excel） | Amazon 唯讀＋Mac 本機檢查 |
| 產品 | 拖拉圖片、格式／像素檢查、排序、選配自有 R2 上傳、Amazon 回查 | 自動檢查＋一鍵 |
| 產品 | 全商品標題、五大賣點、成分匯出 Excel | 一鍵 |
| 產品 | Variation Family 地圖與拖拉規劃 | 唯讀規劃，不寫入 Amazon |
| 價格 | 查價、上下限、舊值衝突、20% 大幅變動防呆、調價 | 一鍵＋Touch ID |
| 價格 | Listing Sale Price（SKU 限時售價）建立／取消 | 一鍵＋Touch ID |
| 價格 | Subscribe & Save 資格、折扣與目前有效訂閱快照 | 自動讀取 |
| 促銷 | Coupon、S&S 管理與 Amazon Ads 集中於「Amazon 官方完成」 | 一鍵開啟、Amazon 內完成 |
| 系統 | Keychain 密文、防重送帳本、預檢票證、自我檢查、更新 | 自動 |

能力邊界：目前 Amazon SP-API 可安全寫入 Listing 價格、Sale Price、文案與圖片；S&S 啟用／折扣、Coupon 建立及 SB／SD 正式開啟仍需要獨立資格、Ads API 或 Seller Central 人工確認。既有 child SKU 改掛新 variation parent 需要非原子的移除與重建，本版只讀取 family 並建立拖拉規劃，不會 DELETE 或改寫 Amazon 關係。介面不會假裝 API 已完成 Amazon 不開放或無法安全原子完成的動作。

## 第一次使用

1. 從 GitHub Releases 下載已簽章的 `.dmg`，拖進「應用程式」。
2. 開啟 App，按右下角「Mac 安全連線」。
3. 輸入 Private Seller App 的：
   - LWA Client ID
   - LWA Client Secret
   - 各使用區域的 Refresh Token
   - 各區域 Seller ID / Merchant Token
4. 用 Touch ID 保存並測試。
5. 在頂端輸入 Seller SKU，直接進入文案、圖片、定價、促銷或補貨。

SP-API 不是單一 API Key。北美（US／CA）、遠東（JP／SG／AU）、歐洲（UK／DE）各自使用區域 Refresh Token 與 Seller ID；同一個 LWA Client 可共用。

目前每個區域保存一組 Selling Partner 授權；只有同一 Seller authorization 實際涵蓋的 marketplaces 才能共用。若 JP、SG、AU 是不同 Seller accounts，v0.1 不會把它們合併成同一個遠東設定，未授權站點會由 Amazon 拒絕。

圖片要交給 Amazon 下載，必須有公開 HTTPS URL。App 可以：

- 直接貼現有 CDN 圖片 URL；或
- 在「Mac 安全連線」輸入你自己的 Cloudflare R2 S3 credentials、bucket 與 public base URL。R2 Secret 同樣只存在 Keychain。

## 憑證保存位置

- Secret 經 Electron `safeStorage`／macOS Keychain 加密後，才寫入 App 的 `userData/credentials.enc`。
- 完整 Secret 永不回傳 renderer、永不寫入 GitHub、`.env`、URL、localStorage 或日誌。
- Amazon Access Token 只在主程序記憶體中短暫快取。
- Keychain 不可用時保存會直接失敗，沒有明文 fallback。
- 清除 App 設定不會改動 GitHub 程式；「清除本機憑證」會要求本機確認。

## 防呆流程

Amazon 寫入固定經過：

`讀取舊值 → Amazon Validation Preview → 兩分鐘本機預檢票證 → 必要的 SKU／幅度防呆 → Touch ID → 再核對舊值 → Idempotency 帳本 → 單次寫入 → 只讀回查`

文案更新在 Validation Preview 後直接跳 Touch ID，不再要求重打 SKU；價格、圖片與 Sale Price 仍保留各自既定的額外防呆。

寫入不會因為 `429`、逾時或 `5xx` 自動重送。結果不確定時帳本會標記 `unknown` 並阻止同一確認碼重送。

## 開發與驗證

需求：Node.js 24、macOS（執行 App）或任何平台（型別／單元／renderer 建置）。

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

Linux 只能驗證 TypeScript、單元測試與 renderer/main/preload bundle；`.dmg`、簽章、Touch ID、公證必須由 macOS runner 驗證。

## 發布與更新

- 推送 `main`：驗證程式、自動部署 GitHub 控制台、建立內部測試 App artifact。
- 建立和 `package.json` 完全相同的 tag（例如 `v0.1.0`）：簽章、公證、驗證後發布 GitHub Release。
- 正式更新同時發布 `.zip`、`latest-mac.yml` 與 `.dmg`；App 內可檢查、下載，最後由使用者按「更新並重啟」。
- 未簽章測試版只供內部測試，Gatekeeper 會警告，也不能當正式自動更新來源。

正式 Release 需要 GitHub `mac-release` protected environment 與：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## GitHub Pages

第一次到 `Settings → Pages`，將 Source 選為 **GitHub Actions**。之後 `src/renderer/` 的更新會自動建置與部署，不需要重新下載 Mac App。

## Repository

正式 repository 為 [`jspusa/AMZ.API`](https://github.com/jspusa/AMZ.API)。GitHub Pages 請在 `Settings → Pages` 將 Source 設為 **GitHub Actions**。

更多安全邊界請看 [SECURITY.md](SECURITY.md) 與 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
