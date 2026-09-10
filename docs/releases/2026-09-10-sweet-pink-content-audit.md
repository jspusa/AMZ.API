# Sweet pink / content audit frontend delivery

Baseline: `49da09de2c92772a5686e3d02e92b86af88dc1ac` (0.1.63).
User-authorized renderer-only change; no desktop installation needed.

The pink theme is now solid cherry-blossom/blush rather than purple gradients. Content audit puts its existing recheck action above results, labels it 「重新健檢」, collapses Excel tools until selected, preserves both export scopes and mounted import state, and moves technical explanations after results. Source expiry, partial worksheet guidance, full diff and native write safeguards remain. Attention reset counts only attention rows; it is not an all-product filter.

Focused content and palette tests passed locally. Local browser navigation is blocked by the environment; offline about:blank rendering uses synthetic fixture data with display-storage/URL adaptation and unchanged built CSS/JS. This is not actual-origin or live-account verification. Actual-origin browser tests, full check and production dependency audit are required in CI; their exact run and the eventual Pages deployment will be recorded on the PR. No success or security-audit result is inferred from an earlier release.
