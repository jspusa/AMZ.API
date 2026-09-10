# Compact performance cards and usable dark mode

User request: keep brand totals unbroken, reduce both homepage charts, and improve dark-mode usability. Baseline main `6ecf68f40710c839b50a0b6c6cfd9148104765a6`.

- Full-width, full-precision brand total above a compact pie; retain all six brand/eight category rows and their original values, sorting, colors and interactions.
- Compact sales plot uses a measured-width SVG, readable ticks and pointer coordinates based on the same geometry. Currency is labeled once on the axis. The optional skater keeps its original headroom. Partial-day evidence and all range values stay intact.
- Authored neutral dark canvas, surface, raised controls, muted/readable text, visible selected/focus states. Original/pink accent choices remain; photos and semantic state hues are not inverted. Authored dark selectors must not be run through the legacy auto-palette conversion again.
- Renderer-only. No Bridge, API, credentials, source/data persistence, package version/dependency, installation, update-channel or write-gate changes.
- Validate full source/build contract, regression tests, realistic long-money fixture at six widths, standard/large font and four theme combinations; no new requests from display-only interactions. CI uses synthetic loopback data, not live Amazon.
