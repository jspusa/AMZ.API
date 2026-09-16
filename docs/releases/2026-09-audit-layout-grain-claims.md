# 0.1.79 健檢修正交付帳本

規格：[健檢排版、圖片門檻入口與無穀宣稱](../specs/2026-09-audit-layout-grain-claims.md)。

- Base `03378b8a23320fd8dd259521f184499b74f881f8`；獨立工作副本與分支 `codex/audit-layout-image-controls-20260916`，保留原 checkout 的未追蹤檔。
- 原生 .78 已讀取使用者本次健檢結果，重現兩個標籤與長原因被三欄 grid 擠壓重疊；只切換既有結果篩選，未重新掃描、預檢或寫入 Amazon。
- 原共用宣稱規則沒有無穀／穀物核對；產品描述已排除。本次新增規則並保留原有描述排除。
- Production renderer 合成資料視覺已核對 1440／390 px × 標準／大字 × 深／淺色八組：兩標籤與長原因均無重疊、無列外溢、無文件水平溢出。另四組圖片頁核對 1–10 選项、選取 10 張與首頁無選單；選單實測 84 px，沒有撐滿版面。只使用測試 Bridge，未連線 Amazon。
- 第一次完整檢查 4,281 項通過，7 項因版本與 CSS 組成基準待更新失敗；按實際組成更新 canonical 1,215,441 字元、LF 881,303 bytes／29,771 行與 CRLF 911,074 bytes，規則 fingerprint `73457f11b00957c3d15a4d6848c7bc7d6d680638085e0d8d06482e31d2147cd7`。保留所有檢查，未放寬驗證。
- 本機檢查、視覺、審查、CI、Pages、兩平台 artifact、安裝與受保護下載各層尚待本輪驗證，不能沿用 .78 成功證據。
- 第一輪 Standards 0 findings；Spec 的兩個 P2（括號內否定吞掉後續 Rice、may also／might contain 誤當正向證據）已在公共 seam 重現並修正。新增十個案例後 grain 46 tests、五檔共 200 tests 通過；產品描述持續排除。
- 圖片頁站點選單亦收斂成內容寬度，最後樣式契約為 canonical 1,215,581 字元、LF 881,386 bytes／29,772 行、CRLF 911,158 bytes，fingerprint `2b3a99bd0324c3746a451682aefb68cb6ceb1addfac25ab415cf16fbce452ce9`。
