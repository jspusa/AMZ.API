# 0.1.62 — existing product facts required by variation Preview

Issue #228; [scope and acceptance](../specs/2026-09-10-variation-preserved-required-facts.md). The previous 0.1.61 release record remains authoritative for its artifact and delivery evidence.

This is the historical 0.1.62 record. Its accepted-operation recovery was subsequently completed on official 0.1.63; current installation and protected-download delivery are tracked in the [0.1.63 recovery ledger](2026-09-variation-readback-recovery.md).

## Confirmed cause

On 2026-09-10, the reviewed local diagnostic candidate `af191f4d0da1cb3d90447c5318f83f3df5138356` completed one Preview for the original standalone source and target. Amazon HTTP 200 returned ERROR 90220 / `contains_liquid_contents` / `MISSING_ATTRIBUTE`; the main diagnostic was `VARIATION_REQUIREMENTS_VALUE_CONFLICT`. The current listing already contained nonempty data, so the fill-only form excluded it. This proves the conflicting read/Preview branch, not the precise fact value or validity of an arbitrary replacement.

The candidate was restored to the trusted CI 0.1.61 bundle after diagnosis. Both restoration cycles preserved the encrypted vault bytes. The first cycle could not execute Preview because native UI control was stuck; it is not live acceptance evidence. The second cycle completed after normal app shutdown restored UI control. Local evidence is in `/tmp/amz-api-variation-conflict-canary-round2/af191f4d0da1cb3d90447c5318f83f3df5138356/` (`live-value-conflict.json`, `restore-evidence.json`). No formal Amazon mutation occurred.

## Delivery status

| Layer | Evidence |
|---|---|
| ★ Root-cause diagnosis | Original account/source/target reached the exact existing-value conflict. |
| ★ Trusted app restored | CI 0.1.61 ASAR `b92c6ccd4bc93341c88a3c99b14dedd3cadf1bd6ac96cf81cf8be2878c5e1dea`; vault unchanged. |
| ★ 0.1.62 implementation | Explicit name-only preservation, exact unchanged-fact proof and current target-family proof are implemented. |
| ★ Feature source checks | 296 test files / 3,316 tests, typecheck, build and stylesheet verification passed; production audit found 0 vulnerabilities. Integrated main `19cc03fe` check also passed: 297 files / 3,321 tests, build/stylesheet parity and production audit 0. Final exact-source CI is recorded below. |
| ★ Independent reviews | Final Standards and Spec re-reviews each report 0 remaining findings; independent production-seam drift regressions passed. The subsequent main integration also passed both independent axes with 0 findings. |
| ★ Pages and desktop CI artifacts | PR #235 merged as `9a71d8bd848266936cd387d729ec0b6fdd473eac`; exact main Validate, Pages, Mac and Windows succeeded. All live Pages HTML/JS/CSS bytes and both official desktop artifacts verified. |
| ★ Installed 0.1.62 / live Preview | Official Mac 0.1.62 installed with vault unchanged and launched connected. The same ASAR previously passed the original liquid-required Preview after explicit unchanged-fact acknowledgement. |
| ☆ Accepted bind recovery | After external user interaction the app displayed an accepted request awaiting verification. Subsequent GET showed the intended parent, but this is not full canonical proof. The existing button cannot reconcile; follow-up is Issue #236 / 0.1.63. |
| ☆ Protected downloads | Pending this version's upload and authenticated byte/hash retrieval. |

Installed version, protected downloads, actual Amazon result, real Touch ID/Windows Hello approval, Windows device behavior and publisher signing are separate evidence claims; their verified and pending states are recorded below.

## Verified release and live boundaries

PR #235 final reviewed head `6a981a013aa39a3696d3c8f6ed6d7e779a6884fa` passed Validate `34431102625` and Windows `34431102670`; the merged main has the same source tree. Main Validate `34431681374`, Pages `34431681365`, Windows `34431681362` and Mac `34431681367` attempt 2 succeeded. The first Mac attempt failed only the existing five-second architecture source-scan timeout; its exact-source focused check passed within the original timeout, and one justified failed-job rerun passed. No failed run is used as artifact evidence.

| Artifact | Exact evidence |
|---|---|
| ★ Pages | Artifact `10134741272`; index plus all nine JS/CSS assets match public HTTP bytes. Local evidence: `/tmp/amz-api-v0162-verified/pages/pages-byte-verification.json`. |
| ★ Mac | Artifact `10134996998`; DMG 247,072,192 bytes, SHA-256 `10ec9a61ff211da82e4d9b4bae991e337ed159d4f6437947cbe6f45e8501102b`. Installed universal ASAR `350232d07df4bfbf1e9354b817938edde729c0d19ce477ef6cb8144dcb2be788`, deep strict ad-hoc verification, update channel disabled. |
| ★ Windows | Artifact `10134841508`; installer 101,994,182 bytes, SHA-256 `dd953eb29eafba91ecd54d859de7c18223acaafec56695e7f07a71e85831d711`. Packaging, ASAR, AMD64 and native boundary checks passed; no real Windows device or Hello claim. |
| ★ Installation | `/tmp/amz-api-v0162-verified/installation-verification.json`; old app backed up, current userData retained, encrypted vault unchanged. Official app reopened with Amazon connected. |
| ☆ Protected portal | 0.1.62 has not been uploaded; employee authentication remains pending. Final 0.1.63 delivery will supersede both cards after exact artifact verification. |

The original source `TPZ01AM-4` and target `AF Turkey Tedon_Small` displayed the existing liquid answer as No. The operator explicitly acknowledged preserving that answer, and one fresh Preview passed with No → No and the formal confirmation button available. The agent did not click formal confirmation or native approval. During external user interaction, a later fresh UI observation reported accepted/pending with Request ID `74c40126-c7b1-491a-83ca-163813a77205`. Read-only followups first showed no parent, then the intended parent. The existing button reads family state without reconciling the durable intent, so the unchanged pending UI is not proof that the full canonical predicate failed. No resubmission was performed. Evidence: `/tmp/amz-api-variation-preserved-facts-canary/9a71d8bd848266936cd387d729ec0b6fdd473eac/`. Recovery of this existing record is the bounded [0.1.63 task](../specs/2026-09-10-variation-readback-recovery.md).

Local review evidence: the first review identified missing target identity binding and content-owned fields in the managed denylist; a follow-up production-seam reproduction exposed target-theme drift after the last Preview. These were fixed with before-approval/dispatch regressions, including changed sibling combinations and membership. The final feature check is `/tmp/amz-api-v0162-verified/feature-final-check.log`. No test result here is a live Amazon write or new installed-version claim.

Main integration preserved PR #234 audit layout and the new preservation checkbox styles. The five fixture conflicts contained only rule-stream hashes and measured lengths; regenerated appearance and the combined stylesheet measured fingerprint `32696117161a0b08f398c6e4f9c6c0df52187f2313850eac292fec2accb39c86`. Evidence: `/tmp/amz-api-v0162-verified/integrated-check.log`, `integrated-audit.log`, `styles-after-main-integration.json`.

PR #235 initial head `e71089cb63fd9b79041dc23c1d872513d9477758` passed Validate `34430706277`; Windows `34430706435` failed before packaging because the merged audit source-text test expected LF on a CRLF checkout. The test reader now normalizes line endings while keeping all semantic assertions. Both independent review axes report 0 findings for this test-only correction; the subsequent full local check passed 297 files / 3,321 tests and build/stylesheet parity (`windows-portability-check.log`). This failed Windows run is not packaging evidence; replacement exact-head CI is required.

## Subsequent 0.1.63 closure

On 2026-09-10, [PR #237](https://github.com/jspusa/AMZ.API/pull/237) / main `6086d8dbbf85226540c333adc7d3e717cb59a8ac` was released and its official Mac artifact installed with the active vault and entire ledger preserved during the swap. The existing `TPZ01AM-4` attach then displayed “★ 先前操作已由 Amazon 唯讀回查確認” through the new GET recovery path, from no parent to `AF Turkey Tedon_Small`, with 19 FBA family members. The agent invoked zero 0.1.63 Preview, native approval or PATCH; it recovered the accepted operation observed above after external user interaction. The historical .62 observations and artifacts remain unchanged in this record. Exact .63 source/artifact/install/live receipts and the separate uploaded-versus-authenticated-download status are in the [0.1.63 ledger](2026-09-variation-readback-recovery.md).
