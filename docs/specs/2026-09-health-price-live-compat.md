# Health report compatibility and generated price row isolation

Issue [#258](https://github.com/jspusa/AMZ.API/issues/258).

This is a corrective continuation of Jasper's approved inventory-workflow goal.
The installed 0.1.66 App connected to Amazon, then its first full-FBA health sync
and first generated price job each reached a terminal failure. Neither was
restarted. Baseline: main `f91d236683c437ca6ba873ed1593121e3c865748`.

## Observed failures and evidence boundary

- Generated price discovery found 285 FBA products and displayed real prices,
  then stopped with the sanitized Listing identity-incomplete error. No source
  workbook was selected and no output workbook was produced. The exact malformed
  live row is unknown. The real Listing reader and public price owner reproduce
  whole-job failure on a row-scoped `409 LISTING_IDENTITY_MISMATCH`.
- Full-FBA expiry/sales sync stopped with `REPORT_FORMAT_UNSUPPORTED`, reporting
  duplicate or conflicting columns. The exact live header is not retained. The
  official FBA Manage Inventory Health field list includes both `days-of-supply`
  and `Total Days of Supply (including units from open shipments)`, and both
  `snapshot-date` and `Inventory age snapshot date`. Each documented pair
  reproduces this rejection through the public report reader.

Official source, checked 2026-09-13:
https://developer-docs.amazon/sp-api/docs/report-type-values-fba#fba-manage-inventory-health-report

## Required behavior

1. In the price owner's per-row Listing catch, isolate only the exact additional
   status/code pair `409 LISTING_IDENTITY_MISMATCH`. Keep checkpoint validation
   first and the shared Listing validator strict. Preserve the trusted FBA row
   identity and an unavailable/error indication, never rejected title, price,
   minimum price or image facts. Continue independent rows and allow an honest
   populated XLSX export under existing completion rules. Original workbook
   comparison must retain its existing behavior.
2. Account, mode, generation, adapter or report identity errors, generic 409,
   authentication, throttling, network and server errors must still stop the job.
   Context invalidation clears observation/export and must prevent later reads.
3. Treat the two official health column pairs as distinct meanings. The stock
   supply field uses `days-of-supply`; inbound-inclusive supply must never be
   silently substituted. Stock/sales freshness uses `snapshot-date`; an inventory
   age date must never manufacture a current stock/sales snapshot. Preserve
   supplemental evidence separately only where needed by an existing consumer;
   otherwise leave it unused. Missing primary evidence stays unknown.
4. Do not loosen general duplicate-header or alias-ambiguity validation. Preserve
   FBA identity, numeric validation, region-specific age completeness, fee null
   semantics, all-FBA scope, and the confirmed-positive-shortfall calendar rule.

## Verification and delivery

Add public-seam regressions before changing each owner. Exercise good/bad/good
price rows through the real Listing reader, observe completion and parse the
actual exported workbook; verify global failure and invalidation still fail
closed. For health, cover both distinct official columns together with different
values and reversed order, primary-only and supplemental-only inputs, true
duplicates, and freshness that cannot borrow an age-only date. Run focused tests,
full `npm run check`, production audit and two-axis review before publication.

Preserve the complete original goal and pending native acceptance. Record source,
CI, Pages, desktop artifacts, installation and employee downloads separately.
No Amazon mutation or new diagnostic credential/transport access is authorized
by this fix. Public fixtures do not prove the next native job succeeds.
