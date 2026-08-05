# Amazon FBA OS

JSPUSA 的 macOS 本機優先 Amazon 營運控制台。只處理 FBA，不提供任何 FBM 入口。

這個 repository 會產生兩個成品：

1. `launcher/`：GitHub Pages 上的下載／啟動頁。
2. `src/`：真正執行 Amazon SP-API 的 macOS App。

GitHub Pages 不會連線 Amazon，也不會檢查或接收 API 憑證。按「開啟 Mac App」只會呼叫 `amazon-fba-os://launch`；真正控制台和 Amazon 資料都在 App 內。

## 已整合功能

| 區域 | 功能 | 自動化程度 |
|---|---|---|
| 策劃 | FBA 訂單、自動同步、SB／SD 授權狀態、FBA 補貨計算 | 自動／人工授權 |
| 產品 | SKU 查詢、標題、五大賣點、成分、Amazon 預檢與寫入 | 一鍵＋Touch ID |
| 產品 | 拖拉圖片、格式／像素檢查、排序、選配自有 R2 上傳、Amazon 回查 | 自動檢查＋一鍵 |
| 產品 | 全商品標題、五大賣點、成分匯出 Excel | 一鍵 |
| 價格 | 查價、上下限、舊值衝突、20% 大幅變動防呆、調價 | 一鍵＋Touch ID |
| 價格 | 限時售價建立／取消 | 一鍵＋Touch ID |
| 價格 | Subscribe & Save 資格與折扣讀取 | 自動讀取 |
| 促銷 | Coupon、S&S 管理與 Amazon Ads 官方入口 | 一鍵開啟、Amazon 內完成 |
| 系統 | Keychain 密文、防重送帳本、預檢票證、自我檢查、更新 | 自動 |

能力邊界：目前 Amazon SP-API 可安全寫入 Listing 價格、限時售價、文案與圖片；S&S 啟用／折扣、Coupon 建立及 SB／SD 正式開啟仍需要獨立資格、Ads API 或 Seller Central 人工確認。介面會把它們集中成一鍵官方入口，不會假裝 API 已完成 Amazon 不開放的動作。

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

`讀取舊值 → Amazon Validation Preview → 兩分鐘本機預檢票證 → SKU／幅度防呆 → Touch ID → 再核對舊值 → Idempotency 帳本 → 單次寫入 → 只讀回查`

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

- 推送 `main`：驗證程式、部署 launcher、建立未簽章內部測試 artifact。
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

第一次到 `Settings → Pages`，將 Source 選為 **GitHub Actions**。之後 `launcher/` 的更新會自動部署。

## Repository 改名

本專案預定名稱是 `jspusa/Amazon-FBA-OS`。如果是從空的 `jspusa/Test` 發布，先在 repository 的 `Settings → General → Repository name` 改成 `Amazon-FBA-OS`。GitHub 會保留舊網址 redirect，commit 歷史不會消失。

更多安全邊界請看 [SECURITY.md](SECURITY.md) 與 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
