# Full-page tools and image progress recovery

User request: folder image updates are already visible on Amazon, but “重新讀取本批次進度” remains accepted without a new readback; top navigation should open full pages like the image audit; opening 價目表 shows the generic workspace error.

## Accepted behavior

1. Manual image-batch refresh performs a new bounded GET-only canonical reconciliation of existing accepted operations. Background progress polling only observes the existing job. Clearly show that readback is running and its resulting state; an unchanged result is not silently presented as a completed verification.
2. Exact identity and every requested image position, including intended deletions, must match before verification. Storefront appearance, ACCEPTED receipts, source expiry, or elapsed time never suffice. Unknown, mismatch, read failures, or invalid context cannot authorize resend.
3. Provide bounded recovery after closing/reopening or upgrading the app: the operator supplies at most 30 exact Seller SKUs in the selected marketplace. Recover only the current account/mode's newest eligible durable image operation; a newer unresolved attempt must not be hidden by older success. Recovery does not prepare files, stage a preview, request native authorization, upload, or PATCH. No arbitrary ledger listing or new persistent business-data store.
4. Every top function-menu entry opens a single full-page workspace, not a home-card scroll target or floating drawer. Image tools use the same presentation as the audit entry and retain single-SKU, audit, and folder-batch tabs. Existing operations, reports, pricing, and advertising features remain reachable.
5. Preserve back navigation, focus/scroll restoration, current-account/marketplace fences, active work, write-time navigation locks, and honest completed/partial/unknown states. Navigating to a function does not itself start a new Amazon mutation or duplicate an audit.
6. The price list opens reliably across a Pages release without a late request for a removed price-list chunk. Preserve the existing in-session workbook and result behavior. Only claim a live root cause when directly evidenced; reproducing a missing-chunk failure is separate from observing that exact exception in the user's process.
7. When a fresh image readback remains pending, show the reasons from that same observation instead of calling every failure an image mismatch. A closed, validated diagnostic value may contain only fixed blocker categories and bounded aggregate counts for identity/evidence, image positions and categorized Amazon errors. No raw issue text, image URLs, account identifiers or credentials may enter it. Missing legacy diagnostics stay unknown; a failed new read clears prior reasons. Diagnostics neither relax the existing verification predicate nor grant permission to resend.

## Validation and delivery

- Regress delayed Amazon synchronization followed by manual refresh, repeat/overlapping refreshes, mismatches, errors, context invalidation, malformed recovery input, newer unresolved evidence, and zero new writes during recovery.
- Exercise real dashboard menu clicks and return behavior; verify full-page presentation for each navigation group and that busy write guards still hold.
- Reproduce the price-list delayed-load failure at the dashboard entry seam; keep existing price-list workflow tests.
- Run `npm run check`, `npm audit --omit=dev`, and `git diff --check`; independent Standards and Spec review on the same final change.
- Main recovery changes require a new Notebook Key capability release; publish Pages plus both protected installer cards. Preserve the installed app's vault and durable evidence before replacement. Verify the user's existing batch by readback only; do not submit an Amazon update for acceptance testing.
- Separate source/tests, CI, Pages, artifacts, protected download, installed app, and live readback evidence.
- The 0.1.80 native readback recovered ten accepted records but verified none. Its generic pending message does not identify which predicate failed. The follow-up must distinguish same-pass failures without adding another Amazon query, and test malformed diagnostic values plus legacy responses. An Amazon media host, changed URL, identical image count or no issues alone cannot prove submitted image content.
