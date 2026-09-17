# 先前圖片已受理後開始新的更新

追蹤：[Issue #320](https://github.com/jspusa/AMZ.API/issues/320)。

## 使用者更正與範圍

2026-09-17，使用者明確更正 #317 的範圍：先前完整圖片組已被 Amazon 受理，之後仍要能更新其中一張共用圖；只改善「先前結果不明」提示或要求一直回查，沒有完成需求。主例是第一天送出九張圖片已 `ACCEPTED`，第二天另選第 9 圖套用多個 SKU；舊 Amazon CDN URL 尚未符合 canonical 條件，不應一律阻擋這次獨立的新更新。

本規格接續[共用圖片](2026-09-shared-image-batch.md)及[進度與恢復](2026-09-image-batch-progress-recovery.md)，取代後者「任何 unresolved accepted 均阻擋新圖片 intent」的範圍；舊 intent 的不可重送與真正結果不明的保護保留。使用者已直接要求實作，不增加額外人工批准流程；正式 Amazon 寫入仍保留既有每次原生確認。

開工基準為 main `ebe95660c273f2171b3a4960aa782966de1251c5`，已安裝前版 Notebook Key `0.1.83`，本輪目標 `0.1.84`。測試只用合成身分與圖片，不記錄私人批次、原始 Amazon payload 或憑證。

## 使用者可見行為

- 有可信的先前圖片 `ACCEPTED` 證據時，使用者可開始獨立的新圖片更新。新的指定圖位、完整 canonical 原值及本次差異重新核對，經 fresh Validation Preview 和新的 Touch ID／Windows Hello 確認後，才送出這次新 intent；不必先等舊圖片 URL canonical verified。
- 同圖重套、換位及還原也可構成使用者刻意開始的新工作，仍須重新核對與原生確認；新 UUID 或圖片 hash 本身不是授權。
- 第 9 圖更新只改第 9 格，其他圖位以本次 fresh canonical 狀態保留。共用圖片的一圖多 SKU、手動配對、完整資料夾模式、進度及系列選取維持既有契約；批次最多 30 SKU／300 個套用組合／每 SKU 10 位置。
- 畫面分開表達「先前已受理、尚未確認」與本次新預覽／未送出／已受理的狀態。舊 receipt 不能證明本次完成；新更新也不把舊操作標為 verified。明確錯誤或結果不明時顯示原因，不引導盲目重送。
- 既有「找回先前圖片進度」與手動刷新繼續 GET-only。canonical verified 仍依原本嚴格條件判定；不同網址、相同張數、外觀或經過時間不算圖片內容相同的證據。

## 安全與持久化契約

- 新工作必須有新 intent／idempotency identity，不能重播先前的 Preview Ticket、批准或相同 key。每個新 intent 維持 fresh exact account／mode／marketplace／generation、Seller SKU／ASIN／Product Type、FBA、seller-specific PTD、完整原值、Validation Preview、不可變 review binding、原生批准、耐久單次 claim、serial PATCH 與唯讀回查。
- 僅可信、完整、身分相符的 image `ACCEPTED` receipt 可作為開始新圖片工作的前筆證據。已存在操作卻沒有可信受理結果（含 null／malformed／歧義）、真正 unknown、未完成 claim 或文案 collision 仍 fail closed；不能回退較舊的 accepted／success 來跳過最新阻擋，也不放寬其他寫入領域。
- main 在 Preview 時綁定當時前筆證據的 revision；提交及 atomic durable claim 再核對同一前筆證據。若其間有新操作、unknown、context 或紀錄變更，舊預覽失效，不能藉已檢查過的 accepted 狀態繞過較新的阻擋。final claim 與送出之間維持原有 final fences；並行新預覽不得取得重複寫入權。
- `MainWriteGate`／`LocalStore` 擁有此證據與原子檢查；renderer 只提交經驗證的公開意圖，不能指定任意 ledger 狀態、覆寫 predecessor、解除未知或授權上游 transport。欄位名稱依實作決定，行為與持久化條件必須可驗證。
- 保留舊 receipt、原狀態與防重送紀錄，不以刪除、清空或假造 verified 來放行；重開後仍可辨識歷史操作與新的操作。持久化失敗、可能已送出、回覆不明時保留未知並停止；同一 key 不再送第二次 PATCH。
- 不加入自動保留期限放行、背景重送、URL 等價猜測或時間到期解鎖。既有圖片一小時暫存、來源餘裕、票證期限、取消／鎖屏／context invalidation 與遲到回覆 fences 保持有效。

## 公開接縫驗證

- 以公開 batch mutation owner 配合真正 `MainWriteGate`／`LocalStore` 重現主例：先前九圖 `ACCEPTED`、canonical URL 尚未相符；新的第 9 圖可完成 fresh Preview、新原生批准及每 SKU 唯一一次 PATCH，其他圖位保留。assert 舊 receipt／未確認狀態保留，沒有舊 intent 重送。
- 單 SKU 圖片更新具相同行為與安全條件；不能只有批次入口放行，也不能讓單 SKU 繞過 batch 的未知保護。renderer／route 公開操作驗證新更新不再被一律導向舊 GET 恢復，保留真實進度、逐 SKU 差異與舊 Bridge 能力界線。
- 負例覆蓋相同 idempotency key、null／malformed／歧義／unknown、content collision、最新 unknown 覆蓋舊 accepted、Preview 後 predecessor revision 改變、並行 claim、context／FBA／PTD 漂移、過期、批准取消及持久化失敗；不取得不該有的送出能力、不產生第二次 PATCH。
- 保留 GET-only 恢復與 strict canonical 回歸，以及完整資料夾、selected-slots、進度、系列全選等既有測試。避免只測新純 helper 或繞過真正 durable owner 的 fake gate。
- 完成聚焦測試、`npm run check`、`npm audit --omit=dev`、`git diff --check` 及固定候選獨立 Standards／Spec review。發行以 Notebook Key `0.1.84` 為目標，最終 source／CI／artifact identity 只在實際產生後鎖定；分層證據見[本輪帳本](../releases/2026-09-image-new-update-after-accepted.md)。

功能驗收不送真實 Amazon mutation；實機檢查、安裝、下載卡與 authenticated download 依證據分開記錄。此處新增的是使用者明確開始的新工作，不是恢復舊操作時自動寫入。
