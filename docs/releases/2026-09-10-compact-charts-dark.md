# Compact charts and dark readability — verification record

Baseline: `6ecf68f40710c839b50a0b6c6cfd9148104765a6`. Scope: approved frontend-only chart geometry and dark paint; retain API/security boundaries, pink/light choices, all audit layouts and original data.

Local exact-source build and stylesheet composition passed. The new production-browser harness passed 48 width/font/theme combinations, switching both share views, testing complete money strings, all axis label bounds, selected control contrast, keyboard detail selection and local-only interactions. Offline inspection uses about:blank URL/storage adaptation and a CJK font fallback; this is not actual-origin or device validation.

Initial full regression exposed an existing minimal DOM mock without getBoundingClientRect; its plot mock was extended, without weakening assertions. Review also caught clipped enlarged axis labels; the plot now reserves axis space and displays the currency once rather than repeating it on every tick.

Final full check, production dependency audit, real-loopback CI, normal PR check, merge, Pages publication and artifact byte verification will be recorded individually in the pull request. Do not infer deployment/device/live verification from this source record. No device installation is part of this update.
