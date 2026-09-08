# Renderer usability polish (no Notebook Key reinstall)

The user approved implementing the frontend-only portion of the UX review. Baseline:
`85c92f30c22cc02622704f37106a91cc75c57133` (original/pink and light/dark supported).

## Accepted scope

- Settings: font size / appearance / auto-sync before collapsed technical guidance;
  a pending read must not disable Close, Escape or backdrop dismissal. Keep focus
  within the modal, restore its trigger, and support font-size arrow navigation.
- Allow Settings in a nonbusy workspace; preserve all existing editor busy locks,
  write confirmations, context fences and unknown-write recovery. This is not a
  blanket removal of disabled navigation.
- Enhance the existing Seller SKU input with focus shortcuts and explicit clear;
  typing, focus, clear and IME composition must never invoke an API operation.
- Distinguish a completed audit from a healthy product. Show genuine known issue
  counts, incomplete ranges and uninspected states; never infer zero from missing
  evidence. Summarize categories from already-fenced current jobs/results only.
  Summary counts are seven audit types, not unique SKUs, and locate a card without
  running or retrying it.
- Keep the golden sales series and original values. Segments touching partial days
  are dashed and the actual dates/time zone disclosed. Do not assume an incomplete
  historical day is still today. Put the optional skater in Chart options.
- Preserve seven equal tile widths and icon/title baselines. Reduce decorative
  shadows and refine settings, status and numeric typography in all four themes.

## Non-goals

No main, preload, Amazon transport, credentials, operational persistence, package
version, dependencies, release feed or device installation changes. No background
Amazon scans, persistent SKU search history, cross-device preferences, full
cross-workspace scroll/filter restoration or blanket editor navigation unlock.

## Acceptance

Run existing full check and production audit. Keep exact stylesheet manifests and
canonical/text snapshots current without disabling checks or changing historical
payload guards. Browser verification must use synthetic local data only and cover
stalled-read dismissal, focus/IME/keyboard, truthful summary navigation and all
four appearance combinations. CI/artifact/Pages success is not live Amazon or
real Notebook Key hardware verification.
