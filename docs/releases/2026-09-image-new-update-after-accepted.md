# 0.1.84 已受理圖片後續新更新交付記錄

2026-09-17；追蹤 [Issue #320](https://github.com/jspusa/AMZ.API/issues/320)，規格見[先前圖片已受理後開始新的更新](../specs/2026-09-image-new-update-after-accepted.md)。[PR #321](https://github.com/jspusa/AMZ.API/pull/321) 已合併；runtime source 固定為 `0401ddfbe0201aebc92ba2fe6dd530111b50ee15`。Pages、兩平台產物與下載卡上傳已驗，本機安裝及登入後下載分列下表。

## 固定範圍

可信圖片 `ACCEPTED` 尚未 canonical verified 時，可開始獨立的新圖片更新；先前 receipt／原狀態保留，相同 intent 不重送。新 Preview 綁定前筆證據 revision，提交及 atomic durable claim 再檢查；真正 unknown、歧義及文案 collision 仍受保護。fresh canonical／FBA／PTD／Validation Preview、每次原生批准、serial 單次 PATCH 與 GET-only 恢復均保留。

## 目前證據

| 層次 | 證據與狀態 |
|---|---|
| ★ 開工基準／正式來源 | 開工 main `ebe95660c273f2171b3a4960aa782966de1251c5`；PR #321 合併為上述 runtime `0401ddf…`，Notebook Key `0.1.84`。immutable config 與 main source proof 已核對。 |
| ★ 已安裝前版 | 本輪準備時唯讀核對 App `0.1.83`，ASAR `320560499ac2b1e287dea1c77497bd0698ac02c0734872d8cda82d344a22faa0` 符合既有安裝及 source／CI／artifact 證據鏈。前版來源 `b162f831d5d9e0847d280d6f4fe6b7386cc52df6`，只作 predecessor pin；不是 `.84` 來源。 |
| ★ 發行工具準備 | `/tmp/amz-api-v0184-verified/` 已從 `.83` 工具建立 38 個來源檔的獨立副本，原工具 hash 未變；12 組合成測試／183 cases、28 Python／8 JavaScript 語法檢查通過。準備時 config 不存在、template identity 全空，缺值時 printer 拒絕操作命令；該準備階段 production network／credentials／安裝／上傳／Amazon requests 均為 0。正式 identity 在合併及 main CI 成功後才鎖定。 |
| ★ 程式／本機驗證 | 新增 public owner／真 Gate／Store 回歸 23 項；完整 `npm run check`（`VITEST_MAX_WORKERS=4`）340 files／4,474 tests、typecheck／build 通過，production audit 0。首輪因測試 fixture 注入在初次 lookup 而不是 mutation GET 的期待修正；其他 4 檔程序／測試逾時未改碼，獨立 51 項及最終完整檢查通過。 |
| ★ 固定候選 review | Standards／Spec 各 0 open；兩軸獨立核對最終 patch `0bace110865c0f24d828f0e1c65ae7065b63c558f920023da7ab7b46a6da2486`。其後只補實際 review／交付記錄，無行為變更。 |
| ★ 正式 CI | 同 runtime 的四條 main／push 均 attempt 1 成功：Validate `35229135925`、Pages `35229135918`、Mac `35229135939`、Windows `35229135950`。 |
| ★ Pages | artifact `10500846198`；線上 HTML＋10 個 JS／CSS 共 11 檔全部符合 exact artifact bytes，包含 lazy module。 |
| ★ Mac 產物 | artifact `10501330061`；DMG／ZIP manifest 與 bytes／hash 相符，ZIP App 的版本、universal arm64／x86_64、ad-hoc deep-strict codesign、ASAR 與兩架構 fuses 已驗；更新通道 `disabled`。這是產物檢查，尚未安裝或啟動 `.84`。 |
| ★ Windows 產物 | artifact `10500353224`；installer／portable ZIP manifest、bytes／hash、AMD64／N-API、ASAR native addon 邊界、版本與全部 8 項 fuses 已驗，更新通道 `disabled`。本機 Windows 產物核對為靜態檢查，未在這台 Mac 執行 EXE。 |
| ☆ 本機安裝 | 實查仍為 `.83`；原生工具回報 Mac 鎖定，已請使用者手動解鎖，尚待回覆。本輪尚未正常退出、備份或安裝，未清除既有草稿；不可把可信 `.84` 產物當成已安裝。 |
| ★ 下載卡上傳 | Mac→Windows 兩張 `.84` 卡片的 completion receipts 已核對，version／bytes／hash 精確符合本輪可信產物。 |
| ☆ 登入後下載 | 本輪一般下載密碼登入、authenticated HTTP bytes 與 browser 落地檔案尚未驗證；completion receipt 及舊版下載證據不能代替。 |
| ☆ native／live Amazon | `.84` 尚無原生或 live 行為證據；功能驗收不送真實 Amazon mutation。`.83` 的既有 Accepted 10／Verified 0 唯讀回查是歷史證據，不能冒充本輪新 intent 成功。 |

## 安裝檔與證據

| 可信安裝檔 | Bytes | SHA-256 |
|---|---:|---|
| ★ Mac DMG | 246,941,743 | `f55834c1f36bfbdfd563e279654226cda81ea8111eedbd0e73f1edb05b43575a` |
| ★ Windows Setup.exe | 102,095,398 | `739163cb32f412f67b99acaa5738c10d540f7a5c1ee68fd59afd599eb9d6e234` |

- [工具 README](/tmp/amz-api-v0184-verified/README.md)、[來源 hashes](/tmp/amz-api-v0184-verified/preparation-provenance.json)、[準備核對](/tmp/amz-api-v0184-verified/preparation-pins-verification.json)：僅準備證據與合成驗證。
- [固定 identity](/tmp/amz-api-v0184-verified/release-config.json)、[main source proof](/tmp/amz-api-v0184-verified/source-main-verification.json)、[Pages bytes](/tmp/amz-api-v0184-verified/pages/pages-byte-verification.json)。
- Mac：[CI](/tmp/amz-api-v0184-verified/macos/ci-verification.json)、[artifact](/tmp/amz-api-v0184-verified/macos/verification.json)、[ZIP App](/tmp/amz-api-v0184-verified/macos/zip-bundle-verification.json)、[fuses](/tmp/amz-api-v0184-verified/macos/zip-bundle-fuses-verification.json)。Windows：[CI](/tmp/amz-api-v0184-verified/windows/ci-verification.json)、[artifact](/tmp/amz-api-v0184-verified/windows/verification-result.json)、[fuses](/tmp/amz-api-v0184-verified/windows/fuses-verification.json)。
- [等待解鎖的安裝狀態](/tmp/amz-api-v0184-verified/installation-pending-unlock.json)、[Mac 上傳 receipt](/tmp/amz-api-v0184-verified/portal-upload-macos-dmg-receipt.json)、[Windows 上傳 receipt](/tmp/amz-api-v0184-verified/portal-upload-windows-installer-receipt.json)。
- [前版安裝 proof](/tmp/amz-api-v0183-verified/installation-verification.json)及[.83 交付帳本](2026-09-image-batch-progress-recovery.md)：前版 provenance 與各層限制。

更新通道維持 `disabled`，不建立公開 release tag。Mac 若遇先前 Xcode license 工具環境問題，既有 helpers 可僅對個別程序使用已安裝 Command Line Tools；不接受授權、不改全域 developer 選擇、不放寬 assertions。真正安裝前仍須保留未完成工作、正常退出、建立最新 userData／App 備份並核對 vault／ledger；準備工具不執行這些操作。
