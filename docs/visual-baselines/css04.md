# CSS04 final renderer stylesheet extraction

Date: 2026-08-27
Issue: #108
Accepted main baseline: `b70ec317f8546cb18f858b1b67380a2d603e0a44`

## Scope

This baseline proves that the final five contiguous stylesheet epochs can move
out of residual `app.css`, and that the monolith can be retired, without
changing AMZ.API presentation, cascade, keyboard behavior, motion behavior, or
the emitted logical rule stream. It compares an exact detached build of the
accepted main baseline with the CSS04 working build. Both builds use the same
fixed-time, local-only renderer fixture.

This evidence is local, scripted, fixture/demo evidence only. It is not CI,
deployment, installation, live Amazon, Notebook Key, Touch ID, Windows Hello,
or real-device evidence. CSS04 performs no external operation.

## Brace-safe final moves

At the accepted baseline, residual `app.css` was 4,064 lines and 84,289 bytes
with SHA-256
`df09c6c8f0f7ad18c6ff0e7d263a2272215a68bae9ae39198c9ae36eb019ecfb`.
Top-level PostCSS node inspection confirmed every boundary was between complete
root nodes. The extraction preserves the original bytes in this order:

| Residual lines | Original monolith lines | Ordered file | Lines | Bytes | SHA-256 |
| ---: | ---: | --- | ---: | ---: | --- |
| 1-839 | 9,331-10,169 | `styles/image-home-audits.css` | 839 | 16,287 | `1bdab607...d3ed74` |
| 840-2,200 | 10,170-11,530 | `styles/brand-ads.css` | 1,361 | 33,920 | `4c489fff...feb2c` |
| 2,201-2,786 | 11,531-12,116 | `styles/reports-reviews.css` | 586 | 10,861 | `ac15d12a...5e2af` |
| 2,787-3,085 | 12,117-12,415 | `styles/final-overrides.css` | 299 | 5,810 | `823683da...6bb26` |
| 3,086-4,064 | 12,416-13,394 | `styles/fba-inbound.css` | 979 | 17,411 | `dd728dfd...9a0da` |

Each historical blank separator belongs to the following epoch so every module
ends on a rule rather than a blank line. Concatenating all fifteen ordered
payload files reproduces the exact accepted 13,394-line, 293,971-byte source
and SHA-256
`7ddb84bf404826a4ce1af22a1f2bb7abd43d103d9474be75c6647882173f583c`.

The moved ranges contain no relative resource reference whose resolution could
change. No selector, declaration, at-rule, specificity, media block,
formatting, or dead rule was edited or removed. The former `app.css` file and
all active tracked source, script, and test references to it are absent;
historical evidence documents intentionally retain its name.

## Composition and production checks

`styles/index.css` now owns the complete fifteen-payload order: the five CSS02
modules, five CSS03 modules, and five CSS04 modules. The contract and tests pin
the sixteen-file manifest including the entry, each CSS04 module's
LF-normalized byte count and SHA-256, the final CSS04 payload, the complete
source payload, CRLF parity, single ownership, and monolith retirement.

The source and emitted production CSS both resolve to logical rule-stream
fingerprint
`735f076b23747729e7840d11a316ffd6e5c4a4c907784d6d1af2d83c94e0ca41`.
Vite emits 293,957 bytes because it removes one historical blank line at each
of the fourteen payload seams. The production verifier proves the rule order
and CSS semantics remain exact.

## Focused CSS04 browser matrix

The shared harness runs `#css04-extra` against five profiles:

| Profile | Viewport | Font | Motion |
| --- | ---: | --- | --- |
| desktop-standard | 1440 x 1000 | standard | normal |
| desktop-large | 1440 x 1000 | large | normal |
| compact-390-large | 390 x 844 | large | normal |
| compact-320-large | 320 x 568 | large | normal |
| desktop-reduced | 1440 x 1000 | standard | reduced |

Ten surfaces run for every profile: primary and low-frequency Home states,
Image results, Aged Inventory switch state, Brand interaction, Ads results,
Report Library, Reviews, missing-bullets Content results, and inbound issues.
The reduced-motion profile adds the Sales skater state. That is 51 before/after
pairs and 102 screenshots.

The harness proves all of the following:

- Home cards, audit results, report/review drawers, Brand charts, Ads coverage
  and strategy results, and FBA inbound states preserve exact before/after
  page, dialog, viewport, window-scroll, scope-scroll, and internal-scroller
  geometry;
- menus, drawer close targets, Brand SVG controls, switches, report category
  navigation, and tested keyboard targets retain visible focus and the expected
  interaction state;
- Report Library proves the exact All-plus-fifteen category controls, operates
  a Tax-to-FBA filter switch, and Review is reached through its intended Home
  shortcut rather than being invented as a report-menu item;
- compact report navigation and inbound tables exercise their intended internal
  horizontal ranges without silently allowing unrelated overflow;
- reduced motion disables the Sales skater jump and wheel animations, including
  the browser's effectively-zero `0.00001s` computed duration representation;
- the CSS04 fixture allows only the exact local read requests used by these
  states, rejects every unlisted request, and rejects all `PUT`, `PATCH`, and
  `DELETE` requests.

The final run recorded zero external requests, zero unhandled fixture routes,
zero console errors, and zero page errors.

## Inherited matrices

The CSS01, CSS02, and CSS03 matrices were all rerun after the final harness
stabilization rather than reusing earlier output:

| Matrix | Before/after pairs | Screenshots | External requests | Console errors | Page errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| CSS01, five profiles and nine surfaces | 45 | 90 | 0 | 0 | 0 |
| CSS02, three profiles and three surfaces | 9 | 18 | 0 | 0 | 0 |
| CSS03, four profiles and five/six surfaces | 21 | 42 | 0 | 0 | 0 |
| CSS04, five profiles and ten/eleven surfaces | 51 | 102 | 0 | 0 | 0 |
| **Total** | **126** | **252** | **0** | **0** | **0** |

Every before/after geometry comparison passed. Screenshot capture waits for
fonts and two animation frames, finishes finite animations, freezes infinite
animations at time zero, and hides the caret. These controls remove state and
capture timing as confounders while leaving the production stylesheet under
test unchanged.

## Pixel comparison and visual review

The final inherited matrices were nearly entirely pixel-exact: CSS01 was
44/45 exact, CSS02 was 9/9 exact, and CSS03 was 19/21 exact. Their remaining
pixels were bounded text/raster noise: maximum channel deltas were 1 and 8 for
CSS01 and CSS03 respectively, with no geometry difference.

In the focused CSS04 matrix, 45 of 51 pairs were pixel-exact. The six remaining
pairs were bounded browser text/raster noise:

| Profile / surface | Changed pixels | Changed area | Max channel delta | Mean absolute channel error |
| --- | ---: | ---: | ---: | ---: |
| desktop-standard / Home primary | 50 | 0.003472% | 8 | 0.000068 |
| desktop-large / Reviews | 132 | 0.009167% | 1 | 0.000047 |
| desktop-large / Reports | 118 | 0.008194% | 1 | 0.000043 |
| desktop-large / Brand interaction | 18 | 0.001250% | 3 | 0.000016 |
| compact-320-large / Image results | 1 | 0.000550% | 1 | 0.000006 |
| compact-320-large / Missing bullets | 1 | 0.000550% | 1 | 0.000002 |

Representative desktop, large-font, 390-pixel, 320-pixel, reduced-motion,
report, audit, Ads, Brand, and inbound captures, plus both Report Library
before/after pairs, were inspected. No layout change, missing control, clipping,
focus regression, or presentation drift was observed.

## Pre-existing observations

At 320 pixels, the page remains exactly `clientWidth=320` and
`scrollWidth=352`, and the Notebook Bridge retains its existing internal
`302/323` range from CSS03. The newly exercised compact Aged Inventory list has
an existing `clientWidth=234` and `scrollWidth=255` internal range. All are
identical before and after and are narrowly allowlisted only for their exact
profile and surface. This no-behavior-change ticket records them rather than
silently changing presentation.

## Preservation boundary

CSS04 changes stylesheet ownership and deterministic visual-test support only.
It does not change public behavior, Electron trust boundaries, FBA-only
filtering, write previews or gates, credential handling, live Amazon behavior,
deployment, installation, or real-device flows.
