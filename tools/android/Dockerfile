# Android build environment: Android SDK 36 + JDK 21 (from the cirruslabs
# image) plus Node 24 for building the web part.
FROM node:24-slim AS node

FROM ghcr.io/cirruslabs/android-sdk:36
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# Capacitor's Gradle plugin asks for build-tools 35; install it once here
# instead of on every build.
RUN sdkmanager --install "build-tools;35.0.0" > /dev/null
COPY build.sh /usr/local/bin/build-apk
RUN chmod +x /usr/local/bin/build-apk
ENTRYPOINT ["build-apk"]
