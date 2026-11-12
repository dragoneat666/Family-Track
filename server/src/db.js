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
  `ALTER TABLE list_items ADD COLUMN remind_all_day INTEGER NOT NULL DEFAULT 0;`,
  // Reminders at set times (pills morning and evening...), made by grown-ups.
  //   times     JSON ["08:00", "20:00"], the server's local time
  //   days      JSON weekdays it goes off on, 0 = Sunday
  //   who       JSON { all: true } or { groups: ['adults'|'kids'], ids: [profile ids] }
  //   each      everyone taps their own Done (else one Done counts for everyone)
  //   nudges    JSON minutes after the time to remind again while it isn't done
  //   starts_at nothing earlier than this goes out (set when it's made, and
  //             when its times, days or people change), so a reminder made at
  //             9:00 for 8:00 doesn't pop up as "late" straight away
  // reminder_done: occ is which time it was, 'YYYY-MM-DDTHH:MM' local;
  // profile_id 0 = done for everyone, else done by/for that person (each).
  `
  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    times TEXT NOT NULL,
    days TEXT NOT NULL,
    who TEXT NOT NULL,
    each INTEGER NOT NULL DEFAULT 0,
    nudges TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    starts_at INTEGER NOT NULL,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
  );
  CREATE TABLE reminder_done (
    reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    occ TEXT NOT NULL,
    profile_id INTEGER NOT NULL DEFAULT 0,
    done_by INTEGER,
    done_at INTEGER NOT NULL,
    PRIMARY KEY (reminder_id, occ, profile_id)
  );
  `,
  // The family calendar. Days are 'YYYY-MM-DD' and times 'HH:MM', in the
  // server's local time; times are null for all-day events. end_day is the
  // last day (the same as start_day unless it spans days).
  //   kind       'event' | 'birthday' (title is then the person's name)
  //   repeat     JSON null or { every: 'day'|'week'|'month'|'year', n, by: 'date'|'weekday', until }
  //   people     JSON account ids it's about (its colour); [] = the whole family
  //   remind     JSON minutes before it starts to remind (all day: before midnight that day)
  //   remind_who JSON { groups: ['adults'] } or { ids: [grown-up ids] }
  //   sched_at   when its times or reminders last changed: reminders due before
  //              then aren't sent late
  // event_changes: one date of a repeating event skipped or changed. occ is
  // the day it would have been; data holds what's different (JSON).
  `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'event',
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT '',
    all_day INTEGER NOT NULL DEFAULT 0,
    start_day TEXT NOT NULL,
    start_time TEXT,
    end_day TEXT NOT NULL,
    end_time TEXT,
    repeat TEXT,
    people TEXT NOT NULL DEFAULT '[]',
    grownups_only INTEGER NOT NULL DEFAULT 0,
    remind TEXT NOT NULL DEFAULT '[]',
    remind_who TEXT NOT NULL,
    birth_year INTEGER,
    sched_at INTEGER NOT NULL,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
  );
  CREATE TABLE event_changes (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occ TEXT NOT NULL,
    skipped INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}',
    sched_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, occ)
  );
  `,
  // The family's contacts (mostly family). birthday is 'MM-DD' (birth_year
  // if known); a contact with a birthday has a birthday event on the
  // calendar (events.contact_id), kept in step both ways.
  //   phones     JSON [{ label, number }]
  //   emails     JSON [{ label, address }]
  //   profile_id this person's Family Track account, if they have one
  //   kids_name  what the kids call them ("Grandpa"), shown to kids instead of name
  //   calendar   whose calendar their birthday is on: 'everyone' | 'kids' | 'grownups' | 'none'
  //   phone_key  the phone contact it's kept up to date from (Android lookup
  //              key), on the device phone_device; null = not kept up to date
  // events.kids_only: on the kids' calendar only (a contact's birthday).
  `
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT '',
    kids_name TEXT NOT NULL DEFAULT '',
    phones TEXT NOT NULL DEFAULT '[]',
    emails TEXT NOT NULL DEFAULT '[]',
    address TEXT NOT NULL DEFAULT '',
    birthday TEXT,
    birth_year INTEGER,
    note TEXT NOT NULL DEFAULT '',
    profile_id INTEGER,
    grownups_only INTEGER NOT NULL DEFAULT 0,
    calendar TEXT NOT NULL DEFAULT 'everyone',
    phone_key TEXT,
    phone_device INTEGER,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
  );
  ALTER TABLE events ADD COLUMN contact_id INTEGER;
  ALTER TABLE events ADD COLUMN kids_only INTEGER NOT NULL DEFAULT 0;
  `,
  // Which phones keep a contact in step with their own contacts: one link
  // per grown-up's phone (device), with that phone's lookup key for it.
  // (Replaces contacts.phone_key / phone_device, which held just one.)
  `
  CREATE TABLE contact_links (
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL,
    phone_key TEXT NOT NULL,
    PRIMARY KEY (contact_id, device_id)
  );
  INSERT INTO contact_links (contact_id, device_id, phone_key)
    SELECT id, phone_device, phone_key FROM contacts WHERE phone_key IS NOT NULL AND phone_device IS NOT NULL;
  UPDATE contacts SET phone_key = NULL, phone_device = NULL;
  `,
  // Who can tap Done on a reminder, like `who`: null = whoever gets it
  // (and any grown-up), else { all } / { groups, ids }.
  `ALTER TABLE reminders ADD COLUMN done_who TEXT;`,
  // Recipes. ingredients: [{ section } | { text, qty, qty2, unit, name, note }],
  // steps: [{ section } | { text }], tags: [text]. photo: a file in
  // DATA_DIR/recipes. imported_from: 'mealie:<id>', 'tandoor:<id>' or the
  // web page's address, so importing again doesn't make a second copy.
  `
  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    servings INTEGER,
    yield TEXT NOT NULL DEFAULT '',
    prep_min INTEGER,
    cook_min INTEGER,
    total_min INTEGER,
    ingredients TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL DEFAULT '',
    photo TEXT,
    imported_from TEXT UNIQUE,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    changed_at INTEGER NOT NULL
  );
  `
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
