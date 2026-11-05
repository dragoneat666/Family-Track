import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

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
  `ALTER TABLE profiles ADD COLUMN puzzle_level TEXT NOT NULL DEFAULT 'easy';`
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]);
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
