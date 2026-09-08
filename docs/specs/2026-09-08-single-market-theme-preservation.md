# Preserve an existing theme from a trusted single-market read

The installed 0.1.59 live acceptance confirmed that the unbound picker can prepare the newly reported standalone FBA item. The original standalone attach case still stopped during preparation because its existing `variation_theme` did not satisfy the helper's explicit `marketplace_id` check. This occurs before Validation Preview, and no Amazon mutation was performed.

| Required result | Acceptance |
|---|---|
| ★ Ground the missing selector rule | Use official Listings/PTD semantics and production-owned exact single-market read evidence to decide when a completely absent marketplace selector can be preserved safely. Do not equate a malformed, blank or explicit null selector with absence. |
| ★ Preserve the existing theme | When the source is independently proven standalone FBA and its unique existing theme exactly matches the target, keep the complete raw value, including selector absence, and omit the theme PATCH. |
| ★ Keep the safety boundary | Foreign or mixed-market values, duplicate themes, conflicting names, relationship remnants, untrusted source construction and evidence drift remain blocked. Bind the raw preserved value through preparation, Preview, fresh native-confirmation checks, durable evidence and canonical readback. |
| ★ Validate actual usability | Reproduce the missing-selector case through the production public seam, complete repository checks and both review axes, then use the updated installed app to reach a real Amazon Validation Preview for the original case. No formal Amazon write is part of acceptance. |

0.1.59 is already installed and both protected installer uploads completed, so this follow-up requires a new Notebook Key version. Keep the verified numeric-text price fix and original workbook preservation unchanged. Private Amazon responses and the user's workbook stay outside source, fixtures and repository evidence.

## Source and interpretation

Amazon's [variation family examples](https://developer-docs.amazon/sp-api/docs/building-listings-management-workflows-guide#configure-variation-families) omit `marketplace_id` from both parent and child theme values. This supports preserving an existing matching value without inventing a selector; it does not establish the raw shape of the private live response. The observed 0.1.59 error alone cannot distinguish absent, blank or malformed selectors.

The [Listings GET guide](https://developer-docs.amazon/sp-api/docs/retrieve-details-about-a-listing) now permits up to 12 stores in a request. Therefore the exception must prove the actual production request selected exactly the current marketplace. An opaque main-only witness binds that query, the exact Seller SKU and the original returned attributes object. It is available only for complete variation-evidence reads with relationships, not fallback data or caller-created objects. Only a theme with no own selector property qualifies; the raw value remains unchanged throughout the existing evidence and idempotency flow.
