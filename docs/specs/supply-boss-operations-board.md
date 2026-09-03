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
| Seller SKU, manual expiry, promotion title／date, countdown choice, note | ★ | — |
| Current FBA fulfillable inventory and effective price | — | ★ |
| Amazon credential, board password, board session token | — | ★ |

The public board is intentionally readable by every connected employee App. Only authenticated write requests can change it. The local editor uses a memory-only partition and no-network CSP; credential submission crosses only the exact editor main-frame IPC, then main calls the fixed Supply Boss origin.

## API and storage contract

- `GET /api/operations-board` is public and returns one exact v1 snapshot.
- `POST /api/operations-board/login` verifies the shared credentials and returns a board-scoped session with an eight-hour maximum lifetime.
- `PUT /api/operations-board` requires that session and a base revision. It submits the full replacement after create／edit／delete operations.
- Snapshot and write bodies are limited to 128 KiB and 100 unique UUID items. Marketplaces, date-only values, Seller SKU, titles, notes, and discriminated item shapes are validated exactly.
- Supply Boss owns the fixed R2 object `operations-board/v1.json`; AMZ.API never asks the operator for bucket, account, access key, secret, or public-base fields.
- The server generates revision and update time and uses R2 ETag conditional writes. A competing edit returns `409`; the client reloads and requires an explicit human retry instead of overwriting.
- Timeout, `429`, `5xx`, network failure, and unknown write result are never blindly retried.
- A read failure may use only the current process's last-known-good snapshot and must display stale state; failure never means the board is empty.

## Announcement behavior

- An expiry announcement contains marketplace, Seller SKU, manual expiry date, and optional note.
- A promotion contains date, event name, optional note, and an optional countdown.
- Manual expiry dates appear in both the compact expiry list and the calendar.
- Compact rows do not repeat countdown values; the calendar has seven equal weekday columns and uses an icon rather than a Chinese-character date badge.
- Inventory and price remain live, local, read-only Amazon facts and are never uploaded with the announcement.

## Verification seams

- Invalid login does not create a session; successful login never exposes password or token to the Pages renderer.
- Editor close preserves a valid in-App session; lock, sleep, App exit, and expiry clear it.
- Unauthenticated writes return `401`; stale revision writes return `409`; successful create／edit／delete increment the server revision.
- Malformed, oversized, duplicate-ID, unsupported-marketplace, and unsafe-text snapshots fail closed.
- Public read, login, and write all use one fixed Supply Boss origin and fixed paths.
- Failure after a write may have reached the server remains outcome-unknown and is not automatically resent.

## Current evidence boundary

The next-version local implementation, automated verification, independent Standards／Spec review, and fixed-fixture browser interaction checks are complete. This specification does not claim public deployment, live endpoint verification, release artifact creation, employee download replacement, or installation.
