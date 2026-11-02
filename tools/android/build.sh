#!/bin/bash
# Builds a signed release APK.
#   /src      the repo (read-only)
#   /signing  family-track.keystore + signing.env (KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)
#   /out      gets family-track.apk and version.json (the server's data/apk folder)
# VERSION_CODE / VERSION_NAME come from the environment.
set -euo pipefail

: "${VERSION_CODE:?set VERSION_CODE}"
: "${VERSION_NAME:?set VERSION_NAME}"
set -a
# shellcheck disable=SC1091
. /signing/signing.env
set +a
export KEYSTORE_FILE=/signing/family-track.keystore

# Work on a copy so nothing is written into the source folder.
rm -rf /work && mkdir -p /work
cp -r /src/app /work/app
rm -rf /work/app/node_modules /work/app/dist
cd /work/app
npm ci --no-audit --no-fund
npm run android

cd android
chmod +x gradlew
./gradlew assembleRelease --no-daemon -q

mkdir -p /out
cp app/build/outputs/apk/release/app-release.apk /out/family-track.apk.new
mv /out/family-track.apk.new /out/family-track.apk
printf '{"versionCode":%s,"versionName":"%s"}\n' "$VERSION_CODE" "$VERSION_NAME" > /out/version.json
echo "Built Family Track $VERSION_NAME (code $VERSION_CODE): $(du -h /out/family-track.apk | cut -f1)"
