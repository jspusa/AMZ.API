# 0.1.84 已受理圖片後續新更新交付記錄

2026-09-17；追蹤 [Issue #320](https://github.com/jspusa/AMZ.API/issues/320)，規格見[先前圖片已受理後開始新的更新](../specs/2026-09-image-new-update-after-accepted.md)。本輪接續使用者更正後的需求，準備狀態不代表已發布或安裝。

## 固定範圍

可信圖片 `ACCEPTED` 尚未 canonical verified 時，可開始獨立的新圖片更新；先前 receipt／原狀態保留，相同 intent 不重送。新 Preview 綁定前筆證據 revision，提交及 atomic durable claim 再檢查；真正 unknown、歧義及文案 collision 仍受保護。fresh canonical／FBA／PTD／Validation Preview、每次原生批准、serial 單次 PATCH 與 GET-only 恢復均保留。

## 目前證據

| 層次 | 證據與狀態 |
|---|---|
| ★ 開工基準 | main `ebe95660c273f2171b3a4960aa782966de1251c5`；目標 Notebook Key `0.1.84`。 |
| ★ 已安裝前版 | 本輪準備時唯讀核對 App `0.1.83`，ASAR `320560499ac2b1e287dea1c77497bd0698ac02c0734872d8cda82d344a22faa0` 符合既有安裝及 source／CI／artifact 證據鏈。前版來源 `b162f831d5d9e0847d280d6f4fe6b7386cc52df6`，只作 predecessor pin；不是 `.84` 來源。 |
| ★ 發行工具準備 | `/tmp/amz-api-v0184-verified/` 已從 `.83` 工具建立 38 個來源檔的獨立副本，原工具 hash 未變；12 組合成測試／183 cases、28 Python／8 JavaScript 語法檢查通過。正式 config 不存在，template identity 全空；缺值時兩個 printer 拒絕列印操作命令。準備期間 production network／credentials／安裝／上傳／Amazon requests 均為 0。 |
| ★ 程式／本機驗證 | 新增 public owner／真 Gate／Store 回歸 23 項；完整 `npm run check`（`VITEST_MAX_WORKERS=4`）340 files／4,474 tests、typecheck／build 通過，production audit 0。首輪因測試 fixture 注入在初次 lookup 而不是 mutation GET 的期待修正；其他 4 檔程序／測試逾時未改碼，獨立 51 項及最終完整檢查通過。 |
| ★ 固定候選 review | Standards／Spec 各 0 open；兩軸獨立核对最終 patch `0bace110865c0f24d828f0e1c65ae7065b63c558f920023da7ab7b46a6da2486`。其後僅更新本列實際 review 結果，無行為變更。 |
| ☆ final source／PR／CI | 最終 candidate、PR、runtime source、四條 main workflow run／attempt 及 artifact IDs 尚未產生或鎖定。 |
| ☆ Pages／平台產物 | 尚無 `.84` Pages bytes、Mac／Windows payload 或 fuses 驗證。 |
| ☆ 安裝／受保護下載 | 尚未執行 `.84` 安裝或下載卡上傳；一般密碼登入、authenticated bytes 與 browser 落地檔案另行驗證。 |
| ☆ native／live Amazon | `.84` 尚無原生或 live 行為證據；功能驗收不送真實 Amazon mutation。`.83` 的既有 Accepted 10／Verified 0 唯讀回查是歷史證據，不能冒充本輪新 intent 成功。 |

## 工具與前版證據

- [工具 README](/tmp/amz-api-v0184-verified/README.md)、[來源 hashes](/tmp/amz-api-v0184-verified/preparation-provenance.json)、[準備核對](/tmp/amz-api-v0184-verified/preparation-pins-verification.json)：僅準備證據與合成驗證。
- [空 identity template](/tmp/amz-api-v0184-verified/release-config.template.json)：等待實際 final source／run／artifact，不得沿用前版 IDs。
- [前版安裝 proof](/tmp/amz-api-v0183-verified/installation-verification.json)及[.83 交付帳本](2026-09-image-batch-progress-recovery.md)：前版 provenance 與各層限制。

更新通道維持 `disabled`，不建立公開 release tag。Mac 若遇先前 Xcode license 工具環境問題，既有 helpers 可僅對個別程序使用已安裝 Command Line Tools；不接受授權、不改全域 developer 選擇、不放寬 assertions。真正安裝前仍須保留未完成工作、正常退出、建立最新 userData／App 備份並核對 vault／ledger；準備工具不執行這些操作。
