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
| 營運 | 首頁可收折重要公布欄：以緊湊單列顯示人工標記的即期 Seller SKU／產品效期／選填停售日／備註、一次倒數、站點、目前 FBA 可售庫存、有效售價與同步時間；有停售日時優先倒數停售日，沒有才倒數產品效期。七欄等寬促銷月曆同時標示促銷檔期、SKU 停售日與到期日；促銷可設定含首尾日的多日檔期，並可另選首頁倒數 | AMZ.API 內直接按「新增即期品／新增促銷」填白話欄位；發布或管理時才在 main-owned 無網路小視窗輸入共用帳密，可直接新增、編輯、刪除。員工不需 GitHub，也不需設定 R2 五個欄位 |
| 產品 | SKU 查詢、標題、1–5 項產品要點、成分、Amazon 預檢與寫入 | 一鍵＋Touch ID／Windows Hello／系統確認；只有實際編輯產品要點時，才可在完整揭露同語系第 6 項後舊值、勾選 preview-bound 確認並通過原生確認後，以 1–5 項完整取代；只改標題不會刪除多出的要點 |
| 產品 | 全站 FBA 文案健檢（產品名稱 `<60`、產品亮點 `<110`、每項產品要點 `<150`／`>200`、產品敘述 `<1800`、疑似錯字、缺值、成分宣稱核對與逐項原因） | Amazon 唯讀掃描；第一次按下就啟動一個工作，忙碌期間重複點擊只沿用同一 flight；依明確 ingredients 證據核對多成分、Tendon／Tendons 與 Chicken／hypoallergenic 宣稱；`airdried`、`grainfree`、`dogfood`、`airdry` 只在後台產品敘述免列錯字，出現在標題、亮點、要點或成分仍回報；摘要與常用操作優先顯示，門檻、辭典與安全範圍收在低調的「詳細說明 ›」；Excel 依已證明的變體 family 分頁，問題欄著色，未發現問題的可編輯欄使用淺綠色。只有 family 每一列資料完整且全部檢查通過時，工作表才由 `F001` 命名為 `F001(可)`；任一問題、incomplete 或 unknown 都維持原名 |
| 產品 | 將文案健檢 Excel 以選檔或拖放回傳，逐欄核對 Amazon 原值／Excel 更新值後批次更新；新版可只回傳 F007，或只回傳 F007、F008 等實際要改的完整工作表 | 同檔 round trip 保留特殊換行與 main-owned 24 小時證據。匯入會一次列出所有問題 SKU、工作表、Excel 列號、實際欄位與原因；能安全歸屬單列的 parser／fresh-read／Validation 問題只隔離該 SKU，其餘獨立安全 SKU 繼續，Amazon `INVALID` 沒有強制送出入口。公式／巨集／外部連結、跨帳號／站點、auth／rate limit／server／network／timeout 或無法綁定結果仍整批 fail closed。Preview／重新預檢最多同時 3 筆，並只在同一 phase、相同 Product Type 與安全脈絡內沿用 PTD；正式 PATCH 仍逐 SKU 單線送出。每筆 durable `ACCEPTED` 後立刻前進下一筆，main 另外以最多 2 個 GET-only 工作做 bounded 回查；進度分開顯示實際標籤「重新預檢 n/N」、「等待 Touch ID／Windows Hello」、「送出 n/N」、「Amazon 已接受 n/N」與「回查完成 n/N」。每 SKU 只有一次 ledgered PATCH，任何回查都不會重送 PATCH |
| 產品 | 拖拉圖片、格式／像素檢查、排序、選配自有 R2 上傳、Amazon 回查 | 自動檢查＋一鍵 |
| 產品 | 全站 FBA 圖片健檢（少於六張與讀取未完成分開標示、結果保留並可返回） | Amazon 唯讀 |
| 產品 | 全站 FBA A+ 健檢（依唯一 ASIN 讀取官方 publish records、Content Manager 文件與文件-ASIN 關聯；分開顯示發布狀態、文件名稱、文件審核狀態與關聯狀態，問題列可前往 A+ Content Manager 核對） | Amazon A+ Content API 唯讀；任一 exact 文件／ASIN 關聯只要含 schema-valid `CONTENT_PUBLISHED` 就保留已發布正向證據，不會被同 ASIN 另一文件的 negative／malformed 關聯抹除；未使用的 optional `contentReferenceKeySet` 畸形只把完整度降為 partial；沒有任何 published positive 的 malformed／negative 關聯仍 fail closed；文件存在或 APPROVED 本身不會被猜成已發布 |
| 產品 | 文案健檢同一快照可分別匯出「待確認清單」與「全部商品完整模板」；兩個入口使用不同名稱與視覺層級，任一份都可選回同一批次更新流程 | 一鍵；兩份 Excel 都只在本機建立，不上傳商品文案 |
| 產品 | 雙 Family 並排、FBA child 拖拉改掛、CHILD PTD 動態欄位 | 兩階段預檢＋本機身分確認＋回查 |
| 產品 | 全站未綁變體健檢（Listings relationships 每批最多 20 SKU、缺值／歧義 fail closed；Excel 含淺色 family 分組的「所有變體」與「父變體橫排」） | Amazon 唯讀；「父變體橫排」第一列直接橫排所有已驗證 Parent SKU，每一欄從第二列起只接續該 Parent 的 Child SKU；standalone／資料未完成留在各自工作表，不用 ASIN 猜 family |
| 產品 | 非 parent FBA ASIN 評論主題健檢（child＋standalone、排除 parent、前五／後五與全量 Excel） | Amazon Customer Feedback 唯讀 |
| 價格 | 查價、上下限、舊值衝突、20% 大幅變動防呆、調價 | 一鍵＋本機身分確認 |
| 價格 | Listing Sale Price（SKU 限時售價）建立／取消 | 一鍵＋本機身分確認 |
| 價格 | 官方支援站點的全站 FBA Subscribe & Save 價格、折扣、目前有效訂閱、最多 23 個完整月趨勢與五分頁 Excel；具同次 current-FBA 證據的無效／重複 offer 或月度 SKU 獨立列為未完成，不拖垮其餘正常 SKU；未證明識別值只保留聚合計數 | 自動讀取；來源不完整時只顯示已核對範圍；SG／AU 顯示不支援邊界 |
| 價格 | 全站 FBA Amazon Business 價格健檢，列級原因可同時標示「不符建議 B2B 價格」、「未正確設定階梯折扣」與「高於一般售價」，並提供五工作表 Excel；建議規則為 USD 一般價減 1.00，以及 5／10／15／20 件各 5%／10%／15%／20% | 摘要只顯示「全部／需處理／未設定／正確設定／資料未完成」；後四類互斥且相加等於全部。需處理只含資料完整、已設定 B2B 且任一建議價格／階梯／高於一般價問題的 SKU；未設定獨立；一般售價缺失歸資料未完成；正確設定只含完全合格列。Seller SKU 搜尋會先 trim、忽略大小寫並以 substring 比對，再與目前分類篩選取交集。報表與 snapshot owner 維持唯讀；清單可逐列勾選、全選目前可處理列並一次啟動批次，每列仍 fresh Preview，正式 PATCH 逐筆單線送出，最低價與 B2B intent 分開取得原生確認；批次預檢、原生確認或送出期間會鎖住外層返回／關閉。Amazon 接受後由 main 自動做 bounded GET-only reconcile，只有 exact canonical GET 相符才顯示已驗證，且永不重送 PATCH。首頁以寬版單層 workspace 在清單與單 SKU editor 間切換並保存返回位置，editor 底部提供「← 返回健檢結果」。Active Listings exact Business Price／quantity fields 可補足尚未同步的 Listings attributes contribution；來源衝突或 malformed／duplicate／身分不符仍 fail closed，Excel 只由 main-owned 完成快照建立 |
| 促銷 | Coupon、S&S 管理與 Amazon Ads 集中於「Amazon 官方完成」 | 一鍵開啟、Amazon 內完成 |
| 報表 | FBA 入庫貨件追蹤（近 30／90／180 天、貨件狀態、逐 SKU 預期／送出、Amazon 已接收、尚未接收／超收、每日貨件／箱件／商品瑕疵與中文 Excel）；入口只放在頂端「報表」，不佔首頁或「營運」工具列 | Fulfillment Inbound GET＋耐久化每日問題報表；部分資料不補 0 |
| 營運 | Amazon Ads Profile 自動發現、Sponsored Products 活動唯讀查詢與全站 FBA 廣告覆蓋健檢；任何 Listing 身分缺口都整次停止 | 獨立 Ads LWA＋唯讀；無 Ads 寫入 route |
| 營運 | FBA 廣告策略表：同一日期範圍整合目前 FBA SKU、SKU 粒度品項銷售與 Sponsored Products advertised-product 報表，產生 T1–T4、可覆寫 SP 預算／目標 ACoS、實際花費／歸因銷售／購買次數與中文 Excel | 三份 main-owned 唯讀報表；缺值不補 0；SB／SD／規格與價格保持人工留白 |
| 報表 | 文件庫列出 Amazon 官方 109 個唯一公開 report types、用途、角色、FBA 邊界與 App 接線狀態；Vendor 類型不顯示，並可依可用性快速篩選 | 公開文件＋唯讀規劃 |
| 健檢 | 首頁一鍵直接啟動文案、圖片、A+、未綁變體、Subscribe & Save、B2B 價格、廣告覆蓋七張既有卡片的 main-owned 工作，名稱與順序完全共用；首頁入口改用同一個寬版單層工作區，優先顯示摘要、進度、操作與結果，不再把結果限制在小型 modal；判定規則、資料來源及安全範圍只在低調的「詳細說明 ›」展開後顯示 | 全部唯讀；執行中工作會沿用，啟動或執行失敗各自在原卡片 fail honest |
| 健檢 | 從任一單項卡啟動文案、圖片、A+、未綁變體、Subscribe & Save、B2B、廣告覆蓋、庫齡或評論後，可返回首頁並讓 Notebook Key 主程序繼續執行，首頁持續顯示該站點進度並可重新接回結果；非首頁工具仍可保留既有 drawer | renderer 只觀察 main-owned、account／mode／marketplace-scoped 工作；離開工作區不會取消工作，切換安全 context 會失效；B2B 寫入處理中仍禁止離開 |
| 健檢 | FBA 180 天以上庫齡／預估冗餘與評論主題依此順序收在首頁預設折疊的「低頻健檢」，各自獨立執行 | 不納入一鍵全部，避免低頻或長時間工作阻塞常用健檢 |
| 系統 | 作業系統安全儲存密文、防重送帳本、預檢票證、自我檢查、字級、API 版本更新建議、公開會計 API 能力與安全下載規劃 | 自動／能力邊界 |

能力邊界：目前 Amazon SP-API 寫入流程涵蓋 Listing 一般價格、Sale Price、文案、圖片、符合 seller-specific PTD 的單 SKU 與明確勾選批次 B2B 價格／percent 數量折扣，以及既有 FBA child 的 variation 關係；全站 B2B 健檢 owner 與 snapshot 本身仍固定唯讀，但使用者可在結果清單明確勾選可處理列，由獨立的 main-owned B2B batch owner 啟動安全寫入流程。一般 B2B 寫入只更新 exact `audience=B2B` contribution，其他 audiences 原樣保留；唯一窄例外是使用者明確送出 percent 階梯、US／USD 的最低階單價低於一份可唯一辨識且既已設定的 `ALL.minimum_seller_allowed_price` 時，App 可把該護欄降到最低階單價再少 US$1.00。這個例外不會建立缺少的最低價、不接受 ambiguous `ALL` offer，也不改 `our_price` 或其他 `ALL` 欄位。若需要先調低最低價，最低價與 B2B 仍是兩個獨立 intent，各自以 fresh Validation Preview 與原生確認授權，正式 PATCH 全程逐筆單線送出。Amazon 一回 `ACCEPTED`，App 立刻保存不可重送的 durable evidence 並前進下一個已授權 intent；main-owned bounded GET-only reconciliation 另外追蹤 exact canonical 狀態，不阻塞後續 PATCH，也絕不重送 PATCH。最低價只有 canonical 目標相符後，才可用最新 Listing 重新預檢並再次確認 B2B 價格與階梯。只調價格時既有數量折扣與最低價都保持原樣。Amazon 對已接受的 Listing 更新可能延遲數分鐘，實際曾觀察到接近 10 分鐘；這不是保證時限，`ACCEPTED` 也不等於 verified。變體改掛不是原子操作，固定拆成「解除舊 parent」與「加入新 parent」兩階段；所有寫入都維持重新讀取、Amazon Validation Preview、本機身分確認、持久化防重送、單次 PATCH 與後續唯讀回查，任何不確定狀態都禁止直接重送。S&S 啟用／折扣、Coupon 建立及 SB／SD 正式開啟仍需要獨立資格、Ads API 或 Seller Central 人工確認。

Amazon 公開 API 目前不提供現有 FBA FC 庫存的逐 SKU／批次效期，因此 App 不會拿庫齡冒充近效期或已過期清單。首頁即期品的產品效期、選填停售日與備註明確標示為人工維護；有停售日時倒數以停售日為準，沒有才使用產品效期。目前 FBA 可售庫存與價格才由各台 Notebook Key 以單次 bounded `POST /api/sp-api/operations-board-facts` 唯讀批次另行取得，兩種證據不互相冒充。公布欄發布也不是 Amazon 寫入，不會呼叫 Amazon Validation Preview 或 PATCH。一般 US／CA／JP／SG／AU／UK／DE 發票與 Seller Central 帳單也沒有通用公開下載 API；會計中心只啟用可證明為 FBA 的公開報表，Finances JSON、結算報表、人工前置與不可用能力會分開標示，不使用 Seller Central 私有接口。

FBA 入庫貨件的「Amazon 已接收」取自 Fulfillment Inbound v0 `QuantityReceived`，不是 Seller Central 私有畫面的逐次掃描或調查結論。接收中貨件的正差額只稱為「尚未接收／暫時差異」；超收會獨立保留，只有已關閉貨件仍有差異時才提示回 Seller Central 核對。逐票商品第一頁若回傳 `NextToken`，Notebook Key 只會以官方 `getShipmentItems` 的固定 `NEXT_TOKEN` GET 讀完後續頁，並核對同一票識別、重複 token／SKU 與安全頁數上限。若 Amazon 拒絕舊版日期範圍清單，Notebook Key 會依序嘗試 v0 活動中狀態清單與 2024 新版入庫計畫清單；兩種備援都固定標為部分範圍，不能冒充所選日期內的完整貨件清單。每日 inbound noncompliance report 只包含 Amazon 回傳的問題列且可能落後即時畫面，沒有問題列不等於可證明三個層級即時零瑕疵。

Customer Feedback API 提供的是每週更新的正／負「評論主題影響值」（`starRatingImpact`），不是商品總星等、1–5 星制、總評論數或完整 review 全文。負值表示負向主題對星等下降方向的影響，不是「商品負星等」；App 保留 Amazon 原始正負號，不改成 0 或絕對值。評論健檢只對 Listings relationships 已證明為 child 或 standalone 的 FBA ASIN 排序主題；不會拿 parent 容器或推測值冒充商品評論排名。

FBA 廣告策略表只會把 Sales & Traffic 的 exact Seller SKU＋ASIN 與目前 FBA 清單核對後納入銷售分級；Ads SKU 缺失時，也只有 ASIN 在目前 FBA 清單唯一對應一個 SKU 才能歸屬。原始範本中的「廣告花費」是排名而非金額，因此 App 明確改稱「SP 花費排名」並另列 Amazon Ads 實際花費。即時售價沒有同次可信來源，價格欄保持空白，不以營業額除以件數推算；SB／SD 的素材、受眾、攻守與正式預算仍由人決定。

## 第一次使用

1. 前往 [AMZ.API Notebook Key 安全下載頁](https://supply-boss.brave-prawn-0848.chatgpt.site/downloads)，通過內部密碼驗證後下載 Mac `.dmg` 或 Windows 11 Pro x64 的 NSIS installer。下載頁只提供這兩個員工安裝入口；portable ZIP 與 checksum manifest 只保留為內部驗證 artifact，不另顯示成下載卡。安裝檔保存在私有 R2，不使用公開 GitHub Release 直連；GitHub Pages 也不包含密碼或真實檔案網址。
2. 目前 Windows artifact 是內部未簽章版；Windows SmartScreen 會顯示發行者未知警告。請只從上述安全下載頁取得並核對頁面提供的 SHA-256，不要從 PR 的測試結果下載，也不要關閉全系統 SmartScreen 來繞過警告。
3. 開啟 App，按右上角「Notebook Key 安全連線」，再開啟本機 SP-API 安全輸入。敏感欄位會在 main process 建立的本機 sheet 中開啟，不會進入 GitHub Pages renderer。
4. 在本機 sheet 輸入 Private Seller App 的：
   - LWA Client ID
   - LWA Client Secret
   - 各使用區域的 Refresh Token
   - 各區域 Seller ID / Merchant Token
5. macOS 使用 Touch ID；Windows 11 使用 Windows Hello（指紋／臉部／PIN 由 Windows 決定）。Windows Hello 未設定、取消或失敗時會停止敏感操作，不會降級成一般按鈕放行。
6. 公布欄不需要 Amazon 憑證或使用者自備 R2。按「新增即期品」可填產品效期與選填停售日；按「新增促銷」可選開始日與結束日，單日活動把兩日設成同一天。填完白話欄位後，App 會開啟無網路的本機管理小視窗；輸入共用帳密即可確認發布，之後也能從同一處直接編輯或刪除。員工不需 GitHub 帳號，多台 Notebook Key 會讀取同一份 Supply Boss 公布欄。
7. 在頂端輸入 Seller SKU，直接進入文案、圖片、定價、促銷或補貨。

SP-API 不是單一 API Key。北美（US／CA）、遠東（JP／SG／AU）、歐洲（UK／DE）各自使用區域 Refresh Token 與 Seller ID；同一個 LWA Client 可共用。

目前每個區域保存一組 Selling Partner 授權；只有同一 Seller authorization 實際涵蓋的 marketplaces 才能共用。若 JP、SG、AU 是不同 Seller accounts，v0.1 不會把它們合併成同一個遠東設定，未授權站點會由 Amazon 拒絕。

圖片要交給 Amazon 下載，必須有公開 HTTPS URL。App 可以：

- 直接貼現有 CDN 圖片 URL；或
- 在「Notebook Key 安全連線」輸入你自己的 Cloudflare R2 S3 credentials、bucket 與 public base URL。R2 Secret 同樣只存在作業系統安全儲存區。

## 憑證保存位置

- Secret 經 Electron `safeStorage` 的作業系統金鑰保護後，才寫入 App 的 `userData/credentials.enc`；macOS 使用 Keychain，Windows 使用當前登入使用者的 DPAPI。
- Amazon Ads 使用獨立 `ads-credentials.enc`；兩種憑證都只在 main process 的無網路本機 sheet 輸入，Pages 只能開啟 sheet、讀取遮罩狀態、測試或清除。
- 公布欄使用獨立於 Supply Boss 舊管理 API 的 board-editor 帳密，只送往固定登入端點；最長 8 小時的 board-scoped session token 只存在 main process 記憶體，不能操作舊 snapshot 管理 API。密碼不保存，鎖屏、睡眠、App 結束或到期即登出；關閉管理視窗不會立刻登出，讓同一次 App 使用期間再次管理時不必重輸。Seller SKU、人工產品效期／停售日、促銷開始日／結束日、促銷名稱與備註屬公開公告內容；Amazon 憑證、即時庫存與價格不會上傳。

- 公布欄目前以 canonical schema v2 運作。新版 Notebook Key 對讀寫都固定送出 `x-amz-api-operations-board-schema: 2`；Supply Boss 可讀既有 v1 或 v2 儲存內容並正規化為 v2。為讓舊版 App 安全讀取，沒有這個 header 的 public GET 仍只回傳 exact v1 projection；帶 header 的 GET 才回完整 v2。canonical 資料升為 v2 後，舊版無 header 的 PUT 會回 `409` 並要求升級，避免無聲覆蓋停售日或多日促銷的結束日。
- 完整 Secret 永不回傳 renderer、永不寫入 GitHub、`.env`、URL、localStorage 或日誌。
- Amazon Access Token 只在主程序記憶體中短暫快取。
- 作業系統安全儲存不可用時保存會直接失敗，沒有明文 fallback。Windows DPAPI 保護不同 Windows 使用者之間的存取，不等於隔離同一使用者權限下的其他程式。
- 清除 App 設定不會改動 GitHub 程式；「清除本機憑證」會要求本機確認。

## 防呆流程

Amazon 寫入固定經過：

`讀取舊值 → Amazon Validation Preview → 兩分鐘本機預檢票證 → 必要的 SKU／幅度防呆 → Touch ID／Windows Hello／系統確認 → 再核對舊值 → Idempotency 帳本 → 單次寫入 → 只讀回查`

單 SKU 文案更新在 Validation Preview 後直接跳本機身分確認，不再要求重打 SKU；可保留 1–5 項產品要點。只有產品要點本身有編輯時，main 才能把同語系第 6 項後舊值作為 exact replacement 範圍：App 必須逐項顯示 Amazon 原值、更新值與所有將刪內容，使用者勾選和本次 preview 綁定的確認後，再進 Touch ID／Windows Hello；只改標題或其他欄位時，多出的產品要點保持原樣。Excel 批次文案先核對每列的 main-owned 掃描證據，並一次列出所有問題 SKU、工作表、Excel 列號、實際欄位與清理過的公開原因；能安全歸屬 exact SKU 的 parser／fresh-read／Validation／身分／FBA／PTD／schema 問題只隔離該 SKU 且保持零寫入，其餘獨立安全列繼續。Amazon `INVALID` 永遠隔離，沒有 override 或「仍要嘗試上傳」入口。工作簿結構篡改，或無法安全歸屬單一 SKU 的 context／帳號／站點／模式 drift、auth／rate limit／`5xx`／網路／逾時、malformed／unknown、結果綁定失效等全域問題仍停止整批。Excel 對同語系產品要點採完整取代時，adapter 若看到第 6 項後舊值，必須把所有將刪內容及語系帶進 main-owned 預檢；renderer 逐字顯示並回傳完全相同且有序的 SKU acknowledgement，main fresh revalidation 也必須逐字相同。Preview 與原生確認前重新預檢最多同時處理 3 個 SKU，同一 phase 只為相同 Product Type 與安全脈絡沿用 PTD；原生確認只涵蓋重新預檢後仍可寫的 SKU。Excel 預檢、原生確認與正式送出尚未完成時，外層關閉／返回、工具分頁及 Amazon 站點選擇都會鎖住，避免失去本次 main-owned 進度。摘要超過 120 字時改用不含任意 Amazon 文字的 bounded 計數與 Write Gate 12 字驗證碼，因此大量更新不必拆檔。核准後正式 PATCH 仍按工作簿順序單線送出；每筆 durable `ACCEPTED` 後立刻送下一筆，最多 2 個 main-owned GET-only 工作另外做 bounded canonical reconciliation。`ACCEPTED`、verified 與 unknown 分開顯示；任何回查都不會重送 PATCH。價格、圖片與 Sale Price 保留各自既定的額外防呆。

寫入不會因為 `429`、逾時或 `5xx` 自動重送。真正 PATCH 前的重新讀取／PTD／Validation Preview 若發生無法安全歸屬單一 SKU 的失敗，或 exact pre-commit evidence 已漂移，會明示尚未送出並安全釋放 claim；真正 PATCH 可能已送出、但沒有可信 accepted／rejected receipt 時，帳本才會標記 `unknown` 並阻止同一確認碼重送；已耐久保存 Amazon `ACCEPTED` 的項目保持 `PROCESSING`，回查未相符或失敗也不會降成可重送。B2B 單筆或已勾選批次一取得 Amazon accepted receipt，就保存 `PROCESSING` 並讓 serial dispatcher 前進下一筆；main-owned bounded reconciliation 只以 GET／`reconcile()`／`inspect()` 追蹤已接受項目，不占用或重送 PATCH。B2B intent 只有 exact SKU／ASIN／站點／Business Price 與本次要求的階梯全部相符，才能把 durable 狀態轉成 `VERIFIED`。最低價 intent 只以 exact SKU／ASIN／站點／Product Type／FBA 與 canonical 目標最低價確認；Amazon 在同步期間正規化的一般售價、B2B contribution、階梯或 protected hash 不會讓已命中的最低價永久卡住，因為第二階段仍必須使用最新 Listing 重新預檢並再次確認。自動或手動重新讀取都只做 GET，不會重送 PATCH。

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

- 一般 renderer 變更推送到 `main` 後由 GitHub Pages 自動發布 Control Console Release，不需要提高桌機版本，也不需要員工重新下載 Notebook Key。
- 新增本機 Amazon 寫入、憑證、安全確認或其他 main／preload 能力時，提高一次 `package.json` 版本並建立完全相同的 tag。單一 `desktop-release.yml` 會先驗證共用程式碼，再分別建立 Developer ID＋公證的 Mac universal DMG／ZIP／`latest-mac.yml`，以及 Authenticode 的 Windows x64 NSIS／ZIP／`latest.yml`；兩邊全部通過才可發布同一個 Notebook Key Release。
- 正式簽章包會被工作流注入 `publisher-signed-v1`；未簽章測試包固定保留 `disabled`，因此不能檢查、下載或安裝正式更新，也不能冒充正式發布。
- 正式 Notebook Key 啟動後約 15 秒背景檢查，之後每 6 小時重查；有新版會在背景下載並顯示小滑板人進度。下載完成後不會自行關閉程式，只顯示一次「更新並重啟」。Amazon／憑證安全操作尚未結束時會拒絕重啟；按下後立即關閉憑證編輯器、停止接受新的 Amazon／憑證操作，再以 Windows 靜默 NSIS 或 macOS updater 安裝並重開。若 installer 當場拋錯或稍後發出 error，操作 gate 與按鈕狀態都會回復，不會把 App 永久鎖住。
- GitHub Pages renderer 會先偵測目前 Notebook Key 是否已有新的 updater bridge；舊版仍可正常載入頁面，但只顯示「需先安裝簽章版」，不會呼叫不存在的 IPC。這個 Bootstrap 相容層是讓既有使用者安全走完最後一次手動安裝，不是繞過簽章。
- 現有未簽章／不同簽章身分的安裝無法憑空加入可信更新鏈；Mac 與 Windows 都必須最後手動安裝一次 Bootstrap Notebook Key。之後例行桌機能力更新不再需要回到網站，例外只剩首次安裝、修復或簽章身分遷移。
- 員工可見的 [Notebook Key 安全下載頁](https://supply-boss.brave-prawn-0848.chatgpt.site/downloads) 仍只顯示 Mac DMG 與 Windows NSIS installer 兩張卡。自動更新若採 GitHub provider，Release 資產技術上是公開下載來源；發布 job 因此要求 `desktop-release` environment 的 `PUBLIC_DESKTOP_UPDATE_FEED=approved`，未取得明確核准不得發布。
- 未簽章測試版只供內部測試。CI 不能冒充 Gatekeeper／SmartScreen reputation、Touch ID、Windows Hello 或真實裝置更新已通過。

正式 Release 需要 GitHub `mac-release` protected environment 與：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

GitHub `windows-release` protected environment 另需要同一個穩定 Windows publisher identity 的：

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

兩平台簽章檔驗證完成後，`desktop-release` protected environment 才能核准公開更新來源。Release tag 必須精確對應 workflow SHA，且該 commit 必須已進入 `origin/main`；Mac 與 Windows runner 各自在自己的環境重新安裝依賴與建置，不能沿用另一台 runner 的輸出。台灣公司目前不一定符合 Microsoft Artifact Signing Public Trust 的申請地區；若所選憑證由 cloud HSM／hardware token 保管，需把 Windows job 改接該發行商的 CI signer，不能把不可匯出的 private key 假裝成 `WIN_CSC_LINK`。

## GitHub Pages

第一次到 `Settings → Pages`，將 Source 選為 **GitHub Actions**。之後 `src/renderer/` 的更新會自動建置與部署，不需要重新下載 Notebook 鑰匙。

## Repository

正式 repository 為 [`jspusa/AMZ.API`](https://github.com/jspusa/AMZ.API)。GitHub Pages 請在 `Settings → Pages` 將 Source 設為 **GitHub Actions**。

更多安全邊界請看 [SECURITY.md](SECURITY.md) 與 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
