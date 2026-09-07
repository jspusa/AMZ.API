# 0.1.55 candidate — exact-version live acceptance

Prepared 2026-09-07. **No live Amazon operation, native biometric check, installation or signed update was performed for this candidate in this session.** Local tests/CI are separate evidence. Last recorded device 0.1.53 and historical 0.1.30 reads do not satisfy this matrix.

## Record before each run

Create one row per actual device/run; fill every field before marking a feature passed:

| Field | Required value |
|---|---|
| Time / operator | UTC timestamp and operator initials |
| Source / Pages | Exact main SHA and deployed asset or deployment evidence |
| Installed Notebook Key | Actual version, platform/build, artifact SHA-256, publisher/signature state, installed path |
| Execution context | Live/demo, marketplace, safe internal account alias; never full Seller ID or tokens |
| Feature | Exact workflow and bounded SKU selection; no guesses from display names |
| Expected / observed | Pass criteria below, observed status, sanitized request ID/time if available |
| Boundary | Read-only / Validation Preview / exact authorized mutation / native / installed update |
| Result | Pending, Blocked (reason), Failed (reason), or Passed (evidence) |

Start with read-only checks through the user's existing Notebook Key. Some audits create official report jobs; record that report creation separately and never confuse it with a listing mutation. If a check fails, record the operation, sanitized HTTP/code, Request ID, time and coverage; keep unknown values unknown, and leave the rest of that scope unverified. Never paste credentials, raw request/response logs or workbook contents into public GitHub evidence.

## Matrix

Priority stars show the order to tackle pending acceptance; they are not success ratings.

| Check | Procedure and pass criterion | Current status | Priority |
|---|---|---|---|
| Installed Bridge / Pages compatibility | Record actual app and UI source; old supported single-SKU routes still work, while unsupported B2B batch/recovery explains the required update before starting. New capability metadata must not authorize writes | Pending exact devices | ★★★★★ |
| First load / return navigation | Open app with normal and slow Amazon read; console shell is usable while sales show loading/error. Return from low-frequency workspace preserves the main job and focus | Pending real UI | ★★★★☆ |
| Seller / Listings connection | Confirm selected marketplace/Live; independently test Listings and one exact FBA SKU. Orders-only success does not pass this row | Pending | ★★★★★ |
| B2B read-only audit | All/missing/action/correct/incomplete are mutually exclusive; search/filter intersection and exact Seller SKU/ASIN/FBA evidence; snapshot time remains distinct from write/readback time; protected 5-sheet export matches the completed snapshot | Pending current version | ★★★★★ |
| B2B recovery after reopen | Use already authorized historical accepted/pending/minimum-price-next-stage work for the same account/marketplace. Reopen and inspect bounded recent work; recovery requests are GET-only, expose no raw ledger, and send zero PATCH | Pending suitable existing evidence | ★★★★★ |
| B2B fresh action from recovery | Inspect proposal and current Listing; every next write requires fresh preview and a new native approval. Cancel before approval to confirm no mutation; any real commit requires a new exact-SKU/field instruction | Pending; commit not authorized by this checklist | ★★★★★ |
| Low stock with inbound | Inspect a SKU with low available units but inbound sufficient for the selected target; retain stockout risk and show inbound tracking without recommending ordering zero | Pending suitable SKU | ★★★★★ |
| AWD handoff | Check lead-time calculation and Seller Central handoff; UI does not claim automatic inbound draft creation | Pending | ★★★★☆ |
| Content audit / compact view | Main-owned job remains single-flight; summaries/reasons follow feature contracts. Compact/expanded list and pagination retain filters/selection and reveal full consequential old→new diffs before action | Pending real UI | ★★★★☆ |
| Content workbook round trip | Export full and partial templates; read instructions for original-device 24-hour source evidence. Reimport unchanged file and verify zero mutation intents; valid edited rows require preview and separately displayed preview expiry | Pending workbook on original device | ★★★★★ |
| Workbook failure distinction | On an isolated copied workbook, missing source device and known expired source produce distinct guidance. Formulas/macros/external links, cross-context or digest mismatch fail closed. Never move a vault or weaken evidence to make a workbook accepted | Pending isolated copies | ★★★★★ |
| Content write acceptance | Only after separate exact SKU/field authorization: disclose complete bullet replacement/overflow, fresh preview and native approval; PATCH serial, accepted time separate from GET verified, incomplete/INVALID rows zero writes | Blocked until separate live action | ★★★★★ |
| Persistence / restart | Existing automated fault tests establish disk-failure behavior. On device, normal restart retains pending/unknown evidence and recovery cannot resend. Simulate disk-full/rename failure only against an isolated data directory, never live vault/ledger | Pending device; isolated fault tests separate | ★★★★★ |
| Touch ID / Windows Hello | Safe local confirmation: success, cancel, unavailable; Windows configured PIN fallback is decided by OS. Cancellation/failure blocks sensitive action without button-only bypass; no Amazon mutation needed for this row | Pending Mac + physical Windows 11 Pro x64 | ★★★★★ |
| OS vault / Windows accounts | Same OS user can reopen existing encrypted vault; a separate Windows account cannot use copied encrypted credentials. Use disposable test credential data for cross-user tests, not the operational vault | Pending physical devices | ★★★★★ |
| A+ / variations / images | Exact FBA non-parent scope; incomplete stays incomplete. A+ positive records survive partial sources; variation relationship/family and image count/export match the actual canonical reads | Pending | ★★★★☆ |
| S&S / aged inventory / reviews | S&S 6/12/23 completed months and missing months; normal sheets by 0/5/10/15/20%, problem rows separate. Inventory excess uses Amazon estimate, incomplete totals remain unknown; review impact keeps negative sign and is not a star rating | Pending | ★★★★☆ |
| Brand / category / inbound | Same selected-date shipment source for brand/category with dataThrough; inbound US 30-day job, received/remaining/over-received quantities, partial fallback, daily problem coverage and 7-sheet export are honest | Pending | ★★★★☆ |
| Ads strategy | Actual Ads LWA + US last 30 complete days, current FBA + Sales & Traffic + Reporting v3; T1–T4 and 3-sheet/29-column export; missing manual fields stay blank | Blocked until actual Ads connection is available | ★★★★☆ |
| Board / multiple devices | Public schema v2 and no-header v1 projection preserve fields. Authenticated editor, revision conflict and lock/sleep session clearing use separate board authorization; do not publish test announcements without permission | Pending; edit not authorized by this checklist | ★★★★☆ |
| Protected download / installation | Employee login, displayed version and exact downloaded SHA-256; actual Mac/Windows install evidence separately, preserved vault and backups | Pending employee-controlled login + devices | ★★★★★ |
| Signed N→N+1 | Pass the [signed-update preflight](signed-update-preflight.md): both identities, notarization/Authenticode, approved feed, manual bootstrap, download without forced exit, safe explicit restart, N+1 identity and version | Blocked pending identities/feed/device evidence | ★★★★☆ |

## Safe mutation evidence, when separately authorized

Record the exact marketplace, SKU, fields and canonical old→new proposal before native confirmation. Preserve each stage's preview/acceptance/readback times. An Amazon accepted receipt is `ACCEPTED / PROCESSING`, never proof of exact canonical success. Unknown transport results remain locked; do not retry to “get a clean test.” Minimum-price and B2B stages require two independent previews and approvals. Read-only reconciliation may continue or be resumed, and must never send another PATCH.

## Completing the candidate

Attach sanitized evidence to each passing row and keep blocked/failed rows explicit. An aggregate green CI run or one successful SKU cannot mark all rows passed. Update the release ledger for source, deployment, artifacts, portal, installed device and live outcomes independently.
