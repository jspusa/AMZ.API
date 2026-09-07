# 任務必讀表

任何工作先讀 `docs/CODEX_HANDOFF.md`、`AGENTS.md`、`CONTEXT.md`、`SECURITY.md`、`docs/ARCHITECTURE.md` 和 `package.json`。再依下表讀取涉及的整個 owner 與 public seam 測試；不要只讀 renderer 或只憑檔案長度決定拆分。

| 任務 | 額外必讀 |
|---|---|
| 功能／版面行為 | `README.md`、`docs/FEATURE_CONTRACTS.md` 對應條款；相關 renderer component、tests 與 `src/renderer/src/styles/index.css` composition |
| Bridge／啟動／連線 | `src/shared/contracts.ts`、`src/preload/index.ts`、`src/main/index.ts`、`src/main/renderer-trust.ts`、`src/main/api-router.ts`、`src/renderer/src/connection-panel.tsx` |
| 帳號／安全 context | `src/main/credential-vault.ts`、`src/main/amazon/sp-credential-runtime.ts`、`sp-execution-context.ts`、`sp-api-error.ts`；Ads 或 board 分別讀各自 vault／editor |
| Amazon 唯讀 | `src/main/amazon/sp-api.ts` composition；對應 `*-reads.ts`／`*-reads-production.ts`、coordinator、route 與 public DTO；Reports 另讀 `reports-runtime.ts`／`reports-runtime-production.ts` |
| Listing／PTD 身分 | `listings-reads.ts`、`listings-reads-production.ts`、`listings-response-error.ts`、`exact-seller-sku-batches.ts`；variation 另讀 `variation-family-reads.ts`、`variation-relationship-evidence.ts`、`variation-catalog-reads.ts` |
| 寫入／恢復／持久化 | `src/main/write-gate.ts`、`src/main/local-store.ts`、`src/main/business-pricing-mutations.ts`／`src/main/listing-content-batch-mutations.ts` 或對應 mutation owner、`src/main/amazon/listings-write-production.ts`、對應 safety tests；B2B 另讀價格／最低價兩階段 owner，文案批次另讀 workbook parser、snapshot evidence 與 mutation owner |
| 公布欄 | ADR 0003、`src/shared/operations-board.ts`、`src/main/operations-board.ts`、`operations-board-editor.ts`、`operations-board-admin-vault.ts`、`operations-board-facts.ts` 及 Supply Boss contract tests |
| Pages／桌面發布／安裝 | ADR 0001、相關 `.github/workflows/*.yml`、`scripts/after-pack.mjs`、Windows verifier／Hello addon、`src/main/update-policy.ts`／`desktop-updater.ts`；[版本證據](../releases/2026-09-review-evidence.md) 與 [簽章 preflight](../releases/signed-update-preflight.md) |
| 真實裝置／Amazon 驗收 | [live 驗收矩陣](../releases/2026-09-live-acceptance.md)、exact feature contract、目前安裝／下載來源證據；歷史只能作對照 |
| 歷史事故／既有發布追查 | [immutable archive](../releases/archive/CODEX_HANDOFF-through-2026-09-04.md) 對應日期／版本；其餘情況不用全文重讀 |

表內 Amazon 相對檔名均位於 `src/main/amazon/`。路由數、版本、scripts 和 bundle 配置以現行程式碼為準，不在此複製會過時的數值。
