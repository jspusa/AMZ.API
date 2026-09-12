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
- Mac installation is now 0.1.65. The prior App and a 0700 userData backup are
  retained; installed ASAR, vault and ledger preservation passed the separate
  checks below. New native UI and live feature acceptance remain pending.
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
| Installed Mac | 0.1.65 universal; installed ASAR matches the verified artifact, deep strict codesign passed, vault/ledger bytes preserved | ★★★★★ installation |
| Native UI / preferences | New process is alive, but no new UI observed yet; user handling of system Keychain/save windows remains pending | ☆☆☆☆☆ pending |
| Protected upload | Mac then Windows upload completed successfully; both payload lengths and hashes match the trusted artifacts | ★★★★★ upload only |
| Employee download bytes | After user login, both 0.1.65 cards and hashes were observed and Mac then Windows downloads initiated; the filesystem verifier still lacks a fresh Mac file | ☆☆☆☆☆ pending |

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
package 0.1.65 and update channel disabled. This inspection is separate from the
installation evidence below; it does not prove Developer ID or notarization.
Windows packaged ASAR is `da1daec0310c0de954361dbfde13c9b9b2eebc55e3fb3956c5af13f7a70f1721`,
package 0.1.65 with update channel disabled. Its unpacked Hello addon matches
the packed manifest; this is not evidence from physical Windows Hello hardware.

## Installed device and pending acceptance

`/Applications/AMZ.API.app` is now 0.1.65 from the same merged source, Mac run
`34694902258` and artifact `10298244661`. `installation-verification.json`
confirms universal architecture, deep strict codesign, disabled updates and
installed ASAR `1820bfa0d35298ed37ee3159531023d3da94dc216b058c49f71be3ece56b1638`.
The App was stopped during the swap; vault and all ledger bytes remained equal.
`user-data-backup-verification.json` confirms the stopped-App backup and both
byte-preservation checks. Preserved destinations are:

- Previous App: `/Applications/AMZ.API-v0.1.64-backup-before-0165-20260912.app`.
- User data: `/Users/jasper/Library/Application Support/amz-api-backups/20260912-before-0165/userData`, mode 0700.

Before normal quit, root observed the old App homepage with no active image
workspace or draft. For restart acceptance, the original standard text size,
original palette and light mode were recorded, then temporarily changed to
large text, pink palette and dark mode. Their persistence in the new App is
still unverified; restore the recorded original settings after that check.
Native UI inspection timed out, while a process check showed the App and system
SecurityAgent alive. No new native UI has been observed yet. Keychain and save
windows await user handling; process existence does not prove launch/UI,
preference persistence, image upload, inventory sync or Vine acceptance.

Local evidence is under `/tmp/amz-api-v0165-verified/`: `local-verification.json`,
the separate `pages/`, `macos/` and `windows/` verification records,
`site-image-service.json`, `installation-verification.json` and
`user-data-backup-verification.json`. `portal-upload-verification.json` records
successful Mac then Windows uploads to the existing protected cards. Its
expired-login observation describes the earlier post-upload state. Root later
observed the user's fresh employee login, both 0.1.65 cards with matching hashes,
and sequential Mac/Windows download starts. The filesystem verifier still
reports no fresh Mac download; physical download bytes remain unverified.

Keep authenticated browser observation and physical file verification separate.
The new UI and requested live behavior require their own acceptance evidence.
No secret or operational account data is included here.
