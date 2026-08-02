#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/macos/NexoraBridge/main.swift"
PLIST="$ROOT/macos/NexoraBridge/Info.plist"
ICON_SOURCE="$ROOT/soulmate/assets/soulmate-icon-512.png"
OUTPUT_ROOT="$ROOT/dist/nexora-bridge-macos"
APP="$OUTPUT_ROOT/NEXORA Bridge.app"
MACOS_DIR="$APP/Contents/MacOS"
RESOURCES_DIR="$APP/Contents/Resources"
ARCH_BUILD="$OUTPUT_ROOT/architectures"

rm -rf "$OUTPUT_ROOT"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$ARCH_BUILD"
cp "$PLIST" "$APP/Contents/Info.plist"

build_architecture() {
  local architecture="$1"
  xcrun swiftc \
    -swift-version 5 \
    -O \
    -whole-module-optimization \
    -target "${architecture}-apple-macos13.0" \
    -framework AppKit \
    -framework Security \
    "$SOURCE" \
    -o "$ARCH_BUILD/NexoraBridge-$architecture"
}

BUILT_ARCHITECTURES=()
for architecture in arm64 x86_64; do
  if build_architecture "$architecture"; then
    BUILT_ARCHITECTURES+=("$architecture")
  elif [[ "$architecture" == "$(uname -m)" ]]; then
    echo "Unable to build the native architecture: $architecture" >&2
    exit 1
  fi
done

if [[ "${#BUILT_ARCHITECTURES[@]}" -eq 2 ]]; then
  xcrun lipo -create \
    "$ARCH_BUILD/NexoraBridge-arm64" \
    "$ARCH_BUILD/NexoraBridge-x86_64" \
    -output "$MACOS_DIR/NexoraBridge"
else
  cp "$ARCH_BUILD/NexoraBridge-${BUILT_ARCHITECTURES[0]}" "$MACOS_DIR/NexoraBridge"
fi
chmod 755 "$MACOS_DIR/NexoraBridge"

ICONSET="$OUTPUT_ROOT/AppIcon.iconset"
mkdir -p "$ICONSET"
for specification in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"; do
  read -r size filename <<< "$specification"
  sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/$filename" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES_DIR/AppIcon.icns"
rm -rf "$ICONSET" "$ARCH_BUILD"

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
"$MACOS_DIR/NexoraBridge" --self-test

ZIP="$ROOT/dist/NEXORA-Bridge-macOS.zip"
DMG="$ROOT/dist/NEXORA-Bridge-macOS.dmg"
rm -f "$ZIP" "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
hdiutil create -quiet -volname "NEXORA Bridge" -srcfolder "$APP" -ov -format UDZO "$DMG"
shasum -a 256 "$ZIP" "$DMG" > "$ROOT/dist/NEXORA-Bridge-macOS.sha256"

echo "Built: $APP"
echo "Archive: $ZIP"
echo "Disk image: $DMG"
lipo -archs "$MACOS_DIR/NexoraBridge"
