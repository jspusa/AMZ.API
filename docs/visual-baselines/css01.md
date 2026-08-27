# CSS01 visual baseline

Date: 2026-08-27
Issue: #105
Accepted main baseline: `3a656b1065cdfe9a53f18d06889df69636219415`

## Scope

This baseline proves that introducing the ordered renderer stylesheet entry does
not change the current AMZ.API presentation. It compares an exact detached build
of the accepted main baseline with the CSS01 working build. Both builds use the
same deterministic, local-only fixture and fixed time.

This evidence is local, scripted, fixture/demo evidence only. It is not CI,
deployment, installation, live Amazon, Notebook Key, Touch ID, Windows Hello, or
real-device evidence.

## Matrix

Five display profiles cover every one of the nine representative surfaces, for
45 before/after pairs and 90 screenshots total.

| Profile | Viewport | Font | Motion |
| --- | ---: | --- | --- |
| desktop-standard | 1440 x 1000 | standard | normal |
| desktop-large | 1440 x 1000 | large | normal |
| compact-390-large | 390 x 844 | large | normal |
| compact-320-large | 320 x 568 | large | normal |
| desktop-reduced | 1440 x 1000 | standard | reduced |

The covered surfaces are WebGate, Home, Sales, Brand, System Info modal,
Variation, B2B, Reports, and Inbound.

The deterministic shared browser harness is
`scripts/visual-qa/renderer-visual-baseline.js`. Its shared bridge and API
fixture is `scripts/visual-qa/renderer-visual-fixture.js`. Generated screenshots
and contact sheets stay under the ignored `output/playwright/css01/` evidence
directory and are not release assets.

## Automated assertions

The complete run passed all of these checks:

- exactly 90 captures across both phases, all five profiles, and all nine
  surfaces;
- zero external requests, zero unhandled fixture routes, zero `PUT`, `PATCH`, or
  `DELETE` requests;
- zero console errors and zero page errors;
- exact before/after page, dialog, and allowed horizontal-scroller geometry;
- at least 8 CSS pixels of dialog gutter on every edge;
- exact 36 x 36 CSS-pixel modal close targets;
- requested font size present on the root element;
- reduced-motion media query active, root smooth scrolling disabled, and the
  Sales skater transition disabled in the reduced-motion profile.

The detached baseline and working renderer build directories were also
byte-for-byte identical. The source composition and emitted production CSS both
resolved to logical rule-stream fingerprint
`735f076b23747729e7840d11a316ffd6e5c4a4c907784d6d1af2d83c94e0ca41`.

## Pixel comparison and visual review

Decoded RGB comparison found 36 of 45 pairs pixel-exact. Nine pairs contained
only small raster/compositor variation. Across all pairs, the maximum individual
channel delta was 20 on the 0-255 scale, and the maximum mean absolute channel
error was 0.037520 on the same scale.

| Profile / surface | Changed pixels | Max channel delta | Mean absolute channel error |
| --- | ---: | ---: | ---: |
| compact-320-large / B2B | 0.012654% | 2 | 0.000147 |
| compact-320-large / Inbound | 0.026959% | 1 | 0.000224 |
| compact-320-large / System Info | 0.304247% | 1 | 0.001029 |
| compact-390-large / Inbound | 0.017621% | 1 | 0.000063 |
| compact-390-large / System Info | 0.485174% | 9 | 0.027672 |
| desktop-large / Reports | 0.035139% | 20 | 0.000283 |
| desktop-large / Sales | 0.004514% | 1 | 0.000043 |
| desktop-reduced / Brand | 0.001250% | 1 | 0.000007 |
| desktop-standard / WebGate | 9.915486% | 2 | 0.037520 |

All five contact sheets were inspected. No changed layout, missing control,
clipped dialog, unexpected write affordance, or presentation regression was
observed. Because the built HTML, JavaScript, and CSS are byte-identical and all
captured geometry is exact, the non-zero decoded-pixel values above are treated
as rendering noise rather than stylesheet drift.

## Pre-existing observation

At 320 pixels, the Home page has `scrollWidth=352` and `clientWidth=320`, a
32-pixel page-level horizontal overflow. The exact same metric is present before
and after CSS01. This ticket deliberately does not change CSS rules, so the
existing overflow is recorded here rather than silently repaired or reported as
a CSS01 regression.

## Preservation boundary

CSS01 changes only the renderer import path and adds composition/build
verification. It does not edit, reorder, reformat, split, layer, clean, or remove
any rule in `src/renderer/src/app.css`.
