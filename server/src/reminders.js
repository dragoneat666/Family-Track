import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';

// Reminders at set times, like pills in the morning and evening. Grown-ups
// make them; they go to whoever they're for as a phone notification with a
// Done button. If nobody taps Done, the phones remind again (the "nudges",
// say 30 and 60 minutes later) and then stop.
//
// Phones don't work any of this out themselves. Their plan (GET
// /api/notify/plan) lists every time for the next week, and they set alarms
// for those, so reminders go off with no connection to the server. Before a
// nudge a phone asks the server (GET /api/reminders/check) whether someone
// already tapped Done, and only reminds again if not (or if it can't ask).
//
// Times are the server's local time, which is the family's.

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const AHEAD = 7 * DAY; // how far ahead phones get alarms: a week without the server is fine
const KEEP_DONE = 90 * DAY;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OCC = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isAdult = (p) => !!p.is_parent && !p.is_test;

// "20:05" -> "8:05 PM"
export function timeText(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

const parse = (r) => r && {
  ...r,
  times: JSON.parse(r.times), days: JSON.parse(r.days), who: JSON.parse(r.who), nudges: JSON.parse(r.nudges)
};
const reminderRow = (id) => parse(db.prepare('SELECT * FROM reminders WHERE id = ?').get(Number(id)));
// In order of their first time of the day.
const allReminders = () => db.prepare('SELECT * FROM reminders').all().map(parse)
  .sort((a, b) => a.times[0].localeCompare(b.times[0]) || a.title.localeCompare(b.title) || a.id - b.id);
const people = () => db.prepare('SELECT * FROM profiles WHERE is_test = 0 ORDER BY is_parent DESC, sort, id').all();

// Is this reminder for that person? (The kid account grown-ups try things
// out as is never anyone's.)
export function gets(who, p) {
  if (p.is_test) return false;
  if (who.all) return true;
  if (who.groups?.includes(p.is_parent ? 'adults' : 'kids')) return true;
  return !!who.ids?.includes(p.id);
}

// Every time the reminder goes off from `from` up to `to` (ms), in order:
// { occ: '2026-11-11T08:00', at, time: '08:00' }.
export function timesBetween(r, from, to) {
  const out = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) {
    if (!r.days.includes(d.getDay())) continue;
    for (const t of r.times) {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      if (at >= from && at < to) out.push({ occ: `${dayKey(d)}T${t}`, at, time: t });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Done ticks from `fromOcc` on: Map occ -> [{ profile, by, at }].
function doneSince(reminderId, fromOcc) {
  const out = new Map();
  const rows = db.prepare('SELECT * FROM reminder_done WHERE reminder_id = ? AND occ >= ? ORDER BY done_at').all(reminderId, fromOcc);
  for (const d of rows) {
    if (!out.has(d.occ)) out.set(d.occ, []);
    out.get(d.occ).push({ profile: d.profile_id, by: d.done_by, at: d.done_at });
  }
  return out;
}
// Done for that person: by everyone's Done, or their own.
const doneFor = (ticks, profileId) => !!ticks?.some((d) => d.profile === 0 || d.profile === profileId);

// ---------- what phones show ----------

export function reminderPlan(account) {
  if (account.is_test) return [];
  const now = Date.now();
  const entries = [];
  for (const r of allReminders()) {
    if (r.paused || !gets(r.who, account)) continue;
    // From a day back (one nobody dealt with stays up until the next time
    // comes round), with one time past the end to know when the last ends.
    const times = timesBetween(r, Math.max(r.starts_at, now - DAY), now + AHEAD + DAY);
    if (!times.length) continue;
    const done = doneSince(r.id, times[0].occ);
    times.forEach((o, n) => {
      if (o.at >= now + AHEAD) return;
      const until = Math.min(times[n + 1]?.at ?? Infinity, o.at + DAY);
      if (until <= now || doneFor(done.get(o.occ), account.id)) return;
      const when = [timeText(o.time), r.note].filter(Boolean).join(' · ');
      entries.push({
        id: `rem-${r.id}-${o.occ.replace(/\D/g, '')}`,
        at: o.at, channel: 'reminders', quiet: false,
        title: r.title, body: when, againBody: `Not done yet · ${when}`,
        actions: [{ id: 'done', title: 'Done', post: { path: '/api/reminders/done', body: { id: r.id, occ: o.occ } } }],
        // Reminded again at these times unless someone taps Done first, and
        // taken down when the next time comes round (or a day later).
        nudges: r.nudges.map((m) => o.at + m * MIN).filter((t) => t < until),
        check: `/api/reminders/check?id=${r.id}&occ=${encodeURIComponent(o.occ)}`,
        until,
        tap: { screen: 'reminders' }
      });
    });
  }
  return entries;
}

// ---------- the Reminders screen ----------

const toPerson = (p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, isParent: !!p.is_parent });
const toReminder = (r, everyone) => ({
  id: r.id, title: r.title, note: r.note, times: r.times, days: r.days, who: r.who,
  each: !!r.each, nudges: r.nudges, paused: !!r.paused, createdBy: r.created_by,
  // Who it goes to right now.
  for: everyone.filter((p) => gets(r.who, p)).map((p) => p.id)
});

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}

// Everything the Reminders screen shows: the reminders, the people they can
// go to, and today's times with who has done them.
function overview() {
  const everyone = people();
  const [start, end] = todayBounds();
  const reminders = allReminders();
  const today = [];
  for (const r of reminders) {
    if (r.paused) continue;
    const times = timesBetween(r, Math.max(start, r.starts_at), end);
    if (!times.length) continue;
    const done = doneSince(r.id, times[0].occ);
    for (const o of times) today.push({ reminder: r.id, occ: o.occ, at: o.at, done: done.get(o.occ) || [] });
  }
  today.sort((a, b) => a.at - b.at);
  return { reminders: reminders.map((r) => toReminder(r, everyone)), people: everyone.map(toPerson), today, now: Date.now() };
}

function cleanWho(who) {
  if (!who || who.all) return { all: true };
  const groups = ['adults', 'kids'].filter((g) => Array.isArray(who.groups) && who.groups.includes(g));
  if (groups.length === 2) return { all: true };
  const known = new Set(people().map((p) => p.id));
  const ids = [...new Set((Array.isArray(who.ids) ? who.ids : []).map(Number))].filter((id) => known.has(id));
  if (!groups.length && !ids.length) throw httpError(400, 'Pick who gets it');
  return { groups, ids };
}

function clean(b) {
  const title = text(b.title, 80);
  if (!title) throw httpError(400, 'Give it a name');
  const times = [...new Set((Array.isArray(b.times) ? b.times : []).map(String).filter((t) => TIME.test(t)))].sort().slice(0, 12);
  if (!times.length) throw httpError(400, 'Pick a time');
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) throw httpError(400, 'Pick at least one day');
  const nudges = [...new Set((Array.isArray(b.nudges) ? b.nudges : []).map(Number))]
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= 720).sort((x, y) => x - y).slice(0, 3);
  return { title, note: text(b.note, 200), times, days, who: cleanWho(b.who), each: b.each ? 1 : 0, nudges, paused: b.paused ? 1 : 0 };
}

export const remindersRouter = express.Router();

remindersRouter.get('/', requireAdult, (req, res) => res.json(overview()));

remindersRouter.post('/', requireAdult, (req, res) => {
  const r = clean(req.body);
  const now = Date.now();
  db.prepare(`INSERT INTO reminders (title, note, times, days, who, each, nudges, paused, starts_at, created_by, created_at, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.title, r.note, JSON.stringify(r.times), JSON.stringify(r.days), JSON.stringify(r.who), r.each,
      JSON.stringify(r.nudges), r.paused, now, req.account.id, now, now);
  res.json(overview());
});

remindersRouter.put('/:id', requireAdult, (req, res) => {
  const old = reminderRow(req.params.id);
  if (!old) throw httpError(404, 'That reminder is gone');
  const r = clean(req.body);
  const now = Date.now();
  // New times, days or people (or switched back on): start from now, so
  // nothing that already went by today suddenly turns up late.
  const fresh = JSON.stringify([old.times, old.days, old.who]) !== JSON.stringify([r.times, r.days, r.who]) || (old.paused && !r.paused);
  db.prepare(`UPDATE reminders SET title = ?, note = ?, times = ?, days = ?, who = ?, each = ?, nudges = ?, paused = ?,
    starts_at = ?, changed_at = ? WHERE id = ?`)
    .run(r.title, r.note, JSON.stringify(r.times), JSON.stringify(r.days), JSON.stringify(r.who), r.each,
      JSON.stringify(r.nudges), r.paused, fresh ? now : old.starts_at, now, old.id);
  res.json(overview());
});

remindersRouter.delete('/:id', requireAdult, (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(Number(req.params.id));
  res.json(overview());
});

// Done (or { undo: true }) for one time of a reminder: from a notification's
// button, or the Reminders screen. Anyone it's for can; grown-ups can for
// anyone, and `for` someone in particular when everyone taps their own.
remindersRouter.post('/done', (req, res) => {
  const r = reminderRow(req.body.id);
  if (!r) throw httpError(404, 'That reminder is gone');
  const occ = String(req.body.occ ?? '');
  if (!OCC.test(occ)) throw httpError(400, 'Bad time');
  const adult = isAdult(req.account);
  if (!adult && !gets(r.who, req.account)) throw httpError(403, "That one isn't for you");
  let profile = 0;
  if (r.each) profile = adult && req.body.for != null ? Number(req.body.for) : req.account.id;
  if (req.body.undo && r.each) {
    db.transaction(() => {
      // A Done for everyone (from before everyone tapped their own) stays
      // for the others.
      const shared = db.prepare('SELECT * FROM reminder_done WHERE reminder_id = ? AND occ = ? AND profile_id = 0').get(r.id, occ);
      if (shared) {
        db.prepare('DELETE FROM reminder_done WHERE reminder_id = ? AND occ = ? AND profile_id = 0').run(r.id, occ);
        for (const p of people().filter((x) => gets(r.who, x) && x.id !== profile)) {
          db.prepare('INSERT OR IGNORE INTO reminder_done (reminder_id, occ, profile_id, done_by, done_at) VALUES (?, ?, ?, ?, ?)')
            .run(r.id, occ, p.id, shared.done_by, shared.done_at);
        }
      }
      db.prepare('DELETE FROM reminder_done WHERE reminder_id = ? AND occ = ? AND profile_id = ?').run(r.id, occ, profile);
    })();
  } else if (req.body.undo) {
    db.prepare('DELETE FROM reminder_done WHERE reminder_id = ? AND occ = ?').run(r.id, occ);
  } else {
    db.prepare('INSERT OR IGNORE INTO reminder_done (reminder_id, occ, profile_id, done_by, done_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, occ, profile, req.account.id, Date.now());
  }
  db.prepare('DELETE FROM reminder_done WHERE done_at < ?').run(Date.now() - KEEP_DONE);
  res.json({ ok: true });
});

// Asked by a phone before it reminds again: has this been dealt with? A
// reminder that's gone, paused or no longer for this person counts as done
// (nothing more to remind about).
remindersRouter.get('/check', (req, res) => {
  const r = reminderRow(req.query.id);
  if (!r || r.paused || !gets(r.who, req.account)) return res.json({ done: true });
  const occ = String(req.query.occ ?? '');
  const tick = db.prepare('SELECT 1 FROM reminder_done WHERE reminder_id = ? AND occ = ? AND profile_id IN (0, ?)').get(r.id, occ, req.account.id);
  res.json({ done: !!tick });
});

// Today's reminders for whoever is signed in (kids too).
remindersRouter.get('/today', (req, res) => {
  const [start, end] = todayBounds();
  const out = [];
  for (const r of allReminders()) {
    if (r.paused || !gets(r.who, req.account)) continue;
    const times = timesBetween(r, Math.max(start, r.starts_at), end);
    if (!times.length) continue;
    const done = doneSince(r.id, times[0].occ);
    for (const o of times) {
      out.push({ id: r.id, title: r.title, note: r.note, occ: o.occ, at: o.at, time: timeText(o.time), done: doneFor(done.get(o.occ), req.account.id) });
    }
  }
  res.json({ reminders: out.sort((a, b) => a.at - b.at) });
});
