# 資料夾批次圖片更新與有限期圖片暫存

期限已依使用者最新決定改為一小時；下列初始七天／兩天餘裕條款由 [一小時暫存規格](2026-09-image-one-hour-retention.md) 取代，其餘批次契約維持。

## Problem Statement

Jasper 每次處理一組變體，通常 5–30 個 SKU；逐一開啟 SKU 並拖入圖片過於繁複。圖片雲端僅用於交給 Amazon 取得，不應永久累積原始圖片。使用者已明確選擇以每個資料夾作完整圖片組，清除多出的舊圖，並授權實作、測試及發布本功能。

## Solution

圖片工作台新增「資料夾批次更新」分頁。一次接受最多 30 個商品資料夾／30 個 exact SKU，每 SKU 最多 10 個編號位置、全批最多 300 張。可拖入多個商品資料夾或其上層資料夾，也提供選擇資料夾。檔名中的 exact SKU 與 01–10 決定配對及排序；01 為主圖。Amazon 實際允許的位置仍依 seller-specific PTD 驗證，介面上限不代表每個商品都支援十張。

每列先顯示 SKU、圖片數量與順序、錯誤，再準備圖片及取得 Amazon 預檢。整批核對頁顯示已驗證身分、原圖／新圖、替換位置與每個將清除位置；明確確認完整替換後，只要求一次原生確認，背景逐 SKU 提交。

Supply Boss 改成 7 天暫存：到期即停止提供網址，固定定期清理工作實際刪除圖片並釋放 active 容量。清理涵蓋未送出的圖片。既有 v1／v2 圖片採一次性七天遷移緩衝，不立即清空。圖片保留期限是本產品的暫存政策，不是 Amazon 保證七天內取圖；accepted 或 canonical contribution URL 並不證明已下載，不據此提前刪除。

## User Stories

1. 使用者可拖入一組變體的商品資料夾，省去逐 SKU 開啟工作台。
2. 使用者可沿用 `AF_US組圖_AFA12AM_V11` 與 `AFA12AM_01_主圖.jpg` 這類命名，不必重新命名。
3. 使用者看到每列排序縮圖，確認主圖與副圖順序。
4. 重複 SKU 版本、重複位置、缺主圖／編號斷層、錯誤格式或超限必須標示，不猜測或靜默丟檔。
5. 每個 SKU 的資料夾是完整圖片組；若只提供九張，核對頁列出第十張刪除，唯讀或必填位置無法完整替換時阻止該 SKU。
6. 有問題的 SKU 明示本批不送出，其他獨立安全列仍可核對。
7. 全部準備與預檢完成後，使用者一次指紋核准精確列出的整批變更。
8. 已接受、已確認、結果未明、未送出分别呈現；不把接受收據當作成功取圖或完成。
9. 圖片只暫存七天；前台顯示期限，準備證據不足兩天時重新準備後才可寫入。
10. 鎖屏、睡眠、切換帳號／站點或重啟撤銷舊批准；未送出者需重新核對授權，已接受／未知者只唯讀確認。

## Implementation Decisions

- main-owned batch plan 固定 context、exact SKU／ASIN／Product Type、原圖／目標向量與刪除範圍；renderer 只提供意圖及 opaque batch／review handles。
- 重用圖片 mutation operations 和 Write Gate；新增 images-batch family、十五分鐘票證與既有 listing-attribute collision reservation。
- fresh read／PTD／Validation Preview 在初次、原生批准前與送出前核對；整批每個 exact intent 最多一次 PATCH，接受後分開做 bounded GET observers。
- batch 僅接受 main 驗證過 bytes、同帳號／SKU 與期限的圖片準備證據；單 SKU 新增暫存來源也核對期限。
- 一次只讀取／傳送一張原檔；批次回覆省略整張 base64，前台採可釋放的本機預覽。資料夾遍歷有深度、檔數及項目總數上限，分頁讀完才發布完整清單。
- 保留既有 v2 固定 URL／hash、單次 PUT、unknown GET-only；expiry receipt 驗證後才回傳準備完成。
- server 僅可清理自己判定到期的 listing-images v1／v2 物件，禁止任意 key／bucket／URL／credential 輸入。實際 delete 並確認不存在後才回收 active quota；小型操作 tombstone 與圖片 bytes 分離。
- AMZ.API 的每小時 GitHub Actions 維護工作呼叫固定空 body 清理入口，且每次新準備也觸發有界清理。排程可能延遲，網址到期與物理刪除完成分開記錄；清理失敗不能宣稱釋放容量。
- 自訂上傳限制調整為同 IP 每 UTC 小時 600、每 UTC 日 1,200、全站每 UTC 日 2,000；active 圖片最多 10 GiB／10,000 張。這不是供應商付費方案，也沒有新增訂閱。
- 此功能需要 Notebook Key Release；Pages 的新入口遇到舊 Bridge 顯示升級提示。

## Testing Decisions

沿用公開 renderer 操作、ApiRouter／mutation owner、Write Gate、圖片 preparation port 及 Supply Boss HTTP seam。以合成圖片與 fake clocks 驗證真實可觀察行為；不以測試發送真實 Amazon mutation。

覆蓋 5 SKU／45 圖配對、30 SKU／300 圖上限、31 SKU 拒絕、資料夾分頁／深度／歧義、完整替換與刪除、單次 native approval、serial PATCH、accepted/readback、context drift／取消／雙擊／unknown 不重送、expiry／期限不足、HTTP 410、實際刪除與容量回收、legacy grace 及非圖片物件保留。完整 check、production audit、兩軸 review、深淺色桌面／窄畫面及發布分層驗證。

## Out of Scope

不建立或修改變體關係，不產生新圖片、不做永久相簿、不更動本機／OneDrive 原檔。程式驗收不授權真實 Amazon 圖片 PATCH；使用者稍後選定 exact 商品並完成原生批准才送出。

## Further Notes

- [Amazon media sources and image variants](https://developer-docs.amazon/sp-api/lang-en_EN/docs/submit-media)：Amazon 需可讀來源；支援位置按 Product Type／站點決定。
- Sites 僅提供既有 R2 binding，未提供可設定的 R2 lifecycle／cron control；因此使用 repo 定期維護工作，以及新上傳附帶的少量背景清理；新上傳不等待舊圖清理，不能把 HTTP 過期當作已物理刪除。
