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

## Agent orchestration

- Use subagents proactively when a task can be meaningfully decomposed into
  independent workstreams and parallel execution improves speed, coverage,
  or quality.
- Do not use subagents unnecessarily for small, localized, or highly coupled
  changes. Prefer the primary agent when parallelism would add coordination
  overhead without meaningful benefit.
- For large repository-level investigations or changes, consider parallel
  workstreams for frontend/renderer, main/API, Amazon integrations, security,
  and tests when those workstreams are sufficiently independent.
- The primary agent remains responsible for understanding the overall task,
  integrating subagent findings, resolving conflicts, and validating the final
  repository-wide result.
- Avoid having multiple agents modify the same files concurrently unless there
  is a clear reason to do so.
- Subagents must follow the same `AGENTS.md`, `docs/CODEX_HANDOFF.md`, security,
  Amazon-write, testing, and repository rules as the primary agent.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `jspusa/AMZ.API`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using a root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
