# 0.1.71 入庫效期診斷交付帳本

接續 Issue #263；[規格](../specs/2026-09-inbound-expiry-diagnostics.md)。

- Source base `82d2739c708c3c371e4ece80721de742d9dac6b3`；分支從另含 .70 文件更新的 `1852dc44cc1aad7de5e2ab8c2756e339d6ea9745` 開始。
- .70 的原生圖片免準備密碼／生物辨識、單次安全 Preview 通過、無 SKU 重打及零 PATCH 已驗；健康首次取得 284 核心列，入庫效期仍 generic `FBA_EXPIRY_FORMAT_UNSUPPORTED`／partial。詳細記於 [.70 帳本](2026-09-passwordless-image-preparation.md)。這些不是 .71 交付證據。
- 本次診斷回歸已先紅：合成空計畫名稱通過真 reader → coordinator → sync 時，舊版只回泛化訊息。固定安全原因改善後聚焦 4 files／74 tests 通過；最終全檢 322 files／3,871 tests、typecheck／build／樣式檢查及 production audit 0 通過；Standards／Spec 對 `513ce68e236e3bc14e37c58a34433c5050b7d68a` 各 0 open。CI、artifact、安裝及原生定位仍待；不得以合成案例宣稱已識別實際壞資料。
- 新版不變更圖片服務、批准流程、效期接受政策或資料格式。尚未取得 .71 原生效期原因，也未修復／完成原始完整效期目標。
- .70 原生首頁驗收後，2026-09-13 再次嘗試展開既有公告時 CUA 回報 Mac 鎖定且自動解鎖失敗；本機程式檢查可繼續。人工公告完整後驗與員工登入後實際下載仍待；不重複要求已完成的圖片授權，不為驗收提交 Amazon mutation。

- 首次全檢只有既有 B2B recent-work 5 秒逾時，相關 test／owner／LocalStore 與 base bytes 一致；定點一次 1,396 ms 通過。獨立 synthetic public-owner 量測 66 次操作／132 次耐久寫入約 1,351 ms，結果投影約 2.3 ms；併行 I/O／排程延遲是符合證據的推論，未量測原逾時瞬間。未調 timeout、未跳過全檢或修改該功能；接續一次完整 `npm run check` 成功。證據根目錄 `/tmp/amz-api-v0171-verified/`。

## 首次發布來源與 Mac 測試阻礙

- PR #267 已合併至 `2147d35243f109c99d5da2d745523feda28e9ec7`。該來源 Validate `34748504871`、Pages `34748504856` 及 Windows `34748504803` 成功；Pages HTML／全部 11 個 JS／CSS bytes 與 Windows artifact 已核對，證據仍在首次根目錄。
- Mac `34748504816` 首次及唯一重跑都因首頁導覽和 Orders 架構測試的 5 秒期限失敗；兩次其餘 320 個檔案通過，未產生 Mac 安裝包。未安裝 .71、未上傳 .71 下載卡，也沒有 .71 原生效期原因。停止重跑相同來源。
- Issue #268／[測試穩定性規格](../specs/2026-09-macos-test-stability.md) 接續處理這項交付阻礙，仍為 0.1.71。新來源的交付證據使用 `/tmp/amz-api-v0171-r2-verified/`；不得將首次來源的 Windows／Pages hash 當成新來源通過。
- 架構測試以實際檔案 bytes 重用 immutable import evidence，並以 TSX 模式解析 TSX；兩個新案例先紅，分別捕捉重複解析和 JSX 內遺漏的動態 import，亦驗證同長度內容變更會重新解析。原 77 項架構斷言和完整 source 範圍保留。
- 首頁只抽出互相獨立的圖片門檻與同頁捷徑；七項健檢 → B2B 忙碌鎖定 → 真實 lazy 工作區 → 品牌返回仍在同一個 Dashboard instance。原 56 個斷言、8 個捷徑、7 項健檢、3 個工作區與價目表 instance 檢查保留，teardown 在移除 globals 前卸載。相同 renderer cohort 的最長案例為 275 ms；本機未重現 5 秒逾時，須由新 Mac CI 確認改善。
- 測試改善後完整 `npm run check` 首次通過：322 files／3,875 tests、typecheck／build／樣式驗證成功，production audit 0。沒有 production、workflow、timeout 或版本變更；兩軸 review 和新來源交付待續。
