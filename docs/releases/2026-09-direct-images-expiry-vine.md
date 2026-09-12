# 0.1.65 direct images, expiry clearance, and active Vine

Issue: [#250](https://github.com/jspusa/AMZ.API/issues/250).
Source base: `8d6d8c578f0b207ad372343b1df1231aef959d96`.
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

- Local `npm run check` passed on 2026-09-12: 320 test files, 3,681 tests,
  typecheck, production build and composed stylesheet verification. Production
  `npm audit --omit=dev` reports zero vulnerabilities; `git diff --check` passed.
  The Vine disk-read/save races, interrupted health observation, image login
  cancellation, context invalidation and old nine-slot receipt recovery have
  focused regression coverage. Independent final review, exact-main Actions,
  Pages and desktop artifacts are pending.
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

Update this ledger with exact final source/CI/artifact/install/download evidence
after those steps complete. Do not infer later phases from version numbers.
