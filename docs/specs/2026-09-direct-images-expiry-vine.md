# Direct image preparation, expiry clearance, and active Vine progress

Jasper corrected the 0.1.64 acceptance workflow on 2026-09-12 after using the App.
This spec supplements the inventory-workflow spec; it supersedes the nine-image
filename limit, age-audit-dependent health entrypoint, and sixty-day Vine view.

## Images

Dropping a whole JPEG/PNG set must prepare usable Amazon image URLs without
requiring the operator to configure R2 or supply URLs per image. Filenames include
`SKU_01` through `SKU_10`; parse numeric order, preserve visible overflow/conflicts,
and use main-proven seller PTD capabilities for the actual editable slots. Never
silently drop an unsupported tenth image. Keep default audit threshold eight and
allow the operator to select a threshold before checking.

The existing Supply Boss service owns immutable image objects and a dedicated
image login audience. The first preparation opens a packaged, network-disabled
Notebook Key login sheet using the existing employee download password verifier.
The resulting image session lives in main memory only; it does not reuse or widen
download, board, or admin tokens. Lock, sleep, or account/context change clears it.
No common service credential is embedded in the App. Only image bytes and an
opaque upload operation ID reach this service; no Seller ID or SKU is uploaded.

The main upload owner validates dimensions/type/size, submits at most one PUT per
operation, resolves ambiguous outcomes with GET, and anonymously reads back the
exact image bytes before setting `readyForAmazon`. Pending rows preserve their
original File for preparation retry and keep the correct numeric slot visible.
Preview, native approval, durable claim, single Amazon PATCH, and canonical
readback remain separate. Existing nine-slot accepted evidence remains readable.

## Expiry and sell-through

The primary entrypoint is FBA expiry and clearance risk, with its own explicit
sync action and resumable main job. It reads all FBA inventory/sales rows and
available inbound declared expiry evidence; the 180-day age filter cannot gate
this workflow. Age buckets and Amazon estimated costs remain optional supporting
data. Show sanitized phase-specific failures rather than hiding every upstream
failure behind a generic empty result.

Include recently received stock. Show full-SKU stock, sales speed, estimated
sell-through days and earliest declared expiry where available. Unconfirmed lot
balances may produce review guidance, never an invented expiry quantity or a
safe verdict. The automatic calendar retains only confirmed-lot positive forecast
shortfalls. Original manual expiry notices and promotions remain available.

## Vine

Accept a full Seller Central Vine page pasted as plain text, including navigation,
multi-line pending/pre-release statuses, two dates and numeric columns. Identify
ASIN, title, enrollment date, explicit status, enrolled units, and Amazon Vine
reviews. Do not require the user to invent a Seller SKU or rearrange CSV columns.
Revalidate FBA identity in main and save only normalized encrypted records.

Show ongoing enrollments regardless of enrollment age, with reviews/enrolled as
the progress bar. Ended/cancelled records do not appear in the active list; later
terminal evidence removes an existing active enrollment. Missing rows on one of
several pasted pages are not evidence that an enrollment ended. Unknown status,
malformed rows or partial pages are explicitly reported, not converted to zeros.
Import preview reports accepted/ended/rejected counts before local persistence.
No automatic Vine API synchronization or Amazon mutation is claimed.

## Acceptance evidence

Use public owner and UI seams for image preparation, old receipt recovery,
numeric order, all-stock health sync, low-age expiry risk, and full-page Vine
parsing/active filtering. Verify the full check/audit before release. Record Site
deployment, Pages, desktop artifacts, installation, employee downloads and actual
Amazon/device behavior separately. User-selected image drafts must not be lost
by an uncoordinated App restart during release acceptance.
