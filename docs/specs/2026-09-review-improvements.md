# Approved September architecture and usability improvements

User authorized all recommendations in the 2026-09-07 AMZ.API review. Baseline:
`efdf76fd701b76997e64b74a4f30d3d3d96da360` (0.1.54). Implement within the existing
Pages/Notebook Key architecture, preserving FBA-only, exact context/identity,
native approval, serial PATCH, accepted/verified distinction and no blind retry.

## Accepted scope

- 01: Pages publication depends on typecheck/tests/build for the same source,
  including manual and existing issue event paths.
- 02: A narrow read-only Notebook Key capability snapshot and conservative old
  Bridge compatibility. Unsupported B2B batch/recovery must explain the update
  before accepting a workflow; existing supported single-SKU work remains usable.
- 03: Distinguish replenishment quantity from low available inventory with stock
  already inbound; never advise ordering zero units. Retain stockout risk.
- 04: Content workbook exports disclose original-device evidence and 24-hour
  source deadline; missing source differs from expired source. Preview deadline
  (up to 15 minutes) is separately displayed. Do not weaken evidence checks.
- 05: A bounded, current-account/current-marketplace recent B2B work projection
  restores accepted/pending and minimum-price-next-stage work after reopening.
  Recovery is observation/GET only. Fresh preview and new native authorization
  remain required for every next write; no raw ledger enumeration or old approval.
- 06: AWD UI says the current implementation is a lead-time calculation and
  official handoff, without implying automatic draft creation.
- 07: Centralize browser-safe B2B public wire DTO knowledge across main and
  renderer, preserving runtime identity/binding validators and main-only internals.
- 08: Persistence commits publish memory only after successful durable storage;
  define and test temp-write/rename failures and crash/restart/no-resend behavior.
- 09: Compact current handoff plus linked immutable history; correct stale
  merge/release/ADR states and separate source, deployed UI, artifacts, installed
  device and live verification evidence.
- 10: Complete available signed-update preparation and unify installer guidance.
  Do not invent certificates, change update-feed visibility, disable protections,
  or claim publisher signing/physical installation without evidence.
- 11: Produce an exact-version live acceptance matrix and safe evidence procedure.
  Do not call real Amazon mutations or pretend Linux/CI verified native biometrics.
- U1: Valid CJK/system font fallbacks and consistent numeric alignment.
- U2: Render an operable console shell without waiting for the first sales read;
  preserve scoped requests, loading/error states, and connection authority.
- U3: Display B2B snapshot time separately from per-SKU write/readback time.
- U4: Compact/expanded views with bounded pagination for B2B and content results;
  preserve search/filter, selection meaning, complete consequential diffs and focus.
- U5: Measure bundles, then defer low-frequency views when worthwhile; preserve
  main job lifecycle, caches and return focus. Do not restructure for file length.
- Make external LibreOffice integration timeout configurable and diagnose process
  failures. Keep actual round-trip assertions and do not skip available integration.

## Accepted verification surfaces

Use existing public route/domain interfaces, rendered UI behavior, LocalStore
public persistence/inspection and real workbook parsing. Add one failing behavior
test per meaningful slice, then fix. Existing route/security/ownership contracts
remain required. Run focused tests during work and full check plus production
audit before proposing release. Browser preview is currently blocked by its URL
policy: report that limitation and do not bypass it or claim visual verification.

## Delivery

Create a reviewable GitHub change and verify CI before merge/publication. Local
work can complete without secrets; signing, installed-device checks and live
Amazon proof may remain explicitly blocked by absent user environment evidence.
