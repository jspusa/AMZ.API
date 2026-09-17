# 0.1.82 共用圖片批次更新交付紀錄

需求：[Issue #314](https://github.com/jspusa/AMZ.API/issues/314)。規格：[單張、多張與共用圖片](../specs/2026-09-shared-image-batch.md)。開工基準 `d380744ad45187680f0887e91d62d00fe74d88df`，獨立分支 `codex/shared-image-batch-20260917`；原工作目錄與未追蹤檔保留。

## 功能與驗證範圍

新增 loose-image intake、逐圖 exact SKU 目標／位置、唯讀同 family FBA 候選，以及 main-owned selected-slots intent。第 9 圖可套用數個 SKU，其他位置由 canonical 原值保留；既有資料夾完整替換保持原契約。舊 Bridge 只禁用新模式，不降級或誤刪圖片。所有實作驗證使用 fake adapters／fixture，不送真實 Amazon 更新、不修改提供的 OneDrive 原圖。

公開 seam 已先重現缺少 loose-image 入口及 sparse selected-slot 不受支援，再完成對應行為。聚焦驗證包含多 SKU 每個 exact SKU 各自準備、同圖不同位置、衝突與超限、family 部分結果／晚到回應、編輯使預檢失效、原圖漂移、來源到期、模式批准、single PATCH 與 GET-only recovery。完整檢查、兩軸 review、畫面驗證及發布證據於完成後逐層補錄。

## 分層狀態

目前為本機候選實作；尚不能由版本字串推定 CI、Pages、安裝檔、Notebook Key 安裝、下載卡或 authenticated download 完成。驗證與交付接續使用 `/tmp/amz-api-v0182-verified` 的 fail-closed helpers；config 必須固定最終 main source、四條成功 main/push run 與當次 artifact IDs。

保留既有 0.1.81 的 pending／accepted ledger；不得以新版驗收重送歷史圖片更新。沒有 live Amazon mutation、真人 Windows Hello、正式簽章或公開自動更新 feed 的新增證據。
