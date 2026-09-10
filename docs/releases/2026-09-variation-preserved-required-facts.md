# 0.1.62 — existing product facts required by variation Preview

Issue #228; [scope and acceptance](../specs/2026-09-10-variation-preserved-required-facts.md). The previous 0.1.61 release record remains authoritative for its artifact and delivery evidence.

## Confirmed cause

On 2026-09-10, the reviewed local diagnostic candidate `af191f4d0da1cb3d90447c5318f83f3df5138356` completed one Preview for the original standalone source and target. Amazon HTTP 200 returned ERROR 90220 / `contains_liquid_contents` / `MISSING_ATTRIBUTE`; the main diagnostic was `VARIATION_REQUIREMENTS_VALUE_CONFLICT`. The current listing already contained nonempty data, so the fill-only form excluded it. This proves the conflicting read/Preview branch, not the precise fact value or validity of an arbitrary replacement.

The candidate was restored to the trusted CI 0.1.61 bundle after diagnosis. Both restoration cycles preserved the encrypted vault bytes. The first cycle could not execute Preview because native UI control was stuck; it is not live acceptance evidence. The second cycle completed after normal app shutdown restored UI control. Local evidence is in `/tmp/amz-api-variation-conflict-canary-round2/af191f4d0da1cb3d90447c5318f83f3df5138356/` (`live-value-conflict.json`, `restore-evidence.json`). No formal Amazon mutation occurred.

## Delivery status

| Layer | Evidence |
|---|---|
| ★ Root-cause diagnosis | Original account/source/target reached the exact existing-value conflict. |
| ★ Trusted app restored | CI 0.1.61 ASAR `b92c6ccd4bc93341c88a3c99b14dedd3cadf1bd6ac96cf81cf8be2878c5e1dea`; vault unchanged. |
| ★ 0.1.62 implementation | Explicit name-only preservation, exact unchanged-fact proof and current target-family proof are implemented. |
| ★ Feature source checks | 296 test files / 3,316 tests, typecheck, build and stylesheet verification passed; production audit found 0 vulnerabilities. Latest main integration and exact-source CI remain pending. |
| ★ Independent reviews | Final Standards and Spec re-reviews each report 0 remaining findings; independent production-seam drift regressions passed. |
| ☆ Pages and desktop CI artifacts | Not yet published or verified for this change. |
| ☆ Installed 0.1.62 live recovery | Pending new UI and verified application; do not claim the original liquid blocker fixed. |
| ☆ Protected downloads | Pending this version's upload and authenticated byte/hash retrieval. |

Source version 0.1.62 does not mean the user's app or protected downloads have been updated. Formal mutation, real Touch ID/Windows Hello approval, Windows device behavior and publisher signing are separate from Preview and CI acceptance.

Local review evidence: the first review identified missing target identity binding and content-owned fields in the managed denylist; a follow-up production-seam reproduction exposed target-theme drift after the last Preview. These were fixed with before-approval/dispatch regressions, including changed sibling combinations and membership. The final feature check is `/tmp/amz-api-v0162-verified/feature-final-check.log`. No test result here is a live Amazon write or new installed-version claim.
