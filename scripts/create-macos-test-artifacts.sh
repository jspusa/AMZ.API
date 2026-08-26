#!/bin/bash

set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Usage: $0 APP_PATH VERSION OUTPUT_DIRECTORY" >&2
  exit 2
fi

app_path="$1"
version="$2"
output_directory="$3"

test -d "$app_path"
mkdir -p "$output_directory"

artifact_root=""
cleanup_artifacts() {
  if [[ -n "$artifact_root" && -d "$artifact_root" ]]; then
    rm -rf -- "$artifact_root"
  fi
  artifact_root=""
}
trap cleanup_artifacts EXIT

dmg_path="$output_directory/AMZ.API-$version-universal.dmg"
zip_path="$output_directory/AMZ.API-$version-universal.zip"
artifact_root="$(mktemp -d "$output_directory/.amz-api-dmg.XXXXXX")"
stage="$artifact_root/stage"
mkdir -p "$stage"
ditto "$app_path" "$stage/AMZ.API.app"
ln -s /Applications "$stage/Applications"
sync

attempt=1
while [[ "$attempt" -le 3 ]]; do
  attempt_dmg="$artifact_root/AMZ.API-$version-universal-attempt-$attempt.dmg"
  hdiutil_log="$artifact_root/hdiutil-attempt-$attempt.log"

  hdiutil_status=0
  hdiutil create \
    -volname "AMZ.API $version" \
    -srcfolder "$stage" \
    -nospotlight \
    -format UDZO \
    "$attempt_dmg" >"$hdiutil_log" 2>&1 || hdiutil_status=$?

  if [[ "$hdiutil_status" -eq 0 ]]; then
    if [[ -s "$hdiutil_log" ]]; then
      cat "$hdiutil_log"
    fi
    test -f "$attempt_dmg"
    mv -f "$attempt_dmg" "$dmg_path"
    break
  fi

  cat "$hdiutil_log" >&2
  rm -f -- "$attempt_dmg"
  if ! grep -Fqx "hdiutil: create failed - Resource busy" "$hdiutil_log"; then
    exit "$hdiutil_status"
  fi
  if [[ "$attempt" -ge 3 ]]; then
    exit "$hdiutil_status"
  fi

  echo "Transient hdiutil Resource busy; retrying DMG creation ($attempt/3)." >&2
  sleep "$((attempt * 2))"
  attempt=$((attempt + 1))
done

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$zip_path"
