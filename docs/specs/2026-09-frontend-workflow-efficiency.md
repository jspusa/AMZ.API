# Frontend-only workflow efficiency

User approved the four proposed improvements in the ongoing AMZ.API conversation:
loaded web-build identification with safe reload, pasted SKU filtering, session view
memory, and previous/next navigation. Baseline: main 4a3d08d829ffd2c1988492b6efc6bd60e86169f8.

## Acceptance

- Settings distinguish the loaded renderer revision/build time from the installed
  Notebook Key version. Reload requires explicit confirmation, rechecks busy state,
  and does not claim to discover the latest online release or clear every cache.
- Nine audit surfaces accept up to 500 exact, newline/tab-delimited SKU cells.
  Typing/applying/clearing is display-only: no new scan, write selection or API call.
  Missing items are relative to the whole current snapshot, not declared healthy.
  Spaces, commas and case remain part of identity. Over-limit input fails as a whole.
- Dashboard-owned, bounded in-memory view state is discarded on connection remount
  or marketplace/mode transition. Each list is additionally keyed to its source
  snapshot. No operational data enters localStorage, sessionStorage, URLs or disk.
- Existing cached query/page state is preserved; the other applicable audit filters,
  detail expansion and scroll position use the same session boundary. Restoring view
  state never manufactures an API result. Reloading ends this UI session.
- Content, images and B2B use the filtered queue for previous/next. Boundaries do not
  wrap. Busy activity blocks switching, unsent edits require confirmation, and each
  chosen item follows its existing fresh GET path. No preview/approval/write is
  automatically performed. Unknown/accepted outcomes retain their main-owned ledger.
- Existing whole-snapshot summaries and workbook export scopes are unchanged by
  display filtering. In advertising/reviews an explicit SKU batch shows the matching
  source rows rather than silently restricting to a prefiltered top-five/uncovered list.
- Existing pink/default, light/dark, homepage charts and operational state colors stay.

## Excluded

New Amazon routes or permissions, main/preload/credential changes, permanent audit
history, cross-device synchronization, installer/update-channel changes and live
Amazon writes. This is a Control Console Release, not a Notebook Key Release.
