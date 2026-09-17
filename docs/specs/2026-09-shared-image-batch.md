# 單張、多張與共用圖片批次更新

## 問題與範圍

Jasper 要在現有圖片批次工作區直接拖入一張或多張圖片，並把同一張共用圖一次套用到多個 SKU，不必先整理成資料夾或逐 SKU 開啟工作台。例如 `AFA21AM_09_系列底圖_模板.jpg` 應辨識 `AFA21AM` 與第 9 張位置，讓使用者選取其他商品及手動輸入完整 SKU。使用者已要求直接實作並交付；圖片內容只作示例，不是修改其他商品或送出 Amazon 更新的授權。

## 已定案行為

- 保留原資料夾完整替換流程，另提供單張／多張圖片的拖放與選檔。共用圖片使用「只更新指定位置」模式；每個 SKU 未選到的位置完整保留，不要求補主圖或連續編號，也不清除其他舊圖。
- 檔名中的完整 SKU 與 `01`–`10` 只作初始配對提示；每張圖片顯示縮圖、位置及目標 SKU，使用者可改位置、加入或移除 exact SKU。無法唯一解析的檔名保持待填，不猜 SKU 或位置。
- 可由提示 SKU 經既有唯讀 family API 找到同群 FBA 商品供選取。清單顯示 exact SKU 與已回傳品名；只有完整、身分相符的 family 可供整群選取。未完整、FBM、parent、身分衝突或讀取失敗明示原因，不把 SKU 前綴相似當成變體證據，也不自動選取整個系列。
- 每張圖可手動輸入多個完整 SKU，支援一行一個；空行可略過，重複項目明示提示，不以大小寫、trim 或 alias 改寫識別值。手動目標不需先加入相同 family，但仍須通過 main 的逐 SKU 身分、FBA、圖位與預檢。
- 全批最多 30 個不同 SKU、每 SKU 最多 10 個不同位置、最多 300 個圖片與 SKU 的套用組合。相同 SKU／位置出現不同檔案必須阻擋並提示衝突，不能以後檔覆蓋或靜默截斷。
- 準備與預檢前呈現全部配對及錯誤；核對頁逐 SKU 顯示已驗證身分與實際原圖／新圖、指定位置，並明示其餘位置保留。準備、預檢與確認期間編輯配對會使舊核對失效。
- 沿用一次原生批准、逐 SKU serial single PATCH、accepted 與 GET-only canonical verified 分離，以及找回先前進度。unknown／accepted 不出現重送入口，程式驗收不送真實 Amazon mutation。

## 實作與安全契約

- `ListingImageBatchMutations` 擴充明確的 selected-slots 模式；legacy complete 模式繼續沿用原完整替換及刪除揭露。模式、排序後的指定位置、全部原圖／目標圖與身分納入不可變 main-owned plan 與 review binding。
- main 從 fresh canonical snapshot 合成完整目標向量；selected-slots 只覆寫使用者指定的位置，不能接受 renderer 宣稱的未選原值或刪除範圍。fresh read、seller-specific PTD、Validation Preview、原生批准前重新預檢與最後 transport fence 全部保留。
- 使用既有 `POST /api/uploads/listing-images` 逐 exact SKU 準備相同檔案，保持 context／SKU／bytes／expiry 綁定。共用原檔不等於 renderer 可跨 SKU 重用另一筆準備授權；不新增 Supply Boss server 路由或儲存權限。
- 沿用一小時暫存、超過十分鐘來源餘裕、最長十五分鐘核對票證、既有 image-only PUT／GET 與 unknown GET-only 恢復。到期、Amazon accepted、canonical 相符及實際圖片下載／清理是不同證據。
- family API 僅提供候選，不取得 mutation authority；手動與自動提示的每個 exact SKU 都由 main 重新驗證。錯誤公開文案保持既有 sanitizer，帳號／模式／站點／generation 改變時清除舊候選與準備狀態、拒絕遲到回應。
- 此變更新增 Notebook Key 的批次意圖能力，預計版本 `0.1.82`；舊 Bridge 不支援時明示更新，禁止把 selected-slots 意圖降級為 complete。既有 folder 模式及 recovery DTO 保持相容。

## 驗證與交付

公開 renderer 操作覆蓋單檔、多檔、檔名提示、人工補填、逐圖多 SKU、唯讀 family 建議與不完整結果、衝突／超限、取消、context 變更、遲到回應及舊 Bridge。主例為一張第 9 圖套用數個 SKU，其他位置逐字保留；另驗多張圖各自不同 SKU 組合。

mutation owner 與 ApiRouter public seams 驗證 selected-slots 合成、指定圖位無權限、原圖漂移、準備授權不可跨 SKU、expiry、票證模式綁定、單次 native approval、serial PATCH、接受後 GET-only 回查、雙擊與 unknown 禁止重送；原資料夾完整替換回歸仍通過。使用合成圖片與 fake adapters，不改本機／OneDrive 原檔。

完成聚焦測試後跑 `npm run check`、`npm audit --omit=dev`、`git diff --check` 及 Standards／Spec 兩軸 review。分開記錄 exact source、CI、Pages bytes、Mac／Windows 可信 artifact、保留 vault／ledger 的安全安裝、下載卡及 authenticated download bytes；本機／CI 不代替 live Amazon 或真人 Windows Hello 證據。

## 不包含

不產生或修改圖片、不猜同系列所有 SKU、不改變變體關係、不建立永久相簿、不變更雲端圖片服務，也不為程式驗收對 Amazon 送出正式更新。
