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

Preview CI is isolated and credential-free; synthetic demo data is not evidence
of Amazon or real macOS/Windows hardware behavior. No main/preload, API route,
write gate, native confirmation, package version, or release feed change.
