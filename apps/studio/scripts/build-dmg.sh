#!/usr/bin/env bash
# Build a signed + notarized + stapled macOS .dmg shipping the React renderer.
#
# Full pipeline:
#   1. Build studio-react (the BeeTable React renderer shipped via extraResources)
#   2. electron-builder: sign (Developer ID + hardened runtime), notarize the
#      .app via App Store Connect API key, staple, package the dmg
#   3. Sign + notarize + staple the dmg container itself (electron-builder only
#      handles the .app, not the dmg wrapper)
#
# Packaged builds default to the React renderer (WindowBuilder.ts); no env var
# needed at runtime.
#
# Usage:
#   ./scripts/build-dmg.sh                # current arch
#   ./scripts/build-dmg.sh --universal    # Intel + Apple Silicon in one dmg
#   ./scripts/build-dmg.sh --x64 --arm64  # two separate dmgs
# Any extra args are passed straight through to electron-builder.
set -euo pipefail

STUDIO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REACT_DIR="$(cd "$STUDIO_DIR/../../studio-react" && pwd)"
cd "$STUDIO_DIR"

ENV_FILE="$STUDIO_DIR/.env.notarize"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found (holds APPLE_API_* notarization vars)" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# Expand $HOME etc. and fail early on a missing key file.
APPLE_API_KEY="$(eval echo "$APPLE_API_KEY")"
export APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER
if [[ ! -f "$APPLE_API_KEY" ]]; then
  echo "error: .p8 key not found at $APPLE_API_KEY" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "error: no 'Developer ID Application' identity in keychain" >&2
  exit 1
fi

echo "==> Building studio-react renderer (shipped into the .app)"
( cd "$REACT_DIR" && yarn build )

echo "==> Building notarized .app + dmg (issuer ${APPLE_API_ISSUER:0:8}…, key $APPLE_API_KEY_ID)"
yarn electron:build --mac dmg "$@"

# electron-builder notarizes/staples the .app but not the dmg container. Sign +
# notarize + staple each produced dmg so the downloaded file opens clean too.
ID="Developer ID Application: Queau Jocelin (VS3FLTY94C)"
shopt -s nullglob
for DMG in "$STUDIO_DIR"/dist_electron/*.dmg; do
  echo "==> Signing + notarizing dmg container: $(basename "$DMG")"
  codesign --force --sign "$ID" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
done

echo "==> Done. Artifacts in $STUDIO_DIR/dist_electron/"
echo "    Verify: spctl -a -vvv -t open --context context:primary-signature dist_electron/*.dmg"
