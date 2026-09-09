# Audit detail reading system — frontend publication

The user requested consistent typography and layout inside the nine audits,
then explicitly requested publishing the current changes without new features.

## Recovery and scope
The previous turn's preview images survived, but its implementation patch was
not persisted. The existing branch contained only the temporary verification
workflow. This pass reconstructs the same scoped reading improvements against
main `e529ffa2f9d189336bee119911b5e5fbb0e68d0e`; it does not claim recovery of
identical missing patch bytes. The source archive was checked against all 22
published usability implementation blobs before editing.

- Shared reading marker on the seven workspace/dialog presentations and the
  low-frequency aged-inventory and review dialogs.
- Consistent return/title alignment, readable body/control/helper text,
  equal summary tiles, toolbar wrapping, table cell spacing and long-copy rhythm.
- Original/pink and light/dark support; main homepage layout remains unchanged.
- Only decorative empty summary spacer is hidden; warnings, incomplete evidence,
  write confirmations, task lifecycle, focus behavior and actions are preserved.
- No main/preload/API/credential/storage/installer/dependency/version changes.

## Exact verification
- Preview run 34300812793 / job 102307121433 passed on source
  `6d1c0f4876e19ce39b6dd9dae1fbc6a4201163ee` with the reviewed patches applied.
- npm run check: 295 files passed, 3,198 tests passed; one existing optional test
  was skipped. Production build and exact CSS stream verification passed.
- Real-loopback Chromium checked 72 audit result cases: nine audits x two widths
  (1440/375) x four appearances. No page overflow, no tiny body/table text,
  no uncaught renderer errors, and no PUT/PATCH/DELETE calls. The harness waits
  for lazy content rather than mistaking its dialog shell for a ready panel.
- Existing usability checks and 20 homepage appearance cases also passed.
- Artifact 10084900052 SHA-256:
  `5ff8e7422506862b42a8cdcdf1794b27d1ad04244ada4e88a1535513cc8062f5`.
  All 14 implementation blobs matched the reviewed local files; this evidence
  document is refreshed afterwards, while the other 13 remain byte-identical.
- Local CJK rendering was inspected separately because CI fonts omit Chinese
  glyphs. Local screenshots use about:blank with synthetic storage/URL adaptation;
  actual-origin assertions come from the CI loopback harness.
- CSS canonical fingerprint:
  `48fd44a196d50be1e645c0eef60486db8d5058d53d26dd733d5474255ddf3143`.
  Current stream snapshots updated; historical payload guards retained.

## Existing dependency warning, not fixed by this UI release
npm audit --omit=dev returned exit code 1 with one high js-yaml advisory,
GHSA-2883-xcg3-v3hh. package.json and package-lock.json remain byte-identical
to the deployed baseline. The temporary verifier records the JSON and status,
checks the exact package hashes, and permits only that specifically identified
baseline advisory; unknown issues and audit service errors still fail. No clean
dependency audit is claimed. No dependency update or device install is included.
The temporary verifier, patch payloads and hash manifest do not remain in the
final branch diff; normal PR/Pages validation is unchanged.

Final PR validation, merge and Pages deployment are distinct steps; publication
and released-byte checks will be recorded in the PR after their actual success.
No live Amazon, Touch ID, Windows Hello or installed-device verification is claimed.
