# 0.1.83 圖片批次進度與恢復交付記錄

2026-09-17；追蹤 [Issue #317](https://github.com/jspusa/AMZ.API/issues/317)，規格見[圖片批次進度與恢復](../specs/2026-09-image-batch-progress-recovery.md)。PR #318 已發布並安裝 `0.1.83`；受保護下載的登入與實際下載仍待驗，以下分層記錄。

## 固定範圍

圖片準備及 main-owned 背景預檢顯示實際進度；舊 durable 操作在原生確認前阻擋時，本次各列明示尚未送出。使用者可直接用本次 exact SKU 另行唯讀回查舊操作，保留新圖草稿。系列建議支援整列勾選與有界的全選／取消，保留手動目標。指定圖位保留其他原圖、FBA／PTD／原生確認、耐久防重送及 exact canonical 回查條件不變。

## 目前證據

| 層次 | 證據與狀態 |
|---|---|
| ★ 開工基準 | main `09460121cefb51bee7dc87dbdbd7a1976c89e14b`；基準 Notebook Key `0.1.82`。修正分支為 `codex/image-batch-progress-recovery`。 |
| ★ 最終程式／PR | [PR #318](https://github.com/jspusa/AMZ.API/pull/318)；final candidate `b66d9462e7e3eb955aa2feae54d1a87ceaeaca92` 與 runtime source `b162f831d5d9e0847d280d6f4fe6b7386cc52df6` 同一 tree `b54685610afb61699447d181d0d2ce0a108b57e0`。版本 `0.1.83`，更新通道維持 `disabled`。 |
| ★ 本機驗證／review | `VITEST_MAX_WORKERS=4 npm run check` 通過 339 files／4,451 tests，typecheck、build 與 CSS composition／build parity 通過；production audit 0，diff check 通過。route 公開接縫聚焦 8／8 通過。Standards／Spec 兩軸 review 均 0 open，包含最終固定進度區增量；Spec 另獨立核對 main 背景預檢與 cross-content blocker 分類。先前 mixed verified／no-record 接續缺口已修正並補 renderer 回歸。candidate／merged tree 對應已鎖定。 |
| ★ 本機視覺 | production renderer 配合 fake Bridge 完成 44 個情境：8 個系列選取／預覽，36 個準備、逐 SKU 預檢、先前操作阻擋及恢復情境；後者涵蓋 1440／800／390px 亮暗模式。整列品名／ASIN／空白及鍵盤切換、全選／保留手動 SKU、進度固定位置與控制項可操作均通過；沒有頁面溢位、page／console errors。測試的本機 commit request 為 mock，native approval／Amazon PATCH 都是 0。 |
| ★ 發行工具準備 | `/tmp/amz-api-v0183-verified/` 從 `.82` 工具建立獨立副本；12 組純合成測試、183 個案例與 Python／JavaScript 語法檢查通過，原 `.82` 工具及證據未修改。準備時只有空 identity template，缺 identity 會拒絕操作；合併後已依真實 source／run／artifact 鎖定 `release-config.json`。 |
| ★ 安裝前版核對 | 換版前唯讀核對 App `0.1.82`／ASAR `ee5c322d1c8276fd9e98db780826df0f95acb6fdf14492a7552b319dad7029e2`，符合 `.82` source／CI／artifact／installation proof chain；下列 `.83` 安裝為另一份證據。 |
| ★ exact CI | 下表四條 workflow 都是同一 runtime source 的 main／push、attempt 1，全部成功；Windows CI 包含 packaged Bridge smoke。 |
| ★ Pages | `index.html` 加全部 10 個 JS／CSS，線上 HTTP 200／bytes／SHA-256 全部符合指定 Pages artifact；entry `index-_7742vpQ.js`，CSS `index-COMmyU5G.css`。 |
| ★ 可信產物／fuses | Mac archive／manifest、universal 架構、ad-hoc deep strict codesign 與兩架構 fuses；Windows archive／manifest、package／ASAR、Hello addon 邊界及 fuses 均通過。本機 Windows 產物核對為靜態檢查，未在這台 Mac 執行 EXE；不代表正式簽章或真人 Windows Hello。 |
| ★ 安裝 | 原生首頁可讀且未見草稿／對話框後正常退出；建立 0700 userData 備份並以可信 DMG 安裝 `.83`。保留 `.82` App，換版時 App 已停止、vault／ledger bytes 未變。已安裝 ASAR `320560499ac2b1e287dea1c77497bd0698ac02c0734872d8cda82d344a22faa0` 符合可信產物，universal／deep strict codesign 通過。 |
| ★ 下載卡上傳 | 依 Mac→Windows 順序完成；兩份 completion receipts 的版本、bytes、SHA-256 均符合下列可信檔案。 |
| ☆ 員工登入／實際下載 | 一般密碼登入 UI 仍待完成；本輪 authenticated HTTP bytes 與 browser 新落地檔案均未核對，不從 upload receipt 推定下載成功。 |
| ★ native／唯讀回查 | `.83` 原生首頁及 Amazon 已連線可見。找回既有 10 SKU／90 張，手動刷新最近回查由 2026-09-17 17:13:58 推進至 17:14:18（Asia/Taipei），仍 Accepted 10／Verified 0。只展開一列：10 個位置中 1 個相符、9 個回傳不同 Amazon 來源 URL、沒有回報 Amazon error；這一列原因不代表其他 9 列。保留 accepted 與嚴格 GET-only，網址不同不能證明內容相同。 |
| ☆ 寫入與進行中實機畫面 | agent 的 Amazon mutation 為 0，沒有原生寫入批准。實機證據是回查結果及時間推進，未擷取刷新進行中的忙碌畫面；進度互動由上述合成視覺及 public seam 測試驗證。真人 Touch ID／Windows Hello 不在本輪已驗範圍。 |

## 固定 CI 與交付檔案

| 流程 | 同一 source 的成功 run／attempt | Artifact |
|---|---|---|
| ★ Validate | `35202031716`／1 | — |
| ★ Pages | `35202031708`／1 | `10488337467` |
| ★ Mac universal | `35202031661`／1 | `10488801522` |
| ★ Windows x64 | `35202031700`／1 | `10488399664` |

| 可信檔案 | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.83-universal.dmg` | 246,766,983 | `12741a65846ceefa66861c0be3f27f1858dbe0b9461d09dac6d8fabe38bb381f` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102,097,415 | `50adb41fff18a3b74045b1294c587351e0676cd7267d740c883719a2359048c6` |

Mac 的預設 `lipo` 因選取的 Xcode 尚未接受授權而停止；保留首次 staging，再僅對驗證程序指定既有 Command Line Tools 後通過。沒有接受 Xcode 授權、改全域 developer 選擇或放寬驗證 assertions。userData 備份位於 `/Users/jasper/Library/Application Support/amz-api-backups/20260917-before-0183`，舊 App 位於 `/Applications/AMZ.API-v0.1.82-backup-before-0183-20260917.app`。本次原生首頁與連線證據已解除先前畫面等待對本次安裝的阻礙；`.82` 帳本保留原歷史，不重做安裝。

## 前版與新 identity 界限

`.82` 已交付來源為 `f7ac19c4bd38b12a85dbc7624a8b5a8ce412ff6c`，Mac run `35194967994`／artifact `10485328883`；只作安裝前版 pin，明確拒絕作為 `.83` final source。完整前版交付及限制見[共用圖片交付記錄](2026-09-shared-image-batch.md)。

新工具保留同一 source／CI／artifact／package／fuses／Pages bytes 驗證流程。最終 identity 已由實際合併 source 與對應 main workflow 填入 `release-config.json`，沒有沿用前版 IDs。工具準備階段沒有網路發布、credential access、App 結束、安裝、上傳或 Amazon request；後續交付依上表分開記錄。本輪沒有建立 release tag。

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
- [local-code-review-verification.json](/tmp/amz-api-v0183-verified/local-code-review-verification.json)：最終 candidate／merged tree 與本機 review 證據。
- [release-config.json](/tmp/amz-api-v0183-verified/release-config.json)、[source-main-verification.json](/tmp/amz-api-v0183-verified/source-main-verification.json)：本輪固定 identity 與 main provenance。
- [Pages bytes](/tmp/amz-api-v0183-verified/pages/pages-byte-verification.json)、同目錄 `pages-run.json`／`validate-run.json`／`pages-artifact.json`：exact artifact 與線上 11 檔核對。
- [Mac CI](/tmp/amz-api-v0183-verified/macos/ci-verification.json)、[Mac 產物](/tmp/amz-api-v0183-verified/macos/verification.json)、[bundle](/tmp/amz-api-v0183-verified/macos/zip-bundle-verification.json)、[fuses](/tmp/amz-api-v0183-verified/macos/zip-bundle-fuses-verification.json)、[CLT 調整](/tmp/amz-api-v0183-verified/macos/clt-environment-resolution.json)：Mac 各層證據與環境限制處理。
- [Windows CI](/tmp/amz-api-v0183-verified/windows/ci-verification.json)、[Windows 產物](/tmp/amz-api-v0183-verified/windows/verification-result.json)、[fuses](/tmp/amz-api-v0183-verified/windows/fuses-verification.json)：Windows CI 與本機靜態核對。
- [userData 備份](/tmp/amz-api-v0183-verified/user-data-backup-verification.json)、[安裝](/tmp/amz-api-v0183-verified/installation-verification.json)：App 停止、前版保留及 vault／ledger 完整性。
- [Mac completion receipt](/tmp/amz-api-v0183-verified/portal-upload-macos-dmg-receipt.json)、[Windows completion receipt](/tmp/amz-api-v0183-verified/portal-upload-windows-installer-receipt.json)：上傳 metadata；不含 authenticated download 證據。
- [native-readonly-verification.json](/tmp/amz-api-v0183-verified/native-readonly-verification.json)：原生首頁／連線及既有操作 GET 回查的去識別彙總。
