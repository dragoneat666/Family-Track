# Family Track

A family app for the house, starting with kids' tooth brushing:

- **Brushing**: the tablet's front camera checks the kid is really brushing.
  The countdown (2:00, then 0:15 for the front teeth) only moves while they
  are. Stop brushing or walk away and it just waits.
- **Building**: each day of finished brushing unlocks one piece of a 3D
  character. The kid drags it onto a faint outline and it snaps into place.
  When the whole character is built, it dances.
- **Accounts**: grown-up and kid accounts. Each device asks "Who are you?"
  once and remembers. Grown-ups sign in with their own PIN; signing in as a
  kid, or switching away from a kid's account, needs any grown-up's PIN.
  Switching is in Settings.
- **Grown-ups**: a home page with each kid's day, accounts, characters,
  brushing rules and history, devices, and test modes for brushing and
  building that save nothing. Everything except brushing also works in a
  browser (the web app is served by the server itself).

Later: chores and allowance, shared lists, calendar, meal plans and recipes.

## Privacy

The camera is only used on the device. Each frame is looked at in memory
(face position and how much the area around the mouth moves) and thrown
away. **No video or pictures are saved or sent anywhere**, and the face
detection model ships inside the app, so nothing is loaded from the
internet while brushing.

## How it's built

| Part | What |
|---|---|
| `server/` | Node 24, Express, SQLite (built into Node). Stores everything in `/data`. Shrinks uploaded 3D files for the tablets. |
| `app/` | React + three.js, packaged as an Android app with Capacitor. The same build is served by the server for testing in a browser. |
| Brushing | MediaPipe face detector (BlazeFace) + movement in a patch around the mouth that follows the face. |

The app talks to the server over a private network (e.g. a VPN such as
NetBird or Tailscale). The server isn't meant to be exposed to the internet.

## Running the server

```
docker compose up -d
```

Then open `http://<server>:14200` in a browser once to create the parent PIN
(or do it from the app's first launch).

Settings by environment variable: `TZ` (when "today" starts),
`BUILD_MAX_TRIANGLES` (default 80000), `RIGGED_MAX_TRIANGLES` (50000),
`TEXTURE_SIZE` (2048). Lower them for slow tablets.

## The Android app

Install it from the server: open `http://<server>:14200/download` in the
phone or tablet's browser, tap **Download the app**, and allow installing
from the browser when Android asks. When a newer build is on the server, the
app shows a green "update available" banner.

Android only installs updates signed with the same key, so pick one place to
build releases and keep that key forever.

### Building on the server (recommended)

`tools/android` is a Docker build environment (Android SDK 36, JDK 21, Node).
It needs a folder with `family-track.keystore` and `signing.env`
(`KEYSTORE_PASSWORD=…`, `KEY_ALIAS=family-track`, `KEY_PASSWORD=…`), and
writes `family-track.apk` + `version.json` to the server's `data/apk` folder:

```
docker build -t family-track-android tools/android
docker run --rm -v "$PWD:/src:ro" -v /path/to/signing:/signing:ro -v /path/to/data/apk:/out -e VERSION_CODE=1 -e VERSION_NAME=0.1.1 family-track-android
```

Raise `VERSION_CODE` on every build. Make the key once with:

```
docker run --rm -it -v /path/to/signing:/out eclipse-temurin:21 keytool -genkeypair -v -keystore /out/family-track.keystore -alias family-track -keyalg RSA -keysize 4096 -validity 36500
```

### Building on GitHub (alternative)

**Actions → Android app → Run workflow**, then download `family-track-apk`
from the run (a `v*` tag also attaches it to a release). It signs with these
repository secrets, or makes a debug APK without them:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (`base64 -w0 family-track.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `family-track` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password if you pressed Enter) |

Either way, keep the keystore and its password somewhere safe (a password
manager) and out of git.

## Adding characters

Parent area → **Characters** → Add. Upload:

1. **Pieces**: one `.glb` per piece, all exported from the whole model
   *without moving them*, so each piece already sits where it belongs.
   They unlock bottom-up at first (feet first, head last); reorder as you
   like.
2. **Dancing model** (optional): the rigged `.glb`.
3. **Dances** (optional): animation `.glb` files made for the same rig
   (e.g. Meshy/Mixamo exports). Only the motion is kept from each.

Big files are fine. The server shrinks them (merges the pieces into one
file, WebP textures, simplified meshes, meshopt compression) and keeps the
originals so it can rebuild them later.

Kind **Build** is for things that snap together (a robot). **Dress up** is
for outfit pieces on an outline: each piece should include the body part
under it (shoes bring the feet, pants bring the legs).

## Developing

No Node needed on the host. Everything runs in Docker:

```
docker build -t family-track:dev .
docker run --rm -p 8080:8080 -v "$PWD/data:/data" family-track:dev
```
