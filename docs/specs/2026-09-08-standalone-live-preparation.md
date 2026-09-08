# Standalone FBA live preparation follow-up

The user's 0.1.58 acceptance run exposed two remaining barriers for a confirmed standalone FBA item: the unbound picker lost provenance for an explicitly complete empty relationships response, and attach preview treated an existing variation theme as a parent relationship. The existing immutable-dimension preparation itself worked.

| Expected behavior | Acceptance |
|---|---|
| ★ Start from the unbound picker | Use the production family parser, retain complete empty relationship evidence, and freshly confirm the exact SKU before preparing. |
| ★ Preserve matching existing theme | A uniquely scoped existing theme that exactly matches the target can remain unchanged when complete relationships evidence proves standalone and no parentage or parent relationship attribute remains. |
| ★ Fail closed on uncertainty | Missing, malformed, foreign-market, fallback or incomplete relationship evidence, conflicting themes and actual relationship remnants remain blocked. |
| ★ Preserve mutation controls | Validation Preview, fresh main-owned evidence, native approval, durable idempotency and no blind retry remain required; live acceptance performs no Amazon mutation. |

Keep the concurrently published minimal homepage changes from PR #217. Run the public owner and production-parser-to-picker regressions before repository checks and both review axes. Record install, authenticated portal retrieval, workbook export and live read-only acceptance separately from CI.
