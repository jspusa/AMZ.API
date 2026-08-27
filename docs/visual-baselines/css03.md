# CSS03 workspace, operations, Bridge, Variation, and experience extraction

Date: 2026-08-27
Issue: #107
Accepted main baseline: `90aab1f469ed521ec9b2c4d4674ac10c8a12edb2`

## Scope

This baseline proves that the next contiguous historical stylesheet epochs can
move out of residual `app.css` without changing AMZ.API presentation, cascade,
keyboard behavior, or the emitted logical rule stream. It compares an exact
detached archive build of the accepted main baseline with the CSS03 working
build. Both builds use the same fixed-time, local-only renderer fixture.

This evidence is local, scripted, fixture/demo evidence only. It is not CI,
deployment, installation, live Amazon, Notebook Key, Touch ID, Windows Hello,
or real-device evidence. CSS03 performs no external operation.

## Brace-safe contiguous moves

At the accepted baseline, residual `app.css` was 8,960 lines and 210,934 bytes
with SHA-256
`1224f01ce41082dc259d86ad2bc4564cc6ce68e15a9393803d27533362d83b36`.
Top-level PostCSS node inspection confirmed every boundary was between complete
root nodes. The extraction preserves the original bytes in this order:

| Baseline residual lines | Original monolith lines | Ordered file | Lines | Bytes |
| ---: | ---: | --- | ---: | ---: |
| 1-1,173 | 4,435-5,607 | `styles/workspace-sales.css` | 1,173 | 21,280 |
| 1,174-3,017 | 5,608-7,451 | `styles/operations.css` | 1,844 | 54,287 |
| 3,018-3,613 | 7,452-8,047 | `styles/notebook-key-bridge.css` | 596 | 22,162 |
| 3,614-4,056 | 8,048-8,490 | `styles/variation.css` | 443 | 13,156 |
| 4,057-4,896 | 8,491-9,330 | `styles/experience.css` | 840 | 15,760 |
| 4,897-8,960 | 9,331-13,394 | residual `app.css` | 4,064 | 84,289 |

Each historical blank separator belongs to the following epoch so every module
ends on a rule rather than a blank line. The five extracted files total 4,896
lines and 126,645 bytes. Concatenating all ordered CSS02 and CSS03 payload files
plus residual `app.css` reproduces the exact accepted 13,394-line,
293,971-byte source and SHA-256
`7ddb84bf404826a4ce1af22a1f2bb7abd43d103d9474be75c6647882173f583c`.

The moved ranges contain no `url()`, `image-set()`, `@font-face`, `@import`, or
resource `src:` reference whose relative resolution could change. No selector,
declaration, at-rule, specificity, media block, formatting, or dead rule was
edited or removed.

## Composition and production checks

`styles/index.css` now owns a twelve-file exact order: the composition entry,
the five CSS02 modules, the five CSS03 modules, and residual `app.css`. The
contract and tests pin that manifest, every CSS02/CSS03 module's LF-normalized
byte count and SHA-256, the complete source payload, CRLF parity, and single
ownership.

The source and emitted production CSS both resolve to logical rule-stream
fingerprint
`735f076b23747729e7840d11a316ffd6e5c4a4c907784d6d1af2d83c94e0ca41`.
Vite emits 293,961 bytes because it removes one historical blank line at each
of the ten import seams. The production verifier proves the rule order and CSS
semantics remain exact.

## Focused CSS03 browser matrix

The shared harness runs `#css03-extra` against four profiles:

| Profile | Viewport | Font | Motion |
| --- | ---: | --- | --- |
| desktop-standard | 1440 x 1000 | standard | normal |
| compact-390-large | 390 x 844 | large | normal |
| compact-320-large | 320 x 568 | large | normal |
| desktop-reduced | 1440 x 1000 | standard | reduced |

Five surfaces run for every profile: scrolled sticky navigation, horizontally
scrolled Sales chart, long Variation list, keyboard-focused Variation close,
and keyboard-focused Notebook Bridge close. The reduced-motion profile adds a
live Sales loading state. That is 21 before/after pairs and 42 screenshots.

The harness proves all of the following:

- the header remains `position: sticky`, pinned at the top after real page
  scrolling, while the primary navigation trigger receives a visible final-Tab
  focus state;
- compact Sales charts expose their intended internal horizontal range, move
  from zero to the exact maximum, retain page width, and keep a visible keyboard
  focus indicator on the SVG;
- a CSS03-only twelve-child Variation family creates real vertical list
  overflow, reaches the final long child, wraps long SKU/title/dimension text,
  and does not create drawer or list horizontal overflow;
- Variation and Notebook Bridge close targets remain exactly 36 x 36 CSS
  pixels, retain visible final-Tab focus, and both dialogs detach after Escape;
- reduced-motion keeps the live `.sales-trend-loading span` animation disabled;
- only allowlisted internal horizontal scrollers exist, all page/dialog/scroller
  geometry is exact before and after, and every dialog keeps at least 8 CSS
  pixels of viewport gutter.

The final run recorded zero external requests, zero unhandled fixture routes,
zero `PUT`, `PATCH`, or `DELETE` requests, zero console errors, and zero page
errors.

## Inherited matrices

The unchanged CSS01 matrix also passed across five profiles and nine surfaces:
45 before/after pairs and 90 screenshots. The CSS02-specific Content,
Subscription, and Accounting matrix passed across three profiles: another nine
pairs and 18 screenshots. Across all final runs, the shared harness produced
150 screenshots and 75 exact geometry comparisons.

After final standards review, the harness's previously distributed CSS01,
CSS02, and CSS03 mode checks were consolidated into one `visualScenarios`
descriptor. Each scenario now owns its marker, profiles, evidence directory,
surfaces, and capture accounting, with one keyed runner dispatch. An
architecture test first failed against the old distributed seam. All three
matrices were then rerun through the registry and retained the same 90, 18, and
42 screenshot counts with zero external requests, console errors, or page
errors.

## Pixel comparison and visual review

In the focused CSS03 matrix, 16 of 21 pairs were pixel-exact. The five remaining
pairs were limited to browser raster/compositor noise:

| Profile / surface | Changed pixels | Max channel delta | Mean absolute channel error |
| --- | ---: | ---: | ---: |
| compact-390-large / Variation focus | 0.000608% | 1 | 0.000004 |
| compact-390-large / Variation long | 0.000608% | 1 | 0.000004 |
| desktop-reduced / Sticky nav | 0.003194% | 8 | 0.000059 |
| desktop-reduced / Variation focus | 0.000417% | 3 | 0.000010 |
| desktop-standard / Bridge focus | 0.002569% | 1 | 0.000012 |

In the inherited CSS01 matrix, 43 of 45 pairs were pixel-exact; the maximum
changed area was 0.009375%, maximum channel delta was 1, and maximum mean error
was 0.000043. All nine inherited CSS02 pairs were pixel-exact. Representative
desktop, 390-pixel, 320-pixel, reduced-motion, chart, long Variation, sticky-nav,
and Bridge captures were inspected. No layout change, missing control, clipping,
focus regression, or presentation drift was observed.

## Pre-existing observations

At 320 pixels, the page remains exactly `clientWidth=320` and
`scrollWidth=352`, the same 32-pixel page-level horizontal overflow recorded by
CSS01 and preserved by CSS02. The newly covered Notebook Bridge also has an
existing 320-pixel internal range of `clientWidth=302` and `scrollWidth=323`.
Both values are identical before and after CSS03 and are narrowly allowlisted
only for this exact profile. This no-behavior-change ticket records them rather
than silently changing presentation.

## Preservation boundary

CSS03 changes stylesheet ownership and deterministic test support only. It does
not change public behavior, Electron trust boundaries, FBA-only filtering,
write previews or gates, credential handling, live Amazon behavior, or
real-device flows.
