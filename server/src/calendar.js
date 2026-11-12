import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';
import { gets, timeText } from './reminders.js';

// The family calendar: appointments, birthdays, things that repeat (therapy
// every other week, dance every week). Grown-ups add and change events;
// kids can look (not at ones marked grown-ups only). Event reminders go to
// grown-ups' phones through the same notification plan as everything else.
//
// The server works out every date an event happens on, so phones and the
// web app just show what they're given. Days are 'YYYY-MM-DD' and times
// 'HH:MM' in the server's local time, which is the family's.

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const AHEAD = 7 * DAY; // how far ahead phones get reminder alarms
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_REMIND = 4 * 7 * 1440; // minutes: four weeks before
const MAX_MOVE = 60; // days one date of a repeating event can move
const TIMING = ['allDay', 'startDay', 'endDay', 'startTime', 'endTime'];

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isAdult = (p) => !!p.is_parent && !p.is_test;

// ---------- days ----------

const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// (At noon, so adding days never trips over a daylight-saving change.)
const fromDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDays = (s, n) => {
  const d = fromDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
const daysBetween = (a, b) => Math.round((fromDay(b) - fromDay(a)) / DAY);
const validDay = (s) => typeof s === 'string' && DAY_RE.test(s) && toDay(fromDay(s)) === s;
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
// The moment a day (and time) starts, in ms.
const moment = (day, time) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};
const todayDay = () => toDay(new Date());

// ---------- repeats ----------

// The nth weekday (1-4) of a month, or the last one (5).
function nthWeekday(y, m, weekday, nth) {
  if (nth >= 5) {
    const last = daysInMonth(y, m);
    const lastWeekday = new Date(y, m, last, 12).getDay();
    return last - ((lastWeekday - weekday + 7) % 7);
  }
  const firstWeekday = new Date(y, m, 1, 12).getDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
}

// Every day an event starts on, in order. `from`: skip ahead to about there.
export function* startDays(ev, from = null) {
  const r = ev.repeat;
  if (!r) {
    yield ev.start_day;
    return;
  }
  const first = fromDay(ev.start_day);
  const y0 = first.getFullYear(), m0 = first.getMonth(), d0 = first.getDate(), w0 = first.getDay();
  const step = r.every === 'day' ? r.n : r.every === 'week' ? 7 * r.n : 0;
  // Days and weeks can jump straight to near `from`.
  let i = step && from && from > ev.start_day ? Math.max(0, Math.floor(daysBetween(ev.start_day, from) / step) - 1) : 0;
  for (let guard = 0; guard < 20000; i++, guard++) {
    let day;
    if (step) {
      day = addDays(ev.start_day, i * step);
    } else if (r.every === 'month') {
      const mm = m0 + i * r.n;
      const y = y0 + Math.floor(mm / 12), m = mm % 12;
      if (r.by === 'weekday') day = toDay(new Date(y, m, nthWeekday(y, m, w0, Math.ceil(d0 / 7)), 12));
      else if (d0 <= daysInMonth(y, m)) day = toDay(new Date(y, m, d0, 12));
      else continue; // no 31st this month
    } else {
      const y = y0 + i * r.n;
      day = toDay(new Date(y, m0, Math.min(d0, daysInMonth(y, m0)), 12)); // Feb 29 -> Feb 28
    }
    if (r.until && day > r.until) return;
    yield day;
  }
}

const parse = (e) => e && {
  ...e,
  repeat: e.repeat ? JSON.parse(e.repeat) : null,
  people: JSON.parse(e.people),
  remind: JSON.parse(e.remind),
  remind_who: JSON.parse(e.remind_who)
};
const eventRow = (id) => parse(db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id)));

function changesOf(eventIds) {
  const out = new Map();
  if (!eventIds.length) return out;
  const rows = db.prepare(`SELECT * FROM event_changes WHERE event_id IN (${eventIds.map(() => '?').join(',')})`).all(...eventIds);
  for (const c of rows) {
    if (!out.has(c.event_id)) out.set(c.event_id, new Map());
    out.get(c.event_id).set(c.occ, { ...c, data: JSON.parse(c.data) });
  }
  return out;
}

// One date of an event, with any change made to just that date.
function occurrence(ev, occ, change) {
  const d = change?.data || {};
  const span = daysBetween(ev.start_day, ev.end_day);
  const allDay = d.allDay ?? !!ev.all_day;
  const startDay = d.startDay ?? occ;
  const endDay = d.endDay ?? addDays(startDay, span);
  return {
    event: ev.id, occ, title: d.title ?? ev.title, note: d.note ?? ev.note, place: d.place ?? ev.place,
    allDay, startDay, endDay,
    startTime: allDay ? null : d.startTime ?? ev.start_time,
    endTime: allDay ? null : d.endTime ?? ev.end_time,
    changed: !!change && (!!change.skipped || Object.keys(d).length > 0)
  };
}

// Every date of an event that touches the days from..to (inclusive).
export function occurrencesIn(ev, changes, from, to) {
  const span = daysBetween(ev.start_day, ev.end_day);
  // Look a little wider: a long event that started before, or one date moved in from elsewhere.
  const lookFrom = addDays(from, -(span + MAX_MOVE + 2));
  const lookTo = addDays(to, MAX_MOVE + 2);
  const out = [];
  for (const occ of startDays(ev, lookFrom)) {
    if (occ > lookTo) break;
    if (occ < lookFrom) continue;
    const change = changes?.get(occ);
    if (change?.skipped) continue;
    const o = occurrence(ev, occ, change);
    if (o.startDay <= to && o.endDay >= from) out.push(o);
  }
  return out;
}

// ---------- reminders on phones ----------

function dayWords(day, fromMs) {
  const diff = daysBetween(toDay(new Date(fromMs)), day);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  const d = fromDay(day);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// The reminders this grown-up's phone should have for the next week.
export function calendarPlan(account) {
  if (!isAdult(account)) return [];
  const now = Date.now();
  // Reminders can be weeks before an event: look that far.
  const from = toDay(new Date(now - 2 * DAY));
  const to = toDay(new Date(now + AHEAD + MAX_REMIND * MIN + 2 * DAY));
  const events = db.prepare("SELECT * FROM events WHERE remind != '[]'").all().map(parse).filter((e) => gets(e.remind_who, account));
  const changes = changesOf(events.map((e) => e.id));
  const entries = [];
  for (const ev of events) {
    for (const o of occurrencesIn(ev, changes.get(ev.id), from, to)) {
      const start = moment(o.startDay, o.allDay ? null : o.startTime);
      const end = o.allDay ? moment(addDays(o.endDay, 1)) : moment(o.endDay, o.endTime);
      const since = Math.max(ev.sched_at, changes.get(ev.id)?.get(o.occ)?.sched_at || 0);
      const birthday = ev.kind === 'birthday';
      const age = birthday && ev.birth_year ? Number(o.startDay.slice(0, 4)) - ev.birth_year : null;
      for (const m of ev.remind) {
        const at = start - m * MIN;
        // Not one that came due before the event was made or moved (no
        // surprise "late" ones), nothing after it's over, a week ahead at most.
        if (at < since || end <= now || at >= now + AHEAD) continue;
        const when = dayWords(o.startDay, at) + (o.allDay ? '' : ` at ${timeText(o.startTime)}`);
        entries.push({
          id: `cal-${ev.id}-${o.occ.replace(/-/g, '')}-${m}`,
          at, channel: 'reminders', quiet: false,
          title: birthday ? `🎂 ${o.title}'s birthday` : o.title,
          body: [when, age ? `turns ${age}` : o.place].filter(Boolean).join(' · '),
          until: end,
          tap: { screen: 'calendar', event: ev.id, occ: o.occ }
        });
      }
    }
  }
  return entries;
}

// ---------- the calendar screen ----------

const toEvent = (e, adult) => ({
  id: e.id, kind: e.kind, title: e.title, note: e.note, place: e.place, allDay: !!e.all_day,
  startDay: e.start_day, startTime: e.start_time, endDay: e.end_day, endTime: e.end_time,
  repeat: e.repeat, people: e.people, grownupsOnly: !!e.grownups_only, birthYear: e.birth_year,
  ...(adult ? { remind: e.remind, remindWho: e.remind_who, createdBy: e.created_by } : {})
});
const people = () => db.prepare('SELECT * FROM profiles WHERE is_test = 0 ORDER BY is_parent DESC, sort, id').all()
  .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, isParent: !!p.is_parent }));

export const calendarRouter = express.Router();

// Everything happening from..to (default: from a month back to a year
// ahead), with the events themselves. Kids don't get grown-ups-only ones.
calendarRouter.get('/', (req, res) => {
  const today = todayDay();
  const from = validDay(req.query.from) ? req.query.from : addDays(today, -31);
  const to = validDay(req.query.to) ? req.query.to : addDays(today, 400);
  if (to < from || daysBetween(from, to) > 800) throw httpError(400, 'Ask for less at a time');
  const adult = isAdult(req.account);
  const events = db.prepare('SELECT * FROM events').all().map(parse).filter((e) => adult || !e.grownups_only);
  const changes = changesOf(events.map((e) => e.id));
  const items = [];
  for (const ev of events) items.push(...occurrencesIn(ev, changes.get(ev.id), from, to));
  items.sort((a, b) => a.startDay.localeCompare(b.startDay) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1)
    || String(a.startTime).localeCompare(String(b.startTime)) || a.title.localeCompare(b.title));
  res.json({ from, to, today, events: events.map((e) => toEvent(e, adult)), items, people: people() });
});

function cleanRepeat(r, startDay) {
  if (!r) return null;
  if (!['day', 'week', 'month', 'year'].includes(r.every)) throw httpError(400, 'Bad repeat');
  const n = Math.min(12, Math.max(1, Math.round(Number(r.n) || 1)));
  const until = r.until ? String(r.until) : null;
  if (until && (!validDay(until) || until < startDay)) throw httpError(400, 'It has to stop after it starts');
  return { every: r.every, n, ...(r.every === 'month' ? { by: r.by === 'weekday' ? 'weekday' : 'date' } : {}), until };
}

function cleanRemindWho(w) {
  const adults = db.prepare('SELECT id FROM profiles WHERE is_parent = 1 AND is_test = 0').all().map((p) => p.id);
  if (!w || w.all || w.groups?.includes('adults')) return { groups: ['adults'] };
  const ids = [...new Set((Array.isArray(w.ids) ? w.ids : []).map(Number))].filter((id) => adults.includes(id));
  return ids.length ? { ids } : { groups: ['adults'] };
}

// The times and dates of an event (or of one date of it).
function cleanWhen(b) {
  const allDay = !!b.allDay;
  if (!validDay(b.startDay)) throw httpError(400, 'Pick the day it starts');
  const endDay = b.endDay == null || b.endDay === '' ? b.startDay : b.endDay;
  if (!validDay(endDay)) throw httpError(400, 'Bad end day');
  if (endDay < b.startDay) throw httpError(400, 'It has to end after it starts');
  if (daysBetween(b.startDay, endDay) > 366) throw httpError(400, 'That is more than a year long');
  let startTime = null, endTime = null;
  if (!allDay) {
    if (!TIME.test(b.startTime || '')) throw httpError(400, 'Pick the time it starts');
    startTime = b.startTime;
    endTime = TIME.test(b.endTime || '') ? b.endTime : startTime;
    if (endDay === b.startDay && endTime < startTime) throw httpError(400, 'It has to end after it starts');
  }
  return { allDay, startDay: b.startDay, endDay, startTime, endTime };
}

function clean(b) {
  const kind = b.kind === 'birthday' ? 'birthday' : 'event';
  const title = text(b.title, 80);
  if (!title) throw httpError(400, kind === 'birthday' ? 'Whose birthday is it?' : 'Give it a name');
  const when = kind === 'birthday' ? cleanWhen({ allDay: true, startDay: b.startDay }) : cleanWhen(b);
  const known = new Set(people().map((p) => p.id));
  // Minutes before it starts; an all-day one starts at midnight, so -480 is 8 AM that day.
  const remind = [...new Set((Array.isArray(b.remind) ? b.remind : []).map(Number))]
    .filter((m) => Number.isInteger(m) && m >= (when.allDay ? -1439 : 0) && m <= MAX_REMIND).sort((x, y) => y - x).slice(0, 5);
  const year = Number(b.birthYear);
  return {
    kind, title, note: text(b.note, 500), place: text(b.place, 120), ...when,
    repeat: kind === 'birthday' ? { every: 'year', n: 1, until: null } : cleanRepeat(b.repeat, when.startDay),
    people: [...new Set((Array.isArray(b.people) ? b.people : []).map(Number))].filter((id) => known.has(id)),
    grownupsOnly: !!b.grownupsOnly,
    remind, remindWho: cleanRemindWho(b.remindWho),
    birthYear: kind === 'birthday' && Number.isInteger(year) && year > 1880 && year <= new Date().getFullYear() ? year : null
  };
}

const row = (e) => [
  e.kind, e.title, e.note, e.place, e.allDay ? 1 : 0, e.startDay, e.startTime, e.endDay, e.endTime,
  e.repeat ? JSON.stringify(e.repeat) : null, JSON.stringify(e.people), e.grownupsOnly ? 1 : 0,
  JSON.stringify(e.remind), JSON.stringify(e.remindWho), e.birthYear
];

calendarRouter.post('/', requireAdult, (req, res) => {
  const e = clean(req.body);
  const now = Date.now();
  const id = db.prepare(`INSERT INTO events (kind, title, note, place, all_day, start_day, start_time, end_day, end_time,
    repeat, people, grownups_only, remind, remind_who, birth_year, sched_at, created_by, created_at, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...row(e), now, req.account.id, now, now).lastInsertRowid;
  res.json({ ok: true, id: Number(id) });
});

calendarRouter.put('/:id', requireAdult, (req, res) => {
  const old = eventRow(req.params.id);
  if (!old) throw httpError(404, 'That event is gone');
  const e = clean({ ...req.body, kind: old.kind });
  const now = Date.now();
  const timing = (x) => JSON.stringify([x.all_day ?? (x.allDay ? 1 : 0), x.start_day ?? x.startDay, x.start_time ?? x.startTime,
    x.end_day ?? x.endDay, x.end_time ?? x.endTime, x.repeat, x.remind, x.remind_who ?? x.remindWho]);
  const moved = timing(old) !== timing({ ...e, all_day: e.allDay ? 1 : 0 });
  db.transaction(() => {
    db.prepare(`UPDATE events SET kind = ?, title = ?, note = ?, place = ?, all_day = ?, start_day = ?, start_time = ?, end_day = ?,
      end_time = ?, repeat = ?, people = ?, grownups_only = ?, remind = ?, remind_who = ?, birth_year = ?, sched_at = ?, changed_at = ?
      WHERE id = ?`).run(...row(e), moved ? now : old.sched_at, now, old.id);
    // A different start or repeat makes different dates: changes made to
    // single dates of the old ones no longer apply.
    if (old.start_day !== e.startDay || JSON.stringify(old.repeat) !== JSON.stringify(e.repeat)) {
      db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(old.id);
    }
  })();
  res.json({ ok: true, id: old.id });
});

calendarRouter.delete('/:id', requireAdult, (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(Number(req.params.id));
    db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
  })();
  res.json({ ok: true });
});

// Just one date of a repeating event: { skip: true }, { reset: true } (back
// to how the others are), or what's different on that date.
calendarRouter.put('/:id/dates/:occ', requireAdult, (req, res) => {
  const ev = eventRow(req.params.id);
  if (!ev) throw httpError(404, 'That event is gone');
  const occ = req.params.occ;
  if (!validDay(occ) || !occurrencesIn(ev, null, occ, occ).some((o) => o.occ === occ)) throw httpError(404, "It isn't on that day");
  const old = changesOf([ev.id]).get(ev.id)?.get(occ);
  const base = occurrence(ev, occ, null);
  let data = {}, skipped = 0;
  if (req.body.skip) skipped = 1;
  else if (!req.body.reset) {
    const when = cleanWhen(req.body);
    if (Math.abs(daysBetween(occ, when.startDay)) > MAX_MOVE) throw httpError(400, 'Move it less than two months, or make a new event');
    const title = text(req.body.title, 80) || ev.title;
    const next = { title, note: text(req.body.note, 500), place: text(req.body.place, 120), ...when };
    // Keep only what differs from the others.
    for (const [k, v] of Object.entries(next)) if (v !== base[k]) data[k] = v;
  }
  // (Back to how the others are is kept as a change of nothing, so a
  // reminder time that passed meanwhile doesn't pop up late.)
  const before = old ? occurrence(ev, occ, old) : base;
  const after = occurrence(ev, occ, { skipped, data });
  const moved = skipped !== (old?.skipped || 0) || TIMING.some((k) => before[k] !== after[k]);
  const schedAt = moved ? Date.now() : old?.sched_at ?? ev.sched_at;
  db.prepare(`INSERT INTO event_changes (event_id, occ, skipped, data, sched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (event_id, occ) DO UPDATE SET skipped = excluded.skipped, data = excluded.data, sched_at = excluded.sched_at`)
    .run(ev.id, occ, skipped, JSON.stringify(data), schedAt);
  res.json({ ok: true });
});
