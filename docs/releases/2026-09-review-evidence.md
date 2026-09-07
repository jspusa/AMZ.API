# September review — version evidence

Recorded 2026-09-07. This ledger separates observable layers; an entry is evidence for its exact version and time only. 0.1.55 source is merged and the control console is deployed. Desktop packaging and physical acceptance remain distinct layers below.

## Baseline checked by GitHub read-only review

| Layer | Exact evidence | What it proves | Boundary |
|---|---|---|---|
| Source checkout | `efdf76fd701b76997e64b74a4f30d3d3d96da360`, package 0.1.54 | Review source | Later docs-only main; not the artifact SHA |
| 0.1.54 feature merge | [PR #204](https://github.com/jspusa/AMZ.API/pull/204), merged 2026-09-04 09:00:15 UTC, commit `36f4afcdbeaf6167a822d99bf41624005ae706b6` | Feature source on main | Supersedes the old handoff's candidate-only claim |
| Validation | [33856173053](https://github.com/jspusa/AMZ.API/actions/runs/33856173053), success at the merge SHA; docs-only [34036397235](https://github.com/jspusa/AMZ.API/actions/runs/34036397235), success at the review SHA | Automated validation at each SHA | No device or Amazon proof |
| Pages publication | [33856173033](https://github.com/jspusa/AMZ.API/actions/runs/33856173033), success at the merge SHA | Deployment workflow succeeded | This review did not byte-compare the live page with the artifact |
| macOS unsigned package | [33856173006](https://github.com/jspusa/AMZ.API/actions/runs/33856173006), success; artifact `9930480781`, `AMZ.API-unsigned-36f4afcdbeaf6167a822d99bf41624005ae706b6`, 468,246,244 bytes | CI artifact metadata | Payload not downloaded in this review; metadata expiration 2026-09-18 09:07:17 UTC |
| Windows unsigned package | [33856173057](https://github.com/jspusa/AMZ.API/actions/runs/33856173057), success; artifact `9930451303`, `AMZ.API-Notebook-Key-Windows-x64-36f4afcdbeaf6167a822d99bf41624005ae706b6`, 245,002,439 bytes | CI artifact metadata | Payload not downloaded; metadata expiration 2026-09-18 09:06:29 UTC |
| Mac installed device | Historical 2026-09-04 0.1.53, source `89d74f4f3ab21552da2f5532ea76757d2a13d34a`, `/Applications/AMZ.API.app`; details in archive | Last recorded installed version | Current installed version unknown; do not infer it from newer CI |
| Employee download cards | Historical 2026-09-04 0.1.53 Mac DMG / Windows NSIS upload | Last recorded protected portal publication | Current card contents and authenticated short-link bytes not rechecked |
| Signed update feed | GitHub releases GET returned `[]` on 2026-09-07 | No release returned by that read | No certificate or protected environment secrets inspected |
| Main protection | Rulesets GET returned `[]`; branch protection GET returned 403 | Rulesets response only | Legacy branch protection is unknown, not absent |
| Live Amazon / native biometrics | No new live run in this review | Nothing further | Historical accepted writes are not 0.1.54/0.1.55 verified writes |

## 0.1.55 completion ledger

Replace `Pending` only after the named evidence exists. Preserve failed attempts and the exact SHA when adding success.

| Layer | Status / evidence needed |
|---|---|
| Source and PR | [PR #206](https://github.com/jspusa/AMZ.API/pull/206) merged as `bf2ec996e5ee0445c8aa1de8139dc26360dd3ca2` after final head `058e4ca6f0ae098b4fc56eca96622b4881531d6a` passed Linux and Windows CI; source tree `800be01b53a2d18f49d386f1630dd2bd90382ba5` |
| Local checks | Passed 2026-09-07: `npm run check` (265 files / 2709 tests, typecheck, build and stylesheet parity), `npm audit --omit=dev` (0 vulnerabilities), `git diff --check` |
| Exact-main CI | All passed at the feature merge SHA: [Validate 34087231279](https://github.com/jspusa/AMZ.API/actions/runs/34087231279), [Pages 34087231372](https://github.com/jspusa/AMZ.API/actions/runs/34087231372), [Mac 34087231335](https://github.com/jspusa/AMZ.API/actions/runs/34087231335), [Windows 34087231387](https://github.com/jspusa/AMZ.API/actions/runs/34087231387) |
| Pages publication / bytes | Deployment succeeded for the exact feature merge SHA. Source-build asset names/hash appear below; a separate direct byte comparison of the live URL was not performed |
| Desktop payload | CI created and checked 0.1.55 macOS universal test DMG/ZIP and Windows x64 unsigned NSIS/ZIP; metadata below. Artifact contents were not independently downloaded in this session |
| Protected installer cards | Not updated or authenticated in this session; the new artifacts are available through GitHub Actions below. Current portal card version/bytes remain unverified |
| Mac installation | Pending: actual device, exact app version/signature/hash, preserved vault and backup |
| Windows installation | Pending: Windows 11 Pro x64, NSIS version, addon boundary, safeStorage and Hello |
| Signed bootstrap / update | Blocked pending signing identity, protected environment and separately approved feed; see preflight |
| Live feature acceptance | Not run: use the exact-version matrix; no Amazon mutation is authorized by this ledger |

## Preserved history

[Original handoff](archive/CODEX_HANDOFF-through-2026-09-04.md) is the original 449,222 bytes, SHA-256 `b09da95092ea42a4cc48e153337475f3008ad828b90a76ede4c75bd965d2c5fb` from review baseline `efdf76fd701b76997e64b74a4f30d3d3d96da360`. Do not edit it to make historical “current” statements match today; add dated evidence here or a new release ledger.

## 0.1.55 implementation and local evidence

All 16 approved recommendation IDs have corresponding source changes or, for signing/native/live work, concrete preparation documents. Final publication evidence is recorded separately from this local implementation.

| Scope | Implemented behavior | Verification surface |
|---|---|---|
| 01 | Every Pages trigger validates the exact checkout before artifact upload/deploy | Parsed workflow gate regression |
| 02 / 07 | Narrow read-only feature negotiation; conservative legacy fallback; shared browser-safe B2B DTOs | Bridge parser/late-response tests and existing route/write validators |
| 03 / 06 | Zero-order inbound tracking, insufficient-target risk, accurate AWD calculation wording | Restock port and SKU command tests; FBA inventory regressions |
| 04 | Actual persisted source deadline, original-device instructions, separate missing/expired responses and preview deadline | Export/import router and real LibreOffice round-trip |
| 05 | Up to 30 sanitized current-context B2B records; observation before a fresh preview/approval | Reopened LocalStore, GET-only route, renderer recovery/unknown-result tests |
| 08 | Copy/persist/publish, file flush and directory flush; uncertain persistence blocks further work and cannot enter destructive repair | Failure injection, initialization/recovery and reopened no-resend assertions |
| 09 | Short current handoff, immutable history, corrected release/ADR evidence | Exact archived bytes/SHA and document links |
| 10 / 11 | One protected installer entry, source/artifact distinction, signed preflight and 22-row live matrix | Update policy/workflow tests; device execution remains outstanding |
| U1 / U3 | Valid CJK/mono fallback, tabular numeric alignment, snapshot vs acceptance/verification times | CSS composition/build parity and rendered timestamp assertions |
| U2 | Usable shell before initial Sales completion; no request-driven remount | StrictMode slow/failing fetch, connection settings and retained SKU behavior |
| U4 | B2B 25-row and content 50-row pagination, compact/full views, full consequential diffs | Search/selection/page/focus and existing full-preview tests |
| U5 | Lazy accounting, inventory-age, reports, reviews and variation tools; explicit loading/error/return handling | Build graph, existing navigation and delayed-workspace behavior |

Bundle comparison uses `npm run build` with the same locked dependency versions and compares the uncompressed script referenced by `out/renderer/index.html`. Baseline entry was 2,012,012 bytes; the first integrated candidate measured 1,867,142 bytes (7.20% smaller). Five tool chunks totalled 171,944 bytes and load on demand. This is build-output evidence, not measured real-device startup time. Final candidate bytes and full-check counts are appended after integration.

The Windows filesystem exception is explicit: Node/libuv may not support directory-handle flushes. The file is flushed before replacement; documented unsupported directory errors are tolerated on Windows only. Real I/O failures fail closed. This does not claim POSIX-equivalent directory durability or replace real Windows acceptance.

Browser URL policy prevented this session's live visual preview. No browser screenshot, physical biometric, publisher-signature, installed-device or live Amazon result is claimed. The signed-feed visibility decision remains independently required by ADR 0001.

Final local integration: **265 test files / 2709 tests passed**; typecheck, production build and stylesheet parity passed. Real LibreOffice round-trip remained enabled and passed. Production dependency audit returned zero vulnerabilities. The first full run had seven failed legacy contract expectations (route count, new expiry fields, purged-source response, CSS bytes and version constants); each was updated with the new exact contract and the final full run passed.

Final initial script: `assets/index-BzG71_Wh.js`, **1,868,976 bytes**, SHA-256 `ee032ae3dec84410c1992f5bc976ba27392685e695f059af878d43766b8ead71`; **7.11% smaller** than baseline. CSS ordered rule-stream fingerprint: `e5233b94b5fe1a24ca189ec44c3ca42606e1336d3610e517c12a36dad2f65a10`.

Independent Standards and Spec reviews found and resolved three substantive regressions before submission: zero-order lead-time risk, lazy variation return/focus, and initialization disk-flush failure incorrectly entering destructive corruption recovery. The final reviews reported no open findings within the approved scope.

PR CI first attempt: Linux [Validate 34086478685](https://github.com/jspusa/AMZ.API/actions/runs/34086478685) passed at `69818c58ae073d62e6dc0b808c82d01940be26eb`. Windows [34086478642](https://github.com/jspusa/AMZ.API/actions/runs/34086478642) found one timing-dependent assertion in the brand/listing dedupe test (2,704 passed, 1 failed, 4 existing platform/tool skips). The test now waits for both actual gateway-start signals instead of assuming file durability work completes after one fake millisecond; it still asserts exactly one POST at start and completion. Production source is unchanged by this correction; all 36 dedupe tests pass locally. The corrected head then passed [Linux 34086764885](https://github.com/jspusa/AMZ.API/actions/runs/34086764885) and [Windows packaging / Bridge smoke 34086764883](https://github.com/jspusa/AMZ.API/actions/runs/34086764883) before merge.

The main Pages job recorded `assets/index-BzG71_Wh.js` and `assets/index-Doik7abF.css`, with the same stylesheet fingerprint as the local build. It reported deployment status `succeed` and publication of `https://jspusa.github.io/AMZ.API/` at **2026-09-07 05:34:25 UTC**. This verifies source-build/deployment correspondence; it is not a direct CDN-byte or visual comparison.

## Main desktop artifact evidence

Both runs used feature merge bf2ec996e5ee0445c8aa1de8139dc26360dd3ca2, package 0.1.55. Mac completed universal packaging, ad-hoc signing/verification and packaged smoke before producing the DMG/ZIP. Windows completed installed NSIS, portable ZIP and unpacked Bridge/addon smoke without Amazon credentials; the AMD64 N-API export and packed checksum manifest passed. These are test packages, not publisher-signed releases.

| Platform | Run / artifact | Uploaded bytes | GitHub archive digest | Expiry (UTC) |
|---|---|---:|---|---|
| macOS universal | [Run 34087231335](https://github.com/jspusa/AMZ.API/actions/runs/34087231335), artifact [10005712794](https://github.com/jspusa/AMZ.API/actions/runs/34087231335/artifacts/10005712794) | 469,019,912 | sha256:c0c3143b3e7e70301e4ecfd811a5e3c3bdab14feb794b6b5cf5075e310d36226 | 2026-09-21T05:37:55Z |
| Windows x64 | [Run 34087231387](https://github.com/jspusa/AMZ.API/actions/runs/34087231387), artifact [10005723971](https://github.com/jspusa/AMZ.API/actions/runs/34087231387/artifacts/10005723971) | 245,025,954 | sha256:90ceff9b30353d0f57f86e9b5a26dd56c388d0e8af0b86db3e5cc79ae461270c | 2026-09-21T05:38:38Z |

The digest above identifies GitHub’s uploaded artifact archive, not an individual EXE, DMG or installed app. Local Linux verification passed all 2,709 tests including the real LibreOffice round-trip. Main Mac CI passed 2,708 with the unavailable LibreOffice check skipped; Windows passed 2,705 with the same LibreOffice check and three existing POSIX-only artifact harness tests skipped. Both ran all 265 test files and completed their production builds and packaging gates. No additional test was disabled to make this release pass.
