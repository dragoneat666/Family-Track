# Family Track

A family app for the house: kids' tooth brushing, home exercises, and the
grown-ups' shared lists.

- **Brushing**: the tablet's front camera checks the kid is really brushing.
  The countdown (2:00, then 0:15 for the front teeth) only moves while they
  are. Stop brushing or walk away and it just waits. A tracking check done
  by a kid where they brush (standing at the sink, or sitting further
  away) can give them their own setting; with both saved, it picks by how
  big their face looks to the camera.
- **Building**: each finished brush (at least 6 hours after the last one, so
  morning and bedtime both count) unlocks one piece of a 3D character.
  When the whole character is built, it dances. Each kid picks how hard
  building is in Settings:
  - *Easy*: drag the piece onto a faint outline and it snaps into place.
  - *Medium*: no outlines. Put the piece where you think it goes and tap
    **Check**: close enough clicks in, otherwise it wiggles and you try again
    (after three misses the outline flashes for a moment).
  - *Hard*: like medium, but pieces arrive turned and the arrows turn them back.
  The first piece of a character always works like easy, to show where it starts.
- **Exercises**: home exercises from an occupational therapist.
  - *Metronome*: a steady tick to clap along to, faster or slower by 5 beats
    a minute (each kid's speed is remembered on the device).
  - *The partner's exercises*: each exercise partner (a character) has its
    own exercises, made by a grown-up in the exercise editor (below), like
    Hug & Starfish: arms on the chest, cross the leg, sit up and hold while it
    counts, lie back as a starfish, then the other side. The wait, hold and
    number of rounds are set per kid by a grown-up.
  - *Exercise partners*: any character can be one. Kids pick their partner in
    Settings, from the characters they've finished building plus any open to
    everyone, and get that partner's exercises.
- **Calendar**: the family's appointments, practices and birthdays, with
  US holidays. A month at the top and, below it, what's on day by day.
  Events can repeat (every week, every other week, every month…) and remind
  grown-ups on their phones beforehand. More under [Calendar](#calendar).
- **My Day** (kids): a card on each kid's home screen with today's things
  and their reminders (with **Done**), and what's on tomorrow; tap it for
  **My Week**. More under [My Day and My Week](#my-day-and-my-week).
- **Contacts**: the family's phone numbers, emails, addresses and
  birthdays. Grown-ups can call, text, email or map from there, and fill one
  in from the phone's own contacts; each grown-up's phone can stay linked
  to its own contacts (both ways, names untouched); kids can look numbers
  up. Birthdays go on the calendar by themselves, for
  everyone, just the kids, just grown-ups or nobody. More under
  [Contacts](#contacts).
- **Recipes**: the family's recipes with photos, amounts that scale to
  how many are eating, and imports from recipe web pages. More under
  [Recipes](#recipes).
- **Lists**: the grown-ups' shared lists, one per store plus anything else
  (to-dos, packing). Store lists are sorted by section in the order you walk
  that store and suggest groceries as you type; anything can be pinned to the
  phone's notifications or given a reminder. They work with no connection
  and catch up later. More under [Lists](#lists).
- **Reminders**: things like pills, at set times on chosen days, for
  everyone or just some of the family. They pop up on phones and tablets
  with a **Done** button, and remind again a little later if nobody taps it.
  More under [Reminders](#reminders).
- **Accounts**: grown-up and kid accounts. Each device asks "Who are you?"
  once and remembers. Grown-ups sign in with their own PIN; signing in as a
  kid, or switching away from a kid's account, needs any grown-up's PIN.
  Switching is in Settings.
- **Grown-ups**: a home screen of buttons. **Calendar**, **Lists**, **Reminders**, **Contacts** and **Recipes** are there; **Kids Setup**
  has each kid's day, then Characters, Brushing (rules and history),
  Exercises and Test (brushing and building that save nothing). Accounts and
  Devices are under the gear, in Settings. Everything except brushing also
  works in a browser (the web app is served by the server itself).
- **Dark mode**: the app and the web app follow the phone's or computer's
  light/dark setting.

Later: a meal planner and cooking mode (for recipes), a family tree, chores
and allowance.

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
| `app/android/…/notify/` | The Android side of reminders and pins (alarms, notification buttons, the background check), in Java. |
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

**Backups:** every night at 1:30 (and when the server starts, if there's
none from the last day) the server saves a full copy of the database in
`data/backups` as `family-track-YYYY-MM-DD.db`, and keeps two weeks of them.
To go back to one, stop the server and put it in place of
`data/family-track.db`. The 3D files and voice recordings (`data/characters`)
are not in it.

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

Kids Setup → **Characters** → Add. Upload:

1. **Pieces**: one `.glb` from Blender with each piece as its own object
   (the pieces are named after the objects), or one `.glb` per piece. All
   exported from the whole model *without moving them*, so each piece
   already sits where it belongs. They unlock bottom-up at first (feet
   first, head last); reorder as you like.
2. **Dancing model** (optional): the rigged `.glb`.
3. **Dances** (optional): animation `.glb` files made for the same rig
   (e.g. Meshy/Mixamo exports); a file with several animations becomes one
   dance each. Only the motion is kept.

Big files are fine. The server shrinks them (merges the pieces into one
file, WebP textures, simplified meshes, meshopt compression) and keeps the
originals so it can rebuild them later.

Kind **Build** is for things that snap together (a robot): every piece is
dragged on, one piece per brush. **Exercise partner only** has nothing to
build: just the exercise model.

**Dress up** is for people. Clothes are dragged on like pieces, but body
parts are *uncovered*: once the clothes before them are on, the camera
zooms in on each body part in turn, it shows up under sparkly clouds in its
exact shape, and the kid rubs the clouds away with a finger (it takes a few
swipes). Body parts next to each other in the unlock order come with the same
brush, so for example:

| Brush | Unlocks |
|---|---|
| 1 | Shorts |
| 2 | Stomach, legs (uncovered) |
| 3, 4 | Left boot, right boot |
| 5 | Top |
| 6 | Hands, head (uncovered) |
| 7 | Braid |

Name a body part with `(Body)` in Blender (`Stomach (Body)`, `Left Leg [body
part]`) and it's marked as one for you (the tag is left out of its name), or
tick **Body part** next to it on the character's page. Set the order there
too: each piece shows which brush unlocks it.

### Kids pick their own character

Every Build and Dress up character is open to every kid. The kid home has a
**Characters** button showing each one as a picture of how far that kid got
(finished pieces drawn for real, the rest as the faint outline), marked
Unlocked (finished), the one they're on now, new pieces waiting, or locked.
Tapping one shows its page: **Set as my character** makes brushing earn its
pieces, and **Build** / **Dress up** opens it whenever pieces are waiting. A
finished character's page plays its dances. Pieces on every character are
kept, so a kid can switch and come back. The wait between pieces is per kid,
so switching doesn't earn an extra one. Grown-ups can still set a kid's
character in Settings → Accounts.

### Each character's page

Characters shows every character as a tile; tapping one opens its page:

- **Details**: name, kind, whether every kid can pick it as a partner.
- **Build**: pieces in unlock order (with the brush that unlocks each, and
  the Body part ticks for dress up), the dancing model and dances.
- **Exercise model**: one .glb with the model, any props and every exercise
  animation (Blender: export with all actions), with a viewer to scrub
  through each animation.
- **Voice**: the partner's lines, each with its words. Record them in the
  app, add audio files, or split one long recording (from a voice tool, say)
  into lines: it finds each line by the pauses and matches them up in order.
  Pick a voice effect (robot, radio, giant, sparkly, echo). Recordings are
  trimmed and evened out on the device and stored on the server only.
  Counting (one to thirty) is used while the kid holds.
- **Exercises**: start one from scratch, make Hug & Starfish from animations
  named like `Starfish_Sit_Up.L` / `.R` and `Starfish_Sit_Up_Rev.L` / `.R`, or
  copy one from another character (same animation names, its words come along
  to record again).

### The exercise editor

An exercise is a row of scenes, shown on a timeline with a preview that plays
it exactly as the kid sees it. Each scene has:

- a **move**: part of an animation (from and to, scrubbed to the spot;
  backwards if to is before from), its speed, and whether it keeps repeating;
  no move holds the last pose,
- a **voice** line from the partner's voice (or a new one made from the
  scene's words), starting when you like,
- **words** on the screen (the voice line's words unless you type others),
- **then**: go straight on, wait for the kid, or count while they hold,
  using each kid's own time or a set number of seconds.

A stretch of scenes can repeat for the kid's rounds, with scenes skipped in
the first round (like "Let's do it again!") or the last round (like a rest
before the next round). "Copy for the other side" copies scenes
with left and right swapped in the words, the animations (.L/.R) and the voice
lines. "Make voice lines from the words" and "Split one recording into the
scenes" give a whole exercise its voice in one go. Changes save by themselves.

## Lists

The **Lists** button on a grown-up's home screen. Kids don't see them.

- **Store lists** group things by section (Produce, Dairy & Eggs, …). A new
  one starts with a standard set of sections and a few hundred common
  groceries that know where they go, so typing "ban" offers Bananas and puts
  them under Produce. Each list then learns its own store: under ⋯ →
  **Sections**, drag them into the order you walk the aisles, rename them, add
  your own. Move an item to another section and that list remembers it for
  next time. A new store list can copy another list's sections.
- **Plain lists** are for everything else.
- Tapping an item checks it off and moves it to **Checked** at the bottom,
  where it stays until **Clear checked**. Adding something that's sitting in
  Checked brings it back instead of adding it twice. `milk x2` or
  `milk (the big one)` adds a note.
- **Just me** (when making a list, or under ⋯) hides a list from everyone else.
- Everyone's phone shows a change within a second or two.

**Without the server.** Each phone keeps its own copy of the lists, so they
open and change with no connection (the VPN is off, no signal in the store).
A grown-up's phone opens straight to where it was, without asking the server
first. Changes wait on the phone and are sent when the server is in reach
again; a note at the top says so meanwhile.

**Reminders** (⋯ next to an item):

- **Pin to this phone's notifications**: it sits in the notification area
  with a **Done** button until it's checked off. A whole list can be pinned
  too (under the list's ⋯) and shows what's left. Pins are per phone, come
  back after a restart, and go away if swiped off (Android 14 and later let
  you swipe them).
- **When**: a notification with **Done** at a time, for you or for the
  grown-ups you tick. **All day** means a day with no time: it's there,
  with no sound, from the start of that day.
- **Both**: pinned with a day or time, nothing shows until then; then it
  shows up as the pin and stays. So "call them Monday" can be put in on
  Sunday and stay out of the way until Monday. Moving the time later hides
  it again until then.

Done works from the notification without opening the app. Reminders are set
as alarms on the phone itself, so they go off on time with no connection.
About every 15 minutes (as often as Android allows) the phone also checks the
server in the background, which is how a reminder someone else set for you
arrives while the app is closed. Android asks once for permission to show
notifications.

After the phone restarts, pins and alarms are put back straight away, before
it has even been unlocked (only what to show is kept where Android can read
it that early; the sign-in stays locked until the unlock, so a Done tapped
before then is sent afterwards). Settings → **Reminders and pins on this
phone** shows whether notifications are allowed, when the phone last heard
from the server, and a short list of what the notification side did lately,
which can be sent to the server (`data/notify-logs`) to work out a problem.

How it fits together, for the curious: the phone sends each change as a small
"op" and asks the server for everything after the last change it saw
(`server/src/lists.js`, `app/src/lists/store.js`); the server tells each
phone which notifications it should be showing (`GET /api/notify/plan`), and
the Java code in `app/android/…/notify/` turns that into alarms and
notifications.

## Reminders

The **Reminders** button on a grown-up's home screen, for things that happen
at the same times every day or week: pills in the morning and evening,
vitamins, feeding the dog. A grown-up makes them; nothing is made for you.

Each one has:

- **At**: one or more times of day, and **On**: every day or chosen days.
- **Who gets it**: Everyone, or untick that to pick Adults and/or Kids, or
  untick one of those to pick its people. Groups stay groups, so someone
  added to the family later gets it too.
- **Done**: by default one Done counts for everyone, whoever taps it first.
  Or **Everyone taps their own Done**, and each person is reminded until
  they do.
- **Who can tap Done**: whoever gets it and any grown-up, or just the
  people picked (the same Everyone / Adults / Kids / people picker), say
  only grown-ups for a kid's pills: the kid is still reminded, with no Done
  button. Done only shows (and only counts) once the time has come.
- **If it isn't done**: remind again after 30 minutes and again after an
  hour (both can be changed or turned off), then stop. A notification
  nobody dealt with goes away when the next time comes round.
- **Paused**: kept, but no notifications for now.

The screen also shows today's times: who tapped Done and when, which are not
done yet, and a Done (or Undo) button for each once its time comes, for
those who can tap Done.

On the phones it works like list reminders: a week of times is set as alarms
on the phone, so they go off with no connection. Before reminding again the
phone asks the server whether someone already tapped Done somewhere else, and
if so takes the notification down instead (with no server in reach, it
reminds anyway). A kid's tablet asks once for permission to show
notifications, when the app opens there with a reminder for that kid today.
Times are in the server's time zone.

## Calendar

The **Calendar** button, first on a grown-up's home screen (it says what's
next today, or tomorrow). The calendar fills the screen:

- **The month** at the top, Sunday first, with a coloured dot under a day for
  each thing on it. Tap a day to see from there; the handle under it folds
  the month to one week. ‹ › change month; the month's name goes back to
  today.
- **What's on**, day by day from the day picked: each of the next seven days
  (with "Nothing planned" when that's so), then only the days with something
  on. All-day things come first, then by time. Something that lasts several
  days shows on each of them.
- **Today**, **+ Add** and **Show** along the bottom. Show hides or brings
  back each person's things (things for the whole family always show) and
  holidays, on that device.

Tap something for its details, and to change it, skip just that date, change
just that date (its time, place, name or note), or delete it.

An **event** has a name, who it's for (the whole family, or some of it: its
colour is the first person's), a start and end (a time, or all day; it can
last several days), how it repeats (every day, every week, every 2 weeks,
every month on the same date or on, say, the 2nd Tuesday, or every year;
until a date if you like), where, a note, and **Grown-ups only** to keep it
from the kids. A **birthday** is a name (or someone in the family), the date
(with the year they were born, to show how old they turn), every year, on an
orange card.

**Reminders** go to grown-ups' phones (all of them, or the ones picked):
by default a day before and 30 minutes before; for all-day things and
birthdays, 6 PM the evening before (or 8 AM that day, 2 days or a week
before). Like the other reminders they're alarms on the phone, set a week
ahead, so they go off with no connection; one made too late for a reminder
time doesn't pop up late. Kids see the calendar but get no reminders.

US holidays (New Year's Day, Martin Luther King Jr. Day, Valentine's Day,
Presidents' Day, St. Patrick's Day, Easter, Mother's Day, Memorial Day,
Father's Day, Juneteenth, Independence Day, Labor Day, Columbus Day,
Halloween, Veterans Day, Thanksgiving, Christmas Eve, Christmas and New
Year's Eve) are worked out by the app; nothing is stored for them.

The server works out every date (`server/src/calendar.js`); the app keeps
from a month back to about a year ahead on the device, so the calendar shows
with no server in reach, and fetches older months when you look at them.

## My Day and My Week

A kid's home screen starts with **My Day**: today's things (all day first,
then by time) and that kid's reminders for today in among them, with
**Done** to tick one off, then "Tomorrow: …". It shows the kid's own
things, the whole family's, everyone's birthdays and holidays; never
grown-ups-only ones or other people's. On a tablet held sideways it sits
beside the buttons.

Tap it for **My Week**: the next seven days, today first (outlined), with
"Nothing planned" on empty days and weekends tinted. Both refresh every few
minutes and keep the last answer on the tablet, so they still show with no
server in reach.

## Contacts

The **Contacts** button on a grown-up's home screen: everyone in A to Z
order, with a search box (a name, who they are, or part of a number). Tap
someone for their numbers (📞 Call and 💬 Text), emails, address (🗺️ Map),
birthday and note.

📞 Call opens the phone's dialer with the number in (you still press call);
💬 Text opens the messaging app to them.

A contact has a name, who they are ("Mom's mom", "the kids' dentist"),
**what the kids call them** ("Grandpa": the kids see that instead of the
name, in Contacts and on their calendar), up to six phone numbers and four
emails, an address, a birthday (the year is optional), a note, their Family
Track account if they have one, and **Grown-ups only** to keep them from
the kids.

### Contacts and your phone's contacts (the app)

- **From my phone's contacts** (in the editor) opens the phone's own
  contact picker and fills in the one picked. The name can be changed
  before saving: the phone's "Beautiful Wife" can be "Abby" here.
- Each grown-up's phone can be **linked** to its own contact for someone
  (picked, added, or found), so the same family contact can be linked to
  two grown-ups' phones. Names are never changed either way.
- When Contacts opens, linked contacts are read again and anything the
  phone has that Family Track doesn't (a number, an email, the address,
  the birthday or its year) is filled in here. Nothing is written to the
  phone then; it says how many contacts don't match.
- **🔄 Check with my phone** (for everyone at the top, or one contact):
  fills in what either side is missing, saving to the phone too (numbers
  and emails are added, never taken away); where both have an address or a
  birthday and they differ, it shows both to pick which is right. It also
  looks up family contacts that aren't linked by their numbers (after
  switching phones, or for a contact another grown-up added), to link them,
  and lists linked ones that are no longer on the phone, to unlink.
- **📲 Add to my phone's contacts**: puts a family contact in the phone's
  contacts (its Google account, if it has one, so it goes to Google
  Contacts as usual) under the name you choose, and links it.
- **🔗 They're already on my phone**: pick them in the phone's contacts to
  link them, then it checks the two.

Android asks once to see contacts, and once more to change them. Only
contacts picked, linked or looked up by number are read, and the phone's
contacts are only changed when a grown-up asks.

A contact's **birthday goes on the calendar** by itself, every year. **On
the calendar for**: **Everyone** (the default, with a reminder to grown-ups
the evening before; change reminders on the calendar), **Just the kids**
(their My Day and My Week, no reminders), **Just grown-ups**, or **Not on
the calendar**. Changing the name or birthday on either side changes the
other; deleting the birthday on the calendar leaves the contact without
one, and deleting the contact takes the birthday away. A contact with just
a name and a birthday (a friend of the kids) is fine.

**Kids** get a 📇 button at the top of their home screen to look numbers
up: no calling or texting from there, and no emails, notes or grown-ups-only
contacts.

## Recipes

The **Recipes** button on a grown-up's home screen: every recipe with its
photo, a search that also looks at ingredients and tags, and the most used
tags to tap. Recipes are kept on the device, so they open with no
connection (photos too, once seen).

A recipe shows its photo, prep/cook/total time, ingredients (headings like
"Sauce" included) and numbered steps, then notes, tags and where it's from.
**Serves −/+** (or ½× 1× 2× 3× when it doesn't say how many) changes the
amounts: "1½ cups", "375 g", "2–3 cloves". Tapping an ingredient crosses it
off while getting things out.

**+ Add** or **✏️ Change**: the name, a photo (taken or picked; sent as a
JPEG up to 1600 px, without the camera's location and time), times, how
many it serves, ingredients one per line (a line ending in `:` is a
heading), steps one per line (or a blank line between longer ones), notes,
tags and a web address.

**📥 Import**: paste a recipe page's address. Nearly every recipe site
describes its recipes in a standard way (schema.org), and that's what's
read, photo included. A few big sites turn the server away; add those by
hand. Only addresses out on the internet are fetched, never anything on the
home network. Importing the same page again opens the copy already here.

Photos are kept in the data folder (`data/recipes`).

## Developing

No Node needed on the host. Everything runs in Docker:

```
docker build -t family-track:dev .
docker run --rm -p 8080:8080 -v "$PWD/data:/data" family-track:dev
```

The Android notification code has unit tests that run on the build machine
(on Robolectric, a stand-in for Android); every app build runs them first.
To run only the tests:

```
docker run --rm -v "$PWD:/src:ro" family-track-android test
```
