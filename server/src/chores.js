import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';
import { today } from './config.js';

// Chores that earn the kids allowance money. Grown-ups make them: a name,
// how often (some number of times a week, any day: "Dishes" 3 times; or on
// set days that come round every week: "Trash" on Tuesday and Friday), what
// each time earns ($1 unless changed) and, if they like, who usually does it.
// A grown-up checks one off and ticks who did it (the usual kids start
// ticked); every kid ticked earns the full amount (two kids on the dishes =
// $1 each), and it counts once towards the week's times. Weeks start on
// Sunday.
//
// A chore can be linked to a reminder ("Trash night"). When the reminder is
// marked Done (from the app, My Day or the phone's notification), the
// grown-up's app asks whether to check the chore off too (chore_asks; a kid
// marking it Done asks any grown-up).
//
// Each kid's money is a running total: chores add to it, grown-ups can add
// some (birthday money) and take some out when the kid spends it. Kids see
// the chores and their own money (not their brothers' and sisters'), and
// change nothing.
//
// Money is kept in cents. A deleted chore stays in the history (and the
// money it earned stays earned); undoing a check-off takes its money back.

const MAX_CENTS = 100000; // $1,000
const ASK_FOR = 3; // days a "check the chore off too?" question waits
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');
const fromDay = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The Sunday the week of `day` (YYYY-MM-DD) starts on.
export function weekStart(day = today()) {
  const date = fromDay(day);
  date.setDate(date.getDate() - date.getDay());
  return dayKey(date);
}

const kidRows = () => db.prepare('SELECT * FROM profiles WHERE is_parent = 0 AND is_test = 0 ORDER BY sort, id').all();
const isKid = (id) => !!db.prepare('SELECT 1 FROM profiles WHERE id = ? AND is_parent = 0 AND is_test = 0').get(Number(id));

function cents(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > MAX_CENTS) throw httpError(400, 'Check the amount');
  return n;
}

const parseChore = (c) => c && { ...c, days: c.days ? JSON.parse(c.days) : null, kids: c.kids ? JSON.parse(c.kids) : [] };
const choreRow = (id) => {
  const c = parseChore(db.prepare('SELECT * FROM chores WHERE id = ? AND deleted_at IS NULL').get(Number(id)));
  if (!c) throw httpError(404, 'That chore is gone');
  return c;
};

function cleanChore(b, was = {}) {
  const name = 'name' in b ? text(b.name, 60) : was.name;
  if (!name) throw httpError(400, 'Give the chore a name');
  // Set days (0 = Sunday … 6 = Saturday), or null for any day.
  let days = 'days' in b ? b.days : was.days ?? null;
  if (days != null) {
    days = [...new Set((Array.isArray(days) ? days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!days.length) throw httpError(400, 'Pick at least one day');
  }
  const times = days ? days.length : 'times' in b ? Math.round(Number(b.times)) : was.times ?? 1;
  if (!(times >= 1 && times <= 21)) throw httpError(400, 'A chore can be done 1 to 21 times a week');
  const kids = 'kids' in b
    ? [...new Set((Array.isArray(b.kids) ? b.kids : []).map(Number))].filter(isKid)
    : was.kids ?? [];
  let reminderId = 'reminderId' in b ? (b.reminderId == null || b.reminderId === '' ? null : Number(b.reminderId)) : was.reminder_id ?? null;
  if (reminderId != null && !db.prepare('SELECT 1 FROM reminders WHERE id = ?').get(reminderId)) throw httpError(400, 'That reminder is gone');
  return { name, times, days, kids, reminderId, cents: 'cents' in b ? cents(b.cents) : was.cents ?? 100 };
}

const balance = (profileId) => db.prepare('SELECT COALESCE(SUM(cents), 0) AS n FROM money WHERE profile_id = ?').get(profileId).n;
const earnedSince = (profileId, day) => db.prepare(
  'SELECT COALESCE(SUM(m.cents), 0) AS n FROM money m JOIN chore_done d ON d.id = m.done_id WHERE m.profile_id = ? AND d.day >= ?'
).get(profileId, day).n;
const doneCount = (choreId, week = weekStart()) => db.prepare('SELECT COUNT(*) AS n FROM chore_done WHERE chore_id = ? AND day >= ?').get(choreId, week).n;

// This week's check-offs, each with who did it.
function doneSince(day) {
  const rows = db.prepare(`
    SELECT d.id, d.chore_id AS choreId, d.day, d.done_at AS doneAt, c.name
    FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE d.day >= ? ORDER BY d.done_at DESC, d.id DESC`).all(day);
  const who = db.prepare('SELECT profile_id AS id, cents FROM money WHERE done_id = ? ORDER BY profile_id');
  return rows.map((r) => {
    const kids = who.all(r.id);
    return { id: r.id, choreId: r.choreId, name: r.name, day: r.day, doneAt: r.doneAt, kids: kids.map((k) => k.id), cents: kids[0]?.cents ?? 0 };
  });
}

// A chore as the screens get it. dueToday: one of its days is today and it
// hasn't been done as many times as its days so far this week.
function toChore(c, done, day = today()) {
  const doneThisWeek = done.filter((d) => d.choreId === c.id).length;
  const dow = fromDay(day).getDay();
  const reminder = c.reminder_id && db.prepare('SELECT title FROM reminders WHERE id = ?').get(c.reminder_id);
  return {
    id: c.id, name: c.name, times: c.times, cents: c.cents, days: c.days, kids: c.kids,
    reminderId: reminder ? c.reminder_id : null, reminderTitle: reminder?.title || null,
    doneThisWeek,
    dueToday: !!c.days?.includes(dow) && doneThisWeek < c.days.filter((d) => d <= dow).length
  };
}

// What a screen shows: the chores with this week's count, the kids' money
// (only their own, for a kid) and this week's check-offs.
function overview(account) {
  const week = weekStart();
  const done = doneSince(week);
  const kidId = account.is_parent ? null : account.id;
  const chores = db.prepare('SELECT * FROM chores WHERE deleted_at IS NULL ORDER BY sort, id').all().map(parseChore).map((c) => toChore(c, done));
  const kids = kidRows().filter((k) => kidId == null || k.id === kidId).map((k) => ({
    id: k.id, name: k.name, emoji: k.emoji, color: k.color,
    balance: balance(k.id), thisWeek: earnedSince(k.id, week)
  }));
  return {
    weekStart: week, today: today(), chores, kids,
    done: kidId == null ? done : done.filter((d) => d.kids.includes(kidId)).map((d) => ({ ...d, kids: [kidId] }))
  };
}

// Check a chore off for these kids, on `day` (today unless said).
function checkOff(c, kids, account, day = today()) {
  kids = [...new Set((Array.isArray(kids) ? kids : []).map(Number))];
  if (!kids.length) throw httpError(400, 'Pick who did it');
  if (!kids.every(isKid)) throw httpError(400, "That's not one of the kids");
  db.transaction(() => {
    if (doneCount(c.id, weekStart(day)) >= c.times) throw httpError(409, `${c.name} is done for this week already`);
    const doneId = db.prepare('INSERT INTO chore_done (chore_id, day, by_account) VALUES (?, ?, ?)').run(c.id, day, account.id).lastInsertRowid;
    const add = db.prepare('INSERT INTO money (profile_id, cents, done_id, by_account) VALUES (?, ?, ?, ?)');
    for (const k of kids) add.run(k, c.cents, doneId, account.id);
  })();
}

// ---------- reminders linked to chores ----------

// A linked reminder was marked Done (reminders.js calls this): ask whoever
// did it (any grown-up, if a kid did) whether to check the chore off too.
export function reminderDone(reminderId, occ, account) {
  if (account.is_test) return;
  db.prepare(`INSERT OR IGNORE INTO chore_asks (chore_id, reminder_id, occ, account_id)
    SELECT id, ?, ?, ? FROM chores WHERE reminder_id = ? AND deleted_at IS NULL`).run(reminderId, occ, account.id, reminderId);
}
// ... and undone: the question goes away.
export function reminderUndone(reminderId, occ) {
  db.prepare('DELETE FROM chore_asks WHERE reminder_id = ? AND occ = ?').run(reminderId, occ);
}

// The questions waiting for this grown-up.
function asksFor(account) {
  db.prepare("DELETE FROM chore_asks WHERE created_at < datetime('now', ?)").run(`-${ASK_FOR} days`);
  return db.prepare(`
    SELECT a.*, r.title AS reminderTitle, p.name AS byName, p.is_parent AS byAdult
    FROM chore_asks a
    JOIN chores c ON c.id = a.chore_id AND c.deleted_at IS NULL
    LEFT JOIN reminders r ON r.id = a.reminder_id
    LEFT JOIN profiles p ON p.id = a.account_id
    WHERE a.account_id = ? OR p.is_parent = 0 OR p.id IS NULL
    ORDER BY a.id`).all(account.id).map((a) => {
    const c = choreRow(a.chore_id);
    const day = askDay(a);
    return {
      id: a.id, occ: a.occ, day, reminderTitle: a.reminderTitle || c.name,
      by: a.account_id === account.id ? null : a.byName || null,
      chore: { ...toChore(c, doneSince(weekStart(day)), day), full: doneCount(c.id, weekStart(day)) >= c.times }
    };
  });
}
// The day the reminder was for, as long as that's this week; else today.
const askDay = (a) => {
  const day = String(a.occ || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today() && weekStart(day) === weekStart() ? day : today();
};

export const choresRouter = express.Router();

choresRouter.get('/', (req, res) => res.json(overview(req.account)));

// One kid's money, newest first: what each chore earned, what was added and
// what was taken out.
choresRouter.get('/money/:profileId', (req, res) => {
  const id = Number(req.params.profileId);
  if (!req.account.is_parent && req.account.id !== id) throw httpError(403, "That's someone else's");
  if (!isKid(id)) throw httpError(404, 'No such kid');
  const rows = db.prepare(`
    SELECT m.id, m.cents, m.note, m.at, m.done_id AS doneId, c.name AS chore, d.day
    FROM money m LEFT JOIN chore_done d ON d.id = m.done_id LEFT JOIN chores c ON c.id = d.chore_id
    WHERE m.profile_id = ? ORDER BY m.at DESC, m.id DESC LIMIT 200`).all(id);
  res.json({ balance: balance(id), entries: rows.map((r) => ({ id: r.id, cents: r.cents, note: r.note || '', at: r.at, chore: r.chore || null, day: r.day || null, doneId: r.doneId })) });
});

choresRouter.use(requireAdult);

choresRouter.post('/', (req, res) => {
  const c = cleanChore(req.body || {});
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM chores').get().n;
  db.prepare('INSERT INTO chores (name, times, cents, days, kids, reminder_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.name, c.times, c.cents, c.days && JSON.stringify(c.days), JSON.stringify(c.kids), c.reminderId, sort);
  res.status(201).json(overview(req.account));
});

// A new amount counts from now on: what was already earned stays.
choresRouter.put('/:id', (req, res) => {
  const was = choreRow(req.params.id);
  const c = cleanChore(req.body || {}, was);
  db.prepare('UPDATE chores SET name = ?, times = ?, cents = ?, days = ?, kids = ?, reminder_id = ? WHERE id = ?')
    .run(c.name, c.times, c.cents, c.days && JSON.stringify(c.days), JSON.stringify(c.kids), c.reminderId, was.id);
  if (c.reminderId !== (was.reminder_id ?? null)) db.prepare('DELETE FROM chore_asks WHERE chore_id = ?').run(was.id);
  res.json(overview(req.account));
});

choresRouter.delete('/:id', (req, res) => {
  const c = choreRow(req.params.id);
  db.prepare("UPDATE chores SET deleted_at = datetime('now') WHERE id = ?").run(c.id);
  db.prepare('DELETE FROM chore_asks WHERE chore_id = ?').run(c.id);
  res.json(overview(req.account));
});

// Questions from linked reminders, and answering one: { kids: [ids] } checks
// the chore off for them (on the reminder's day); { skip: true } doesn't.
choresRouter.get('/asks', (req, res) => res.json({ asks: asksFor(req.account) }));

choresRouter.post('/asks/:id', (req, res) => {
  const a = asksFor(req.account).find((x) => x.id === Number(req.params.id));
  if (!a) return res.json(overview(req.account)); // answered already (maybe on another phone)
  if (!req.body?.skip) checkOff(choreRow(a.chore.id), req.body?.kids, req.account, a.day);
  db.prepare('DELETE FROM chore_asks WHERE id = ?').run(a.id);
  res.json(overview(req.account));
});

// Checked off: { kids: [ids] }. Each of them earns the chore's amount.
choresRouter.post('/:id/done', (req, res) => {
  checkOff(choreRow(req.params.id), req.body?.kids, req.account);
  res.json(overview(req.account));
});

// Undo a check-off: its money goes back too.
choresRouter.delete('/done/:id', (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare('DELETE FROM money WHERE done_id = ?').run(id);
    db.prepare('DELETE FROM chore_done WHERE id = ?').run(id);
  })();
  res.json(overview(req.account));
});

// Money added to a kid's total (birthday money) or taken out when they
// spend it: { profileId, cents, note }.
function moneyRoute(sign) {
  return (req, res) => {
    const id = Number(req.body?.profileId);
    if (!isKid(id)) throw httpError(400, "That's not one of the kids");
    const amount = cents(req.body?.cents);
    db.prepare('INSERT INTO money (profile_id, cents, note, by_account) VALUES (?, ?, ?, ?)')
      .run(id, sign * amount, text(req.body?.note, 80) || null, req.account.id);
    res.json(overview(req.account));
  };
}
choresRouter.post('/add', moneyRoute(1));
choresRouter.post('/spend', moneyRoute(-1));

// Undo money added or taken out (chore money is undone with its check-off).
choresRouter.delete('/spend/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM money WHERE id = ?').get(Number(req.params.id));
  if (!row) throw httpError(404, 'Already gone');
  if (row.done_id) throw httpError(400, 'Undo the chore instead');
  db.prepare('DELETE FROM money WHERE id = ?').run(row.id);
  res.json(overview(req.account));
});
