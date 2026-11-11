#!/bin/bash
# Builds a signed release APK, after running the Android unit tests.
#   /src      the repo (read-only)
#   /signing  family-track.keystore + signing.env (KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)
#   /out      gets family-track.apk and version.json (the server's data/apk folder)
# VERSION_CODE / VERSION_NAME come from the environment.
#
# With the argument "test" it only runs the unit tests (no signing or /out needed).
# The tests download a copy of Android to run on into /root/.m2; mount a
# volume there (and on /root/.gradle, /root/.npm) to keep it between builds.
set -euo pipefail

# Work on a copy so nothing is written into the source folder.
rm -rf /work && mkdir -p /work
cp -r /src/app /work/app
rm -rf /work/app/node_modules /work/app/dist
cd /work/app
npm ci --no-audit --no-fund

if [ "${1:-}" = "test" ]; then
  # The tests don't need the real web app, just something for Capacitor to copy.
  mkdir -p dist && echo '<!doctype html><title>test</title>' > dist/index.html
  npx cap sync android
  cd android
  chmod +x gradlew
  ./gradlew testDebugUnitTest --no-daemon -q
  echo "Android unit tests passed"
  exit 0
fi

: "${VERSION_CODE:?set VERSION_CODE}"
: "${VERSION_NAME:?set VERSION_NAME}"
set -a
# shellcheck disable=SC1091
. /signing/signing.env
set +a
export KEYSTORE_FILE=/signing/family-track.keystore

npm run android

cd android
chmod +x gradlew
./gradlew testReleaseUnitTest assembleRelease --no-daemon -q

mkdir -p /out
cp app/build/outputs/apk/release/app-release.apk /out/family-track.apk.new
mv /out/family-track.apk.new /out/family-track.apk
printf '{"versionCode":%s,"versionName":"%s"}\n' "$VERSION_CODE" "$VERSION_NAME" > /out/version.json
echo "Built Family Track $VERSION_NAME (code $VERSION_CODE): $(du -h /out/family-track.apk | cut -f1)"
