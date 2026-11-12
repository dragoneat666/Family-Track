import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSettings } from './db.js';
import { PORT, DATA_DIR, TMP_DIR, APK_DIR, today } from './config.js';
import {
  hasAdults, hashPin, validPin, checkAccountPin, checkAnyAdultPin, createDevice,
  optionalDevice, requireAccount, requireAdult, httpError
} from './auth.js';
import {
  LINE_KEY, cleanScript, cleanSettings, starfishScript, starterText, linesUsed, newLineKey
} from './exerciseScript.js';
import {
  buildCharacterModel, processRigged, processDance, processExercise, characterDir, niceName,
  glbObjects, glbAnimations, splitPieces, cleanObjectName
} from './assets.js';
import { pieceName, nextStep, stepLabel } from './steps.js';
import { listsRouter, listPlan, dropPrivateLists } from './lists.js';
import { remindersRouter, reminderPlan } from './reminders.js';
import { calendarRouter, calendarPlan } from './calendar.js';
import { startBackups } from './backup.js';

const VERSION = process.env.APP_VERSION || 'dev';
const app = express();
app.set('trust proxy', false);
app.use(express.json({ limit: '1mb' }));

// The Android app runs from its own origin (http://localhost) and calls this
// server over NetBird, so allow cross-origin requests. Auth is by header token.
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 600 * 1024 * 1024, files: 120 },
  // Dances may also be Mixamo .fbx downloads; everything else is .glb.
  fileFilter: (req, file, cb) => cb(null, (file.fieldname === 'dances' ? /\.(glb|fbx)$/i : /\.glb$/i).test(file.originalname))
});

// ---------- accounts & sign-in ----------

const profileRow = (id) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!p) throw httpError(404, 'No such account');
  return p;
};
const toProfile = (p) => ({
  id: p.id, name: p.name, emoji: p.emoji, color: p.color,
  isParent: !!p.is_parent, isTest: !!p.is_test, needsPin: !!p.is_parent && !p.pin_hash
});
const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, 40) || fallback;

app.get('/api/status', (req, res) => res.json({ setUp: hasAdults(), version: VERSION }));

// Who can sign in here: shown on the "Who are you?" screen.
app.get('/api/accounts', (req, res) => {
  res.json(db.prepare('SELECT * FROM profiles WHERE is_test = 0 ORDER BY is_parent DESC, sort, id').all().map(toProfile));
});

// Brand-new server: create the first grown-up account and sign in.
app.post('/api/setup', (req, res) => {
  if (hasAdults()) throw httpError(409, 'Already set up');
  const pin = validPin(req.body.pin);
  const id = db.prepare('INSERT INTO profiles (name, emoji, color, is_parent, pin_hash) VALUES (?, ?, ?, 1, ?)')
    .run(cleanName(req.body.name, 'Parent'), req.body.emoji || '🧑', req.body.color || '#2ec27e', hashPin(pin)).lastInsertRowid;
  res.json({ token: createDevice(req.body.deviceName, id), account: toProfile(profileRow(id)) });
});

// Sign in (or switch) this device to an account. Rules are in auth.js.
app.post('/api/sign-in', optionalDevice, (req, res) => {
  const target = profileRow(Number(req.body.profileId));
  if (target.is_test) throw httpError(400, 'That account is only for testing');
  if (target.is_parent) {
    if (target.pin_hash) {
      checkAccountPin(target, req.body.pin, req.ip);
    } else {
      // A grown-up account made without a PIN: its owner picks one now.
      db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(hashPin(validPin(req.body.newPin)), target.id);
    }
  } else if (!(req.account?.is_parent && !req.account.is_test)) {
    checkAnyAdultPin(req.body.pin, req.ip);
  }
  let token = null;
  if (req.device) {
    db.prepare("UPDATE devices SET profile_id = ?, last_seen_at = datetime('now') WHERE id = ?").run(target.id, req.device.id);
  } else {
    token = createDevice(req.body.deviceName, target.id);
  }
  res.json({ token, account: toProfile(profileRow(target.id)) });
});

// ---------- Android app download ----------
// Open http://<server>:14200/download on a tablet's browser to install the
// app. No sign-in: the app itself holds nothing private.

function apkInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(APK_DIR, 'version.json'), 'utf8'));
  } catch {
    return null;
  }
}

app.get('/download', (req, res) => {
  const info = apkInfo();
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Family Track for Android</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f7ff;color:#1d2440;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#fff;border-radius:18px;padding:28px;max-width:420px;box-shadow:0 4px 18px rgba(30,50,120,.08)}
h1{color:#4f8cff;margin-top:0}a.btn{display:block;text-align:center;background:#4f8cff;color:#fff;padding:16px;border-radius:14px;font-weight:700;font-size:1.2rem;text-decoration:none}
li{margin:6px 0}</style></head><body><div class="card"><h1>Family Track</h1>
${info ? `<p>Android app, version ${info.versionName}</p><a class="btn" href="download/family-track.apk">Download the app</a>
<ol><li>Tap the button, then open the downloaded file.</li><li>If Android asks, allow installing apps from this browser.</li>
<li>Open Family Track and enter this server's address: <b>${escapeHtml(`${req.protocol}://${req.get('host')}`)}</b></li></ol>`
    : '<p>The Android app hasn\'t been built yet.</p>'}
</div></body></html>`);
});

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

app.get('/download/family-track.apk', (req, res) => {
  const file = path.join(APK_DIR, 'family-track.apk');
  if (!fs.existsSync(file)) throw httpError(404, 'The app has not been built yet');
  res.set('Cache-Control', 'no-store');
  res.type('application/vnd.android.package-archive').download(file, 'family-track.apk');
});

app.get('/api/app/latest', (req, res) => res.json(apkInfo() || {}));

// Kept for app builds from before accounts existed, so they can still load
// their first screen and show the "update available" banner.
app.get('/api/profiles', optionalDevice, (req, res) => {
  if (!req.device) throw httpError(401, 'This device is not signed in');
  res.json(db.prepare('SELECT * FROM profiles WHERE is_test = 0 AND is_parent = 0 ORDER BY sort, id').all().map(toProfile));
});

app.use('/api', requireAccount);

app.get('/api/me', (req, res) => res.json({ account: toProfile(req.account), deviceName: req.device.name }));

app.put('/api/me/device', (req, res) => {
  db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(cleanName(req.body.name, req.device.name), req.device.id);
  res.json({ ok: true });
});

app.put('/api/me/pin', requireAdult, (req, res) => {
  if (req.account.pin_hash) checkAccountPin(req.account, req.body.currentPin, req.ip);
  db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(hashPin(validPin(req.body.newPin)), req.account.id);
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => res.json(getSettings()));

// ---------- lists, reminders, calendar & notifications ----------

app.use('/api/lists', requireAdult, listsRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/calendar', calendarRouter);

// Everything this phone should be showing or have scheduled as Android
// notifications for whoever is signed in on it. The app fetches it whenever
// something changes and every so often in the background.
app.get('/api/notify/plan', (req, res) => res.json({
  entries: [...listPlan(req.account, req.device), ...reminderPlan(req.account), ...calendarPlan(req.account)]
}));

// ---------- kid side ----------

// Kids only see their own things; grown-ups can look at any kid.
app.use('/api/kids/:id', (req, res, next) => {
  if (req.account.is_parent || req.account.id === Number(req.params.id)) return next();
  res.status(403).json({ error: "That's someone else's" });
});

function activeCharacter(profileId) {
  return db.prepare(`
    SELECT c.*, pc.started_at FROM profile_characters pc
    JOIN characters c ON c.id = pc.character_id
    WHERE pc.profile_id = ? AND pc.active = 1`).get(profileId);
}

const PUZZLE_LEVELS = ['easy', 'medium', 'hard'];

function kidState(profileId) {
  const row = profileRow(profileId);
  const profile = toProfile(row);
  const puzzleLevel = PUZZLE_LEVELS.includes(row.puzzle_level) ? row.puzzle_level : 'easy';
  const brushesToday = db.prepare(
    'SELECT COUNT(*) AS n FROM brush_sessions WHERE profile_id = ? AND local_date = ? AND completed = 1').get(profileId, today()).n;
  const brushedToday = brushesToday > 0;
  const c = activeCharacter(profileId);
  if (!c || c.status !== 'ready') {
    return { profile, brushedToday, brushesToday, puzzleLevel, character: c ? { id: c.id, name: c.name, status: c.status } : null };
  }
  return { profile, brushedToday, brushesToday, puzzleLevel, character: kidCharacter(profileId, c, profile.isTest) };
}

// One kid's progress on one (ready) character: their pieces, dances, and
// when the next piece can come (the wait is per kid, whatever they build).
function kidCharacter(profileId, c, isTest = !!profileRow(profileId).is_test) {
  const pieces = db.prepare(`
    SELECT p.id, p.name, p.node_name AS nodeName, p.reveal, u.unlocked_on AS unlockedOn, u.placed_at AS placedAt
    FROM pieces p LEFT JOIN unlocks u ON u.piece_id = p.id AND u.profile_id = ?
    WHERE p.character_id = ? ORDER BY p.sort, p.id`).all(profileId, c.id);
  const dances = c.has_rigged
    ? db.prepare("SELECT id, name FROM dances WHERE character_id = ? AND status = 'ready' ORDER BY id").all(c.id)
    : [];
  const nextPiece = stepLabel(nextStep(pieces.map((p) => ({ ...p, unlocked: !!p.unlockedOn, reveal: !!p.reveal })), c.kind));
  const settings = getSettings();
  const waitUntil = nextPiece && !isTest ? nextPieceAt(profileId, c, settings) : null;
  return {
    id: c.id, name: c.name, kind: c.kind, status: c.status, version: c.version,
    hasRigged: !!c.has_rigged,
    pieces: pieces.map((p) => ({
      id: p.id, name: p.name, nodeName: p.nodeName, unlocked: !!p.unlockedOn, placed: !!p.placedAt,
      // Dress up only: revealed (rub away the clouds), not placed.
      reveal: c.kind === 'dress' && !!p.reveal
    })),
    dances,
    // Set while a recent piece or brush means the next brush can't earn one
    // yet. unlockedToday is for app builds before 0.1.6.
    nextPieceAt: waitUntil,
    unlockedToday: !!waitUntil,
    hoursBetween: settings.hoursBetween,
    nextPiece,
    complete: pieces.length > 0 && pieces.every((p) => p.placedAt)
  };
}

// Every character a kid can build or dress up (not exercise-only partners).
const pickable = (c) => c && c.status === 'ready' && c.kind !== 'partner';

// Make a character the one a kid's brushing earns pieces for. Their pieces on
// every character are kept, so they can switch back and carry on.
function setActiveCharacter(profileId, characterId) {
  const current = activeCharacter(profileId);
  if (current?.id === characterId) return;
  db.transaction(() => {
    db.prepare('UPDATE profile_characters SET active = 0 WHERE profile_id = ?').run(profileId);
    if (characterId) {
      db.prepare(`INSERT INTO profile_characters (profile_id, character_id, active) VALUES (?, ?, 1)
        ON CONFLICT(profile_id, character_id) DO UPDATE SET active = 1, started_at = datetime('now')`).run(profileId, characterId);
    }
  })();
}

// The kid's Characters screen: all of them, with their progress on each.
app.get('/api/kids/:id/characters', (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const activeId = activeCharacter(profileId)?.id ?? null;
  const rows = db.prepare('SELECT * FROM characters ORDER BY id').all().filter(pickable);
  res.json({ activeId, characters: rows.map((c) => ({ ...kidCharacter(profileId, c), active: c.id === activeId })) });
});

app.get('/api/kids/:id/characters/:characterId', (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const c = characterRow(Number(req.params.characterId));
  if (!pickable(c)) throw httpError(404, 'That one isn’t ready');
  const row = profileRow(profileId);
  res.json({
    character: { ...kidCharacter(profileId, c), active: activeCharacter(profileId)?.id === c.id },
    puzzleLevel: PUZZLE_LEVELS.includes(row.puzzle_level) ? row.puzzle_level : 'easy'
  });
});

// Kids pick their own character (grown-ups can still set it in Accounts).
app.put('/api/kids/:id/character', (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const c = characterRow(Number(req.body?.characterId));
  if (!pickable(c)) throw httpError(400, 'Pick a character that’s ready');
  setActiveCharacter(profileId, c.id);
  res.json(kidState(profileId));
});

app.get('/api/kids/:id/state', (req, res) => res.json(kidState(Number(req.params.id))));

// A kid's own brushing settings from tracking checks (see app brush/tuning.js).
const TUNING_SPOTS = ['standing', 'sitting'];
function brushTuning(row) {
  const t = safeJson(row.brush_tuning);
  const out = {};
  for (const spot of TUNING_SPOTS) {
    const s = t[spot];
    if (s && Number(s.threshold) > 0) out[spot] = { threshold: Number(s.threshold), d: Number(s.d) || null, at: s.at || null };
  }
  return out;
}
app.get('/api/kids/:id/brush-tuning', (req, res) => res.json(brushTuning(profileRow(Number(req.params.id)))));

// Kids change this themselves in Settings (no PIN).
app.put('/api/kids/:id/puzzle', (req, res) => {
  const level = String(req.body?.level ?? '');
  if (!PUZZLE_LEVELS.includes(level)) return res.status(400).json({ error: 'Pick easy, medium or hard' });
  const id = Number(req.params.id);
  if (!profileRow(id) || profileRow(id).is_parent) return res.status(404).json({ error: 'No such kid' });
  db.prepare('UPDATE profiles SET puzzle_level = ? WHERE id = ?').run(level, id);
  res.json({ puzzleLevel: level });
});

app.post('/api/kids/:id/brush', (req, res) => {
  const profileId = Number(req.params.id);
  const isTest = !!profileRow(profileId).is_test;
  const settings = getSettings();
  const secondsBrushed = Math.max(0, Math.round(Number(req.body.secondsBrushed) || 0));
  const secondsPaused = Math.max(0, Math.round(Number(req.body.secondsPaused) || 0));
  const needed = settings.mainSeconds + settings.frontSeconds;
  const completed = !!req.body.completed && secondsBrushed >= needed - 2;
  const date = today();

  let unlockedPiece = null;
  db.transaction(() => {
    const session = db.prepare(`
      INSERT INTO brush_sessions (profile_id, local_date, seconds_brushed, seconds_paused, completed)
      VALUES (?, ?, ?, ?, ?)`).run(profileId, date, secondsBrushed, secondsPaused, completed ? 1 : 0);
    if (!completed) return;
    const c = activeCharacter(profileId);
    if (!c || c.status !== 'ready') return;
    const step = nextLockedStep(profileId, c);
    if (!step.length) return;
    // The test kid gets a piece every time, so parents can run through fast.
    if (!isTest && brushProgress(profileId, c, settings).counted < settings.brushesPerPiece) return;
    unlockStep(profileId, step, date);
    db.prepare('UPDATE brush_sessions SET unlocked_piece_id = ? WHERE id = ?').run(step[0].id, session.lastInsertRowid);
    unlockedPiece = { id: step[0].id, name: stepLabel(step), reveal: c.kind === 'dress' && !!step[0].reveal };
  })();

  res.json({ completed, unlockedPiece, state: kidState(profileId) });
});

// Finished brushes that count toward the next piece: walk the brushes since
// the kid's last piece of any character (or, before their first, since this
// character was picked) and count each one that's at least hoursBetween after
// the previous one that counted. Any character: kids pick their own now, and
// switching mustn't earn a second piece inside the wait. A piece given by a
// grown-up counts as a brush. Returns the count and when the last counted
// brush (or piece) happened.
const sqlTime = (s) => Date.parse(s.replace(' ', 'T') + 'Z');
function brushProgress(profileId, c, settings) {
  const gapMs = settings.hoursBetween * 3600e3;
  const last = db.prepare(`
    SELECT s.id, s.finished_at FROM brush_sessions s
    JOIN unlocks u ON u.piece_id = s.unlocked_piece_id AND u.profile_id = s.profile_id
    WHERE s.profile_id = ? ORDER BY s.id DESC LIMIT 1`).get(profileId);
  const sessions = last
    ? db.prepare('SELECT finished_at FROM brush_sessions WHERE profile_id = ? AND completed = 1 AND id > ? ORDER BY id').all(profileId, last.id)
    // (No piece yet: count from when they started building. A character row
    // from the full list has no started_at of its own; the wait is per kid.)
    : db.prepare('SELECT finished_at FROM brush_sessions WHERE profile_id = ? AND completed = 1 AND finished_at >= ? ORDER BY id')
      .all(profileId, c.started_at ?? activeCharacter(profileId)?.started_at ?? '0');
  let anchor = last ? sqlTime(last.finished_at) : null;
  let counted = 0;
  for (const s of sessions) {
    const t = sqlTime(s.finished_at);
    if (anchor == null || t - anchor >= gapMs) {
      counted++;
      anchor = t;
    }
  }
  return { counted, anchor };
}

// When the next finished brush could earn a piece, if that's in the future
// (a piece or a counted brush happened less than hoursBetween ago). ISO time.
function nextPieceAt(profileId, c, settings) {
  const { counted, anchor } = brushProgress(profileId, c, settings);
  if (anchor == null || counted + 1 < settings.brushesPerPiece) return null;
  const at = anchor + settings.hoursBetween * 3600e3;
  return at > Date.now() ? new Date(at).toISOString() : null;
}

// The pieces the next counted brush unlocks: one piece, or in dress up a run
// of body parts to reveal together (steps.js).
function nextLockedStep(profileId, c) {
  const pieces = db.prepare(`
    SELECT p.*, EXISTS (SELECT 1 FROM unlocks u WHERE u.piece_id = p.id AND u.profile_id = ?) AS unlocked
    FROM pieces p WHERE p.character_id = ? ORDER BY p.sort, p.id`).all(profileId, c.id);
  return nextStep(pieces.map((p) => ({ ...p, unlocked: !!p.unlocked, reveal: !!p.reveal })), c.kind);
}

function unlockStep(profileId, step, date) {
  for (const p of step) db.prepare('INSERT INTO unlocks (profile_id, piece_id, unlocked_on) VALUES (?, ?, ?)').run(profileId, p.id, date);
}

// A grown-up gives the next piece by hand: the kid brushed, but the camera
// didn't count it. Recorded as a finished brush marked "given by a grown-up",
// so it counts as a brush and the usual hours-between wait starts from now.
app.post('/api/parent/profiles/:id/give-piece', requireAdult, (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const c = activeCharacter(profileId);
  if (!c || c.status !== 'ready') throw httpError(400, "They aren't building anything yet");
  const step = nextLockedStep(profileId, c);
  if (!step.length) throw httpError(400, `They already have every piece of ${c.name}`);
  const settings = getSettings();
  const date = today();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO brush_sessions (profile_id, local_date, seconds_brushed, seconds_paused, completed, manual, unlocked_piece_id)
      VALUES (?, ?, ?, 0, 1, 1, ?)`).run(profileId, date, settings.mainSeconds + settings.frontSeconds, step[0].id);
    unlockStep(profileId, step, date);
  })();
  res.json({ piece: { id: step[0].id, name: stepLabel(step) }, character: c.name });
});

app.post('/api/kids/:id/place', (req, res) => {
  const profileId = Number(req.params.id);
  const r = db.prepare("UPDATE unlocks SET placed_at = COALESCE(placed_at, datetime('now')) WHERE profile_id = ? AND piece_id = ?")
    .run(profileId, Number(req.body.pieceId));
  if (!r.changes) throw httpError(400, 'That piece is not unlocked yet');
  // character = the one this piece belongs to (the kid may be finishing one
  // that isn't their active character).
  const c = db.prepare('SELECT c.* FROM pieces p JOIN characters c ON c.id = p.character_id WHERE p.id = ?').get(Number(req.body.pieceId));
  res.json({ ...kidState(profileId), character: kidCharacter(profileId, c) });
});

// ---------- 3D files ----------

function sendAsset(res, file) {
  if (!fs.existsSync(file)) throw httpError(404, 'File not found');
  // URLs carry ?v=<version>, so a changed model gets a new URL.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('model/gltf-binary').sendFile(file);
}
app.get('/api/characters/:id/build.glb', (req, res) => sendAsset(res, path.join(characterDir(Number(req.params.id)), 'build.glb')));
app.get('/api/characters/:id/rigged.glb', (req, res) => sendAsset(res, path.join(characterDir(Number(req.params.id)), 'rigged.glb')));
app.get('/api/characters/:id/dances/:danceId.glb', (req, res) =>
  sendAsset(res, path.join(characterDir(Number(req.params.id)), 'dances', `${Number(req.params.danceId)}.glb`)));

// ---------- exercises ----------
// Exercise partners: a character with an exercise model (its own .glb with
// the exercise animations) acts out its exercises: scripts a grown-up edits
// scene by scene (exerciseScript.js), with lines from its voice library
// played through its voice effect (robot, radio…). Recordings arrive as small
// WAV files, already trimmed and evened out by the app. They're kept in
// /data/voices (backed up), not with the 3D files (which can just be uploaded
// again).

const voiceDir = (id) => path.join(DATA_DIR, 'voices', String(id));
const EFFECTS = ['none', 'robot', 'radio', 'deep', 'high', 'echo'];
const safeJson = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const cleanWords = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

// The voice library, in the order the lines were added.
function voiceLines(characterId) {
  return db.prepare('SELECT key, text, version, seconds FROM voice_lines WHERE character_id = ? ORDER BY rowid').all(characterId)
    .map((l) => ({ key: l.key, text: l.text, version: l.version, seconds: l.seconds }));
}

function exercisesOf(characterId) {
  return db.prepare('SELECT * FROM exercises WHERE character_id = ? ORDER BY sort, id').all(characterId)
    .map((e) => ({ id: e.id, slug: e.slug, name: e.name, emoji: e.emoji, script: cleanScript(safeJson(e.script)) }));
}

// What the app needs to show a partner, hear them and run their exercises.
// lines/uses/marks are still sent for app builds before editable exercises.
function partnerDetail(c) {
  const ex = safeJson(c.exercise);
  const voice = voiceLines(c.id);
  return {
    id: c.id, name: c.name, kind: c.kind, effect: c.voice_effect,
    version: ex.version ?? 0, animations: ex.animations ?? [],
    voice, exercises: exercisesOf(c.id),
    lines: Object.fromEntries(voice.filter((l) => l.version).map((l) => [l.key, { version: l.version, seconds: l.seconds }])),
    uses: ex.uses ?? {}, marks: ex.marks ?? {}
  };
}

// Partners a kid can pick: characters with a ready exercise model that are
// open to everyone or that this kid has finished building.
function partnersFor(profileId) {
  return db.prepare(`
    SELECT c.* FROM characters c
    WHERE json_extract(c.exercise, '$.status') = 'ready' AND (
      c.partner_for_all = 1 OR (
        EXISTS (SELECT 1 FROM pieces p WHERE p.character_id = c.id)
        AND NOT EXISTS (
          SELECT 1 FROM pieces p LEFT JOIN unlocks u ON u.piece_id = p.id AND u.profile_id = ?
          WHERE p.character_id = c.id AND u.placed_at IS NULL
        )
      )
    ) ORDER BY c.id`).all(profileId).map(partnerDetail);
}

app.get('/api/characters/:id/exercise.glb', (req, res) => sendAsset(res, path.join(characterDir(Number(req.params.id)), 'exercise.glb')));

app.get('/api/characters/:id/lines/:line.wav', (req, res) => {
  const line = String(req.params.line);
  if (!LINE_KEY.test(line)) throw httpError(404, 'File not found');
  const file = path.join(voiceDir(Number(req.params.id)), `${line}.wav`);
  if (!fs.existsSync(file)) throw httpError(404, 'File not found');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('audio/wav').sendFile(file);
});

// App builds before partners (0.1.9 and 0.1.10) ask for coaches.
app.get('/api/coaches', (req, res) => res.json([]));

// A kid's partner, the partners they can pick, and their exercise settings
// (hold times, speeds…). Kids may change their own; grown-ups any kid's.
// No partner picked (or it's no longer theirs) = the first one they have.
function exerciseState(p) {
  const partners = partnersFor(p.id);
  const partnerId = partners.find((x) => x.id === p.partner_id)?.id ?? partners[0]?.id ?? null;
  return { partnerId, partners, settings: safeJson(p.exercise_settings) };
}

app.get('/api/kids/:id/exercises', (req, res) => res.json(exerciseState(profileRow(Number(req.params.id)))));

app.put('/api/kids/:id/exercises', (req, res) => {
  const p = profileRow(Number(req.params.id));
  const b = req.body || {};
  if ('partnerId' in b) {
    const id = Number(b.partnerId);
    if (!partnersFor(p.id).some((x) => x.id === id)) throw httpError(400, "That partner isn't unlocked yet");
    db.prepare('UPDATE profiles SET partner_id = ? WHERE id = ?').run(id, p.id);
  }
  if (b.settings && typeof b.settings === 'object') {
    // { wait, hold, rounds } per exercise (by its slug, shared by copies of
    // it, so switching partners keeps them), merged into what's there.
    const settings = safeJson(p.exercise_settings);
    for (const [key, value] of Object.entries(b.settings)) {
      if (LINE_KEY.test(key) && value && typeof value === 'object') settings[key] = cleanSettings({ ...settings[key], ...value });
    }
    const json = JSON.stringify(settings);
    if (json.length > 20000) throw httpError(400, 'Too many settings');
    db.prepare('UPDATE profiles SET exercise_settings = ? WHERE id = ?').run(json, p.id);
  }
  res.json(exerciseState(profileRow(p.id)));
});

// ---------- grown-up side ----------

app.use('/api/parent', requireAdult);
const parent = express.Router();
app.use('/api/parent', parent);

// Home for grown-ups: each kid's brushing today and build progress.
parent.get('/overview', (req, res) => {
  const kids = db.prepare('SELECT * FROM profiles WHERE is_parent = 0 AND is_test = 0 ORDER BY sort, id').all();
  res.json(kids.map((k) => {
    const s = kidState(k.id);
    const last = db.prepare('SELECT local_date FROM brush_sessions WHERE profile_id = ? AND completed = 1 ORDER BY id DESC LIMIT 1').get(k.id);
    const ch = s.character;
    return {
      profile: s.profile,
      brushedToday: s.brushedToday,
      brushesToday: s.brushesToday,
      lastBrushed: last?.local_date ?? null,
      character: ch?.status === 'ready'
        ? {
          name: ch.name, placed: ch.pieces.filter((p) => p.placed).length, unlocked: ch.pieces.filter((p) => p.unlocked).length,
          total: ch.pieces.length, nextPiece: ch.nextPiece, nextPieceAt: ch.nextPieceAt
        }
        : ch ? { name: ch.name, status: ch.status } : null
    };
  }));
});

// Numbers from a tracking check (no pictures), kept for tuning the
// brushing detection. Only the newest 30 are kept.
parent.post('/tracking-log', (req, res) => {
  const dir = path.join(DATA_DIR, 'tracking-logs');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${req.account.id}.json`;
  const { sensitivity, userAgent, summary, samples } = req.body;
  // Who did the check and where (only ids and the spot; names stay out of the logs).
  const kidId = Number(req.body.kidId) || null;
  const spot = TUNING_SPOTS.includes(req.body.spot) ? req.body.spot : null;
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ sensitivity, userAgent, kidId, spot, summary, samples }));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, -30)) fs.rmSync(path.join(dir, old), { force: true });
  res.json({ ok: true });
});

// What the notification side of a phone did lately (Settings -> "Send to the
// server"), kept for working out why a reminder or pin misbehaved.
parent.post('/notify-log', (req, res) => {
  const dir = path.join(DATA_DIR, 'notify-logs');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-device${req.device.id}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ deviceId: req.device.id, accountId: req.account.id, userAgent: req.body.userAgent, status: req.body.status }, null, 1));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, -30)) fs.rmSync(path.join(dir, old), { force: true });
  res.json({ ok: true });
});

parent.put('/settings', (req, res) => {
  const b = req.body;
  const patch = {};
  if (b.mainSeconds != null) patch.mainSeconds = clampInt(b.mainSeconds, 30, 600);
  if (b.frontSeconds != null) patch.frontSeconds = clampInt(b.frontSeconds, 0, 120);
  if (b.brushesPerPiece != null) patch.brushesPerPiece = clampInt(b.brushesPerPiece, 1, 28);
  if (b.hoursBetween != null) patch.hoursBetween = clampInt(b.hoursBetween, 0, 24);
  if (['low', 'normal', 'high'].includes(b.sensitivity)) patch.sensitivity = b.sensitivity;
  if (b.showTrackingInfo != null) patch.showTrackingInfo = !!b.showTrackingInfo;
  res.json(setSettings(patch));
});
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

// Accounts (stored as "profiles")

parent.get('/profiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM profiles WHERE is_test = 0 ORDER BY is_parent DESC, sort, id').all();
  res.json(rows.map((p) => {
    const c = activeCharacter(p.id);
    return { ...toProfile(p), characterId: c?.id ?? null, isMe: p.id === req.account.id, brushTuning: brushTuning(p) };
  }));
});

// Save (threshold > 0) or clear (threshold null) a kid's setting for one spot.
parent.put('/profiles/:id/brush-tuning/:spot', (req, res) => {
  const p = profileRow(Number(req.params.id));
  const spot = req.params.spot;
  if (p.is_parent || !TUNING_SPOTS.includes(spot)) throw httpError(400, 'Pick a kid and standing or sitting');
  const t = brushTuning(p);
  const threshold = Number(req.body?.threshold);
  if (req.body?.threshold == null) delete t[spot];
  else if (Number.isFinite(threshold) && threshold > 0) {
    const d = Number(req.body.d);
    t[spot] = {
      threshold: Math.round(Math.min(20, Math.max(1.5, threshold)) * 100) / 100,
      d: Number.isFinite(d) && d > 0 ? Math.round(Math.min(1000, d) * 10) / 10 : null,
      at: new Date().toISOString()
    };
  } else throw httpError(400, 'Bad setting');
  db.prepare('UPDATE profiles SET brush_tuning = ? WHERE id = ?').run(Object.keys(t).length ? JSON.stringify(t) : null, p.id);
  res.json(t);
});

// A grown-up account can get a PIN now, or none: then its owner picks one
// the first time they sign in.
parent.post('/profiles', (req, res) => {
  const { name, emoji, color, isParent, pin } = req.body;
  if (!String(name || '').trim()) throw httpError(400, 'Name is required');
  const pinHash = isParent && pin ? hashPin(validPin(pin)) : null;
  const r = db.prepare('INSERT INTO profiles (name, emoji, color, is_parent, pin_hash) VALUES (?, ?, ?, ?, ?)')
    .run(cleanName(name, 'Someone'), emoji || '🙂', color || '#4f8cff', isParent ? 1 : 0, pinHash);
  res.json(toProfile(profileRow(r.lastInsertRowid)));
});

parent.put('/profiles/:id', (req, res) => {
  const p = profileRow(Number(req.params.id));
  const b = req.body;
  db.prepare('UPDATE profiles SET name = ?, emoji = ?, color = ? WHERE id = ?')
    .run(cleanName(b.name, p.name), b.emoji ?? p.emoji, b.color ?? p.color, p.id);
  res.json(toProfile(profileRow(p.id)));
});

// Forgotten PIN: clear it, and the owner picks a new one at next sign-in.
parent.post('/profiles/:id/reset-pin', (req, res) => {
  const p = profileRow(Number(req.params.id));
  if (!p.is_parent) throw httpError(400, 'Kid accounts have no PIN');
  db.prepare('UPDATE profiles SET pin_hash = NULL WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

parent.delete('/profiles/:id', (req, res) => {
  const p = profileRow(Number(req.params.id));
  if (p.id === req.account.id) throw httpError(400, "You can't delete the account you're signed in with");
  dropPrivateLists(p.id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// The hidden "Test kid" grown-ups act as to try the real kid screens. It
// keeps its progress between tries (per character, like a real kid) until
// it's reset, and never shows up in lists or history.
function testKid() {
  let p = db.prepare('SELECT * FROM profiles WHERE is_test = 1').get();
  if (!p) {
    const id = db.prepare("INSERT INTO profiles (name, emoji, color, is_test) VALUES ('Test kid', '🧪', '#9b5de5', 1)").run().lastInsertRowid;
    p = profileRow(id);
  }
  return p;
}

parent.get('/test-kid', (req, res) => {
  const p = testKid();
  res.json(kidState(p.id));
});

// Start acting as the test kid, building this character (keeps any progress on it).
parent.post('/test-kid', (req, res) => {
  const characterId = Number(req.body.characterId);
  if (characterRow(characterId).kind === 'partner') throw httpError(400, "That one is only an exercise partner; there's nothing to build");
  const p = testKid();
  db.transaction(() => {
    db.prepare('UPDATE profile_characters SET active = 0 WHERE profile_id = ?').run(p.id);
    db.prepare(`INSERT INTO profile_characters (profile_id, character_id, active) VALUES (?, ?, 1)
      ON CONFLICT(profile_id, character_id) DO UPDATE SET active = 1`).run(p.id, characterId);
  })();
  res.json(toProfile(p));
});

parent.post('/test-kid/reset', (req, res) => {
  const p = testKid();
  db.transaction(() => {
    db.prepare('DELETE FROM unlocks WHERE profile_id = ?').run(p.id);
    db.prepare('DELETE FROM brush_sessions WHERE profile_id = ?').run(p.id);
    db.prepare("UPDATE profile_characters SET started_at = datetime('now') WHERE profile_id = ?").run(p.id);
  })();
  res.json(kidState(p.id));
});

parent.put('/profiles/:id/character', (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const characterId = req.body.characterId ? Number(req.body.characterId) : null;
  if (characterId && characterRow(characterId).kind === 'partner') throw httpError(400, "That one is only an exercise partner; there's nothing to build");
  setActiveCharacter(profileId, characterId);
  res.json({ ok: true });
});

parent.delete('/profiles/:id/progress/:characterId', (req, res) => {
  const profileId = Number(req.params.id);
  const characterId = Number(req.params.characterId);
  db.transaction(() => {
    db.prepare('DELETE FROM unlocks WHERE profile_id = ? AND piece_id IN (SELECT id FROM pieces WHERE character_id = ?)').run(profileId, characterId);
    db.prepare("UPDATE profile_characters SET started_at = datetime('now') WHERE profile_id = ? AND character_id = ?").run(profileId, characterId);
  })();
  res.json({ ok: true });
});

// Characters

function characterDetail(c) {
  const ex = c.exercise ? safeJson(c.exercise) : null;
  return {
    id: c.id, name: c.name, kind: c.kind, status: c.status, error: c.error, hasRigged: !!c.has_rigged, version: c.version,
    pieces: db.prepare('SELECT id, name, node_name AS nodeName, reveal FROM pieces WHERE character_id = ? ORDER BY sort, id').all(c.id)
      .map((p) => ({ ...p, reveal: !!p.reveal })),
    dances: db.prepare('SELECT id, name, status, error FROM dances WHERE character_id = ? ORDER BY id').all(c.id),
    partner: {
      forAll: !!c.partner_for_all,
      effect: c.voice_effect,
      voice: voiceLines(c.id),
      exercise: ex && { status: ex.status, error: ex.error ?? null, version: ex.version ?? 0, animations: ex.animations ?? [] },
      canStarfish: !!(ex && starfishScript(ex))
    },
    exercises: exercisesOf(c.id)
  };
}
const characterRow = (id) => {
  const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  if (!c) throw httpError(404, 'No such character');
  return c;
};

parent.get('/characters', (req, res) => {
  res.json(db.prepare('SELECT * FROM characters ORDER BY id').all().map(characterDetail));
});

const characterUpload = upload.fields([
  { name: 'pieces', maxCount: 60 }, { name: 'rigged', maxCount: 1 }, { name: 'dances', maxCount: 60 }, { name: 'exercise', maxCount: 1 }
]);
const KINDS = ['build', 'dress', 'partner'];

parent.post('/characters', characterUpload, (req, res) => {
  const files = req.files || {};
  const pieces = files.pieces || [];
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'build';
  if (!String(req.body.name || '').trim()) { cleanup(req); throw httpError(400, 'Name is required'); }
  if (kind === 'partner' && !files.exercise?.[0]) { cleanup(req); throw httpError(400, 'Add the exercise model (.glb)'); }
  if (kind !== 'partner' && !pieces.length) { cleanup(req); throw httpError(400, 'Add at least one piece (.glb)'); }
  // A partner-only character has nothing to build, so it's ready straight away.
  const id = db.prepare('INSERT INTO characters (name, kind, status, partner_for_all) VALUES (?, ?, ?, ?)')
    .run(String(req.body.name).trim().slice(0, 60), kind, kind === 'partner' ? 'ready' : 'processing', kind === 'partner' ? 1 : 0).lastInsertRowid;
  const jobs = [];
  if (kind !== 'partner') {
    jobs.push(...addPieces(id, pieces), () => rebuild(id));
  } else {
    cleanupFiles(pieces);
  }
  if (files.rigged?.[0]) jobs.push(...riggedJobs(id, files.rigged[0]));
  jobs.push(...danceJobs(id, files.dances || []));
  if (files.exercise?.[0]) jobs.push(...exerciseJobs(id, files.exercise[0]));
  enqueue(jobs);
  res.status(202).json(characterDetail(characterRow(id)));
});

parent.put('/characters/:id', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const b = req.body;
  db.transaction(() => {
    // A partner-only character stays one (it has no pieces to build).
    const kind = c.kind !== 'partner' && (b.kind === 'dress' || b.kind === 'build') ? b.kind : c.kind;
    db.prepare('UPDATE characters SET name = ?, kind = ? WHERE id = ?').run(
      String(b.name ?? c.name).trim().slice(0, 60) || c.name, kind, c.id);
    // pieces: full list in the new unlock order, with names and which are
    // body parts (dress up reveals those instead of placing them)
    (b.pieces || []).forEach((p, i) => {
      const named = pieceName(String(p.name || '').trim().slice(0, 60) || 'Piece');
      db.prepare('UPDATE pieces SET name = ?, sort = ?, reveal = ? WHERE id = ? AND character_id = ?')
        .run(named.name, i, named.reveal || p.reveal ? 1 : 0, Number(p.id), c.id);
    });
  })();
  res.json(characterDetail(characterRow(c.id)));
});

parent.delete('/characters/:id', (req, res) => {
  const c = characterRow(Number(req.params.id));
  db.prepare('DELETE FROM characters WHERE id = ?').run(c.id);
  fs.rmSync(characterDir(c.id), { recursive: true, force: true });
  fs.rmSync(voiceDir(c.id), { recursive: true, force: true });
  res.json({ ok: true });
});

// Exercise partner: the exercise model, what each animation is for, pause
// marks, open to everyone or not, and the voice.

parent.post('/characters/:id/exercise', upload.single('exercise'), (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (!req.file) throw httpError(400, 'No .glb file received');
  enqueue(exerciseJobs(c.id, req.file));
  res.status(202).json(characterDetail(characterRow(c.id)));
});

parent.put('/characters/:id/partner', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const b = req.body || {};
  if ('forAll' in b) db.prepare('UPDATE characters SET partner_for_all = ? WHERE id = ?').run(b.forAll ? 1 : 0, c.id);
  if (EFFECTS.includes(b.effect)) db.prepare('UPDATE characters SET voice_effect = ? WHERE id = ?').run(b.effect, c.id);
  res.json(characterDetail(characterRow(c.id)));
});

// Exercises

const exerciseRow = (id) => {
  const e = db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
  if (!e) throw httpError(404, 'No such exercise');
  return e;
};
const addVoiceLine = db.prepare(`INSERT INTO voice_lines (character_id, key, text) VALUES (?, ?, ?)
  ON CONFLICT(character_id, key) DO NOTHING`);

// Adds an exercise: an empty one, Hug & Starfish made from this character's
// animations, or a copy of another one (from any character). A copy keeps its
// slug, so each kid's hold time and rounds carry over, and brings the words of
// its voice lines along (to record again in this character's voice).
function addExercise(characterId, { name, emoji, copyFrom, starter }) {
  const c = characterRow(characterId);
  let script;
  let slug = Math.random().toString(36).slice(2, 10);
  let words = (key) => starterText(key);
  if (copyFrom) {
    const src = exerciseRow(Number(copyFrom));
    script = cleanScript(safeJson(src.script));
    slug = src.slug;
    name ||= src.name;
    emoji ||= src.emoji;
    const theirs = new Map(voiceLines(src.character_id).map((l) => [l.key, l.text]));
    words = (key) => theirs.get(key) ?? starterText(key);
  } else if (starter === 'starfish') {
    script = starfishScript(safeJson(c.exercise));
    if (!script) throw httpError(400, 'This character has no "get into position" animation (like Starfish_Sit_Up.L)');
    slug = 'starfish';
    name ||= 'Hug & Starfish';
    emoji ||= '⭐';
  } else {
    script = cleanScript({ scenes: [{ name: 'Start', words: '', then: 'wait' }] });
  }
  return db.transaction(() => {
    for (const key of linesUsed(script)) addVoiceLine.run(c.id, key, words(key));
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM exercises WHERE character_id = ?').get(c.id).n;
    return db.prepare('INSERT INTO exercises (character_id, slug, name, emoji, sort, script) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, slug, cleanWords(name).slice(0, 40) || 'New exercise', String(emoji || '🏃').slice(0, 8), sort, JSON.stringify(script)).lastInsertRowid;
  })();
}

parent.get('/exercises', (req, res) => {
  res.json(db.prepare('SELECT e.id, e.name, e.emoji, e.character_id AS characterId, c.name AS characterName FROM exercises e JOIN characters c ON c.id = e.character_id ORDER BY c.id, e.sort, e.id').all());
});

parent.post('/characters/:id/exercises', (req, res) => {
  const b = req.body || {};
  const id = addExercise(Number(req.params.id), { name: b.name, emoji: b.emoji, copyFrom: b.copyFrom, starter: b.starter });
  res.status(201).json({ id, character: characterDetail(characterRow(Number(req.params.id))) });
});

parent.put('/exercises/:id', (req, res) => {
  const e = exerciseRow(Number(req.params.id));
  const b = req.body || {};
  const script = 'script' in b ? cleanScript(b.script) : cleanScript(safeJson(e.script));
  const json = JSON.stringify(script);
  if (json.length > 200000) throw httpError(400, 'That exercise is too long');
  db.prepare('UPDATE exercises SET name = ?, emoji = ?, script = ? WHERE id = ?').run(
    'name' in b ? cleanWords(b.name).slice(0, 40) || e.name : e.name,
    'emoji' in b ? String(b.emoji || '').slice(0, 8) || e.emoji : e.emoji,
    json, e.id);
  res.json(characterDetail(characterRow(e.character_id)));
});

parent.delete('/exercises/:id', (req, res) => {
  const e = exerciseRow(Number(req.params.id));
  db.prepare('DELETE FROM exercises WHERE id = ?').run(e.id);
  res.json(characterDetail(characterRow(e.character_id)));
});

parent.delete('/characters/:id/exercise', (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (c.kind === 'partner') throw httpError(400, 'This one is only a partner: delete the character instead');
  db.prepare('UPDATE characters SET exercise = NULL WHERE id = ?').run(c.id);
  fs.rmSync(path.join(characterDir(c.id), 'exercise.glb'), { force: true });
  fs.rmSync(path.join(characterDir(c.id), 'src', 'exercise.glb'), { force: true });
  res.json(characterDetail(characterRow(c.id)));
});

parent.post('/characters/:id/pieces', upload.array('pieces', 60), (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (!req.files?.length) throw httpError(400, 'No .glb files received');
  const splits = addPieces(c.id, req.files);
  db.prepare("UPDATE characters SET status = 'processing', error = NULL WHERE id = ?").run(c.id);
  enqueue([...splits, () => rebuild(c.id)]);
  res.status(202).json(characterDetail(characterRow(c.id)));
});

parent.delete('/pieces/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(req.params.id));
  if (!p) throw httpError(404, 'No such piece');
  db.prepare('DELETE FROM pieces WHERE id = ?').run(p.id);
  fs.rmSync(path.join(characterDir(p.character_id), 'src', 'pieces', `${p.id}.glb`), { force: true });
  const left = db.prepare('SELECT COUNT(*) AS n FROM pieces WHERE character_id = ?').get(p.character_id).n;
  if (left) {
    db.prepare("UPDATE characters SET status = 'processing', error = NULL WHERE id = ?").run(p.character_id);
    enqueue([() => rebuild(p.character_id)]);
  }
  res.json(characterDetail(characterRow(p.character_id)));
});

parent.post('/characters/:id/rigged', upload.single('rigged'), (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (!req.file) throw httpError(400, 'No .glb file received');
  enqueue(riggedJobs(c.id, req.file));
  res.status(202).json(characterDetail(c));
});

parent.post('/characters/:id/dances', upload.array('dances', 60), (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (!req.files?.length) throw httpError(400, 'No .glb or .fbx files received');
  enqueue(danceJobs(c.id, req.files));
  res.status(202).json(characterDetail(characterRow(c.id)));
});

parent.put('/dances/:id', (req, res) => {
  db.prepare('UPDATE dances SET name = ? WHERE id = ?').run(String(req.body.name || '').trim().slice(0, 60) || 'Dance', Number(req.params.id));
  res.json({ ok: true });
});

parent.delete('/dances/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dances WHERE id = ?').get(Number(req.params.id));
  if (d) {
    db.prepare('DELETE FROM dances WHERE id = ?').run(d.id);
    fs.rmSync(path.join(characterDir(d.character_id), 'dances', `${d.id}.glb`), { force: true });
  }
  res.json({ ok: true });
});

// A partner's voice lines

const audioUpload = multer({ dest: TMP_DIR, limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

parent.put('/characters/:id/lines/:line', audioUpload.single('audio'), (req, res) => {
  const tmp = req.file?.path;
  try {
    const c = characterRow(Number(req.params.id));
    const line = String(req.params.line);
    if (!LINE_KEY.test(line)) throw httpError(400, 'Bad line name');
    if (!tmp) throw httpError(400, 'No recording received');
    const seconds = wavSeconds(tmp);
    if (!seconds) throw httpError(400, 'That recording is not a WAV file');
    moveFile(tmp, path.join(voiceDir(c.id), `${line}.wav`));
    db.prepare(`INSERT INTO voice_lines (character_id, key, text, version, seconds) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(character_id, key) DO UPDATE SET version = excluded.version, seconds = excluded.seconds`)
      .run(c.id, line, starterText(line), newVersion(), seconds);
    res.json(characterDetail(c));
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
});

// New lines: { texts: ['Hold it!', …] } -> their keys, in order.
parent.post('/characters/:id/lines', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const texts = (Array.isArray(req.body?.texts) ? req.body.texts : []).map(cleanWords).slice(0, 200);
  if (!texts.length) throw httpError(400, 'No words for the new line');
  const keys = db.transaction(() => texts.map((t) => {
    const key = newLineKey();
    addVoiceLine.run(c.id, key, t);
    return key;
  }))();
  res.status(201).json({ keys, character: characterDetail(characterRow(c.id)) });
});

// The words a line says (shown on screen too, unless a scene has its own).
parent.put('/characters/:id/lines/:line/words', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const line = String(req.params.line);
  if (!LINE_KEY.test(line)) throw httpError(400, 'Bad line name');
  db.prepare(`INSERT INTO voice_lines (character_id, key, text) VALUES (?, ?, ?)
    ON CONFLICT(character_id, key) DO UPDATE SET text = excluded.text`).run(c.id, line, cleanWords(req.body?.text));
  res.json(characterDetail(c));
});

parent.delete('/characters/:id/lines/:line', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const line = String(req.params.line);
  if (!LINE_KEY.test(line)) throw httpError(400, 'Bad line name');
  db.prepare('DELETE FROM voice_lines WHERE character_id = ? AND key = ?').run(c.id, line);
  fs.rmSync(path.join(voiceDir(c.id), `${line}.wav`), { force: true });
  res.json(characterDetail(c));
});

// Length of a PCM WAV file in seconds, or 0 if it isn't one.
function wavSeconds(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let byteRate = 0;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(at + 16);
    if (id === 'data') return byteRate ? Math.round((Math.min(size, buf.length - at - 8) / byteRate) * 1000) / 1000 : 0;
    at += 8 + size + (size % 2);
  }
  return 0;
}

// History & devices

parent.get('/brush-sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, pr.name AS profile_name, pc.name AS piece_name FROM brush_sessions s
    JOIN profiles pr ON pr.id = s.profile_id
    LEFT JOIN pieces pc ON pc.id = s.unlocked_piece_id
    WHERE pr.is_test = 0 AND (? IS NULL OR s.profile_id = ?)
    ORDER BY s.id DESC LIMIT 200`).all(req.query.profileId ?? null, req.query.profileId ?? null);
  res.json(rows.map((s) => ({
    id: s.id, profileId: s.profile_id, profileName: s.profile_name, date: s.local_date, finishedAt: s.finished_at,
    secondsBrushed: s.seconds_brushed, secondsPaused: s.seconds_paused, completed: !!s.completed, unlockedPiece: s.piece_name,
    manual: !!s.manual
  })));
});

parent.get('/devices', (req, res) => {
  res.json(db.prepare(`
    SELECT d.id, d.name, d.created_at AS createdAt, d.last_seen_at AS lastSeenAt, p.name AS accountName, p.emoji AS accountEmoji
    FROM devices d LEFT JOIN profiles p ON p.id = d.profile_id ORDER BY d.id`).all()
    .map((d) => ({ ...d, isThisDevice: d.id === req.device.id })));
});

parent.delete('/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- processing queue ----------
// One job at a time: shrinking models is CPU-heavy and the server runs
// plenty of other things.

let queue = Promise.resolve();
function enqueue(jobs) {
  for (const job of jobs) queue = queue.then(job).catch((e) => console.error('job failed:', e));
}

// Adds a piece for each file, or for each object in a file that has several
// (every piece exported together from Blender, named after the objects).
// Returns the jobs that split those files up; run them before rebuild().
function addPieces(characterId, files) {
  const srcDir = path.join(characterDir(characterId), 'src', 'pieces');
  fs.mkdirSync(srcDir, { recursive: true });
  let sort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS s FROM pieces WHERE character_id = ?').get(characterId).s;
  const addRow = (raw) => {
    const { name, reveal } = pieceName(raw);
    const id = db.prepare('INSERT INTO pieces (character_id, name, sort, node_name, reveal) VALUES (?, ?, ?, ?, ?)')
      .run(characterId, name, ++sort, 'pending', reveal ? 1 : 0).lastInsertRowid;
    db.prepare('UPDATE pieces SET node_name = ? WHERE id = ?').run(`piece_${id}`, id);
    return id;
  };
  const jobs = [];
  // Keep originals so the model can be rebuilt (new pieces, bigger budgets).
  const sorted = [...files].sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));
  for (const f of sorted) {
    const objects = glbObjects(f.path);
    if (objects.length <= 1) {
      moveFile(f.path, path.join(srcDir, `${addRow(niceName(f.originalname))}.glb`));
      continue;
    }
    const outs = objects.map((o, i) => ({ index: o.index, out: path.join(srcDir, `${addRow(cleanObjectName(o.name, `Piece ${i + 1}`))}.glb`) }));
    const whole = path.join(srcDir, `whole-${Date.now()}-${outs.length}.glb`);
    moveFile(f.path, whole);
    jobs.push(async () => {
      try {
        await splitPieces(whole, outs);
        console.log(`character ${characterId}: split ${path.basename(f.originalname)} into ${outs.length} pieces`);
      } finally {
        fs.rmSync(whole, { force: true });
      }
    });
  }
  return jobs;
}

// Devices cache 3D files forever by URL (…?v=<version>), so a version must
// never repeat, even when a deleted character's id gets reused. New rows
// start at 1 ("never built"); every build gets a fresh timestamp.
let lastVersion = 0;
function newVersion() {
  lastVersion = Math.max(Date.now(), lastVersion + 1);
  return lastVersion;
}

async function rebuild(characterId) {
  const pieces = db.prepare('SELECT id, node_name FROM pieces WHERE character_id = ? ORDER BY id').all(characterId);
  const srcDir = path.join(characterDir(characterId), 'src', 'pieces');
  try {
    const t = Date.now();
    const tris = await buildCharacterModel(characterId, pieces.map((p) => ({ nodeName: p.node_name, file: path.join(srcDir, `${p.id}.glb`) })));
    const first = db.prepare('SELECT version FROM characters WHERE id = ?').get(characterId).version === 1;
    db.transaction(() => {
      // Brand-new character: unlock order bottom-up. Later rebuilds keep the
      // order the parent set.
      if (first) {
        [...pieces].sort((a, b) => tris.bottoms[a.node_name] - tris.bottoms[b.node_name])
          .forEach((p, i) => db.prepare('UPDATE pieces SET sort = ? WHERE id = ?').run(i, p.id));
      }
      db.prepare("UPDATE characters SET status = 'ready', error = NULL, version = ? WHERE id = ?").run(newVersion(), characterId);
    })();
    console.log(`character ${characterId}: ${pieces.length} pieces, ${tris.before} -> ${tris.after} triangles in ${Date.now() - t} ms`);
  } catch (e) {
    db.prepare("UPDATE characters SET status = 'error', error = ? WHERE id = ?").run(String(e.message || e), characterId);
    throw e;
  }
}

function riggedJobs(characterId, file) {
  const src = path.join(characterDir(characterId), 'src', 'rigged.glb');
  moveFile(file.path, src);
  return [async () => {
    const tris = await processRigged(characterId, src);
    db.prepare('UPDATE characters SET has_rigged = 1, version = ? WHERE id = ?').run(newVersion(), characterId);
    console.log(`character ${characterId}: rigged model ${tris.before} -> ${tris.after} triangles`);
  }];
}

// One dance per file, or one per animation in a file that has several
// (named after the animations).
function danceJobs(characterId, files) {
  return files.flatMap((f) => {
    const names = glbAnimations(f.path);
    const many = names.length > 1;
    const dances = many ? names.map((n, i) => ({ name: cleanObjectName(n, `Dance ${i + 1}`), which: i })) : [{ name: niceName(f.originalname), which: 0 }];
    let left = dances.length;
    return dances.map(({ name, which }) => {
      const id = db.prepare('INSERT INTO dances (character_id, name) VALUES (?, ?)').run(characterId, name).lastInsertRowid;
      return async () => {
        try {
          await processDance(characterId, id, f.path, which);
          db.prepare("UPDATE dances SET status = 'ready' WHERE id = ?").run(id);
        } catch (e) {
          db.prepare("UPDATE dances SET status = 'error', error = ? WHERE id = ?").run(String(e.message || e), id);
        } finally {
          if (--left === 0) fs.rmSync(f.path, { force: true });
        }
      };
    });
  });
}

// The original is kept (src/exercise.glb) so it can be shrunk again later.
// Animations named like "Starfish_Sit_Up.L" or "Wave" get their use guessed;
// uses and pause marks already set are kept when the animation is still there.
function exerciseJobs(characterId, file) {
  moveFile(file.path, path.join(characterDir(characterId), 'src', 'exercise.glb'));
  const ex = safeJson(characterRow(characterId).exercise);
  db.prepare('UPDATE characters SET exercise = ? WHERE id = ?').run(JSON.stringify({ ...ex, status: 'processing', error: null }), characterId);
  return [exerciseJob(characterId)];
}

function exerciseJob(characterId) {
  const src = path.join(characterDir(characterId), 'src', 'exercise.glb');
  const setExercise = (ex) => db.prepare('UPDATE characters SET exercise = ? WHERE id = ?').run(JSON.stringify(ex), characterId);
  return async () => {
    const before = safeJson(characterRow(characterId).exercise);
    try {
      const r = await processExercise(characterId, src);
      const names = new Set(r.animations.map((a) => a.name));
      const uses = {};
      for (const [use, name] of Object.entries(before.uses || {})) if (names.has(name)) uses[use] = name;
      for (const a of r.animations) {
        const use = guessUse(a.name);
        if (use && !uses[use]) uses[use] = a.name;
      }
      const marks = {};
      for (const [name, list] of Object.entries(before.marks || {})) if (names.has(name)) marks[name] = list;
      const ex = { status: 'ready', error: null, version: newVersion(), animations: r.animations, uses, marks };
      setExercise(ex);
      // A first model with "get into position" animations starts out with Hug & Starfish to edit.
      const none = !db.prepare('SELECT 1 FROM exercises WHERE character_id = ?').get(characterId);
      if (none && starfishScript(ex)) addExercise(characterId, { starter: 'starfish' });
      console.log(`character ${characterId}: exercise model ${r.before} -> ${r.after} triangles, ${r.animations.length} animations`);
    } catch (e) {
      setExercise({ ...before, status: 'error', error: String(e.message || e) });
    }
  };
}

// "Starfish_Sit_Up.L" -> starfish_in_left, "Starfish_Sit_Up_Rev.R" -> starfish_out_right,
// "Wave" / "Cheer" -> cheer.
function guessUse(name) {
  const n = name.toLowerCase();
  if (/wave|cheer|yay|celebrat/.test(n)) return 'cheer';
  if (!/starfish|sit/.test(n)) return null;
  const side = /(\.|_|-|\s)l$|left/.test(n) ? 'left' : /(\.|_|-|\s)r$|right/.test(n) ? 'right' : null;
  if (!side) return null;
  return `starfish_${/rev|out|back|down|undo/.test(n) ? 'out' : 'in'}_${side}`;
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.rmSync(from, { force: true });
}

function cleanup(req) {
  for (const list of Object.values(req.files || {})) cleanupFiles(list);
}
function cleanupFiles(list) {
  for (const f of list) fs.rmSync(f.path, { force: true });
}

// ---------- web app + errors ----------

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  const index = path.join(publicDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  next();
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server' });
});

// Characters stuck mid-processing (server restarted) get retried.
// Dance uploads live in the temp folder until processed, so those are lost.
for (const c of db.prepare("SELECT id FROM characters WHERE status = 'processing'").all()) enqueue([() => rebuild(c.id)]);
for (const c of db.prepare("SELECT id FROM characters WHERE json_extract(exercise, '$.status') = 'processing'").all()) enqueue([exerciseJob(c.id)]);
db.prepare("UPDATE dances SET status = 'error', error = 'The server restarted before this finished. Upload it again.' WHERE status = 'processing'").run();
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

app.listen(PORT, () => console.log(`Family Track server ${VERSION} on port ${PORT}`));
startBackups();
