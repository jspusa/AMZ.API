# 功能驗收契約

## 2026-09-08 變體工作台與價目表

- 變體主入口使用單層寬版 workspace。來源／目標查詢、Seller SKU、目標 children 參考值、待辦與目前階段必須可見；點選及按鈕可完成所有步驟，不依賴拖曳。返回恢復原選單焦點與捲動，寫入忙碌期間禁止離開。
- 解除與加入都讀 seller-specific CHILD PTD。缺少的必填商品事實提供相符輸入；布林沒有預設答案。既有 exact child 事實保持唯讀，部分缺漏只補缺少的 leaf，不能藉此覆寫已知值。無法安全編輯的結構明示原因，不能偽裝可送出。
- 若 fresh Amazon Preview 明確要求一個已有完整值的商品事實，提供預設未勾選的「保留既有答案並加入本次檢查」。只接受 main 證明的單筆純量欄位，renderer 只選名稱；完整原值及 selector 由 main 原樣帶入，前後相同仍揭露於檢查內容。此意圖另綁 fingerprint、重新讀取與持久回查；既有值不可藉此編輯，也不放寬其他受管制欄位。
- 必填事實、維度與 parent 變更共同出現在 canonical diff 與 native prompt，綁 exact context、身分、schema 與 preview。編輯即作廢原 Preview；兩階段各自 fresh Preview、native approval、durable claim、single PATCH、canonical GET。結果不明只允許回查，不恢復重送按鈕。
- 已受理／結果不明的變體操作可由目前帳號、站點及 exact SKU 唯讀恢復；重新開啟工作台仍要先辨識未結案紀錄。只有 main 將最新無歧義的 durable intent 與完整 canonical 身分、關係、family membership、維度及保留事實核對後才顯示完成。parent 單獨相符、舊收據、讀取失敗或切換後遲到回覆都不能解除待確認。回查不產生 Preview／原生確認／PATCH；完成舊操作不妨礙另建需要全新授權的後續計畫。
- PTD 唯讀維度有唯一且完整的 exact 原值時可以保留並 attach，production payload 必須省略該欄位；原值／selectors 改動、缺值或歧義仍停止。保留值與 schema 納入預檢 binding，持久化僅存 digest，回查必須核對 exact selectors。
- 變體規劃可沿用同次未綁健檢工作與快照，列出已證明 standalone FBA SKU 及建議 family。建議僅依相容類型、主題及同系列 verified children 計數，星等與相似 SKU 可見；同分／不足不假裝唯一結論，選擇後一律 fresh-read 來源及目標再走原寫入流程。
- 完整回傳的空 relationships 必須保留讀取證據，不得與未回傳資料混淆。獨立商品若只保留唯一且精確符合目標的既有 theme，可以原樣保留並省略 theme PATCH；main 仍須獨立證明無 parentage／parent 關係，保留完整值及 selectors 的預檢綁定，歧義與漂移拒絕。解除後的三個關係欄位清空規則不變。
- US 價目表允許 25 MiB 以下 `.xlsx`，上限只套用精確匯入 route，不擴大既有文案或圖片上傳。原檔只留 main memory，保留工作表順序、圖片、公式及合併；原檔下載必須 exact bytes。匯入不執行公式或存取外部連線，危險 XML、巨集與超限壓縮檔拒絕。
- 原表檢視及輸出保留原欄位，Amazon 售價、最低價格設定與差額在旁比對。★ 有差異／☆ 相同／待確認保持不同；未設定與未取得不是零。表上最低活動價與平台最低價格設定分別說明用途，不自動改價。替換 Amazon 首圖需明確勾選，沒有取得首圖保留原圖。
- 原表價格若存為明確十進位文字，畫面狀態、原表差額與 export 使用同一比較用解析規則；空白、含糊格式及非有限／不安全數值不補零。解析不改寫原儲存格型別、值、公式或原檔；兩份 Excel 比對仍保留型別差異。
- 公司貨號不得自動當 Seller SKU；只採 exact Seller SKU 或同次 current FBA 唯一 ASIN 對應。歧義、重複、未配對與 incomplete 列可見但不冒充相符。價格使用 exact US Listing 的 ALL／USD contribution，不混用 B2B、Buy Box 或促銷顯示價。
- Amazon 讀取由 main 以 account／mode／marketplace／generation 綁定單一工作；GET 只觀察，鎖定／睡眠／安全 context 失效清除，遲到結果不能復活。首圖下載固定 Amazon image host、HTTPS、禁止 redirect、有大小與時間上限；renderer 不指定 arbitrary URL 或匯出價格。第二份 Excel 比對列出新增、移除、重複及欄位變更。
- 價目表以選表、讀取、比較、下載引導下一步；原檔下載與另一份 Excel 比對為次要操作。未開始／FBA 確認中／逐列等待／失敗／未設定／無唯一對應不得統稱未取得。讀取開始即顯示比對，完成摘要揭露未完成範圍；回首頁再進入保留同次面板與工作，不新建讀取或持久保存商業資料。

從 2026-09-04 交接入口逐字保留的功能契約。這些是驗收條件，並非本版已在真實裝置或 Amazon 通過的聲稱。修改相關功能前讀取對應條款；目前實測狀態以 [版本證據](releases/2026-09-review-evidence.md) 與 [live 驗收矩陣](releases/2026-09-live-acceptance.md) 為準。

## 11. 完成定義

只有適用平台與 Amazon 範圍的下列條件都成立，才能向使用者宣稱「已串好」：

- Notebook Key 顯示正確版本；Windows 版必須另在真實 Windows 11 Pro x64 完成安裝、Bridge、DPAPI 與 Windows Hello 成功／取消／不可用／PIN fallback 人工驗證，不能拿 CI 或 Mac 測試代替。
- Orders 與 Listings probe 均 live success。
- US Seller SKU 文案、價格、促銷狀態能只讀查詢。
- 文案拼字規則必須保留欄位邊界：`airdried`、`grainfree`、`dogfood`、`airdry` 只在產品敘述免列疑似錯字；標題、產品亮點、產品要點與成分仍必須回報。
- B2B 摘要「正確設定」只計 Business Price 與建議數量折扣都合格的列；「需處理」必須排除 incomplete，並由獨立「資料未完成」篩選保留全部 exact 原因。
- US Seller SKU 的 FBA 庫存／補貨能只讀查詢，且 7／14／30／90 天、自訂 1–365 天與去年同期 AFN 銷售趨勢完整載入。
- 180 天以上 FBA 庫齡報表能唯讀載入，庫齡與 Amazon 預估冗餘不混為同一指標；它與評論健檢只放在首頁預設收合的「低頻健檢」，不進 run-all。
- 首頁 run-all 精確包含文案、圖片、A+、未綁變體、訂閱省、B2B 價格、廣告覆蓋七項；七項在背景並行執行，名稱與一般健檢卡完全一致並固定依此順序顯示。任一失敗要保留自己的終局狀態，不能把「全部結束」冒充成功。
- 全站文案與圖片健檢能以真實 Amazon FBA 範圍載入，cache／編輯／返回流程正常；文案第一次點擊即建立唯一 main-owned flight，相同 selection 的重複點擊只能接回同一工作；文案門檻精確為產品名稱 60、產品亮點 110、每項產品要點 150–200、產品敘述 1,800 Unicode 字元，圖片門檻可在健檢前選擇 1–10 張，預設 8 張；完整讀取且張數低於選值才列不足，單次健檢、全部執行與匯出共用相同選值，讀取未完成不推論。原因只能顯示一次，摘要數字本身可直接篩選，立即修改要聚焦並保留相符原因。文案、圖片、A+、未綁變體、訂閱、B2B 與廣告的首頁入口必須使用共用寬版、單層、非 modal workspace，只由頁面捲動，進入聚焦標題並在返回時恢復原卡片焦點／位置；非首頁入口可保留既有 presentation surface，但不得再疊第二個 modal。各 panel 必須先顯示摘要、進度、主要操作與結果，長篇判定規則／資料來源／安全範圍統一放在預設收合且低調的「詳細說明 ›」，展開不得改變工作狀態。成分宣稱只在完整且非空的 Amazon ingredients 證據下核對：至少兩個不同成分才可否定 single ingredient，Tendon／Tendons 需有同詞成分，ingredients 含 Chicken 時標示 hypoallergenic 待核對；括號逗號與不完整讀取不得誤判。
- 文案 Excel 可按鈕選檔或 drag/drop，且只含 FBA 商品；同一 main-owned 快照必須提供視覺可區分的「待確認清單」與「全部商品完整模板」兩個下載入口，兩份都能回到同一選檔／批次預檢更新流程。schema v2 必須含「說明與索引」、已證明的變體 family 分頁、「未綁變體」與 fail-closed「資料未完成」，並保留原始／更新欄、問題顏色與「類型／說明」。CR／U+0085／U+2028／U+2029 必須無損 round trip；舊檔只能用 main-owned 唯一完整 digest bounded recovery。按鈕顏色只協助辨識 scope，不是任何寫入授權依據。
- 回傳文案健檢 Excel 時，digest 已證明為原掃描 readStatus=incomplete 的已編輯列與其他能安全歸屬 exact SKU 的 parser／fresh-read／Validation 問題，都要一次完整列出工作表、Excel 列號、實際變更欄位與公開原因；有問題的 SKU 保持零寫入且不進 native approval，其餘獨立安全 SKU 繼續。Amazon `INVALID` 沒有 override 或強制送出入口。無法安全歸屬單列的篡改、跨站點／帳號、公式／巨集／外部連結、context／結果綁定、auth、rate limit、`5xx`、網路、timeout 或 malformed／unknown 全域問題，仍在第一筆 Amazon PATCH 前整批停止。初次 preview 與 native approval 前重新 preview 各自最多 3 筆並行；seller-specific PTD 只能在同一 phase、Product Type、marketplace、account／mode／generation 與 read／write purpose 內 single-flight 沿用。若全被隔離就以零寫入結束。每 SKU 仍只有自己的 ledgered single PATCH attempt；PATCH 按工作簿順序 serial 執行，durable `ACCEPTED` 後立即前進下一筆，不等待 canonical 同步。最多 2 個 main-owned GET-only worker 另對 accepted rows bounded `reconcile()`／`inspect()`；renderer 必須分開顯示「重新預檢 n/N」、「等待 Touch ID／Windows Hello」、「送出 n/N」、「Amazon 已接受 n/N」與「回查完成 n/N」。exact rejection 可隔離該 SKU 並繼續；回查未相符或失敗保留 accepted-pending 且不重送，PATCH `UPDATE_STATUS_UNKNOWN`、auth、context 或任何 receipt 綁定失效則停止尚未開始列。
- 單 SKU 文案 editor 接受 1–5 個產品要點；只有產品要點本身被編輯時，才可把 Amazon 同語系第 6 項後舊值納入 Exact Bullet Replacement。必須完整顯示目前要點、更新後要點與每個將刪原值，取得和本次 preview exact 綁定的勾選及原生確認；只改標題、亮點、敘述或成分時，overflow 要點必須完整保留。
- A+ 全站健檢必須以同次完整 FBA all-listings 證明 exact Seller SKU／ASIN，並用 relationships 排除已證明的 parent。完整 child／standalone 依 marketplace＋ASIN 去重讀取全部官方 publish-record pages；relationship 未完成列保留 exact FBA ASIN 只作 account-wide Content Documents／ASIN relations 的 match target，不得發該 ASIN 的 publish-record request，也不得以空結果誤標 missing。只有 exact publish record 或文件關聯的 schema-valid `CONTENT_PUBLISHED` 可證明已發布；文件存在或 APPROVED 本身不能冒充發布證據。同一 ASIN＋document relation 只要含 published positive 就必須保留，即使另有重複／較舊的 `CONTENT_NOT_PUBLISHED` 或 malformed row 也只能把證據完整度降為 partial；完全沒有 published positive 的 malformed／negative 關聯仍 fail closed。同一文件的重複 metadata 採最新 display data、標為 partial 並繼續遍歷 relations。只有 warning-free、完整分頁的 publish-record 空清單，且 Content Documents 與每份文件的 ASIN relations 亦完整覆蓋時才可標沒有 A+；任一 exact positive record 必須保留，即使 optional warnings envelope 無法解析也不得丟失。403、warning-only 空清單、文件／關聯覆蓋未完成、沒有 published positive 的 schema／identity 衝突、分頁缺口保持 unavailable／incomplete；介面可顯示官方文件名稱、文件審核狀態與關聯狀態，不建立公開 API 無法證明的 theme 或內容類型欄位。
- Subscribe & Save 全站健檢能以完整 FBA Inventory 分頁證明 SKU，正確顯示目前有效訂閱、最多 23 個已完成月份與缺月；開啟顯示全站歷史並能切換／取消單一 SKU。Excel 必須產生 0／5／10／15／20% 五張無問題工作表與獨立「問題 SKU」工作表；未知折扣、問題列與缺值不得冒充 0 或完整總額。
- FBA 冗餘庫存只依 Amazon `estimated excess quantity`，庫齡不會被列為冗餘；storage cost／AIS 缺值不會產生假的 0 或部分全站總額。
- 未綁變體健檢能以真實 FBA relationships fail closed 載入並匯出 Excel；工作簿必須含淡色 family banding 的 `所有變體`，以及第一列橫排已驗證 Parent SKU、各欄第二列起只接該 Parent children 的 `父變體橫排`。standalone／incomplete 只能留在各自工作表，不得混進 parent-column mapping。畸形、缺失或被改寫的識別碼不得被列為可安全操作。
- 品牌與品類營收能以同一份、同日期的真實 FBA Customer Shipment Sales report 核對總額；品牌保留未分類列，品類依 Supply 的最早關鍵字規則產生八類，切換不得另建相同 report。含站點今天時必須顯示實際 `dataThrough`；廣告覆蓋在 Ads API 尚未連線時必須維持 unavailable，不能宣稱已有真實 campaign 覆蓋結果。
- FBA 入庫貨件必須只出現在頂部「報表區」，不在首頁或「營運區」重複入口；並以真實 US 30 天背景 job 證明可完成。預期／Amazon 已接收／尚在接收／多接收、完整／部分 coverage、daily/problem-only 三層瑕疵邊界與 7-sheet Excel 均須驗證；安全失敗、空列或 unavailable 不得冒充 0 貨件、0 差異或 0 瑕疵。
- 廣告策略必須以真實 US 最近 30 個完整日證明目前 FBA、Sales & Traffic 與 SP Reporting v3 可完成；T1–T4、缺值不補 0、價格／SB／SD／規格人工欄保持空白，以及 3-sheet／29 欄 Excel 均須驗證。Ads LWA 未設定或 Reporting 未成功時只能標為未驗證。
- 首頁全站健檢外卡片必須區分未執行、執行中、成功、部分完成與失敗；「狀態收斂進度」不得因所有步驟都已結束而把全部失敗冒充成功。
- B2B 全站健檢必須用同次完整 all-listings 證明 FBA 範圍，exact 核對 Seller SKU／ASIN／marketplace，並把 configured／missing／above-standard／incomplete 分開；`不符建議 B2B 價格` 與 `未正確設定階梯折扣` 是獨立且可重疊的問題，USD 建議價為一般售價少 US$1.00，percent tiers 固定 5／5%、10／10%、15／15%、20／20%。audit owner／snapshot 固定唯讀，不在健檢清單顯示 PTD／唯讀／不支援篩選；問題列可逐列勾選或「全選目前可處理商品」，selection 只能包含 snapshot 已證明 eligible 的 exact Seller SKU，再交由獨立 main mutation owner。audit 清單與單 SKU editor 必須位於同一個單層 presentation surface（首頁寬版 workspace／非首頁既有 surface）內的互斥 content view，editor 底部固定保留「← 返回健檢結果」並恢復原清單 scroll position，不得疊第二個 modal，並保留 Seller Central handoff。完成 snapshot 的 Excel 必須由 main 綁 account／mode／marketplace／job／context 並固定五張工作表。Active Listings report 必須經 main-owned、account／marketplace／mode／type／options 綁定的 durable lifecycle single-flight 建立與沿用；data GET 不得隱含 POST。一般售價／Buy Box ERROR 與 Business Price／數量折扣證據分開；Active Listings 的 exact `Business Price` 可覆蓋較舊 Listings contribution，canonical `Quantity Price Type`＋連續成對的 `Quantity Lower Bound 1–5`／`Quantity Price 1–5` 可補足尚未同步的 `quantity_discount_plan`。Active 與 Listings 兩邊 canonical plan 相同才合併；衝突、duplicate headers／rows、缺口、斷層、malformed value、ASIN／身分衝突一律 ambiguous，不能被第三個 positive 洗掉；Active quantity 欄完全不可用時也不能抹除 Listings canonical plan。unknown evidence 不能冒充 mismatch，只有完整負面證據才可標未設定。單 SKU 或批次每列真實更新仍必須 fresh read，並由帶目前 Seller ID 的 seller-specific PTD 明確開放 exact B2B price path，再完成該列 Validation Preview 並呈現一般價、B2B、階梯與最低價 canonical diff；main 同時保留完成 audit 時的 exact Seller SKU／ASIN／Product Type，任一 fresh Preview 身分漂移都在 stagePreview／PATCH 前停止。階梯可安全編輯時預設 combined，price-only 仍可選並完整守住既有 `quantity_discount_plan` 與最低價。一般 replacement 只帶 exact `audience=B2B` contribution；唯一 `ALL` 例外限 US／USD、canonical 既有最低價高於本次最低階單價時，先以 opaque exact contribution 將 `minimum_seller_allowed_price` 降到最低階單價少 US$1.00，其他 ALL／audiences 不變，absent／ambiguous 最低價不得建立或猜測。combined 必須證明 canonical 1–5 階 percent tiers 與完整 QDP PTD path。最低價與 B2B 固定各自取得 Preview ticket、native confirmation 與 claim；一次批次 UI 動作不能合併兩種授權。批次 PATCH 固定先執行最低價階段、再執行 B2B 階段，每階段內依 selection 相對順序 serial 執行；每個 intent 取得 Amazon accepted receipt 並耐久保存後，dispatcher 必須立即移到同階段下一列，同一次正式送出不得 inline 做 canonical GET。editor 保留 accepted time、Request ID、old→new 差異、`canResend:false` 與回查狀態。main-owned bounded GET-only observer 或後續明確 GET 對 B2B intent 仍需 exact canonical B2B price／QDP target；最低價 intent 只以 exact identity、seller-specific PTD、FBA、目標最低價／幣別與沒有 price-scoped blocking issue 結清，非目標價格／QDP／hash drift 強制下一階段 fresh Preview 而不永久卡住。GET 不得重送 PATCH。最低價與 B2B 固定拆成兩次 Preview＋native confirmation：最低價 `ACCEPTED` 後該 intent 一定停止且 B2B 尚未送出，最低價 verified 後必須以最新 Listing fresh Preview＋新 native confirmation，不能背景續送或沿用舊 preview、approval、reservation。任何 partial／unknown 都禁止盲目重送；回查 observer 沒有 PATCH descriptor 或 retry surface。
- 會計中心只把公開 capability 與安全 access plan 標為完成；除非日後另行實作並驗證 report lifecycle，不得宣稱已下載報表、一般發票或 Seller Central 帳單。
- Variation family 與 CHILD PTD 必須先通過真實唯讀驗證；目前 mutation 只能標為 mock/demo 已驗證。只有在使用者另行明確授權指定 SKU，且 detach 與 attach 各自完成 preview、Touch ID、單次 PATCH 與唯讀回查後，才可對該次操作宣稱真實寫入成功。
- 寫入前顯示 canonical diff 與 exact Amazon Validation Preview 結果；只有通過 Preview 且重新綁定完全一致的 SKU 才可進入一次本機確認／Touch ID／Windows Hello。Excel batch 的 `INVALID` SKU 一律隔離、零寫入，不能靠 acknowledgment 或任何 override 進入確認。
- 寫入後回查；Amazon accepted 與 exact canonical verified 必須分開顯示。B2B `202 PROCESSING` 不是失敗也不是 live 成功，可能維持數分鐘；main-owned 自動 bounded observer 與使用者重新確認都只做 GET／reconcile／inspect，結果不確定時持續阻止盲目重送；accepted 後回查不阻塞同批下一個 serial PATCH。
- Secret 仍只存在各 Notebook Key 的本機加密 vault：macOS Keychain 或目前 Windows 使用者的 DPAPI，不進 Pages、renderer、GitHub、日誌或回覆。

## 12. 營運情報與本機事件

本輪核准 spec 與 source／發布證據分別見 [五項能力 spec](specs/2026-09-08-operations-intelligence.md) 與 [營運情報記錄](releases/2026-09-operations-intelligence.md)。以下是驗收條件，不代表已在真實 Amazon 或員工裝置通過。

- 五項功能都必須從首頁可達：Coupon／促銷、AWD 庫存與在途、Buy Box／價格健康、廣告成效、事件通知中心。既有七張健檢卡的名稱、順序與 run-all 行為不變。尚未同步、running、complete、partial、failed 與舊結果可能過期分開呈現；舊 Notebook Key 的新 route `404` 必須顯示升級提示。
- 促銷實際讀回資料與人工計畫保持獨立；已發布版本和最新修訂不得互相覆蓋。搜尋、selection 的空非終頁、重複 token、總數缺口、缺 issues、未知狀態與頁數上限都須驗證。商品只接受同次 exact FBA SKU＋ASIN；ASIN-only／SKU-only／CATALOG 保持 partial 或聚合提示，不猜參與商品、不宣稱已能建券。
- AWD 本版 US-only；在庫、賣家→AWD、共享可分配／保留與 AWD→FBA 在途分欄，不能重複加總或全數宣稱 FBA-owned。件／箱／板保留原單位，同單位才可計算差額；缺數量／效期保持未知，DELIVERED 不等於完成接收，差額不等於遺失。AWD 效期與人工日期、FBA FC 效期不可混用。
- 價格健康須逐項核對 batch status、ASIN、marketplace 及分段；同 seller 的 MFN offer 不是 FBA 得標證據，ASIN 分段也不能證明 exact SKU 或全體顧客的 Buy Box 資格。CPT、CompetitivePrice、WasPrice 各自保留，缺 exact 自售價為 null，整體資格保持 unknown，不推定 Chewy 因果、不自動跟價。
- 廣告成效只擴充既有 SP advertised-product／策略報表 owner，日期固定站點最近 30 個完整日，14 日歸因與報表期間分開說明。ACoS／ROAS、零分母、missing、身分未歸屬與歸因回補須誠實呈現；策略建議不是利潤或損益兩平保證。不發 Ads mutation、不捏造搜尋詞／CTR／CPC／SB／SD 資料，也不建立第二套報表生命周期。
- 本機事件須驗證同 source 去重、首次／最後觀察時間、亂序／重複時間、已知悉／恢復待處理，以及只有較新完整來源才能解除。partial／失敗不得解除未知問題；事件數與投影上限應揭露，鎖定、suspend、安全脈絡失效或 App 結束會清除。不能稱 Amazon push、全天通知或耐久稽核記錄。
- 自動同步預設關閉，使用者開啟後只排已完成來源；未執行、執行中或失敗不排下一次。停止後續排程與取消已啟動工作分開；離開面板只停止 observer，context 失效才清除 main 工作及事件。權限、分頁、日期／身分、abort、account／mode／marketplace／generation 切換及 late completion 都由 public seam 測試覆蓋，transport quota 不因清除 context 而重置。
- 三條新增 route 只接受 spec 的固定 intent；renderer 不取得憑證、原始 Amazon ID 或任意 transport。所有 Amazon 商品／價格／貨件／廣告寫入仍維持既有獨立授權；本輪沒有增加此類 mutation、雲端通知訂閱、額外憑證或共享商業資料外送。

## 2026-09-12 庫存健康與日常操作

- 保留共用公布欄的手動即期品、促銷及 schema 2 發布流程。自動庫存健康只存這台 Notebook Key 的加密檔案，依 main 的帳號／模式／站點分隔，不上傳 Supply Boss。切換 context 即清除畫面與未完成讀取。
- 效期與清售風險有獨立同步入口，取得全部 FBA 品項與同份報表近 7／30／60／90 天出貨量，接入 FBA 入庫計畫的申報效期；不受 180 天庫齡篩選或舊健檢工作成敗限制。庫齡與官方費用放在補充資料。同 SKU 多效期與來源分開保存。歷史申報數量、庫齡桶、SKU 總庫存皆不是現存批次餘量。
- 批次餘量由人工確認，綁定目前庫存快照；庫存、銷量、來源版本或報表日期變動後需重新核對。合計不可超過可售庫存；空白保持未知。停售日由使用者填入且不得晚於效期，不自行套用公司緩衝天數。
- 清售推估使用四個出貨視窗中最快的日平均，並按目標日期累計同 SKU 已確認批次餘量，避免把同一份銷量重複分配給每批。資料缺漏、矛盾、來源未完整或過期時一律待確認。預測不保證未來銷量；只有仍有正清售缺口的 SKU 進月曆，每 SKU 顯示最早需處理日，其餘批次留明細。
- US 價目表可不放原 Excel，從已確認的 FBA SKU／ASIN 產生含品名、Amazon 售價、最低價設定、首圖與缺值原因的新 `.xlsx`。缺價格不補 0；個別缺圖不阻止其他商品下載。原表比對與原檔保留流程保持可用。
- 字體、顏色模式與圖片門檻由 main 保存固定 enum 設定；重開前完成原子寫入，不藉由持久化 renderer session 保存偏好。
- 圖片整批依精確 SKU 與中間 `01`–`10` 數字排序配槽，實際可編輯槽仍由 seller PTD 證明，溢位檔不可靜默丟棄；錯 SKU、重複編號、失敗檔案逐項顯示，可修正後套用草稿。套用草稿不寫 Amazon，既有預覽、原生確認、一次 PATCH 與 readback 不變。
- 變體健檢預載工作區；dynamic import 下載失敗可在原頁重新載入工作區。程式執行錯誤不誤稱斷線，也不利用 reload 清掉未完成寫入。返回目的地、busy gate 與選擇狀態須通過回歸。
- Vine 目前使用使用者匯入 Seller Central 資料，並由 main 核對 US FBA ASIN 身分，原始貼文沒有 SKU 時不要求補造；不宣稱已有公開 Vine API。可直接貼 Seller Central 整頁文字，ASIN 與登記日形成身分；顯示所有仍在進行的登記，不受 60 日限制，進度為 Amazon Vine 評論／已註冊名額。已結束或取消項目排除，單頁缺席不視為結束；缺狀態列待確認。未知保持空值，不能以訂單、免費銷售或一般商品評論替代。資料只存本機加密檔；無法加密時明示僅本次工作階段，既有損壞檔不可默默覆寫。

- 預設圖片服務使用獨立 Supply Boss image audience；首次由 packaged 無網路登入視窗驗證下載頁密碼並以原生身分確認授權後，保存於獨立 OS 加密憑證檔；後續先 Touch ID／Windows Hello 授權再解密登入，取消或無生物辨識能力時 fail closed，不降級按鈕放行。新 session 只留 main 記憶體，鎖定不刪保存的加密登入資料。未配置自有 R2 也可整組準備；上傳結果不明只 GET 查詢，匿名讀回原檔 bytes 核對後才可用於預檢。下載、公布欄及 admin token 不互通。圖片確認頁顯示 exact SKU／ASIN 與變更位置，不要求重打 SKU；main 仍核對 fresh Preview、context／identity／PTD 及原生授權。缺少此能力的舊 Notebook Key 明示升級提示。完整規格見 [直接上傳、效期與 Vine 修正](specs/2026-09-direct-images-expiry-vine.md)及 [圖片生物辨識與確認](specs/2026-09-image-biometric-confirmation.md)。
