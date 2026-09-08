# Renderer usability polish evidence

User-authorized frontend-only pass on baseline
`85c92f30c22cc02622704f37106a91cc75c57133`; scope is documented in
`docs/specs/2026-09-09-renderer-usability.md`.

Implemented settings priority/dismissal/focus, local SKU keyboard/clear controls,
current-result audit status components and category summary, dashed incomplete-day
sales and disclosed chart options. Homepage geometry, all four themes, gold sales
series and write gates are retained. No package version or device update is needed
for these GitHub Pages renderer changes.

## Verification boundary

- Full isolated local `npm run check`: 294 test files / 3,194 tests passed before
  final copy, focus visibility and style refinements. Final exact-source CI is
  required separately and will be recorded in the PR before publication.
- Local Chromium UI uses about:blank because loopback navigation is blocked in the
  working container. Only the browser environment (URL resolution, UUID, display
  storage) and existing synthetic fixture are adapted; production JS/CSS bytes are
  unmodified. This is visual/interactivity evidence, not real origin persistence.
- Local 20 viewport/theme checks passed; source-controlled CI harness uses a real
  loopback origin and blocks every non-loopback request. It also stalls only the
  synthetic health request to test dismissal independently of request completion.
- Verification found hidden controls inside closed details in the focus candidate
  list. The implementation now excludes them through visibility/tab-index checks.
- Exact composed CSS contract and text snapshots are deliberately updated; no
  historical epoch payload guards or security tests are removed.

Final PR/main workflow IDs, build hashes and Pages deployment belong to the PR
verification record. No live account, Amazon write, actual Touch ID/Windows Hello,
installer or device state is exercised by this frontend task.
