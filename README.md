# Family Track

A family app for the house, starting with kids' tooth brushing:

- **Brushing**: the tablet's front camera checks the kid is really brushing.
  The countdown (2:00, then 0:15 for the front teeth) only moves while they
  are. Stop brushing or walk away and it just waits.
- **Building**: each day of finished brushing unlocks one piece of a 3D
  character. The kid drags it onto a faint outline and it snaps into place.
  When the whole character is built, it dances.
- **Parents** (behind a PIN): add kids, upload characters, set the rules,
  see the brushing history, and test brushing/building without saving
  anything.

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

GitHub Actions builds the APK: **Actions → Android app → Run workflow**, then
download `family-track-apk` from the run. Pushing a tag like `v0.1.0` also
attaches it to a release. Install it on each device (allow "install unknown
apps" for the browser or file manager you open it with).

### Signing key (do this once, keep it forever)

Android only installs updates signed with the same key, so make one release
key and store it as repository secrets. Without them the workflow builds a
debug APK, which works for testing but can't be updated by a release build
later without uninstalling.

```
docker run --rm -it -v "$PWD:/out" eclipse-temurin:21 keytool -genkeypair -v -keystore /out/family-track.keystore -alias family-track -keyalg RSA -keysize 4096 -validity 36500
```

Then add these secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (`base64 -w0 family-track.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `family-track` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password if you pressed Enter) |

Keep the keystore file somewhere safe (a password manager) and out of git.

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
