# 0.1.63 — complete accepted variation work through read-only recovery

Issue [#236](https://github.com/jspusa/AMZ.API/issues/236); [scope and acceptance](../specs/2026-09-10-variation-readback-recovery.md). Source baseline is official 0.1.62 main `9a71d8bd848266936cd387d729ec0b6fdd473eac`. The previous [preserved-fact release](2026-09-variation-preserved-required-facts.md) records its exact artifacts, live Preview and observed accepted operation separately.

The user-facing recovery button previously read only a family snapshot, leaving an accepted operation permanently uncertain in the current workspace. This release adds a main-owned GET recovery projection using the existing strict canonical reconciliation and durable intent. It must never issue Preview, native approval or PATCH. Its installed acceptance uses the existing pending operation; no new Amazon write is authorized for testing.

| Layer | Status |
|---|---|
| ★ Diagnosis and scope | Existing button's family-only behavior confirmed; parent observation cannot replace canonical proof. |
| ★ Implementation and regression checks | `npm run check` passed 297 files / 3,396 tests, typecheck, build and stylesheet parity; production audit 0; diff check passed. |
| ★ Independent Standards / Spec review | Both final independent axes report 0 remaining findings, including the exact route inventory and contradictory-search proof corrections. |
| ★ Exact-source CI / Pages / artifacts | PR #237 merged as `6086d8dbbf85226540c333adc7d3e717cb59a8ac`; exact main Validate, Pages, Mac and Windows succeeded. Public HTML plus all nine JS/CSS assets and both desktop artifacts verified. |
| ★ Mac installation | Official 0.1.63 universal installed at `/Applications/AMZ.API.app`; 0.1.62 App backed up, current userData retained, vault and ledger bytes unchanged during the stopped-app swap. |
| ★ Live GET recovery | Reopened the existing US `TPZ01AM-4` durable operation and displayed the strict main verified receipt for attach to `AF Turkey Tedon_Small`. The agent invoked zero Preview, native approval or PATCH in this 0.1.63 acceptance. |
| ★ Protected download uploads | Both 0.1.63 Mac DMG and Windows installer uploads completed with exact trusted-artifact sizes and SHA-256 receipts. |
| ☆ Authenticated employee downloads | The native portal still presents the employee login form. User login, actual downloads and local byte/hash comparison remain pending. |

Release evidence and reviewed helpers are under `/tmp/amz-api-v0163-verified/`; `release-identity.json` records the actual source, runs and artifacts. The earlier synthetic helper checks remain preparation evidence only. Actual release, installed-device, live recovery and portal receipts are recorded separately below.

Review-driven regressions reproduced source GET versus returned same-SKU search contradictions in ASIN, FBA, dimension values/selectors and preserved facts. The canonical owner now checks the original search row and omits any supplied contradictory or malformed attribute's proof; missing search facts and unrelated content do not create false conflicts. All 14 production GET cases pass, with zero additional Preview, native approval or PATCH. Renderer regressions cover reopened pending work, explicit verified history, transient discovery failure, exact intent matching, late context and spent confirmations.

The first full check found only the newly added route missing from the reviewed route inventory; its exact GET pair and count are now updated without weakening default or unsupported-route checks. A subsequent run hit two unchanged timing-sensitive cases (A+ demo completion and B2B's 65 durable fixture writes); both passed the focused exact-source run within their original bounds. The final full check passed without changing their tests or deadlines. Local evidence: `final-check-reviewed-facts.log`, `final-audit.log`, `timing-failure-focused.log`, `search-contradiction-red.log`, `search-fact-red.log` and `search-all-proof-green.log` under `/tmp/amz-api-v0163-verified/`.

## Exact release and artifact evidence

[PR #237](https://github.com/jspusa/AMZ.API/pull/237) merged to main `6086d8dbbf85226540c333adc7d3e717cb59a8ac`. All four runs below are successful push/main runs for that exact release commit; Mac and Windows succeeded on attempt 1.

| Layer | Exact evidence |
|---|---|
| ★ Validate | [34435345196](https://github.com/jspusa/AMZ.API/actions/runs/34435345196). |
| ★ Pages | [34435345202](https://github.com/jspusa/AMZ.API/actions/runs/34435345202), artifact `10135986877`; public HTML and all nine JS/CSS assets match artifact bytes. |
| ★ Mac universal | [34435345178](https://github.com/jspusa/AMZ.API/actions/runs/34435345178), artifact `10136075383`; archive checksum, payload manifest and both DMG/ZIP hashes verified. |
| ★ Windows x64 | [34435345141](https://github.com/jspusa/AMZ.API/actions/runs/34435345141), artifact `10136101850`; archive/payload hashes, ASAR/native manifest, AMD64 addon and packaged Bridge CI gates verified. |

| Download payload | Bytes | SHA-256 |
|---|---:|---|
| ★ `AMZ.API-0.1.63-universal.dmg` | 246,798,926 | `6cfe53bf6819d47a2053301a26427bf78f1c5b2465bdbd29562734538b584f61` |
| ★ `AMZ.API-0.1.63-universal.zip` | 222,101,635 | `55553fba840776f636c87961e82e0681d417791dc640121b1192a5c83191fe63` |
| ★ `AMZ.API-Notebook-Key-Windows-x64-Setup.exe` | 101,996,794 | `041e42a75cc8860c44be2470bb46565c413653f976bd605674e7601cfc4b0895` |
| ★ `AMZ.API-Notebook-Key-Windows-x64.zip` | 143,291,203 | `60681f68d4bf55a69b80dc81783dd2dbd8a3707919fbc5668429341312758017` |

Pages' `assets/variation-planner-drawer-mxt4NQ86.js` is 128,024 bytes, SHA-256 `d18bcb8b22ca9556e3e51d19abd7bf47188a14d2382e14368fef55a6536d2faf`. Artifact and public bytes both contain `/variation-move/recovery`, the verified-history caption, and the 0.1.63 upgrade/no-resend hint. Evidence: `pages/pages-byte-verification.json`, `pages/recovery-marker-evidence.json`, `macos/verification.json`, `macos/ci-verification.json`, `windows/verification-result.json` and `windows/ci-verification.json` under the release evidence directory.

## Installed Mac and existing-operation recovery

The app was stopped before the verified DMG replaced `/Applications/AMZ.API.app`. The installed universal 0.1.63 ASAR is `071bde44b3cb43b7299238207d1d6d88feb989d0ba958a3c61d7d38b7e73cbb7`; deep strict ad-hoc code-signature verification passed and the update channel remains `disabled`. The previous app is retained at `/Applications/AMZ.API-v0.1.62-backup-before-0163-20260910.app`. A mode-0700 userData backup was verified, and the active vault and entire ledger were unchanged during installation. This preservation claim covers the swap; the following GET recovery then reconciles the existing record. Keep the current ledger when continuing work rather than restoring its pre-recovery copy. Evidence: `user-data-backup-verification.json` and `installation-verification.json`.

At 2026-09-10 04:12:43 UTC, the installed native AMZ.API was connected to Amazon US. The original `TPZ01AM-4` / `B0DJVH4SFV` appeared in the target family with 19 FBA members, and the “先前操作回查結果” table displayed “★ 先前操作已由 Amazon 唯讀回查確認”. Its recovered receipt was `attach`, source parent `null` (standalone), target parent `AF Turkey Tedon_Small`. This is the strict main verified receipt for the existing 0.1.62 operation, extending the earlier family-only observation to canonical recovery. Evidence: `live-get-recovery.json`, tied to the installed ASAR above.

The 0.1.63 acceptance invoked no Validation Preview, native approval or mutation. The earlier accepted operation followed external user interaction on 0.1.62; it was not resubmitted. The completed history no longer locks planning, and a fresh detach Preview control was visible but not invoked. Future writes still require a fresh plan, Preview and independent native approval. This run does not establish real Windows installation/Hello, new native approval, publisher signing or a signed update.

## Protected downloads

| Delivery step | Evidence / remaining work |
|---|---|
| ★ Mac card upload | The DMG above uploaded successfully; receipt matches 246,798,926 bytes and its exact SHA-256. |
| ★ Windows card upload | The Setup EXE above uploaded successfully; receipt matches 101,996,794 bytes and its exact SHA-256. |
| ☆ Employee download verification | Fresh native portal tab still showed the login form. After user-controlled login, download both files through the protected page and independently match actual local bytes/hashes to the trusted payloads above. |

`portal-upload-receipts.json` records both successful upload receipts and explicitly leaves `authenticatedDownloadVerified: false`. The first Mac upload preflight rejected the lexical `/tmp` path before reading stdin or sending HTTP; the upload used the verified resolved `/private/tmp` path. Completed uploads do not substitute for authenticated download evidence.
