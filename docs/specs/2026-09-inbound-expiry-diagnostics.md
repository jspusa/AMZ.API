# 入庫效期拒絕原因的安全診斷

接續 Issue [#263](https://github.com/jspusa/AMZ.API/issues/263)，版本 0.1.71，release base `82d2739c708c3c371e4ece80721de742d9dac6b3`。分支 `codex/inbound-expiry-diagnostics-20260913`；local base `1852dc44cc1aad7de5e2ab8c2756e339d6ea9745` 只另含 .70 交付文件。

## 已觀察的問題

可信 .70 第一次原生全 FBA 效期／銷速同步已讀到 284 筆庫存／銷量核心列，29 筆銷速偏慢或待核對；舊「0–30 天」缺值不再中斷核心。入庫申報效期仍以 `FBA_EXPIRY_FORMAT_UNSUPPORTED` 結束，整體 partial。現行 reader 的欄位、分頁、重複資料、checkpoint、大小限制和身分拒絕共用同一句泛化訊息，公開同步結果無法區分原因。沒有保留 live raw response，沒有重試 .70 同步。

這一步改善可診斷性，不能冒充已找出或修好真實資料的根因。完整效期目標保留；要由新版的實際固定診斷確認原因，再提出對應回歸與修正。

## 變更契約

- `FbaExpiryReads` 在各拒絕位置選用 main-owned 的固定原因和固定繁中文案。分清計畫摘要／識別碼／名稱／更新日期／狀態／站點、商品 SKU／ASIN／FNSKU／申報效期／製造批號／數量、兩種清單、分頁、重複計畫／商品、本機接續資料與完整性、讀取上限、回應結構與身分。
- 字串驗證可以附上固定類別，區分缺值、型別、空字串、過長、前後空白、控制字元或格式不符。錯誤不包含 upstream 值、實際字數、ID、SKU、日期、分頁 token、URL、credential、完整 response 或堆疊；不得新增原始資料日誌或持久檔。
- 公開錯誤碼保持 `FBA_EXPIRY_FORMAT_UNSUPPORTED`／502；既有 reader → coordinator → sync 只傳遞固定安全訊息。沒有新增 renderer／preload／route 欄位、任意 transport、診斷下載入口或憑證讀取方式。
- 原接受／拒絕政策完全相同，不把 null、空字串、缺頁、矛盾或非法值正規化成成功，不調整 SKU／名稱／批號／日期限制。checkpoint schema、cache、scope、分頁續讀、請求／資料上限、取消、context fence 及 demo 行為保持相同。
- 效期失敗仍保存可用庫存／銷速，sourceComplete 為 false。未知批次不進行事曆、不補零、不捏造剩餘量，不自動重送同步、report create 或 Amazon mutation。

## 驗收

1. 在真實 `FbaExpiryReads` → `InventoryHealthCoordinator` → `InventoryHealthSync` seam，以合成空名稱先重現舊泛化訊息，改後收到固定欄位及空字串原因；保留 1,000 件庫存／100 天清完估算、來源未完成與零行事曆資格。這是診斷契約回歸，並非 Jasper 那筆資料的重播。
2. 各關鍵拒絕類別與惡意輸入只能投影固定文字；再次 observe 不產生新的讀取或報表建立。合法資料、checkpoint round trip、原嚴格缺值／矛盾／格式防護不變。
3. `npm run check`、`npm audit --omit=dev`、`git diff --check` 與兩軸 review 通過後，分層核對 exact source CI／Pages／Mac／Windows artifact／下載卡／安裝。
4. 安裝後以一次受控的原生讀取取得具體原因，再修正真正卡點；不得把診斷碼更詳細當成效期健檢已成功。人工效期／促銷與原有行事曆仍需核對，已驗的圖片免密碼準備及預檢、XLSX、Vine、偏好與導覽證據保持有效。

官方 schema 的獨立研究已發現名稱與 SKU 長度契約差异；它們目前只屬合成相容性案例，沒有證明造成此次 live 失敗，因此本次不藉機更改解析政策。依據為 [Amazon pinned inbound model](https://github.com/amzn/selling-partner-api-models/blob/3659f96867bfc669aca7a524c2f95744ff0e4478/models/fulfillment-inbound-api-model/fulfillmentInbound_2024-03-20.json)。
