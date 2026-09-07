# Use Supply Boss for the Operations Bulletin Board

Status: Accepted; released in v0.1.51, with schema v2 released in v0.1.53. Supersedes [ADR 0002](./0002-use-github-announcements-for-operations-board.md).

The shared Operations Bulletin Board uses a fixed Supply Boss API. Anyone with the AMZ.API Notebook Key can read the public board snapshot, while create, edit, and delete require a shared internal account and password entered only in a main-owned, packaged, no-network management window. Employees do not need GitHub accounts and do not configure Cloudflare R2 credentials in AMZ.API.

## Considered options

| Option | Ease | Access boundary | Decision |
|---|---:|---|---|
| GitHub Issue Form | ★★☆☆☆ | Every editor needs repository access and must finish in GitHub | Replaced because the prefilled form proved confusing and unreliable for daily operations |
| User-configured R2 writer | ★☆☆☆☆ | Each App needs five storage fields plus local administrator setup | Rejected because setup and employee maintenance are too complex |
| Fixed Supply Boss API | ★★★★☆ | Public read; shared account/password for write; server owns R2 | Selected |

## Consequences

- Public `GET /api/operations-board` returns only the bounded board snapshot. A current client sends `x-amz-api-operations-board-schema: 2` and receives canonical schema v2; a no-header legacy client receives an exact v1 projection.
- Authenticated `PUT /api/operations-board` replaces the board after exact schema, date-order, size, revision, and R2 conditional-write checks. Current clients send the schema header. Once the canonical board is v2, a legacy no-header PUT returns `409` instead of silently dropping v2-only data.
- Login uses fixed `/api/operations-board/login` and a separate board-editor username／PBKDF2 salt／hash. Those credentials cannot obtain a legacy snapshot-admin token; the resulting board-scoped token remains only in Notebook Key main-process memory for at most eight hours.
- Lock screen, system sleep, App exit, or expiry clears the token. Closing the board editor keeps it for the current App session so routine edits do not require repeated password entry.
- Passwords, session tokens, Amazon credentials, live inventory, and prices are never board fields and are not written to GitHub. Publishing the board never invokes an Amazon write.
- Seller SKU, manual expiry date, optional stop-sale date, promotion start／end dates and title, countdown choice, and note are public operational announcements. A stop-sale date must not follow the expiry date and becomes the countdown target when present; promotion ranges include both endpoints. Each Notebook Key adds current inventory and price locally through the existing read-only Amazon facts route.
- Supply Boss accepts persisted schema v1 or v2 and normalizes it to canonical v2. The existing R2 key `operations-board/v1.json` remains stable for storage compatibility and is not a declaration of the payload schema.
- Request streams are cancelled as soon as they exceed the fixed byte limit; R2 compare-and-swap uses the raw object ETag rather than the quoted HTTP ETag.
- Revision conflict, timeout, rate limit, server failure, network failure, or unknown write result never triggers a blind retry.

## Verification boundary

Supply Boss deployment and desktop v0.1.51/v0.1.53 evidence are recorded in the immutable release history linked by `docs/CODEX_HANDOFF.md`. This ADR records the accepted architecture; each newer candidate still needs its own exact-source, deployment, installation and live evidence.
