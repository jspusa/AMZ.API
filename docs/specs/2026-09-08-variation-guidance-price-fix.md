# 變體唯讀值、未綁建議與價目表操作修正

使用者於 2026-09-08 要求直接完成修正及更換程式。基準為 main `d79f7ac18b7b8f964866da8cfa17a3bec1179b0f`（0.1.57）。沿用既有 public seams，不新增 Amazon mutation 類型。

## 變體資料

- CHILD PTD 的 immutable/readOnly 維度若已有唯一、完整、符合目標的既有值，可以保留此值加入 family；payload 不得再次 PATCH 此欄位。缺值、值改動、selectors 歧義或漂移仍停止。
- preparation、preview、commit、readback 使用同一份精確證據；preview 後的 PTD／資料漂移必須使舊票證失效。
- 已確認 standalone 的 FBA SKU 可直接進入 attach；摘要商品數與來源清單一致，刪除與現行能力矛盾的說明。
- 回歸涵蓋 ITEM_SHAPE/SIZE、不可改的 shape、可編輯 size、未知／歧義與 readback。

## 從未綁商品開始

- 變體規劃區直接沿用既有全站未綁變體健檢工作、快照、進度與結果，不重複建立另一份報表。
- 僅列出 relationships 已確認 standalone 的 FBA 商品供開始操作；incomplete 不冒充未綁。
- 從同一快照的 verified child 分組既有 parent，依相近貨號系列及相容商品類型產生排序建議。用表格、星星、相近已綁 SKU、數量與理由說明；GCBL06 應能找到含 GCBL01/02/03 的候選 family，AFA 類系列亦適用。
- 證據不足、同分、不同類型等須可辨識；SKU 相似只供參考，不自動綁定。
- 選擇來源／候選後重新讀取 exact family、主題與維度，再進原有填寫、重複組合檢查、Preview 與 native approval。

## 價目表

- 主流程清楚呈現「選原表 → 讀取 Amazon → 看差異 → 下載比對版」，依階段只突出下一步。
- 未開始、正在確認 FBA、逐列讀取、讀取失敗、沒有 FBA 對應、歧義、欄位未設定各自說明，不一律顯示未取得。
- 全域失敗保留原表各列與可理解的階段／原因／恢復動作；讀取中已完成的資料可檢視。
- 用使用者原表實際執行唯讀價格讀取，區分已驗證的 transport 問題與操作不清楚造成的誤解；不可為補資料而猜 Seller SKU、補零或改用無法證明的價格。
- 保留原表原位元組下載、原版面、可選 Amazon 首圖、原標準售價／Amazon 設定售價與原最低活動價／Amazon 最低價格設定，以及兩份 Excel 差異。次要功能收在明確說明的入口。
- 已完成結果才允許下載比對版；沒有任何已確認售價時不輸出冒充完成的比對表。

## 交付與邊界

先 public seam RED→GREEN，再執行完整 check、production audit、固定基準的 Standards／Spec review、Pages／兩平台 artifact／受保護下載／Mac 安裝驗證。保留 vault 與舊版備份。真人 Touch ID、Windows Hello 與 live Amazon mutation 分開列為未驗；本次只允許唯讀 live 驗收，不自行提交 Amazon 更新。
