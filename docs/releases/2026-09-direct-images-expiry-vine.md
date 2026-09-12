# 0.1.65 direct images, expiry clearance, and active Vine

Issue: [#250](https://github.com/jspusa/AMZ.API/issues/250).
Source base: `8d6d8c578f0b207ad372343b1df1231aef959d96`.
Merged source: `3584b3bb775ceb0e645fa2e4a403314016bac037` via
[PR #251](https://github.com/jspusa/AMZ.API/pull/251), 2026-09-12 12:53:14 UTC.
The merged tree exactly matches final reviewed branch `c5790ebabb1f8044add7881a7312f372df8e6ded`.
Spec: [direct images, expiry and Vine](../specs/2026-09-direct-images-expiry-vine.md).

## Implemented workflow

- Central image preparation without local R2 configuration; dedicated packaged
  image login, anonymous byte verification, ten-slot PTD-aware ordering and old
  nine-slot receipt recovery. Image audit threshold expands to ten, default eight.
- Independent all-FBA expiry/velocity sync; low-age stock stays visible, actual
  report failures are sanitized and shown, and calendar evidence remains strict.
- Seller Central full-page Vine paste, active enrollments of any age, and
  reviews/enrolled progress. Explicit terminal status retires existing cards.

## Evidence boundaries

- Local `npm run check` passed on 2026-09-12: 320 test files, 3,690 tests,
  typecheck, production build and composed stylesheet verification. Production
  `npm audit --omit=dev` reports zero vulnerabilities; `git diff --check` passed.
  The Vine disk-read/save races, interrupted health observation, image login
  cancellation, context invalidation and old nine-slot receipt recovery have
  focused regression coverage. Final independent Standards and Spec reviews
  have zero open findings; one Standards and four Spec findings were resolved.
- Independent review reproduced an upload identity that changed after lock,
  missing support for bare numeric filenames, and lost original files after a
  single-slot preparation failure. The fixes keep account/mode/region/marketplace/
  SKU identity stable across security generations, align numeric slot detection,
  and retain explicit file positions for preparation. Fresh unsupported slots
  remain visible and allow correction or skipping. Each case has a public-owner
  or UI regression, including recovery after a changed PTD capability.
- Supply Boss image service published successfully as Site version 7 on
  2026-09-12, source `1a0853bbde02e05fd95616892654e0764dc9121f`.
  Project: `appgprj_6a7719308ad8819186b46adcafcc87a6`.
  Deployment: `appgdep_6aa53edabc008191a29cce9431602bde`.
  URL: `https://supply-boss.brave-prawn-0848.chatgpt.site`.
  Existing public audience, R2 binding and protected download/board APIs remain.
  Server contract tests and artifact validation passed; this does not prove a
  real employee image-login/upload from the installed Notebook Key.
- Installed Mac remains 0.1.64. The current user-selected image draft has not been
  discarded by an agent restart or navigation. A later read-only UI check found
  the Mac locked; an unlock request is pending while source work continues.
- No Amazon Preview, native Amazon approval or mutation was sent for this work.
  Real Windows Hello, formal signing and automatic update feeds remain unproved.
- Prior 0.1.64 employee download files still lack final local byte/hash evidence;
  earlier upload receipts and browser start messages are separate evidence.

## Exact-source publication and artifacts

All four runs below are successful `push` / `main` runs for merged source
`3584b3bb775ceb0e645fa2e4a403314016bac037`. Stars indicate evidence coverage
for that row only, not live Amazon acceptance.

| Layer | Exact evidence | Coverage |
|---|---|---|
| Validate | [34694902293](https://github.com/jspusa/AMZ.API/actions/runs/34694902293) | ★★★★★ passed |
| Pages | [34694902265](https://github.com/jspusa/AMZ.API/actions/runs/34694902265), artifact `10297733167`; live HTML and all 11 JS/CSS assets byte-equal to the artifact | ★★★★★ delivered bytes |
| macOS | [34694902258](https://github.com/jspusa/AMZ.API/actions/runs/34694902258), artifact `10298244661`, attempt 1; archive and full DMG/ZIP checksums verified | ★★★★★ artifact |
| Windows | [34694902259](https://github.com/jspusa/AMZ.API/actions/runs/34694902259), artifact `10298274516`, attempt 1; archive, full EXE/ZIP and ASAR addon boundary verified | ★★★★★ artifact |
| Installed Mac / native UI | Current App is still 0.1.64; Mac remains locked and its pending image draft is preserved | ☆☆☆☆☆ pending |
| Protected upload | Mac then Windows upload completed successfully; both payload lengths and hashes match the trusted artifacts | ★★★★★ upload only |
| Employee download bytes | Fresh page reload requires employee login again; no new 0.1.65 browser download has been initiated | ☆☆☆☆☆ pending |

| Trusted payload | Bytes | SHA-256 | Coverage |
|---|---:|---|---|
| Mac universal DMG | 246733885 | `efcc010fb7daadddb40057e61dacd900ee8e6086b8cbc4f15458ef7e02a554c9` | ★★★★★ verified |
| Mac universal ZIP | 222183608 | `35bb1ac7c35cb1025ec9efd87f85c77de6de591b03cadf45c4436f90c28a0e63` | ★★★★★ verified |
| Windows x64 Setup EXE | 102056784 | `48f663e5a92534b900246daca93b2dfab5012271a76a5244d95040c99b9b315c` | ★★★★★ verified |
| Windows x64 ZIP | 143368584 | `11888f4310e6387f0cfaa837246c6aa8b2a1c072628e0b1929240881ae2f685c` | ★★★★★ verified |

GitHub archive digests: Mac `cd2bda39621047127d4406e45b12037440e5217f1a82a67db4ddf05e6d3fe657`;
Windows `6b29ddaaf3845fd6d837eb530ef8d36a68f01f82ef2265fcd2809f232a906250`.
The verified Mac DMG was mounted read-only without launching its App. Bundle
`com.jspusa.amz-api` is 0.1.65, arm64 + x86_64, with passing deep strict ad-hoc
signature verification. Its ASAR is
`1820bfa0d35298ed37ee3159531023d3da94dc216b058c49f71be3ece56b1638`,
package 0.1.65 and update channel disabled. This is artifact inspection, not an
installation, Developer ID or notarization claim.
Windows packaged ASAR is `da1daec0310c0de954361dbfde13c9b9b2eebc55e3fb3956c5af13f7a70f1721`,
package 0.1.65 with update channel disabled. Its unpacked Hello addon matches
the packed manifest; this is not evidence from physical Windows Hello hardware.

Local evidence is under `/tmp/amz-api-v0165-verified/`: `local-verification.json`,
the separate `pages/`, `macos/` and `windows/` verification records, and
`site-image-service.json`. Sequential protected upload completion is recorded in
`portal-upload-verification.json`; the existing `macos-dmg` and
`windows-installer` cards retain their labels and protected audience. The browser
session expired before post-upload card/download verification, and the Mac is
locked. User unlock and employee login are requested; current image draft,
App installation and user data have not been changed during this release.
No secret or operational account data is included here.
Update installation and authenticated download evidence only after those steps
complete; version numbers and upload/start messages do not establish them.
