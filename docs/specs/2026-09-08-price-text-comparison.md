# Numeric-text prices in the original price workbook

The real workbook export revealed that numeric text in the original standard-price column was omitted from renderer comparisons and exported deltas. Original values and Amazon prices were present, but equal prices did not produce a zero delta. This follow-up remains part of the user's requested usable price-list workflow and the not-yet-delivered 0.1.59 release.

| Required result | Acceptance |
|---|---|
| ★ Compare numeric text | A finite, unambiguous decimal price stored as text participates in price comparisons, original-sheet display and export deltas just like a numeric cell. |
| ★ Preserve original workbook | Do not rewrite source cell types, formulas, values, formatting, images or layout. Two-workbook comparisons continue to distinguish the original values and types. |
| ★ Keep missing and invalid distinct | Blank text, malformed values, booleans and non-finite values cannot become zero or a successful comparison. Missing Amazon data stays explicitly unavailable. |
| ★ Keep all evidence aligned | Renderer status, four displayed prices and exported deltas use the same narrow parsing rule. Add regression cases at these public seams, then run the full checks and both review axes. |

The private workbook stays outside the repository and fixtures use synthetic values. No Amazon write, credential, IPC or update-channel scope changes are authorized by this fix.
