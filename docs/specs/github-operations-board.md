# Human-friendly GitHub Operations Bulletin Board

## Operator flow

- The Operations Bulletin Board remains the first important home card and can be collapsed.
- `新增即期品` and `新增促銷` use plain-language AMZ.API forms.
- Publishing opens a completely prefilled GitHub Issue page; the operator only performs GitHub's final publish confirmation.
- Every rendered announcement links to its source for modification or withdrawal. Editing the Issue updates the announcement; closing it withdraws the announcement.
- No R2 account, five connection fields, board password, GitHub token, or OAuth application is required.

## Announcement behavior

- Only Issues authored by the repository owner, a member, or a collaborator may enter the published snapshot.
- An expiry announcement contains marketplace, Seller SKU, manual expiry date, and optional note.
- A promotion announcement contains date, event name, optional note, and an optional countdown.
- Manual expiry dates appear in both the compact expiry list and the promotion calendar.
- A compact item must not repeat the same countdown value, and multiple SKUs must remain space-efficient.
- The calendar uses an icon rather than a Chinese-character date badge, uses a neutral surface, and gives all seven weekdays equal columns.
- Inventory and price stay live, local, read-only Amazon data and are never written to GitHub.

## Publication and compatibility

- GitHub Actions regenerates the public JSON snapshot when authorized announcement Issues change and when the Control Console is built.
- Unaffiliated public Issue events do not start the deployment job. The builder independently rechecks author association across bounded pagination and keeps the previous Pages deployment if the safety limit is exhausted.
- The main-owned board reader uses the published GitHub Pages snapshot by default and remains fail-closed for invalid data.
- A missing published snapshot is unavailable and stale, never a successful empty board.
- The existing Notebook Key gate and local Amazon credential boundary remain unchanged.
- The obsolete R2 board setup and custom administrator password are removed from the operator flow.

## Workbook color

- Content-audit Excel cells that represent a passing or no-problem result use pale green instead of pale blue.

## Verification seams

- A public announcement draft produces the expected prefilled GitHub URL without placing secrets or live Amazon values in it.
- Generated snapshots accept authorized Issue authors and reject unaffiliated public authors.
- Authorized announcements remain discoverable beyond the first 100 labeled Issues; exhausting the 20-page safety limit fails closed.
- Expiry notices render in both the compact countdown list and calendar.
- Passing content-audit workbook cells use the agreed pale-green fill.
