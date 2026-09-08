# Five operating capabilities — approved scope

User approved on 2026-09-08, after explicitly requesting all five capabilities
and accepting the local-notification and testing boundaries. Review baseline:
`69a395096b1fdbf23be94c804a0aea1a4d523a24`.

- Read Amazon Coupon/promotion records, distinguish published and latest
  revisions, verify participating current-FBA identities, preserve manual plans.
- Read AWD on-hand, seller-to-AWD inbound, AWD-to-FBA replenishment and available
  expiry evidence. Preserve nulls and units; do not double-count supply or claim
  all AWD downstream stock is FBA-owned. No shipment creation.
- Diagnose Buy Box/price health from exact Amazon evidence. Segmented featured
  offer evidence and reference prices do not prove universal eligibility or
  identify Chewy as the cause. No automatic price changes.
- Diagnose advertising performance using existing SP advertised-product
  reports and attribution windows. Reuse the report broker and existing strategy
  owner. Missing is not zero; no profitability claim, Ads mutation, or invented
  search-term/SB/SD metrics.
- Provide a separate local event center from verified findings: source,
  timestamps, deduplication, acknowledgement, resolution only with complete
  evidence, and source navigation. Explicitly local sync, not Amazon push.
  Operates only while Notebook Key runs. No cloud provisioning, subscription
  creation, new credentials or commercial data sent to the public manual board.

Preserve main/preload/renderer trust, exact account/mode/marketplace/generation
fences, cancellation, FBA-only identity proof, bounded pagination, rate pacing,
unknown/partial/stale distinctions, and no-blind-retry. Keep the existing seven
run-all audit items unchanged. All five capabilities must have reachable UI.

## Approved public verification seams

ApiRouter.handle; each feature's public read/diagnosis functions; the event
owner's public observe/read/acknowledge/clear operations; and rendered user
interactions. Verify missing values, pagination, permissions, account switching,
late completion, deduplication and no unintended upstream writes. Red before
green at each seam; external API fixtures only, never live account mutations.

Run focused tests during implementation, then npm run check, npm audit
--omit=dev and git diff --check. Standards and Spec reviews use the baseline
above. Source/CI, desktop artifact, installation and live Amazon verification
are distinct; no unverified success claims or unapproved signed release.

Sources and pinned versions: ../research/2026-09-08-amazon-operations-sources.md.
