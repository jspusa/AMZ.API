# 0.1.83 圖片批次進度與恢復交付記錄

2026-09-17；追蹤 [Issue #317](https://github.com/jspusa/AMZ.API/issues/317)，規格見[圖片批次進度與恢復](../specs/2026-09-image-batch-progress-recovery.md)。此處只記錄已取得的證據，準備狀態不代表已發布或安裝。

## 固定範圍

圖片準備及 main-owned 背景預檢顯示實際進度；舊 durable 操作在原生確認前阻擋時，本次各列明示尚未送出。使用者可直接用本次 exact SKU 另行唯讀回查舊操作，保留新圖草稿。系列建議支援整列勾選與有界的全選／取消，保留手動目標。指定圖位保留其他原圖、FBA／PTD／原生確認、耐久防重送及 exact canonical 回查條件不變。

## 目前證據

| 層次 | 證據與狀態 |
|---|---|
| ★ 開工基準 | main `09460121cefb51bee7dc87dbdbd7a1976c89e14b`；基準 Notebook Key `0.1.82`。修正分支為 `codex/image-batch-progress-recovery`。 |
| ☆ 最終程式／PR | 尚未固定 final candidate、合併 source 或 PR；目標版本 `0.1.83`，不能用開工基準冒充新版本來源。 |
| ★ 本機驗證／review | `VITEST_MAX_WORKERS=4 npm run check` 通過 339 files／4,451 tests，typecheck、build 與 CSS composition／build parity 通過；production audit 0，diff check 通過。route 公開接縫聚焦 8／8 通過。Standards／Spec 兩軸 review 均 0 open，包含最終固定進度區增量；Spec 另獨立核對 main 背景預檢與 cross-content blocker 分類。先前 mixed verified／no-record 接續缺口已修正並補 renderer 回歸。最終 SHA／tree 對應仍待鎖定。 |
| ★ 本機視覺 | production renderer 配合 fake Bridge 完成 44 個情境：8 個系列選取／預覽，36 個準備、逐 SKU 預檢、先前操作阻擋及恢復情境；後者涵蓋 1440／800／390px 亮暗模式。整列品名／ASIN／空白及鍵盤切換、全選／保留手動 SKU、進度固定位置與控制項可操作均通過；沒有頁面溢位、page／console errors。測試的本機 commit request 為 mock，native approval／Amazon PATCH 都是 0。 |
| ★ 發行工具準備 | `/tmp/amz-api-v0183-verified/` 從 `.82` 現有工具建立獨立副本；12 組純合成測試、183 個案例通過，Python／JavaScript 語法檢查通過；原 `.82` 工具及證據未修改。只有空 identity template，沒有 `release-config.json`；缺 identity 時拒絕操作指令。 |
| ★ 已安裝前版 | 唯讀重新核對 `/Applications/AMZ.API.app` 版本 `0.1.82`，ASAR `ee5c322d1c8276fd9e98db780826df0f95acb6fdf14492a7552b319dad7029e2`，與 `.82` 既有 source／CI／artifact／installation proof chain 一致。這不是 `.83` 安裝證據。 |
| ☆ exact CI／Pages／產物 | 新版 source、四個成功 workflow run／attempt、三個 artifact ID 全部待實際結果後鎖定；尚未下載或驗證 `.83` payload。 |
| ☆ 安裝與受保護下載 | 未執行 `.83` 備份／安裝／上傳／authenticated download。安裝前仍須確認未完成工作、正常結束 App、建立最新備份並比對 vault／ledger；維持既有受保護下載與 disabled 更新通道。 |
| ☆ native／live Amazon | 本輪程式驗收不送出真實 Amazon mutation；真機狀態、真人 Touch ID／Windows Hello 及既有操作的 live GET 回查結果均須另外記錄。來源網址不同不能證明內容相同，也不能解除 unknown／accepted。 |

## 前版與新 identity 界限

`.82` 已交付來源為 `f7ac19c4bd38b12a85dbc7624a8b5a8ce412ff6c`，Mac run `35194967994`／artifact `10485328883`；只作安裝前版 pin，明確拒絕作為 `.83` final source。完整前版交付及限制見[共用圖片交付記錄](2026-09-shared-image-batch.md)。

新工具保留同一 source／CI／artifact／package／fuses／Pages bytes 驗證流程。最終 identity 必須由實際合併 source 與對應 main workflow 填入 `release-config.template.json` 的副本；不得猜測或沿用前版 IDs。工具準備沒有網路發布、credential access、App 結束、安裝、上傳或 Amazon request，也沒有建立 release tag。

視覺 manifest 記錄 entry `index-B1jgtu5y.js`；最後 check 重新建置的 entry 為 `index-BUj3Zzci.js`，不宣稱兩者 bytes 相同。視覺所記錄的兩個 renderer component、兩個修改樣式 source hash 與目前 source 全部相同，CSS `index-COMmyU5G.css` 的 bytes／SHA-256 也相同。獨立重算 composed source 892,810 bytes、canonical length 1,231,963、rule fingerprint `8e96ba081ea111bb7723bf1a9fa01f4a71b6dc751cc517ddd753ab66076d0e60`；測試只更新有證據的 exact pins，未放寬斷言。

## 本機證據索引

- `/tmp/amz-api-v0183-verified/README.md`：安全使用順序及已核對前版 pins。
- `/tmp/amz-api-v0183-verified/preparation-provenance.json`：唯讀原工具 hash 與獨立副本來源。
- `/tmp/amz-api-v0183-verified/preparation-pins-verification.json`：前版 proof chain／已安裝 ASAR 唯讀核對與缺 identity 時拒絕列印操作指令。
- `/tmp/amz-api-v0183-verified/*synthetic-verification.json`：合成驗證，不是發行／真機證據。
- `/tmp/amz-api-v0183-verified/release-config.template.json`：待填 template，不是已固定的發行 identity。
- `/tmp/amz-api-v0182-verified/installation-verification.json`：前版安裝與綁定的來源證據。
- `/tmp/amz-api-0183-check-final.log`：本機完整 check 結果。
- `/tmp/amz-api-image-selection-qa/results.json`、`progress-results.json`、`visual-build-manifest.json`：44 個合成視覺／互動情境及其 build／feature source pins。
