# Inventory health and daily workflow

Source: Jasper's 2026-09-12 goal objective and subsequent image-audit request.

## Requested outcomes

1. Keep manual expiry and promotion announcements. Automatically read accessible FBA inbound declared expiry dates, preserve multiple dates and source evidence per exact account/marketplace/SKU, and integrate with inventory age, sales pace and estimated costs. Only evidence-backed projected clearance shortfalls belong in the calendar. Unknown batch remainder is a review item, never an inferred expiry quantity. Stock age and declared shipment quantities are not current lot balances. Future sales are forecasts, not guarantees.
2. Generate a populated US Amazon FBA price-list workbook without an uploaded source workbook; retain the existing source-workbook comparison and preservation workflow.
3. Retain font size and appearance across App restarts without persisting renderer credentials or changing the session trust boundary.
4. Opening the variation workspace after the variation audit must work and preserve the correct return destination. Busy writes must remain locked.
5. Drop an entire image set into one area. Validate the exact SKU and map the middle `01`–`09` filename segment to image slots 1–9; explain duplicate/invalid files and preserve valid independent entries. Keep individual image editing and the existing preview/native-confirmation/single-PATCH boundary.
6. Show the last 60 days of Vine enrollment progress when an authoritative source is available. Public SP-API/report catalogs currently expose no verified Vine enrollment/claim/review progress interface. Do not infer progress from free orders, all-product reviews, sales or Customer Feedback. After asking the user about the optional fallback, implement local import/paste of Seller Central data as the recommended default; clearly label manual source and update time, preserve unknown values, and never fabricate `0/30`.
7. Let the operator select the image-audit minimum before running, default 8, with consistent standalone/run-all selection, snapshot, cache and export behavior. Counts below the selected minimum are insufficient; incomplete reads remain unknown.

## Evidence and boundaries

Use existing public UI interactions, owner interfaces and exact API routes as regression seams. Cover restart persistence, audit/workspace navigation, filename mapping, threshold isolation, generated workbook contents, unknown expiry evidence, multi-date retention, conservative sales estimates, source failures, account/context isolation and no-calendar behavior for uncertain data. Final gates: `npm run check`, `npm audit --omit=dev`, `git diff --check`, independent Standards/Spec review, exact-source CI and separately recorded release/installation/live evidence.

Automatic health data stays in the local, account-scoped Notebook Key store; it is not published into the public Supply Boss manual board. Date-only target defaults to the declared expiry; an explicit manual stop-sale date takes precedence. No unapproved company buffer, promotion, price adjustment, removal order or Amazon mutation is introduced.

Inbound history uses bounded reads and encrypted continuation checkpoints. Completed unchanged plans reuse their saved item evidence; interrupted scans resume without treating partial history as complete. Each row retains a human-readable plan name and plan ID. Optional health storage failures leave the existing inventory-age report usable while health read/confirmation fail closed until a successful refresh. A later-started refresh owns its scope so an older completion cannot overwrite newer evidence.

After an App restart or account-context reset, saved batches remain available for review, but require a successful inventory-age/expiry refresh before they can create calendar forecasts or accept new confirmation. This prevents a previously failed refresh from reviving old reminders. Existing batch confirmations survive when their exact report/source evidence remains unchanged.

The image minimum is available on the homepage before starting all audits and in the image workspace before its individual audit. Choices are 1–9, default 8, and saved with the local appearance preferences. Changing the choice alone starts no Amazon request.

Official references checked 2026-09-12: [Inbound plan items](https://developer-docs.amazon/sp-api/reference/listinboundplanitems), [Inbound plans](https://developer-docs.amazon/sp-api/reference/listinboundplans), [FBA report fields](https://developer-docs.amazon/sp-api/docs/report-type-values-fba), [Vine dashboard](https://sell.amazon.com/programs/vine).
