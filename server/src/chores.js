import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';
import { today } from './config.js';

// Chores that earn the kids allowance money. Grown-ups make them: a name,
// how many times a week it can be done ("Dishes" 3 times) and what each time
// earns ($1 unless changed). A grown-up checks one off and ticks who did it;
// every kid ticked earns the full amount (two kids on the dishes = $1 each),
// and it counts once towards the week's times. Weeks start on Sunday.
//
// Each kid's money is a running total: chores add to it, and a grown-up
// takes some out when the kid spends it. Kids see the chores and their own
// money (not their brothers' and sisters'), and change nothing.
//
// Money is kept in cents. A deleted chore stays in the history (and the
// money it earned stays earned); undoing a check-off takes its money back.

const MAX_CENTS = 100000; // $1,000
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');

// The Sunday the week of `day` (YYYY-MM-DD) starts on.
export function weekStart(day = today()) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const kidRows = () => db.prepare('SELECT * FROM profiles WHERE is_parent = 0 AND is_test = 0 ORDER BY sort, id').all();
const isKid = (id) => !!db.prepare('SELECT 1 FROM profiles WHERE id = ? AND is_parent = 0 AND is_test = 0').get(Number(id));

function cents(v, { min = 1 } = {}) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > MAX_CENTS) throw httpError(400, 'Check the amount');
  return n;
}

function cleanChore(b, was = {}) {
  const name = 'name' in b ? text(b.name, 60) : was.name;
  if (!name) throw httpError(400, 'Give the chore a name');
  const times = 'times' in b ? Math.round(Number(b.times)) : was.times ?? 1;
  if (!(times >= 1 && times <= 21)) throw httpError(400, 'A chore can be done 1 to 21 times a week');
  return { name, times, cents: 'cents' in b ? cents(b.cents) : was.cents ?? 100 };
}

const choreRow = (id) => {
  const c = db.prepare('SELECT * FROM chores WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  if (!c) throw httpError(404, 'That chore is gone');
  return c;
};

const balance = (profileId) => db.prepare('SELECT COALESCE(SUM(cents), 0) AS n FROM money WHERE profile_id = ?').get(profileId).n;
const earnedSince = (profileId, day) => db.prepare(
  'SELECT COALESCE(SUM(m.cents), 0) AS n FROM money m JOIN chore_done d ON d.id = m.done_id WHERE m.profile_id = ? AND d.day >= ?'
).get(profileId, day).n;

// This week's check-offs, each with who did it.
function doneSince(day) {
  const rows = db.prepare(`
    SELECT d.id, d.chore_id AS choreId, d.day, d.done_at AS doneAt, c.name, c.deleted_at AS deletedAt
    FROM chore_done d JOIN chores c ON c.id = d.chore_id WHERE d.day >= ? ORDER BY d.done_at DESC, d.id DESC`).all(day);
  const who = db.prepare('SELECT profile_id AS id, cents FROM money WHERE done_id = ? ORDER BY profile_id');
  return rows.map((r) => {
    const kids = who.all(r.id);
    return { id: r.id, choreId: r.choreId, name: r.name, day: r.day, doneAt: r.doneAt, kids: kids.map((k) => k.id), cents: kids[0]?.cents ?? 0 };
  });
}

// What a screen shows: the chores with this week's count, the kids' money
// (only their own, for a kid) and this week's check-offs.
function overview(account) {
  const week = weekStart();
  const done = doneSince(week);
  const kidId = account.is_parent ? null : account.id;
  const chores = db.prepare('SELECT * FROM chores WHERE deleted_at IS NULL ORDER BY sort, id').all().map((c) => ({
    id: c.id, name: c.name, times: c.times, cents: c.cents,
    doneThisWeek: done.filter((d) => d.choreId === c.id).length
  }));
  const kids = kidRows().filter((k) => kidId == null || k.id === kidId).map((k) => ({
    id: k.id, name: k.name, emoji: k.emoji, color: k.color,
    balance: balance(k.id), thisWeek: earnedSince(k.id, week)
  }));
  return {
    weekStart: week, today: today(), chores, kids,
    done: kidId == null ? done : done.filter((d) => d.kids.includes(kidId)).map((d) => ({ ...d, kids: [kidId] }))
  };
}

export const choresRouter = express.Router();

choresRouter.get('/', (req, res) => res.json(overview(req.account)));

// One kid's money, newest first: what each chore earned and what was taken out.
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
  db.prepare('INSERT INTO chores (name, times, cents, sort) VALUES (?, ?, ?, ?)').run(c.name, c.times, c.cents, sort);
  res.status(201).json(overview(req.account));
});

// A new amount counts from now on: what was already earned stays.
choresRouter.put('/:id', (req, res) => {
  const was = choreRow(req.params.id);
  const c = cleanChore(req.body || {}, was);
  db.prepare('UPDATE chores SET name = ?, times = ?, cents = ? WHERE id = ?').run(c.name, c.times, c.cents, was.id);
  res.json(overview(req.account));
});

choresRouter.delete('/:id', (req, res) => {
  const c = choreRow(req.params.id);
  db.prepare("UPDATE chores SET deleted_at = datetime('now') WHERE id = ?").run(c.id);
  res.json(overview(req.account));
});

// Checked off: { kids: [ids] }. Each of them earns the chore's amount.
choresRouter.post('/:id/done', (req, res) => {
  const c = choreRow(req.params.id);
  const kids = [...new Set((Array.isArray(req.body?.kids) ? req.body.kids : []).map(Number))];
  if (!kids.length) throw httpError(400, 'Pick who did it');
  if (!kids.every(isKid)) throw httpError(400, "That's not one of the kids");
  const week = weekStart();
  db.transaction(() => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM chore_done WHERE chore_id = ? AND day >= ?').get(c.id, week).n;
    if (n >= c.times) throw httpError(409, `${c.name} is done for this week already`);
    const doneId = db.prepare('INSERT INTO chore_done (chore_id, day, by_account) VALUES (?, ?, ?)').run(c.id, today(), req.account.id).lastInsertRowid;
    const add = db.prepare('INSERT INTO money (profile_id, cents, done_id, by_account) VALUES (?, ?, ?, ?)');
    for (const k of kids) add.run(k, c.cents, doneId, req.account.id);
  })();
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

// Taking money out of a kid's total when they spend it: { profileId, cents, note }.
choresRouter.post('/spend', (req, res) => {
  const id = Number(req.body?.profileId);
  if (!isKid(id)) throw httpError(400, "That's not one of the kids");
  const amount = cents(req.body?.cents);
  db.prepare('INSERT INTO money (profile_id, cents, note, by_account) VALUES (?, ?, ?, ?)')
    .run(id, -amount, text(req.body?.note, 80) || null, req.account.id);
  res.json(overview(req.account));
});

// Undo taking money out (chore money is undone with its check-off).
choresRouter.delete('/spend/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM money WHERE id = ?').get(Number(req.params.id));
  if (!row) throw httpError(404, 'Already gone');
  if (row.done_id) throw httpError(400, 'Undo the chore instead');
  db.prepare('DELETE FROM money WHERE id = ?').run(row.id);
  res.json(overview(req.account));
});
