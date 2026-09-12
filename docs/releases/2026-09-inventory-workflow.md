# 0.1.64 — inventory health and daily workflow

Issue [#245](https://github.com/jspusa/AMZ.API/issues/245); [scope and acceptance](../specs/2026-09-inventory-workflow.md). Source baseline is main `c70c1314850f42d6d1eee6649a7411abb9d7186c`.

This release integrates inbound declared expiry, inventory age, sales pace and estimated costs; generates an Amazon price list without a source workbook; retains display preferences; recovers failed workspace downloads; maps image sets by exact SKU and slot; adds manually sourced Vine progress; and makes the image audit minimum selectable from 1–9 with default 8. Manual expiry/promotion announcements remain available. All Amazon mutations retain existing previews and native confirmation.

| Layer | Evidence |
|---|---|
| ★ Local implementation | Functional seams cover source/workbook preservation, exact SKU images, threshold selection/cache/export, preference restart, failed lazy loading, encrypted local evidence and context isolation. |
| ★ Visual preview | Local synthetic browser preview confirmed homepage default 8, choice 6 carried into individual image audit, Vine source/date labels with claimed/review progress bars, the generated price-list entry beside source-workbook comparison, and health risk/source/confirmation details. This is not live Amazon evidence. |
| ★ Local validation | `npm run check` passed 316 files / 3,583 tests, typecheck, build and stylesheet parity; `npm audit --omit=dev` reported 0; diff check passed. |
| ★ Independent review | Standards reported no documented violations; Spec-driven source traceability, age-report failure isolation, restart revalidation and asynchronous save races were corrected and regression tested. The final focused safety pass also fixed post-replacement save failures: Vine reloads disk before merging another import; health suspends forecasts and reloads disk on a fresh scan. No remaining actionable findings were reported. |
| ☆ Exact-source CI and Pages | Not yet published. |
| ☆ Mac / Windows artifacts and Mac installation | Not yet built or installed. |
| ☆ Protected employee downloads | Not yet updated or downloaded. |
| ☆ Live account acceptance | No new Amazon mutation is authorized for acceptance. Native UI access currently requires the user to unlock the Mac. |

## Evidence boundaries

Inbound declared quantity is not current batch remainder. Unknown remainder, incomplete history, stale data and contradictory evidence produce review items and no automatic calendar entry. Only positive projected shortfalls supported by confirmed batch quantities enter the calendar, one earliest actionable date per SKU. New App/context sessions require a fresh health scan before saved evidence creates forecasts; unchanged batch confirmations are retained.

The existing age report remains usable if optional health persistence fails. Health operations fail closed until recovery, including across account reset or App restart. Inbound reads are bounded, checkpointed and encrypted; unchanged completed plans reuse evidence.

Vine is explicitly a Seller Central manual CSV/TSV import or paste workflow. No verified public Vine enrollment/claim/review progress API was found in the official public catalogs. It does not infer these counts from orders or general reviews.

The variation audit → workspace path passes interaction regressions, and failed dynamic downloads can retry without restarting the App. The original installed incident has not been conclusively reproduced on the user's device; this release does not claim a proven live incident root cause.

The unsigned/ad-hoc distribution channel stays disabled for automatic publisher updates. Local/CI/fixture checks do not prove real Windows Hello, new native approvals, signing, or live Amazon behavior.
