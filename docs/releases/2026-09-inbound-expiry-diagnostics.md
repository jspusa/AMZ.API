# 0.1.71 入庫效期診斷交付帳本

接續 Issue #263；[規格](../specs/2026-09-inbound-expiry-diagnostics.md)。

- Source base `82d2739c708c3c371e4ece80721de742d9dac6b3`；分支從另含 .70 文件更新的 `1852dc44cc1aad7de5e2ab8c2756e339d6ea9745` 開始。
- .70 的原生圖片免準備密碼／生物辨識、單次安全 Preview 通過、無 SKU 重打及零 PATCH 已驗；健康首次取得 284 核心列，入庫效期仍 generic `FBA_EXPIRY_FORMAT_UNSUPPORTED`／partial。詳細記於 [.70 帳本](2026-09-passwordless-image-preparation.md)。這些不是 .71 交付證據。
- 本次診斷回歸已先紅：合成空計畫名稱通過真 reader → coordinator → sync 時，舊版只回泛化訊息。固定安全原因改善後待完成最終聚焦／全檢、兩軸 review、CI、artifact、安裝及原生定位；不得以合成案例宣稱已識別實際壞資料。
- 新版不變更圖片服務、批准流程、效期接受政策或資料格式。尚未取得 .71 原生效期原因，也未修復／完成原始完整效期目標。
- .70 原生首頁驗收後，2026-09-13 再次嘗試展開既有公告時 CUA 回報 Mac 鎖定且自動解鎖失敗；本機程式檢查可繼續。人工公告完整後驗與員工登入後實際下載仍待；不重複要求已完成的圖片授權，不為驗收提交 Amazon mutation。
