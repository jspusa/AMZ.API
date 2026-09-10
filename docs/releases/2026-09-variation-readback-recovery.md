# 0.1.63 — complete accepted variation work through read-only recovery

Issue [#236](https://github.com/jspusa/AMZ.API/issues/236); [scope and acceptance](../specs/2026-09-10-variation-readback-recovery.md). Source baseline is official 0.1.62 main `9a71d8bd848266936cd387d729ec0b6fdd473eac`. The previous [preserved-fact release](2026-09-variation-preserved-required-facts.md) records its exact artifacts, live Preview and observed accepted operation separately.

The user-facing recovery button previously read only a family snapshot, leaving an accepted operation permanently uncertain in the current workspace. This release adds a main-owned GET recovery projection using the existing strict canonical reconciliation and durable intent. It must never issue Preview, native approval or PATCH. Its installed acceptance uses the existing pending operation; no new Amazon write is authorized for testing.

| Layer | Status |
|---|---|
| ★ Diagnosis and scope | Existing button's family-only behavior confirmed; parent observation cannot replace canonical proof. |
| ★ Implementation and regression checks | `npm run check` passed 297 files / 3,396 tests, typecheck, build and stylesheet parity; production audit 0; diff check passed. |
| ★ Independent Standards / Spec review | Both final independent axes report 0 remaining findings, including the exact route inventory and contradictory-search proof corrections. |
| ☆ Exact-source CI / Pages / artifacts | Pending reviewed commit and successful exact-source runs. |
| ☆ Installation / live GET recovery | Pending verified official artifacts. Preserve current userData and the entire pending ledger; never restore an older ledger. |
| ☆ Protected employee downloads | Pending final artifact upload and authenticated physical-byte verification. |

Prepared-only release helpers are under `/tmp/amz-api-v0163-verified/`. Their future release identities are null; synthetic helper tests do not constitute release or live evidence.

Review-driven regressions reproduced source GET versus returned same-SKU search contradictions in ASIN, FBA, dimension values/selectors and preserved facts. The canonical owner now checks the original search row and omits any supplied contradictory or malformed attribute's proof; missing search facts and unrelated content do not create false conflicts. All 14 production GET cases pass, with zero additional Preview, native approval or PATCH. Renderer regressions cover reopened pending work, explicit verified history, transient discovery failure, exact intent matching, late context and spent confirmations.

The first full check found only the newly added route missing from the reviewed route inventory; its exact GET pair and count are now updated without weakening default or unsupported-route checks. A subsequent run hit two unchanged timing-sensitive cases (A+ demo completion and B2B's 65 durable fixture writes); both passed the focused exact-source run within their original bounds. The final full check passed without changing their tests or deadlines. Local evidence: `final-check-reviewed-facts.log`, `final-audit.log`, `timing-failure-focused.log`, `search-contradiction-red.log`, `search-fact-red.log` and `search-all-proof-green.log` under `/tmp/amz-api-v0163-verified/`.
