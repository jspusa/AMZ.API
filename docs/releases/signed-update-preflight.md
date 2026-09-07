# Publisher-signed Notebook Key preflight

Status: preparation complete; signing and device acceptance remain unverified. The existing `desktop-release.yml` and `DesktopUpdater` already implement a signed update path. Keep that path and ADR 0001. Default packages remain `disabled`; only that signing workflow injects `publisher-signed-v1`.

## Prerequisites and present limits

| Requirement | Exact configuration / acceptance | Current evidence |
|---|---|---|
| macOS signing identity | `mac-release` protected environment: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; valid stable Developer ID Application identity and notarization permission | Not accessed or verified |
| Windows signing identity | `windows-release`: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`; stable Authenticode publisher, trusted timestamp, package metadata publisher exactly matching certificate identity | Not accessed or verified |
| Signing provider form | Current job expects a certificate compatible with electron-builder CSC inputs. A non-exportable HSM/hardware/cloud key needs the issuer's CI signer integration, never an invented/exported key | Provider not established |
| Feed approval | `desktop-release` environment requires `PUBLIC_DESKTOP_UPDATE_FEED=approved` **only after a separately recorded decision to expose GitHub release assets publicly** | No such decision in this work; current protected installer boundary remains |
| Source | Final tag `v<package version>` must equal workflow SHA and be reachable from `origin/main`; quality job check and production audit both succeed | Candidate 0.1.55 not yet a signed release |
| Devices | A Mac supporting the intended native confirmation and a Windows 11 Pro x64 user device with configured Hello; users operate credential entry themselves | Not available in this Linux session |

Secrets are entered through the existing protected environment by their owner. Never place values in chat, source, test fixtures, logs, or this checklist. Missing configuration is a blocked acceptance item, not a reason to set the package marker or weaken verification.

## Release preparation

1. Freeze the exact candidate SHA after review and CI. Record package version, source SHA and checks in the dated release ledger. Read ADR 0001 before any tag or feed change. Publishing a release tag starts the signing workflow; do not use a tag as a harmless preflight probe.
2. Verify the environment names, required key names and provider compatibility without printing secret values. Obtain the separate feed decision before attempting publication. If the protected distribution must stay private, the current GitHub-provider publication remains blocked until a reviewed private updater design is authorized.
3. After release authorization, create the matching tag on main. Existing quality → Mac/Windows → publish jobs must all succeed for that exact tag. A missing certificate, identity mismatch, notarization failure or one-platform failure stops publication. Do not rerun by bypassing those gates.
4. Download verified artifacts and independently compare their payload checksums. Record the actual executable publisher / Team ID, version, bundle ID and architecture. Presence of an Actions artifact or a metadata marker alone is insufficient.

## Artifact verification

These are inspection commands against already downloaded/installed files; substitute the actual paths. They do not install, publish, or contact Amazon.

macOS:

```bash
amz_app='/Applications/AMZ.API.app'
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$amz_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$amz_app/Contents/Info.plist"
codesign --verify --deep --strict --verbose=2 "$amz_app"
codesign --display --verbose=4 "$amz_app"
spctl --assess --type execute --verbose=4 "$amz_app"
xcrun stapler validate "$amz_app"
lipo -info "$amz_app/Contents/MacOS/AMZ.API"
shasum -a 256 "$amz_app/Contents/Resources/app.asar"
```

Require bundle `com.jspusa.amz-api`, exact candidate version, both `arm64` and `x86_64`, the intended Developer ID / Team ID and successful notarization. Ad-hoc `codesign --verify` alone is not publisher signing. Check the original DMG and ZIP against their signed-run checksum manifest before installation.

Windows PowerShell (repository plus downloaded release directory):

```powershell
.\scripts\verify-windows-package.ps1 -SignatureMode Signed
Get-FileHash -Algorithm SHA256 -LiteralPath 'release\AMZ.API-Notebook-Key-Windows-x64-Setup.exe'
Get-AuthenticodeSignature -LiteralPath 'release\AMZ.API-Notebook-Key-Windows-x64-Setup.exe' | Select-Object Status, SignerCertificate, TimeStamperCertificate
signtool verify /pa /v release\win-unpacked\AMZ.API.exe
signtool verify /pa /v release\AMZ.API-Notebook-Key-Windows-x64-Setup.exe
```

Require exact version/x64, signed executable and installer, expected publisher and timestamp, exact `app-update.yml` publisher name, and the fixed ASAR addon manifest/hash boundary. CI smoke does not prove physical Hello, PIN or different-user DPAPI isolation.

## First trusted installation and N → N+1 acceptance

1. Publish approved DMG/NSIS payloads through the existing protected installer process, then use employee-controlled login to verify the displayed version and downloaded SHA-256. Record portal and local install independently. Keep a recoverable old App and encrypted user data; do not delete/recreate the vault or disable OS security protections.
2. On each device, manually install the verified signed bootstrap and record source/version/signature/hash. Confirm old encrypted credentials are usable in the same OS account without exposing them. Launch from the intended installed path; confirm Pages renders and basic read-only connection status.
3. From signed N, approve a signed N+1 release through the same identity and feed. Confirm the first check, background download/progress, continued ordinary UI use, and no automatic exit. Only “更新並重啟” initiates installation.
4. While a sensitive operation is busy, installation must be refused. Once idle, explicit installation closes local editors and gates new operations. The installed N+1 version/signature/hash must match the verified release; the vault remains usable. Network/update error must return usable controls without silently retrying an Amazon write.
5. Independently exercise native success/cancel/unavailable/PIN and cross-user DPAPI in the live matrix. Publisher mismatch/tamper/failed-installer cases use isolated test copies or existing fake-adapter tests; do not damage the operational installation to create a negative test.

Record exact N and N+1 evidence for both platforms. Until those steps pass, report “signed-update preparation complete; publisher signing / bootstrap / device update acceptance pending.”
