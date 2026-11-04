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
import { buildCharacterModel, processRigged, processDance, characterDir, niceName } from './assets.js';

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

function kidState(profileId) {
  const profile = toProfile(profileRow(profileId));
  const brushesToday = db.prepare(
    'SELECT COUNT(*) AS n FROM brush_sessions WHERE profile_id = ? AND local_date = ? AND completed = 1').get(profileId, today()).n;
  const brushedToday = brushesToday > 0;
  const c = activeCharacter(profileId);
  if (!c || c.status !== 'ready') {
    return { profile, brushedToday, brushesToday, character: c ? { id: c.id, name: c.name, status: c.status } : null };
  }
  const pieces = db.prepare(`
    SELECT p.id, p.name, p.node_name AS nodeName, u.unlocked_on AS unlockedOn, u.placed_at AS placedAt
    FROM pieces p LEFT JOIN unlocks u ON u.piece_id = p.id AND u.profile_id = ?
    WHERE p.character_id = ? ORDER BY p.sort, p.id`).all(profileId, c.id);
  const dances = c.has_rigged
    ? db.prepare("SELECT id, name FROM dances WHERE character_id = ? AND status = 'ready' ORDER BY id").all(c.id)
    : [];
  const nextPiece = pieces.find((p) => !p.unlockedOn)?.name ?? null;
  const settings = getSettings();
  const waitUntil = nextPiece && !profile.isTest ? nextPieceAt(profileId, c, settings) : null;
  return {
    profile,
    brushedToday,
    brushesToday,
    character: {
      id: c.id, name: c.name, kind: c.kind, status: c.status, version: c.version,
      hasRigged: !!c.has_rigged,
      pieces: pieces.map((p) => ({ id: p.id, name: p.name, nodeName: p.nodeName, unlocked: !!p.unlockedOn, placed: !!p.placedAt })),
      dances,
      // Set while a recent piece or brush means the next brush can't earn one
      // yet. unlockedToday is for app builds before 0.1.6.
      nextPieceAt: waitUntil,
      unlockedToday: !!waitUntil,
      hoursBetween: settings.hoursBetween,
      nextPiece,
      complete: pieces.length > 0 && pieces.every((p) => p.placedAt)
    }
  };
}

app.get('/api/kids/:id/state', (req, res) => res.json(kidState(Number(req.params.id))));

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
    const next = nextLockedPiece(profileId, c.id);
    if (!next) return;
    // The test kid gets a piece every time, so parents can run through fast.
    if (!isTest && brushProgress(profileId, c, settings).counted < settings.brushesPerPiece) return;
    db.prepare('INSERT INTO unlocks (profile_id, piece_id, unlocked_on) VALUES (?, ?, ?)').run(profileId, next.id, date);
    db.prepare('UPDATE brush_sessions SET unlocked_piece_id = ? WHERE id = ?').run(next.id, session.lastInsertRowid);
    unlockedPiece = { id: next.id, name: next.name };
  })();

  res.json({ completed, unlockedPiece, state: kidState(profileId) });
});

// Finished brushes that count toward the next piece of character c: walk the
// brushes since the last piece (or since the character was started) and count
// each one that's at least hoursBetween after the previous one that counted.
// A piece given by a grown-up counts as a brush. Returns the count and when
// the last counted brush (or piece) happened.
const sqlTime = (s) => Date.parse(s.replace(' ', 'T') + 'Z');
function brushProgress(profileId, c, settings) {
  const gapMs = settings.hoursBetween * 3600e3;
  const last = db.prepare(`
    SELECT s.id, s.finished_at FROM brush_sessions s
    JOIN pieces p ON p.id = s.unlocked_piece_id
    JOIN unlocks u ON u.piece_id = s.unlocked_piece_id AND u.profile_id = s.profile_id
    WHERE s.profile_id = ? AND p.character_id = ? ORDER BY s.id DESC LIMIT 1`).get(profileId, c.id);
  const sessions = last
    ? db.prepare('SELECT finished_at FROM brush_sessions WHERE profile_id = ? AND completed = 1 AND id > ? ORDER BY id').all(profileId, last.id)
    : db.prepare('SELECT finished_at FROM brush_sessions WHERE profile_id = ? AND completed = 1 AND finished_at >= ? ORDER BY id').all(profileId, c.started_at);
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

function nextLockedPiece(profileId, characterId) {
  return db.prepare(`
    SELECT p.* FROM pieces p
    WHERE p.character_id = ? AND NOT EXISTS (SELECT 1 FROM unlocks u WHERE u.piece_id = p.id AND u.profile_id = ?)
    ORDER BY p.sort, p.id LIMIT 1`).get(characterId, profileId);
}

// A grown-up gives the next piece by hand: the kid brushed, but the camera
// didn't count it. Recorded as a finished brush marked "given by a grown-up",
// so it counts as a brush and the usual hours-between wait starts from now.
app.post('/api/parent/profiles/:id/give-piece', requireAdult, (req, res) => {
  const profileId = profileRow(Number(req.params.id)).id;
  const c = activeCharacter(profileId);
  if (!c || c.status !== 'ready') throw httpError(400, "They aren't building anything yet");
  const next = nextLockedPiece(profileId, c.id);
  if (!next) throw httpError(400, `They already have every piece of ${c.name}`);
  const settings = getSettings();
  const date = today();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO brush_sessions (profile_id, local_date, seconds_brushed, seconds_paused, completed, manual, unlocked_piece_id)
      VALUES (?, ?, ?, 0, 1, 1, ?)`).run(profileId, date, settings.mainSeconds + settings.frontSeconds, next.id);
    db.prepare('INSERT INTO unlocks (profile_id, piece_id, unlocked_on) VALUES (?, ?, ?)').run(profileId, next.id, date);
  })();
  res.json({ piece: { id: next.id, name: next.name }, character: c.name });
});

app.post('/api/kids/:id/place', (req, res) => {
  const profileId = Number(req.params.id);
  const r = db.prepare("UPDATE unlocks SET placed_at = COALESCE(placed_at, datetime('now')) WHERE profile_id = ? AND piece_id = ?")
    .run(profileId, Number(req.body.pieceId));
  if (!r.changes) throw httpError(400, 'That piece is not unlocked yet');
  res.json(kidState(profileId));
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
// Coaches are voices for the exercises: a grown-up records each line, and the
// app plays it with the coach's effect (robot, radio…). Recordings arrive as
// small WAV files, already trimmed and evened out by the app.

const coachDir = (id) => path.join(DATA_DIR, 'coaches', String(id));
const LINE_KEY = /^[a-z0-9_]{1,40}$/;
const EFFECTS = ['none', 'robot', 'radio', 'deep', 'high', 'echo'];
const coachRow = (id) => {
  const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
  if (!c) throw httpError(404, 'No such coach');
  return c;
};
function coachDetail(c) {
  const lines = {};
  for (const l of db.prepare('SELECT line, version, seconds FROM coach_lines WHERE coach_id = ?').all(c.id)) {
    lines[l.line] = { version: l.version, seconds: l.seconds };
  }
  return { id: c.id, name: c.name, emoji: c.emoji, effect: c.effect, lines };
}

app.get('/api/coaches', (req, res) => {
  res.json(db.prepare('SELECT * FROM coaches ORDER BY id').all().map(coachDetail));
});

app.get('/api/coaches/:id/lines/:line.wav', (req, res) => {
  const line = String(req.params.line);
  if (!LINE_KEY.test(line)) throw httpError(404, 'File not found');
  const file = path.join(coachDir(Number(req.params.id)), `${line}.wav`);
  if (!fs.existsSync(file)) throw httpError(404, 'File not found');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('audio/wav').sendFile(file);
});

// A kid's coach and exercise settings (hold times, speeds…). Kids may change
// their own; grown-ups any kid's.
const exerciseState = (p) => ({ coachId: p.coach_id ?? null, settings: safeJson(p.exercise_settings) });
const safeJson = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

app.get('/api/kids/:id/exercises', (req, res) => res.json(exerciseState(profileRow(Number(req.params.id)))));

app.put('/api/kids/:id/exercises', (req, res) => {
  const p = profileRow(Number(req.params.id));
  const b = req.body || {};
  if ('coachId' in b) {
    const coachId = b.coachId == null ? null : coachRow(Number(b.coachId)).id;
    db.prepare('UPDATE profiles SET coach_id = ? WHERE id = ?').run(coachId, p.id);
  }
  if (b.settings && typeof b.settings === 'object') {
    // One small object per exercise, merged into what's there.
    const settings = safeJson(p.exercise_settings);
    for (const [key, value] of Object.entries(b.settings)) {
      if (LINE_KEY.test(key) && value && typeof value === 'object') settings[key] = value;
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
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ sensitivity, userAgent, summary, samples }));
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
    return { ...toProfile(p), characterId: c?.id ?? null, isMe: p.id === req.account.id };
  }));
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
  characterRow(characterId);
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
  db.transaction(() => {
    db.prepare('UPDATE profile_characters SET active = 0 WHERE profile_id = ?').run(profileId);
    if (characterId) {
      db.prepare(`INSERT INTO profile_characters (profile_id, character_id, active) VALUES (?, ?, 1)
        ON CONFLICT(profile_id, character_id) DO UPDATE SET active = 1`).run(profileId, characterId);
    }
  })();
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
  return {
    id: c.id, name: c.name, kind: c.kind, status: c.status, error: c.error, hasRigged: !!c.has_rigged, version: c.version,
    pieces: db.prepare('SELECT id, name, node_name AS nodeName FROM pieces WHERE character_id = ? ORDER BY sort, id').all(c.id),
    dances: db.prepare('SELECT id, name, status, error FROM dances WHERE character_id = ? ORDER BY id').all(c.id)
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

const characterUpload = upload.fields([{ name: 'pieces', maxCount: 60 }, { name: 'rigged', maxCount: 1 }, { name: 'dances', maxCount: 60 }]);

parent.post('/characters', characterUpload, (req, res) => {
  const files = req.files || {};
  const pieces = files.pieces || [];
  if (!String(req.body.name || '').trim()) { cleanup(req); throw httpError(400, 'Name is required'); }
  if (!pieces.length) { cleanup(req); throw httpError(400, 'Add at least one piece (.glb)'); }
  const kind = req.body.kind === 'dress' ? 'dress' : 'build';
  const id = db.prepare('INSERT INTO characters (name, kind) VALUES (?, ?)').run(String(req.body.name).trim().slice(0, 60), kind).lastInsertRowid;
  addPieces(id, pieces);
  const jobs = [() => rebuild(id)];
  if (files.rigged?.[0]) jobs.push(...riggedJobs(id, files.rigged[0]));
  jobs.push(...danceJobs(id, files.dances || []));
  enqueue(jobs);
  res.status(202).json(characterDetail(characterRow(id)));
});

parent.put('/characters/:id', (req, res) => {
  const c = characterRow(Number(req.params.id));
  const b = req.body;
  db.transaction(() => {
    db.prepare('UPDATE characters SET name = ?, kind = ? WHERE id = ?').run(
      String(b.name ?? c.name).trim().slice(0, 60) || c.name, b.kind === 'dress' || b.kind === 'build' ? b.kind : c.kind, c.id);
    // pieces: full list in the new unlock order, with names
    (b.pieces || []).forEach((p, i) => {
      db.prepare('UPDATE pieces SET name = ?, sort = ? WHERE id = ? AND character_id = ?')
        .run(String(p.name || '').trim().slice(0, 60) || 'Piece', i, Number(p.id), c.id);
    });
  })();
  res.json(characterDetail(characterRow(c.id)));
});

parent.delete('/characters/:id', (req, res) => {
  const c = characterRow(Number(req.params.id));
  db.prepare('DELETE FROM characters WHERE id = ?').run(c.id);
  fs.rmSync(characterDir(c.id), { recursive: true, force: true });
  res.json({ ok: true });
});

parent.post('/characters/:id/pieces', upload.array('pieces', 60), (req, res) => {
  const c = characterRow(Number(req.params.id));
  if (!req.files?.length) throw httpError(400, 'No .glb files received');
  addPieces(c.id, req.files);
  db.prepare("UPDATE characters SET status = 'processing', error = NULL WHERE id = ?").run(c.id);
  enqueue([() => rebuild(c.id)]);
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

// Coaches

const audioUpload = multer({ dest: TMP_DIR, limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const coachFields = (b, c = {}) => ({
  name: cleanName(b.name, c.name || 'Coach'),
  emoji: String(b.emoji ?? c.emoji ?? '🤖').slice(0, 16) || '🤖',
  effect: EFFECTS.includes(b.effect) ? b.effect : c.effect || 'none'
});

parent.post('/coaches', (req, res) => {
  const f = coachFields(req.body || {});
  const id = db.prepare('INSERT INTO coaches (name, emoji, effect) VALUES (?, ?, ?)').run(f.name, f.emoji, f.effect).lastInsertRowid;
  res.json(coachDetail(coachRow(id)));
});

parent.put('/coaches/:id', (req, res) => {
  const c = coachRow(Number(req.params.id));
  const f = coachFields(req.body || {}, c);
  db.prepare('UPDATE coaches SET name = ?, emoji = ?, effect = ? WHERE id = ?').run(f.name, f.emoji, f.effect, c.id);
  res.json(coachDetail(coachRow(c.id)));
});

parent.delete('/coaches/:id', (req, res) => {
  const c = coachRow(Number(req.params.id));
  db.prepare('DELETE FROM coaches WHERE id = ?').run(c.id);
  fs.rmSync(coachDir(c.id), { recursive: true, force: true });
  res.json({ ok: true });
});

parent.put('/coaches/:id/lines/:line', audioUpload.single('audio'), (req, res) => {
  const tmp = req.file?.path;
  try {
    const c = coachRow(Number(req.params.id));
    const line = String(req.params.line);
    if (!LINE_KEY.test(line)) throw httpError(400, 'Bad line name');
    if (!tmp) throw httpError(400, 'No recording received');
    const seconds = wavSeconds(tmp);
    if (!seconds) throw httpError(400, 'That recording is not a WAV file');
    moveFile(tmp, path.join(coachDir(c.id), `${line}.wav`));
    db.prepare(`INSERT INTO coach_lines (coach_id, line, version, seconds) VALUES (?, ?, ?, ?)
      ON CONFLICT(coach_id, line) DO UPDATE SET version = excluded.version, seconds = excluded.seconds`)
      .run(c.id, line, newVersion(), seconds);
    res.json(coachDetail(c));
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
});

parent.delete('/coaches/:id/lines/:line', (req, res) => {
  const c = coachRow(Number(req.params.id));
  const line = String(req.params.line);
  if (!LINE_KEY.test(line)) throw httpError(400, 'Bad line name');
  db.prepare('DELETE FROM coach_lines WHERE coach_id = ? AND line = ?').run(c.id, line);
  fs.rmSync(path.join(coachDir(c.id), `${line}.wav`), { force: true });
  res.json(coachDetail(c));
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

function addPieces(characterId, files) {
  const srcDir = path.join(characterDir(characterId), 'src', 'pieces');
  fs.mkdirSync(srcDir, { recursive: true });
  let sort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS s FROM pieces WHERE character_id = ?').get(characterId).s;
  // Keep originals so the model can be rebuilt (new pieces, bigger budgets).
  const sorted = [...files].sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));
  for (const f of sorted) {
    const id = db.prepare('INSERT INTO pieces (character_id, name, sort, node_name) VALUES (?, ?, ?, ?)')
      .run(characterId, niceName(f.originalname), ++sort, 'pending').lastInsertRowid;
    db.prepare('UPDATE pieces SET node_name = ? WHERE id = ?').run(`piece_${id}`, id);
    moveFile(f.path, path.join(srcDir, `${id}.glb`));
  }
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

function danceJobs(characterId, files) {
  return files.map((f) => {
    const id = db.prepare('INSERT INTO dances (character_id, name) VALUES (?, ?)').run(characterId, niceName(f.originalname)).lastInsertRowid;
    return async () => {
      try {
        await processDance(characterId, id, f.path);
        db.prepare("UPDATE dances SET status = 'ready' WHERE id = ?").run(id);
      } catch (e) {
        db.prepare("UPDATE dances SET status = 'error', error = ? WHERE id = ?").run(String(e.message || e), id);
      } finally {
        fs.rmSync(f.path, { force: true });
      }
    };
  });
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.rmSync(from, { force: true });
}

function cleanup(req) {
  for (const list of Object.values(req.files || {})) for (const f of list) fs.rmSync(f.path, { force: true });
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
db.prepare("UPDATE dances SET status = 'error', error = 'The server restarted before this finished. Upload it again.' WHERE status = 'processing'").run();
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

app.listen(PORT, () => console.log(`Family Track server ${VERSION} on port ${PORT}`));
