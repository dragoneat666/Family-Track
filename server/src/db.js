import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { starfishScript, starterText, linesUsed } from './exerciseScript.js';
import { pieceName } from './steps.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
const raw = new DatabaseSync(path.join(DATA_DIR, 'family-track.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

export const db = {
  prepare: (sql) => raw.prepare(sql),
  exec: (sql) => raw.exec(sql),
  // Wraps fn so that calling the result runs it inside one transaction.
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  }
};

// Each entry runs once, in order. Never edit a shipped migration; add a new one.
const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🙂',
    color TEXT NOT NULL DEFAULT '#4f8cff',
    is_parent INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );

  -- kind: 'build' (snap parts together) or 'dress' (outfit pieces on an outline)
  -- status: 'processing' | 'ready' | 'error'
  CREATE TABLE characters (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'build',
    status TEXT NOT NULL DEFAULT 'processing',
    error TEXT,
    has_rigged INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE pieces (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL,
    node_name TEXT NOT NULL
  );

  CREATE TABLE dances (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    error TEXT
  );

  -- Which character each kid is working on. Progress is kept per character,
  -- so switching back and forth never loses pieces.
  CREATE TABLE profile_characters (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, character_id)
  );

  CREATE TABLE unlocks (
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    piece_id INTEGER NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    unlocked_on TEXT NOT NULL,
    placed_at TEXT,
    PRIMARY KEY (profile_id, piece_id)
  );

  CREATE TABLE brush_sessions (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    local_date TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT (datetime('now')),
    seconds_brushed INTEGER NOT NULL,
    seconds_paused INTEGER NOT NULL,
    completed INTEGER NOT NULL,
    unlocked_piece_id INTEGER REFERENCES pieces(id) ON DELETE SET NULL
  );
  CREATE INDEX brush_sessions_profile ON brush_sessions(profile_id, local_date);
  `,
  // The hidden "Test kid" parents use to try the whole kid flow.
  `ALTER TABLE profiles ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;`,
  // Accounts: grown-ups (is_parent = 1) each get their own PIN, and every
  // device remembers which account is signed in on it. The old shared parent
  // PIN becomes a grown-up account called "Parent" (rename it in the app).
  `
  ALTER TABLE profiles ADD COLUMN pin_hash TEXT;
  ALTER TABLE devices ADD COLUMN profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;
  INSERT INTO profiles (name, emoji, color, is_parent, pin_hash)
    SELECT 'Parent', '🧑', '#2ec27e', 1, value FROM settings
    WHERE key = 'parent_pin' AND NOT EXISTS (SELECT 1 FROM profiles WHERE is_parent = 1 AND is_test = 0);
  DELETE FROM settings WHERE key = 'parent_pin';
  `,
  // Pieces a grown-up gave by hand (brushed, but the camera didn't count it).
  `ALTER TABLE brush_sessions ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;`,
  // Exercise coaches: a name, a voice effect and lines a grown-up recorded.
  // Each kid picks a coach and has their own exercise settings.
  `
  CREATE TABLE coaches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🤖',
    effect TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE coach_lines (
    coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    line TEXT NOT NULL,
    version INTEGER NOT NULL,
    seconds REAL NOT NULL,
    PRIMARY KEY (coach_id, line)
  );
  ALTER TABLE profiles ADD COLUMN coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL;
  ALTER TABLE profiles ADD COLUMN exercise_settings TEXT;
  `,
  // How hard building is: easy (outlines + snap), medium (no outlines, tap
  // Check), hard (medium + turn the pieces). Each kid picks their own.
  `ALTER TABLE profiles ADD COLUMN puzzle_level TEXT NOT NULL DEFAULT 'easy';`,
  // Exercise partners replace coaches: any character with an exercise model
  // (its own .glb with the exercise animations) can be a kid's partner, once
  // they've built it or if it's open to everyone. Its voice lines live with it.
  // kind 'partner' = only a partner, nothing to build.
  // exercise: JSON { status, error, version, animations: [{ name, seconds }],
  //   uses: { useKey: animationName }, marks: { animationName: [seconds] } }
  `
  ALTER TABLE characters ADD COLUMN partner_for_all INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE characters ADD COLUMN voice_effect TEXT NOT NULL DEFAULT 'none';
  ALTER TABLE characters ADD COLUMN exercise TEXT;
  CREATE TABLE character_lines (
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    line TEXT NOT NULL,
    version INTEGER NOT NULL,
    seconds REAL NOT NULL,
    PRIMARY KEY (character_id, line)
  );
  ALTER TABLE profiles ADD COLUMN partner_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
  `,
  // A partner's own wording for lines: JSON { lineKey: text }. Missing = the
  // app's standard wording.
  `ALTER TABLE characters ADD COLUMN phrases TEXT;`,
  // Exercises a grown-up edits like a movie: each character has its own, made
  // of scenes (see exerciseScript.js). Voice lines become a library of clips
  // with the words they say, instead of a fixed list. Hug & Starfish, which
  // used to be built in, becomes a script for every partner that had it, and
  // a kid's rounds now count both sides (old rounds counted each side).
  () => {
    db.exec(`
      CREATE TABLE voice_lines (
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        version INTEGER,
        seconds REAL,
        PRIMARY KEY (character_id, key)
      );
      CREATE TABLE exercises (
        id INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '⭐',
        sort INTEGER NOT NULL DEFAULT 0,
        script TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const json = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
    const addLine = db.prepare(`INSERT INTO voice_lines (character_id, key, text, version, seconds) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(character_id, key) DO NOTHING`);
    for (const c of db.prepare('SELECT * FROM characters ORDER BY id').all()) {
      const phrases = json(c.phrases);
      const words = (key) => phrases[key] || starterText(key);
      const script = c.exercise ? starfishScript(json(c.exercise)) : null;
      const recorded = new Map(db.prepare('SELECT line, version, seconds FROM character_lines WHERE character_id = ?').all(c.id).map((l) => [l.line, l]));
      // Lines in the order they're used, then any others that were recorded.
      for (const key of [...linesUsed(script), ...recorded.keys()]) {
        const l = recorded.get(key);
        addLine.run(c.id, key, words(key), l?.version ?? null, l?.seconds ?? null);
      }
      if (script) {
        db.prepare("INSERT INTO exercises (character_id, slug, name, emoji, script) VALUES (?, 'starfish', 'Hug & Starfish', '⭐', ?)")
          .run(c.id, JSON.stringify(script));
      }
    }
    db.exec('DROP TABLE character_lines;');
    for (const p of db.prepare('SELECT id, exercise_settings FROM profiles WHERE exercise_settings IS NOT NULL').all()) {
      const settings = json(p.exercise_settings);
      if (settings.starfish?.rounds) {
        settings.starfish.rounds = Math.max(1, Math.ceil(settings.starfish.rounds / 2));
        db.prepare('UPDATE profiles SET exercise_settings = ? WHERE id = ?').run(JSON.stringify(settings), p.id);
      }
    }
  },
  // A kid's own brushing setting from a tracking check, per place they brush:
  // JSON { standing|sitting: { threshold, d, at } } (d = face size then).
  `ALTER TABLE profiles ADD COLUMN brush_tuning TEXT;`,
  // Dress up: body parts aren't placed, they're revealed (the kid rubs away
  // sparkly clouds). Marked by "(Body)" in the name from Blender, or by hand.
  () => {
    db.exec('ALTER TABLE pieces ADD COLUMN reveal INTEGER NOT NULL DEFAULT 0;');
    for (const p of db.prepare('SELECT id, name FROM pieces').all()) {
      const { name, reveal } = pieceName(p.name);
      if (reveal) db.prepare('UPDATE pieces SET name = ?, reveal = 1 WHERE id = ?').run(name, p.id);
    }
  },
  // Shared lists (see lists.js). Phones keep their own copy so lists work
  // without the server, which shapes these tables: ids are made on the phone,
  // every change stamps the row with the next "rev" (a phone asks for
  // everything after the last rev it saw), and deleted rows stay behind as
  // markers until phones have had time to see them.
  `
  CREATE TABLE list_sync (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL, floor INTEGER NOT NULL);
  INSERT INTO list_sync (id, rev, floor) VALUES (1, 0, 0);

  -- kind: 'store' (sections + grocery suggestions) or 'plain' (to-dos and the like)
  -- private: "Just me", only its owner sees it
  CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'plain',
    owner_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    private INTEGER NOT NULL DEFAULT 0,
    sort REAL NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    changed_at INTEGER NOT NULL
  );
  -- key: the standard section it started as, so the starter grocery list
  -- still knows where things go after a rename
  CREATE TABLE list_sections (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key TEXT,
    sort REAL NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    changed_at INTEGER NOT NULL
  );
  -- Times are milliseconds since 1970. remind_who: JSON { all: true } (every
  -- grown-up) or { ids: [account ids] }.
  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    section_id TEXT,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sort REAL NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER,
    checked_by INTEGER,
    added_by INTEGER,
    remind_at INTEGER,
    remind_who TEXT,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    changed_at INTEGER NOT NULL
  );
  CREATE INDEX lists_rev ON lists(rev);
  CREATE INDEX list_sections_rev ON list_sections(rev);
  CREATE INDEX list_items_rev ON list_items(rev);
  CREATE INDEX list_items_list ON list_items(list_id);
  -- What each list has learned: which section a thing goes in there, and
  -- how often it's been put on the list (for suggestions).
  CREATE TABLE list_memory (
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    section_id TEXT,
    uses INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER,
    rev INTEGER NOT NULL,
    PRIMARY KEY (list_id, key)
  );
  CREATE INDEX list_memory_rev ON list_memory(rev);
  -- Changes already applied: a phone that didn't hear back sends them again.
  CREATE TABLE list_ops (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
  -- Things pinned to one phone's notifications by whoever is signed in there.
  CREATE TABLE list_pins (
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (device_id, profile_id, kind, target)
  );
  `,
  // A reminder for a whole day instead of a time: it shows up quietly when
  // that day starts (remind_at is then midnight on the phone that set it).
  `ALTER TABLE list_items ADD COLUMN remind_all_day INTEGER NOT NULL DEFAULT 0;`
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v]();
    else db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  })();
}

const DEFAULT_SETTINGS = {
  mainSeconds: 120,
  frontSeconds: 15,
  // How many finished brushes earn one new piece. A brush only counts if it's
  // at least hoursBetween hours after the last one that counted, so morning
  // and evening both count but brushing twice in a row doesn't.
  brushesPerPiece: 1,
  hoursBetween: 6,
  // 'low' | 'normal' | 'high' — how much movement counts as brushing.
  sensitivity: 'normal',
  showTrackingInfo: false
};

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in DEFAULT_SETTINGS) out[key] = JSON.parse(value);
  }
  return out;
}

export function setSettings(patch) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULT_SETTINGS) upsert.run(key, JSON.stringify(value));
    }
  })();
  return getSettings();
}
