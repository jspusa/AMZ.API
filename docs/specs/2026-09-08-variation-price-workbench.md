# 變體工作台與價目表

使用者要求直接完成既有 AMZ.API 功能。基準為 main `cc491d0adda3bffe5221198e3c05a542ca9fe4d4`。

## 變體工作台

- 以寬版單層工作區及可點選清單完成來源查詢、選取 child、解除、填寫與綁定，不必拖曳卡片。
- 清楚顯示 Seller SKU、來源／目標 parent、theme、維度及目標 children 的參考值；保留每個階段與待辦。
- CHILD PTD 所要求的缺少商品資料（例如是否含液體）必須有相符型別的輸入入口。已有資料沿用 exact child，未取得的值不得猜測或預設為否。
- 必填資料與維度納入 canonical diff、preview binding、single PATCH 與 readback。無法安全表示的欄位給可理解原因。
- 解除與加入各自 fresh Validation Preview、原生身分確認、持久 Write Gate、單次寫入及唯讀回查；解除 verified 後才可送出加入。測試不得自行操作真實 Amazon mutation。

## US 價目表

- 使用者在本機選取自己的 `.xlsx`，檔案不納入 GitHub 或公開 Pages。支援實際約 18 MB 原檔、10 張工作表與內嵌圖片、公式、合併儲存格。
- 原表檢視保留工作表順序、內容、圖片及主要格式；未修改原檔下載保留 exact bytes。
- 顯示表上價格與 Amazon 設定價格、表上最低價格與 Amazon 設定下限的並排比對；差異用表格與星號標示。未設定與讀取未完成分開，不補 0。
- 圖片可切換為 Amazon 首圖。輸出保留原表內容與版面，附上 Amazon 比對欄位；只有明確選取替換首圖才替換圖片。
- 貨號不自動當 Seller SKU。只採 exact Seller SKU 或唯一已證明 current FBA 的 ASIN 對應；缺值、重複與歧義要可見。
- 另可選第二份價目表比對新增、刪除、價格及其他欄位變更。
- 匯入只解析資料，公式不執行、外部連線不存取；有上限的 ZIP/XML 與圖片解析只在 main。原檔不覆蓋、價格不寫入 Amazon。
- 讀取工作 single-flight、綁 account/mode/marketplace/generation；鎖定、睡眠或安全脈絡失效清除，遲到結果不能復活。

## 驗證

既有 public seams：variation preparation/preview/commit/readback、ApiRouter、price-list parser/export 與 renderer interactions。先重現缺欄位，再修補；以合成資料回歸安全邊界，另以本機原價目表確認格式與 exact export，不公開原始商業資料。最終執行 `npm run check`、`npm audit --omit=dev`、diff check、Standards/Spec review 與 production UI 驗證。發布、artifact、Mac 安裝與 live Amazon 證據分開。
