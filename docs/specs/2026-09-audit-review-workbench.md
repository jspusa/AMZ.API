# Same-session audit review workbench

User approved implementation and publication of four frontend-only features:
problem provenance classification, a per-SKU audit matrix, same-session recheck
differences and seen/later review marks. Baseline main is
283d36c8182dd3ba14f02426361f8dc20520d3ad.

## Acceptance

- Reuse existing SKU overview with an audit view and a quiet home shortcut;
  preserve the seven homepage launchers and all chart geometry and themes.
- Project seven already completed main-owned audit jobs: content, images, A+,
  variation, subscription, B2B and advertising. No new route, report, request,
  permission, credential, native installer or package-version change.
- Provenance must come from structured evidence. `amazon-content` means text
  provenance, never an Amazon ruling. Only explicit A+ document REJECTED evidence
  receives Amazon-reported classification; it is not a listing-sale diagnosis.
  Incomplete data, human review and local optional recommendations stay separate.
- Product count is distinct from finding count. Exact Seller SKUs remain exact;
  parents are excluded. Missing source rows are unknown, not zero defects.
  Different ASINs across sources are disclosed rather than silently reconciled.
- Compare only strictly later same-market/mode/kind/options snapshots. A vanished
  finding is resolved only with a complete, same-identity current row and a
  nonempty ASIN. Absent, changed or incompletely read products are unknown.
  First or changed-scope results are not falsely called new findings.
- Marks are per-finding display state and never clear a finding or authorize a
  write. Source evidence changes/removal invalidate them. They are bounded,
  Dashboard-owned memory, discarded on account/market/mode session changes.
- Matrix actions do not initiate API requests. An explicit source handoff uses
  the completed job, binds exact SKU filtering and returns to the matrix. Returning
  through the homepage retains its pre-existing read/refresh lifecycle.
- Keep all export scopes, original verdicts, previews, write gates and busy
  protections unchanged. No operational browser storage or URL persistence.
- Test boundaries, actual rendered interactions, mobile layout and four themes.
  CI, deployment and public asset verification are separate release gates.
