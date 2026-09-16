# 健檢排版、圖片門檻入口與無穀宣稱

使用者於 2026-09-16 明確要求直接修改：

- 全站文案健檢的問題類型、問題來源（尤其「待人工判斷」）及原因不得重疊或把標籤擠成直條。窄視窗與放大字級下保留完整可讀內容，原因與建議可換行。
- 首頁「商品健檢」移除圖片最低張數選單；只在「全站圖片健檢」設定 1–10 張，選單按內容給予合理短寬度。
- 保留原本已保存的圖片門檻；單次掃描、首頁全部執行與匯出仍使用相同選值，不能因入口移除重設偏好。
- 成分宣稱不一致新增 Grain free／Grain-free 與 ingredients 明確穀物證據的核對，涵蓋品名、產品亮點及產品要點。產品描述不參與成分宣稱核對。
- 只用完整且非空 ingredients 的明確成分證據；大豆、豌豆及沒有正向穀物證據的否定文字不得當作穀物。不推測未知、不自動修改 Amazon。
- 畫面、問題篩選、立即修改的原值核對與 Excel 匯出使用同一套規則。任何立即修改仍須原有 fresh evidence、Preview 與原生批准；驗收不送 Amazon mutation。

驗證包含 shared claim seam、main audit／Excel、renderer normalization／quick edit、首頁門檻傳遞，以及 production renderer 的合成資料畫面（桌面、窄版、放大字級）。完成全套 check、production audit、兩軸 review 後發布；shared main 規則隨 0.1.79 Notebook Key 發布，Pages、產物、安裝、受保護下載與 live Amazon 分開記錄。
