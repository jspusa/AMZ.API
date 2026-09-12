# 0.1.64 — inventory health and daily workflow

Issue [#245](https://github.com/jspusa/AMZ.API/issues/245); [scope and acceptance](../specs/2026-09-inventory-workflow.md). Source baseline is main `c70c1314850f42d6d1eee6649a7411abb9d7186c`.

This release integrates inbound declared expiry, inventory age, sales pace and estimated costs; generates an Amazon price list without a source workbook; retains display preferences; recovers failed workspace downloads; maps image sets by exact SKU and slot; adds manually sourced Vine progress; and makes the image audit minimum selectable from 1–9 with default 8. Manual expiry/promotion announcements remain available. All Amazon mutations retain existing previews and native confirmation.

| Layer | Evidence |
|---|---|
| ★ Local implementation | Functional seams cover source/workbook preservation, exact SKU images, threshold selection/cache/export, preference restart, failed lazy loading, encrypted local evidence and context isolation. |
| ★ Visual preview | Local synthetic browser preview confirmed homepage default 8, choice 6 carried into individual image audit, Vine source/date labels with claimed/review progress bars, the generated price-list entry beside source-workbook comparison, and health risk/source/confirmation details. This is not live Amazon evidence. |
| ★ Local validation | `npm run check` passed 316 files / 3,583 tests, typecheck, build and stylesheet parity; `npm audit --omit=dev` reported 0; diff check passed. |
| ★ Independent review | Standards reported no documented violations; Spec-driven source traceability, age-report failure isolation, restart revalidation and asynchronous save races were corrected and regression tested. The final focused safety pass also fixed post-replacement save failures: Vine reloads disk before merging another import; health suspends forecasts and reloads disk on a fresh scan. No remaining actionable findings were reported. |
| ★ Exact-source Validate / Pages | PR #246 merged as `074c78a41276ee013c832fc9ad88de3a59c8d9c8`; Validate [34689198070](https://github.com/jspusa/AMZ.API/actions/runs/34689198070) and Pages [34689198019](https://github.com/jspusa/AMZ.API/actions/runs/34689198019) succeeded. Pages artifact `10297200804`, public HTML and all 10 JS/CSS assets match byte-for-byte. |
| ★ Mac / Windows artifacts | Exact-source main/push runs [34689198016](https://github.com/jspusa/AMZ.API/actions/runs/34689198016) (Mac) and [34689198059](https://github.com/jspusa/AMZ.API/actions/runs/34689198059) (Windows) succeeded on attempt 1. Both GitHub archives, payload manifests and required package checks passed. |
| ★ Protected download uploads | Both 0.1.64 cards uploaded sequentially Mac then Windows; successful receipts match the trusted payload bytes and SHA-256 values below. |
| ☆ Mac installation | The installed Mac remains 0.1.63 and running. The locked desktop prevents checking active work and normal quit; no App or userData replacement has been attempted. |
| ☆ Authenticated employee downloads | The download page was observed at its employee login form. Actual authenticated downloads and local file/hash verification remain pending user login. Upload success is not download proof. |
| ☆ Live account acceptance | No new Amazon mutation is authorized for acceptance. Native UI access currently requires the user to unlock the Mac. |

## Evidence boundaries

Inbound declared quantity is not current batch remainder. Unknown remainder, incomplete history, stale data and contradictory evidence produce review items and no automatic calendar entry. Only positive projected shortfalls supported by confirmed batch quantities enter the calendar, one earliest actionable date per SKU. New App/context sessions require a fresh health scan before saved evidence creates forecasts; unchanged batch confirmations are retained.

The existing age report remains usable if optional health persistence fails. Health operations fail closed until recovery, including across account reset or App restart. Inbound reads are bounded, checkpointed and encrypted; unchanged completed plans reuse evidence.

Vine is explicitly a Seller Central manual CSV/TSV import or paste workflow. No verified public Vine enrollment/claim/review progress API was found in the official public catalogs. It does not infer these counts from orders or general reviews.

The variation audit → workspace path passes interaction regressions, and failed dynamic downloads can retry without restarting the App. The original installed incident has not been conclusively reproduced on the user's device; this release does not claim a proven live incident root cause.

The unsigned/ad-hoc distribution channel stays disabled for automatic publisher updates. Local/CI/fixture checks do not prove real Windows Hello, new native approvals, signing, or live Amazon behavior.

Local and release evidence is retained under `/tmp/amz-api-v0164-verified/`. `local-validation.json`, `final-check.log` and `final-audit.log` describe the tested implementation. `pages/pages-byte-verification.json` binds actual public bytes to the exact main/push artifact. Helper simulation receipts are preparation evidence only.

## Verified distribution payloads

All payloads below belong to release source `074c78a41276ee013c832fc9ad88de3a59c8d9c8`. Mac artifact `10297121274` and Windows artifact `10296247636` passed their GitHub archive digests and payload manifests. The mounted Mac App passed universal architecture, strict ad-hoc signature, package version and disabled-update-channel checks. Windows passed the native addon/manifest/ASAR/AMD64 checks and packaged CI smoke.

| Payload | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.64-universal.dmg` | 246,857,092 | `5ad6b65304563cdf744119d124470a591b761db30beebb975adf575053e3829a` |
| ★ `AMZ.API-0.1.64-universal.zip` | 222,166,504 | `2d557f418b852ae88c00dda432441ccf59558214d97fb0dc00e716ee58bbbe7b` |
| ★ `AMZ.API-Notebook-Key-Windows-x64.zip` | 143,352,775 | `21ec023d97323b305ab8325e8fd36186403d377c429075ce8c749c63c08ab1eb` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 102,043,214 | `0cc5acc047790ff4651a2bb8a87b914f78375d6b8efd6f07c42f8e7042a6fef0` |

The mounted Mac ASAR is `5b9721eecfc17fbf0c3de54f49f2910e5c3d481e651238911c60e8b79fb4748e`. All eight required Electron fuse states were read from that mounted App and match the project boundary. This is artifact inspection, not installation or a live account result.

## Remaining device handoff

The verified DMG is mounted read-only at `/tmp/amz-api-v0164-verified/mounted`. After user unlock, inspect the running App and let active work finish, quit normally, then run the reviewed backup and installation helpers from `/tmp/amz-api-v0164-verified/` (see its `USAGE.md`), outside the read-only mount. Preserve the 0.1.63 App and current userData/vault/ledger; do not restore older ledger data or resend an existing operation. Verify display/threshold persistence and the variation audit → workspace path with read-only actions. Employee downloads must occur through the authenticated page and match the trusted files. `portal-upload-receipts.json` explicitly records `authenticatedDownloadVerified: false`.
