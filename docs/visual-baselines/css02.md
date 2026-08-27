# CSS02 extraction and visual baseline

Date: 2026-08-27
Issue: #106
Accepted main baseline: `ddaf2667d6e8e08af3e1afec151f0b7ff2e9461e`

## Scope

This baseline proves that the first contiguous historical epochs of the
renderer stylesheet can be extracted into ordered modules without changing the
AMZ.API presentation or rule stream. It compares an exact detached build of the
accepted main baseline with the CSS02 working build. Both builds use the same
fixed-time, local-only fixture.

This evidence is local, scripted, fixture/demo evidence only. It is not CI,
deployment, installation, live Amazon, Notebook Key, Touch ID, Windows Hello,
or real-device evidence. CSS02 performs no external operation.

## Brace-safe contiguous moves

The original `app.css` was 13,394 lines and 293,971 bytes with SHA-256
`7ddb84bf404826a4ce1af22a1f2bb7abd43d103d9474be75c6647882173f583c`.
Top-level PostCSS node inspection confirmed every selected boundary was between
complete root nodes. The extraction preserved the original bytes in this order:

| Original lines | Ordered file | Lines | Bytes |
| ---: | --- | ---: | ---: |
| 1-933 | `styles/foundation.css` | 933 | 16,544 |
| 934-3,192 | `styles/legacy-shell-drawers.css` | 2,259 | 37,904 |
| 3,193-3,540 | `styles/subscription-accounting.css` | 348 | 10,798 |
| 3,541-3,812 | `styles/content.css` | 272 | 4,847 |
| 3,813-4,434 | `styles/business-pricing.css` | 622 | 12,944 |
| 4,435-13,394 | `app.css` | 8,960 | 210,934 |

Each historical blank separator belongs to the following epoch so every module
ends on a rule rather than a blank line. Concatenating the six ordered payload
files reproduces the exact 13,394-line,
293,971-byte source and the exact pinned SHA-256. The moved ranges contain no
`url()`, `image-set()`, or `@font-face` references whose relative resolution
could change. No selector, declaration, at-rule, formatting, or dead rule was
edited or removed.

## Composition and production checks

`styles/index.css` imports the five new modules and residual `app.css` in the
original order. The contract and tests pin both the manifest and the source
payload. They reject duplicate, missing, reordered, or bypassed stylesheets.

The source and emitted production CSS both resolve to logical rule-stream
fingerprint
`735f076b23747729e7840d11a316ffd6e5c4a4c907784d6d1af2d83c94e0ca41`.
The Vite output is 293,966 bytes because it removes one import-boundary blank
line at each of the five new seams; a decoded source diff confirmed those five
blank lines are the only raw-byte difference. Rule order and CSS semantics are
unchanged.

## Browser comparison matrix

The inherited CSS01 harness compared five profiles across nine representative
surfaces: WebGate, Home, Sales, Brand, System Info, Variation, B2B, Reports, and
Inbound. That is 45 before/after pairs and 90 screenshots.

| Profile | Viewport | Font | Motion |
| --- | ---: | --- | --- |
| desktop-standard | 1440 x 1000 | standard | normal |
| desktop-large | 1440 x 1000 | large | normal |
| compact-390-large | 390 x 844 | large | normal |
| compact-320-large | 320 x 568 | large | normal |
| desktop-reduced | 1440 x 1000 | standard | reduced |

The CSS02-specific harness adds Content, Subscription, and Accounting at
desktop-standard, compact-390-large, and desktop-reduced: another nine
before/after pairs and 18 screenshots. It runs the `#css02-extra` mode of the
shared `scripts/visual-qa/renderer-visual-baseline.js` harness with the shared
`scripts/visual-qa/renderer-visual-fixture.js` bridge/API fixture. Generated
screenshots stay under the ignored `output/playwright/` evidence directory and
are not release assets.

Both harnesses passed all assertions:

- 108 total screenshots and 54 before/after pairs;
- exact before/after page and dialog geometry;
- at least 8 CSS pixels of modal gutter on every edge;
- exact 36 x 36 CSS-pixel modal close targets;
- standard and large font settings preserved;
- reduced-motion media query and root scroll behavior preserved;
- zero external requests, zero unhandled fixture routes, zero console errors,
  and zero page errors;
- zero `PUT`, `PATCH`, or `DELETE` requests.

## Pixel comparison and visual review

In the five-profile matrix, 38 of 45 pairs were pixel-exact. The seven other
pairs showed only small raster/compositor variation; the maximum channel delta
was 11 on the 0-255 scale and the maximum mean absolute channel error was
0.037520.

| Profile / surface | Changed pixels | Max channel delta | Mean absolute channel error |
| --- | ---: | ---: | ---: |
| compact-320-large / System Info | 0.359815% | 6 | 0.011686 |
| compact-320-large / Variation | 0.000550% | 1 | 0.000006 |
| compact-390-large / System Info | 0.484871% | 11 | 0.033079 |
| desktop-large / Sales | 0.004514% | 1 | 0.000043 |
| desktop-large / WebGate | 8.988125% | 2 | 0.031252 |
| desktop-reduced / Brand | 0.001250% | 1 | 0.000007 |
| desktop-standard / WebGate | 9.915486% | 2 | 0.037520 |

In the CSS02-specific matrix, seven of nine pairs were pixel-exact. The two
non-exact pairs were compact Subscription (0.223296%, maximum delta 1, mean
0.001485) and desktop Accounting (0.073125%, maximum delta 18, mean 0.000854).
Representative Content, Subscription, and Accounting captures were inspected;
no changed layout, missing control, clipped dialog, or presentation regression
was observed. Exact logical CSS and geometry establish that these subpixel
differences are rendering noise rather than stylesheet drift.

## Pre-existing observation

At 320 pixels, Home remains `scrollWidth=352` and `clientWidth=320`, the same
32-pixel page-level horizontal overflow recorded by CSS01. CSS02 deliberately
does not alter declarations, so this is unchanged baseline behavior rather than
a CSS02 regression.

## Preservation boundary

CSS02 changes stylesheet ownership and deterministic test support only. It does
not change public behavior, Electron trust boundaries, FBA-only filtering,
write gates, credential handling, live Amazon behavior, or real-device flows.
