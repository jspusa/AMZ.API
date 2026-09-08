# 2026-09 營運情報與本機事件

日期：2026-09-08。這是本輪 source 變更與驗收邊界記錄，不是發布、安裝或 Amazon live 成功證明。

- SOURCE baseline：`69a395096b1fdbf23be94c804a0aea1a4d523a24`。
- 工作分支：`feature/operations-intelligence`。
- Source package：`0.1.56`；更新 channel 保持 `disabled`，不是已發布安裝包。
- 核准範圍：[五項營運能力 spec](../specs/2026-09-08-operations-intelligence.md)。使用者已核准五項功能、Notebook Key 開啟期間的本機通知，以及 public seam 測試方式。
- 外部依據：[固定 commit 與授權查核](../research/2026-09-08-amazon-operations-sources.md)。參考 Amazon 官方 Models／Samples 與 Bizon TypeScript 客戶端結構，獨立實作固定語意；本輪沒有複製第三方功能程式碼或新增套件依賴。

## 五項能力與限制

### Coupon／促銷同步

`PromotionsReads` 讀取固定 Promotions `2025-12-01` 搜尋、明細及 selection。搜尋使用 `revision=ANY`，主體與 `latestRevision` 分開；失敗的最新修訂不覆蓋仍生效的已發布狀態。參與商品含 benefit selection，以及存在時的購買條件 selection；人工促銷計畫與公告日曆保持原資料，不自動覆寫或發布 Amazon 讀回資料。

只有同次 current-FBA 證據與回應中的 exact Seller SKU＋ASIN 配對一致時，才列出商品。官方允許 ASIN-only 或 SKU-only 的 item，但本版不猜其另一個識別值；這些資料、CATALOG 及無法歸屬的活動保持 partial／聚合提示。分頁空白但有下一頁 token 時續讀；重複 token、總數缺口或安全上限不能標為完整。缺失的問題欄不是「沒有問題」，已讀到的有效問題仍保留。原始 promotion／selection／tracking ID 留在 main，公開 key 使用雜湊。

本版沒有建立、修改、取消 Coupon，也沒有促銷成效報表整合；促銷是否可用與角色授權仍須用使用者帳號驗收。

### AWD 真實庫存與在途

`AwdInventoryReads` 本版只開放 US／NA。由固定 AWD `2024-05-09` 庫存、入庫貨件清單與明細讀取在庫、賣家→AWD 在途、共享可分配／保留、AWD→FBA 在途及 API 有回報的 AWD 效期。顯示範圍由同次 current-FBA SKU 證據限制；這個配對不是「所有 AWD 貨物專供 FBA」的證明。

AWD 是多下游通路共享貨源，各階段分開顯示，不自動加總進既有補貨供給。貨件明細保留 `PRODUCT_UNITS`／`CASES`／`PALLETS`，只在同 SKU、同單位且資料可驗證時顯示差額；不套用 24 箱／板去猜官方缺失的換算。空值不補零，`DELIVERED` 不等於全部完成接收，差額不直接稱遺失。沒有 AWD 效期資料不代表沒有效期，也不是 FBA FC 批次效期。沒有建立貨件、下單或承運確認。

### Buy Box／價格健康

`PriceHealthReads` 使用官方 Product Pricing `2022-05-01` 的固定 Competitive Summary 唯讀 batch；外層為 POST，但每個封閉子項固定 GET，並非調價。ASIN 每批最多 20 項，逐項核對 status、ASIN 與 marketplace，app-session pacing 不因帳號／mode cache 清除而重置。

Featured Offer 是 ASIN 的顧客分段證據；把它放在目前 FBA SKU 列旁，不代表 Amazon 已證明該 exact SKU 得標。自身 seller、AFN／MFN、會員分段、商品價與運費分別保留；MFN 的自身 offer 不是 FBA 得標證據。`CompetitivePriceThreshold`、`CompetitivePrice`、`WasPrice` 各自顯示，整體資格固定為 unknown。沒有 exact-SKU 自售價來源時保留 null，不拿任一 featured price 冒充自己的現價；不能據此斷言 Chewy 是原因或自動追價。

### 廣告成效診斷

`createOperationsSourceReaders` 接回既有 `ReadOnlyAdvertisingCoordinator` 的策略工作；同一個 `FixedReportBroker` 繼續唯一擁有 All Listings、Sales & Traffic 與 SP advertised-product 報表的建立、耐久沿用、輪詢及下載。沒有再建立第二套報表生命周期。

本入口固定使用站點時區最近 30 個已完成日；`sales14d`／`purchases14d` 的 14 日是 Ads 歸因視窗，不是報表日期範圍。`buildAdvertisingDiagnostics` 在既有已核對快照上顯示 SP 花費、歸因銷售、購買次數、ACoS／ROAS、策略建議及規則依據，保留各來源時間。缺列、身分衝突、缺值或尚未回補都不補成零；零分母不產生 Infinity。高 ACoS 與有花費但零歸因銷售只提示人工核對，不是商品利潤、損益兩平或沒有成交的結論。

本版沒有搜尋詞、CTR／CPC、SB／SD 診斷或廣告／預算修改。報表等待沿用既有工作，不以逾時自動重建報表。

### 事件通知中心

`OperationsEvents` 彙整四個來源的已驗證 findings，保存來源、首次／最後本機觀察時間、去重 key 與待處理／已知悉／來源已確認解除狀態。已知悉不等於已解決；只有同來源較新且完整的 snapshot 證明問題不再存在，才解除舊事件，partial／失敗不得解除。舊或相同時間的重複觀察不覆寫較新狀態；再次出現的已解除問題重新開啟。

事件只存在本次 Notebook Key 程序記憶體，最多保留 5,000 筆、一次投影 500 筆，另回傳省略數量；這是有界工作記錄，不是耐久稽核帳本。鎖定、suspend、憑證／帳號／mode 安全脈絡失效或 App 結束後清除。它不是 Amazon Notifications push、作業系統推播或 App 關閉後的雲端服務；沒有建立 SQS／EventBridge、notification subscription、destination、額外憑證或付費雲端資源，也不把商業資料送往人工公布欄。

## 唯一新增路由

| Exact route | 固定意圖與公開輸入 |
|---|---|
| `GET /api/operations-intelligence` | 只讀目前本機狀態；query 僅 `marketplaceId`，不隱含同步或建立報表。 |
| `POST /api/operations-intelligence/sync` | 啟動指定來源／`all`，或設定 `autoSync`；JSON 僅 `marketplaceId`、`source`、`autoSync`。來源限定 `promotions`、`awd`、`price-health`、`advertising`。 |
| `POST /api/operations-intelligence/events` | 本機事件已知悉／恢復待處理；JSON 僅 `marketplaceId`、`eventId`、`status`，status 限 `open`／`acknowledged`。不能手動宣告問題已解除。 |

`ApiRouter` 只組合及委派，`OperationsIntelligenceCoordinator` 單一擁有 session、來源工作、排程與事件。所有工作綁 exact account／mode／marketplace／generation；同來源 single-flight，取消與 late completion fence 防止舊工作復活。renderer 只能取得 schema-validated、安全投影的資料與隨機本機 context/event handle，不能提供 region、account scope、Seller ID、任意上游 URL、HTTP method 或 token。

## 排程與介面

首頁「營運情報與事件」提供五個分頁、四項來源一鍵同步、單來源同步、事件回到來源與已知悉操作。既有首頁 run-all 的七張健檢卡及順序不變。

自動同步預設關閉，需使用者明確開啟。只有已啟動並完成為 complete／partial 的來源才安排下一次：促銷、AWD、價格健康於完成後 15 分鐘，廣告於完成後 60 分鐘。未同步、正在執行或失敗的來源不排下一次；失敗須手動核對後重新啟動。關閉自動同步清除後續排程，已開始的同步仍會完成；離開面板只停止 renderer observer，不撤銷 main 工作。鎖定／suspend／安全脈絡失效或 App 結束會停止工作與排程。

尚未同步、執行中、完整、部分與失敗各自可見。重新同步中或失敗仍有舊 snapshot 時標示「上次結果／可能過期」，不能冒充本次成功。舊 Notebook Key 對新 route 回 `404` 時顯示升級桌面程式提示；這次包含 main 能力，不能只部署 Pages 就宣稱可用。

## 驗證與發布證據

下列狀態分層記錄；尚未完成者保持 PENDING。

- Focused public-seam tests：PASS；包含四個實際 source owner、既有 broker／Ads、事件 owner 與真實 renderer parser 的端到端 fixture 整合。
- `npm run check`（typecheck／tests／build）：PASS，exact source `b1f0fcc4c1c2eff9226d7bc191519ee9a73b0faa`，279 個檔案／2,882 項測試，包含 22 項新 renderer 互動測試；main、preload、renderer build 與 CSS rule-stream 驗證通過。
- `npm audit --omit=dev`：PASS，0 vulnerabilities，未新增依賴。
- 瀏覽器外觀驗收：未完成。隔離 fixture 已打包，但此環境的 Cloud browser 拒絕同步檔案 URL；未以其他路徑繞過，沒有截圖或實機外觀成功證據。
- `git diff --check`：PASS。
- Standards review，相對 SOURCE baseline：首輪 3 項 P2 全部修正並於 `b1f0fcc` 複核通過：purchase-selection ID 遮蔽、AWD 取消後 token 競態、事件容量與清除說明。獨立聚焦驗證 71 項通過，未發現新的邊界違規。另有 1 項非阻擋的 bounded JSON decoder 重複程式建議；共用解碼器重構留後續，端點固定 transport 與重試政策維持分開。
- Spec review，相對 SOURCE baseline：首輪 3 項 P2 全部修正並於 `b1f0fcc` 複核通過：合法純數字 SKU、促銷 missing issues 與空陣列區別、事件保存／投影上限揭露。獨立數字 SKU 聚焦驗證 7 項通過，未發現新功能回歸或未要求的擴充範圍。
- 修正後再次驗證：PASS；新增取消競態、純數字身分、已知問題與未知欄位、purchase-selection 識別遮蔽及空事件容量揭露回歸。Price Health 同步補上 token／fetch 前取消檢查。
- 首輪本機 source commit：`d830b8729733c80ff89aa55fb4a14103f3748be5`；後續審查與證據提交另列於 git history。
- 修正與已驗證 source commit：`b1f0fcc4c1c2eff9226d7bc191519ee9a73b0faa`。兩種 SKU（`FBA-ONE` 與合成數字 SKU）皆通过四來源、五事件、renderer 與本機已知悉的完整 fixture 路徑；測試資料不是使用者 Amazon 資料。
- Push／PR／同 SHA Actions：BLOCKED。推送新分支被環境安全審核拒絕，要求使用者明確批准將新增原始碼發布至 `jspusa/AMZ.API`。沒有改用其他傳輸途徑繞過，也未建立 PR、合併、觸發發布或取得 Actions 證據。

本輪沒有使用真實 Amazon 帳號呼叫或 mutation，沒有部署雲端通知，也沒有發布簽章桌面版。Source 驗證、Actions、Mac／Windows artifact、安裝與 Amazon live 是不同證據層；本文件不把任何一層推定為下一層完成。正式 Notebook Key 版本、簽章及更新 channel 仍依 [ADR 0001](../adr/0001-separate-console-and-notebook-key-releases.md) 與 [signed-update preflight](signed-update-preflight.md) 處理。

Live 驗收需在新版 Notebook Key、正確帳號及角色下分別核對五項能力：實際促銷 selection 的識別完整度、US AWD 的庫存／單位／效期、Pricing 分段語意、SP 報表日期與歸因、通知去重與 context 清除。Windows Hello、Touch ID、DPAPI、簽章更新與既有 mutation 安全仍依原驗收矩陣，fixture／Linux build 不能代替實機證據。
