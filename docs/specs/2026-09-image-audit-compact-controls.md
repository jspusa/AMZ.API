# Compact image audit controls

User-authorized Control Console Release, baseline 396374dc5896d8343dd13369864138836c861c92.

Remove the homepage image-threshold chooser from visual and keyboard layout. Keep the existing shared preference and all launch handlers: run-all must still use the operator's saved minimum. The inner Image Audit remains the place to change the 1–10 image minimum.

Use a short, readable native select beside its label and the existing launch action. Stack the action on small screens; do not stretch the select across the page. Preserve current pink/default and dark/light colors, error/status visibility, result layout, disabled/busy behavior and preference persistence.

This is a scoped CSS-only production change in workflow-efficiency.css, with regression tests and exact stylesheet baselines. No main/preload/API, package version, installer, chart geometry, audit thresholds, exports or write gates change. The existing hidden home field is retained in the component tree to avoid changing preference wiring; display:none removes its visual, focus and accessibility exposure.

Acceptance: no home picker; inner 1–10 options remain; 6.5rem select with at least 40px target; desktop label/select/action aligned; narrow layouts do not overflow; results and warnings span the panel; exact-source CI and Pages deployment verified separately. No live Amazon operations are authorized for testing.
