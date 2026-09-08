# Local appearance: original / rose and independent dark mode

User-authorized renderer-only change after homepage symmetry repair #229.

Settings places `AppearancePreference` immediately after the existing font size.
Native radio inputs select original or rose; the separate native switch chooses
light/dark. Every combination is available, defaults remain original/light, and
changes apply synchronously without remounting the dashboard or invoking Bridge.
Only the two allowlisted strings are saved under `amz-api:ui-accent` and
`amz-api:ui-mode`. Denied storage is nonfatal and visibly disclosed. Preferences
survive a renderer reload where storage is available; a nonpersistent Electron
partition does not promise persistence across a full app exit.

`appearance.css` owns controls and rose accents, not audit status meanings.
The Node-only `generate-dark-palette.mjs` creates static paint-only overrides
before test/check/build. It resolves foreground/background/border/shadow aliases
separately, retains semantic hues, uses zero-specificity theme scoping, and never
inverts the document or product imagery. Existing layout styles remain unchanged.
The generated file is intentionally ignored in Git, is reproducible from the
ordered manifest, and participates in the SAME exact stylesheet source and build
fingerprint verification as the original modules. Historical payload hashes are
not relaxed. Color/layout and preference regression tests are added.

## Verified evidence

- Feature source `7d30ac98f16ed367a132e03c717deb5d789cd0ca` was downloaded from
  the exact Actions archive and all 19 reviewed feature files were byte-compared
  with the isolated local working copy; all match.
- Preview run `34218742678`, job `102036610920`: `npm run check` and the production
  browser harness passed. Source/build fingerprint gates remained enabled.
- The browser harness used the existing synthetic fixture and blocked all
  non-loopback traffic. It passed all four accent/mode combinations at widths
  320, 375, 768, 1024 and 1440: no page/control horizontal overflow, unchanged
  seven-tile geometry, centered icon/title axes, no dashboard remount, reload
  persistence, native radio arrow keys and switch Space interaction.
- `npm audit --omit=dev --json` in that run reported zero production dependency
  vulnerabilities. No dependency was added or upgraded for the feature.
- PR #231 Validate run `34218779406` passed against the synthetic merge with the
  concurrently updated main `cd2616c911e0812bfe3f96957a30b413cd4a0951`. Those unrelated
  main changes, including its package version, must be preserved when merging.
- The temporary source-archive/preview workflow and staging payload are removed
  before merge. `scripts/visual-qa/appearance-check.mjs` remains rerunnable with
  an externally installed Playwright path and local Chrome. The final cleanup
  changes no renderer, CSS, generator, or executable feature code.

Preview CI is isolated and credential-free; synthetic demo data is not evidence
of Amazon or real macOS/Windows hardware behavior. No main/preload, API route,
write gate, native confirmation, package version, or release feed change is part
of this feature. Final PR checks and Pages publication are separate evidence and
must be verified on their exact resulting commits.
