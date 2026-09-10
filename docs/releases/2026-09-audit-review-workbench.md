# Audit review workbench — evidence and limits

Baseline main: 283d36c8182dd3ba14f02426361f8dc20520d3ad.
Approved scope: ../specs/2026-09-audit-review-workbench.md.

Frontend-only implementation reuses the existing SKU overview and seven completed
core audit snapshots. Original low-frequency audits, native APIs, installer,
package version, exports, writes and chart layout are unchanged.

Four capabilities: structured problem-source categories; per-SKU matrix;
same-session consecutive-snapshot differences; exact-evidence seen/later marks.
These marks are not remediation, successful writes or policy clearance. Missing
rows and incomplete sources cannot establish resolution. Known cross-source ASIN
differences are visible. No historical or cross-computer persistence is added.

## Verification

Focused model/component tests cover origin provenance, identifier fidelity,
source parsing, scope/chronology, positive resolution, incomplete/absent evidence,
mark invalidation and request-free actions. CSS manifests and logical/source
fingerprints are independently refreshed from the actual canonical stream;
historical payload assertions are retained, not bypassed.

Local full check initially encountered EIO on fsync in both /tmp and /mnt/data.
A probe confirmed /dev/shm supports the actual fsync operations. Re-running the
unchanged suite with TMPDIR=/dev/shm passed. No production fsync behavior, test
assertion or safety gate was disabled. The normal GitHub runner must also pass
npm run check and npm audit --omit=dev before publication.

The production-bundle browser fixture exercises all seven completed sources,
zero-request matrix filtering/marking, exact source handoff, return, same-session
mark retention, evidence-change reset and new/continuing/resolved/unknown deltas.
24 layout cases cover matrix/detail, desktop/mobile and all four themes. Current
screenshots and counts, final exact PR checks, deployment SHA and public-byte
proof are recorded in the PR after the corresponding gates complete.

## Limits

Browser checks use synthetic data only and never send a live Amazon mutation or
write preview. Local offline rendering flattens the built modules solely for a
fixture; normal-origin verification runs separately on GitHub. No real account,
Touch ID/Windows Hello, installed upgrade or universal policy compliance claim.
The loaded web version proves only the UI bundle, not new Bridge capabilities.
