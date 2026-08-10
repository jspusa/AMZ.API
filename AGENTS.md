# AMZ.API agent entrypoint

Before planning, editing, debugging, or publishing this repository, read
`docs/CODEX_HANDOFF.md` completely and follow its required file-reading order.

Non-negotiable project rules:

- Product name is `AMZ.API`.
- This is a private Jasper Amazon Seller operations console and is FBA-only.
- GitHub Pages provides the current UI; macOS／Windows AMZ.API Notebook Key
  Bridge owns credentials and Amazon SP-API network calls.
- Never place LWA client secrets, refresh tokens, full Seller IDs, access tokens,
  or user credentials in GitHub, source files, logs, URLs, browser storage,
  spreadsheets, tests, or chat responses.
- Never treat an Orders-only success as proof that Seller ID or Listings access
  works. Follow the live-verification state in `docs/CODEX_HANDOFF.md`.
- Preserve the renderer/preload/main trust boundary, FBA filtering, write previews,
  Touch ID／Windows Hello confirmation, idempotency ledger, and no-blind-retry policy.
- Inspect the working tree before editing. Preserve unrelated changes and do not
  use destructive Git commands.
- Run `npm run check` and `npm audit --omit=dev` before proposing release.
- CI cannot prove live Amazon behavior or real Windows Hello hardware. State
  clearly what still requires the user's Notebook Key and Amazon account.
