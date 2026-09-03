# Supply Boss Operations Bulletin Board

## Operator flow

- The Operations Bulletin Board remains the first important, collapsible home card.
- `新增即期品` and `新增促銷` keep their plain-language inline forms.
- Confirming a new notice opens the local management window. The operator signs in with the shared internal account and password only when the current App session has no valid board session.
- A valid session lets the operator create, edit, and delete entries in the same screen. Employees do not need GitHub accounts and do not configure R2 fields.
- Closing the editor does not log out. The board session expires after at most eight hours and is also cleared on lock screen, sleep, or App exit.

## Public and private data

| Data | Shared board | Notebook Key only |
|---|---:|---:|
| Seller SKU, manual expiry, optional stop-sale date, promotion title／start／end dates, countdown choice, note | ★ | — |
| Current FBA fulfillable inventory and effective price | — | ★ |
| Amazon credential, board password, board session token | — | ★ |

The public board is intentionally readable by every connected employee App. Only authenticated write requests can change it. The local editor uses a memory-only partition and no-network CSP; credential submission crosses only the exact editor main-frame IPC, then main calls the fixed Supply Boss origin.

## API and storage contract

- `GET /api/operations-board` is public. A request with `x-amz-api-operations-board-schema: 2` returns the complete schema v2 snapshot; a request without that header returns an exact v1 projection for legacy readers. That projection omits `stopSaleDate`; a promotion's legacy `date` is its `startDate`, and `endDate` is omitted.
- `POST /api/operations-board/login` verifies separate board-editor credentials and returns a board-scoped session with an eight-hour maximum lifetime. The same credentials are rejected by the legacy `/api/login` snapshot-admin route.
- `PUT /api/operations-board` requires that session, a base revision, and `x-amz-api-operations-board-schema: 2`. It submits the full schema v2 replacement after create／edit／delete operations. Once canonical storage is v2, an old no-header PUT returns `409` with an upgrade instruction and cannot erase v2-only fields.
- Login and write request streams are bounded before JSON parsing; a stream is cancelled immediately once it exceeds its limit. Snapshot and write bodies are limited to 128 KiB and 100 unique UUID items. Marketplaces, date-only values, date ordering, Seller SKU, titles, notes, and discriminated item shapes are validated exactly.
- Supply Boss owns the fixed R2 object key `operations-board/v1.json`; the stable legacy key name does not define the payload schema. The server accepts persisted schema v1 or v2, normalizes either to canonical v2, and projects v1 only at a no-header GET boundary. AMZ.API never asks the operator for bucket, account, access key, secret, or public-base fields.
- The server generates revision and update time and uses the raw R2 object ETag for conditional writes; the quoted HTTP ETag is response metadata only. A competing edit returns `409`; the client reloads and requires an explicit human retry instead of overwriting.
- Timeout, `429`, `5xx`, network failure, and unknown write result are never blindly retried.
- A read failure may use only the current process's last-known-good snapshot and must display stale state; failure never means the board is empty.

## Announcement behavior

- An expiry announcement contains marketplace, Seller SKU, manual expiry date, optional stop-sale date, and optional note. A stop-sale date must be on or before the expiry date.
- An expiry countdown targets the stop-sale date when present; otherwise it targets the expiry date. Both dates remain visible, and each appears in the calendar.
- A promotion contains inclusive start and end dates, event name, optional note, and an optional countdown. A one-day event uses the same date for both endpoints; an end date cannot precede its start date.
- Every day in a multi-day promotion range appears in the calendar. The agenda represents the promotion once with its range rather than duplicating it once per day.
- Compact rows do not repeat countdown values; the calendar has seven equal weekday columns and uses an icon rather than a Chinese-character date badge.
- Inventory and price remain live, local, read-only Amazon facts and are never uploaded with the announcement.
- Publishing an announcement writes only the Supply Boss board object. It never invokes Amazon Validation Preview, the Amazon Write Gate, or an Amazon PATCH.

## Verification seams

- Invalid login does not create a session; successful login never exposes password or token to the Pages renderer.
- Editor close preserves a valid in-App session; lock, sleep, App exit, and expiry clear it.
- Unauthenticated writes return `401`; stale revision writes return `409`; successful create／edit／delete increment the server revision.
- Malformed, oversized, duplicate-ID, unsupported-marketplace, invalid date-order, and unsafe-text snapshots fail closed.
- Persisted v1 snapshots migrate without inventing a stop-sale date or multi-day range; header `2` GET returns v2, while no-header GET preserves the exact v1 item shapes.
- After canonical v2 data exists, a no-header legacy PUT fails with `409` and leaves the v2 snapshot unchanged.
- Public read, login, and write all use one fixed Supply Boss origin and fixed paths.
- Failure after a write may have reached the server remains outcome-unknown and is not automatically resent.

## Current evidence boundary

The next-version local implementation, automated verification, independent Standards／Spec review, and fixed-fixture browser interaction checks are complete. This specification does not claim public deployment, live endpoint verification, release artifact creation, employee download replacement, or installation.
