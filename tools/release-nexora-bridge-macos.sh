#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/nexora-bridge-macos/NEXORA Bridge.app"
ZIP="$ROOT/dist/NEXORA-Bridge-macOS.zip"
DMG="$ROOT/dist/NEXORA-Bridge-macOS.dmg"
IDENTITY="${NEXORA_CODESIGN_IDENTITY:-}"
NOTARY_PROFILE="${NEXORA_NOTARY_PROFILE:-}"
NOTARY_KEYCHAIN="${NEXORA_NOTARY_KEYCHAIN:-}"
CODESIGN_KEYCHAIN="${NEXORA_CODESIGN_KEYCHAIN:-}"

if [[ -z "$IDENTITY" || "$IDENTITY" == "-" ]]; then
  echo "NEXORA_CODESIGN_IDENTITY must name an installed Developer ID Application certificate." >&2
  exit 2
fi
if [[ -z "$NOTARY_PROFILE" ]]; then
  echo "NEXORA_NOTARY_PROFILE must name a notarytool Keychain profile." >&2
  exit 2
fi
for tool in codesign ditto hdiutil xcrun; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 2; }
done

NEXORA_CODESIGN_IDENTITY="$IDENTITY" \
NEXORA_CODESIGN_KEYCHAIN="$CODESIGN_KEYCHAIN" \
bash "$ROOT/tools/build-nexora-bridge-macos.sh"

NOTARY_ARGUMENTS=(--keychain-profile "$NOTARY_PROFILE")
if [[ -n "$NOTARY_KEYCHAIN" ]]; then
  NOTARY_ARGUMENTS+=(--keychain "$NOTARY_KEYCHAIN")
fi

xcrun notarytool submit "$ZIP" "${NOTARY_ARGUMENTS[@]}" --wait
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose=2 "$APP"

rm -f "$ZIP" "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
hdiutil create -quiet -volname "NEXORA Bridge" -srcfolder "$APP" -ov -format UDZO "$DMG"
if [[ -n "$CODESIGN_KEYCHAIN" ]]; then
  codesign --force --timestamp --keychain "$CODESIGN_KEYCHAIN" --sign "$IDENTITY" "$DMG"
else
  codesign --force --timestamp --sign "$IDENTITY" "$DMG"
fi
codesign --verify --verbose=2 "$DMG"

xcrun notarytool submit "$DMG" "${NOTARY_ARGUMENTS[@]}" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

shasum -a 256 "$ZIP" "$DMG" > "$ROOT/dist/NEXORA-Bridge-macOS.sha256"
echo "Release-ready macOS packages:"
echo "  $ZIP"
echo "  $DMG"
