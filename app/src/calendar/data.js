import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';
import { timeText } from '../reminders/data.js';

// What the Calendar shows. The server works out every date events happen on
// (GET /api/calendar: from a month back to about a year ahead) and the
// answer is kept on the device, so the calendar still shows with no server
// in reach. Adding or changing events needs the server.

const listeners = new Set();
let snapshot = { key: '', data: null, offline: false };

const keyNow = () => `ft.calendar.${api.serverUrl}|${api.knownAccount?.id ?? ''}`;

function current() {
  const key = keyNow();
  if (snapshot.key !== key) {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(key)); } catch { /* nothing kept */ }
    snapshot = { key, data, offline: false };
  }
  return snapshot;
}

function publish(next) {
  snapshot = { ...current(), ...next };
  for (const fn of listeners) fn();
}

function got(data) {
  try { localStorage.setItem(current().key, JSON.stringify(data)); } catch { /* full or private: fine */ }
  publish({ data, offline: false });
}

export function useCalendar() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

export async function refreshCalendar() {
  try {
    got(await api.get('/api/calendar', { timeout: 8000 }));
  } catch (e) {
    if (e.status === 401) throw e;
    publish({ offline: true });
  }
}

// Days outside what's kept (looking further back): just fetched, not kept.
export const fetchDays = (from, to) => api.get(`/api/calendar?from=${from}&to=${to}`, { timeout: 8000 });

async function afterChange() {
  got(await api.get('/api/calendar'));
  notify.sync(); // this phone's reminders right away; others catch up
}

export async function saveEvent(e) {
  const body = {
    kind: e.kind, title: e.title, note: e.note, place: e.place, allDay: e.allDay,
    startDay: e.startDay, startTime: e.startTime, endDay: e.endDay, endTime: e.endTime,
    repeat: e.repeat, people: e.people, grownupsOnly: e.grownupsOnly, remind: e.remind,
    remindWho: e.remindWho, birthYear: e.birthYear
  };
  const r = e.id ? await api.put(`/api/calendar/${e.id}`, body) : await api.post('/api/calendar', body);
  await afterChange();
  return r.id;
}

export async function deleteEvent(id) {
  await api.del(`/api/calendar/${id}`);
  await afterChange();
}

// Just one date of a repeating event: { skip: true }, { reset: true }, or its new details.
export async function changeDate(eventId, occ, body) {
  await api.put(`/api/calendar/${eventId}/dates/${occ}`, body);
  await afterChange();
}

// ---------- days ----------

const pad = (n) => String(n).padStart(2, '0');
export const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDays = (s, n) => {
  const d = fromDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
export const daysBetween = (a, b) => Math.round((fromDay(b) - fromDay(a)) / 86400000);
export const todayDay = () => toDay(new Date());
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const addMonths = (s, n) => {
  const d = fromDay(monthStart(s));
  d.setMonth(d.getMonth() + n);
  return toDay(d);
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const short = (s) => s.slice(0, 3);

// "Wednesday, November 11" (with the year when it isn't this year)
export function dayText(day, today = todayDay()) {
  const d = fromDay(day);
  const year = day.slice(0, 4) !== today.slice(0, 4) ? `, ${d.getFullYear()}` : '';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}
// "Nov 15"
export const shortDay = (day) => {
  const d = fromDay(day);
  return `${short(MONTHS[d.getMonth()])} ${d.getDate()}`;
};
// "Today - Wednesday, November 11"
export function dayTitle(day, today = todayDay()) {
  const diff = daysBetween(today, day);
  const word = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : '';
  return word ? `${word} - ${dayText(day, today)}` : dayText(day, today);
}

const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
// Which of its weekday in the month a day is: 1-4, or 5 for the last.
export const nthOfMonth = (day) => Math.ceil(Number(day.slice(8)) / 7);
const nthText = (day) => {
  const n = nthOfMonth(day);
  return n >= 5 ? 'last' : ordinal(n);
};

// The choices for how an event repeats, in words, for the day it starts.
export function repeatChoices(startDay) {
  const d = fromDay(startDay);
  const weekday = WEEKDAYS[d.getDay()];
  return [
    ['none', "Doesn't repeat", null],
    ['day', 'Every day', { every: 'day', n: 1 }],
    ['week', `Every week on ${weekday}`, { every: 'week', n: 1 }],
    ['week2', `Every 2 weeks on ${weekday}`, { every: 'week', n: 2 }],
    ['month', `Every month on the ${ordinal(d.getDate())}`, { every: 'month', n: 1, by: 'date' }],
    ['monthday', `Every month on the ${nthText(startDay)} ${weekday}`, { every: 'month', n: 1, by: 'weekday' }],
    ['year', `Every year on ${MONTHS[d.getMonth()]} ${d.getDate()}`, { every: 'year', n: 1 }]
  ];
}

export function repeatKey(r) {
  if (!r) return 'none';
  if (r.every === 'week') return r.n === 2 ? 'week2' : r.n === 1 ? 'week' : 'other';
  if (r.every === 'month') return r.n !== 1 ? 'other' : r.by === 'weekday' ? 'monthday' : 'month';
  return r.n === 1 ? r.every : 'other';
}

// "Every 3 weeks on Tuesday", "Every 2 months on the 2nd Friday".
export function customRepeatText(r, startDay) {
  const d = fromDay(startDay);
  const unit = { day: 'days', week: 'weeks', month: 'months', year: 'years' }[r.every];
  const every = r.n === 1 ? `Every ${unit.slice(0, -1)}` : `Every ${r.n} ${unit}`;
  if (r.every === 'week') return `${every} on ${WEEKDAYS[d.getDay()]}`;
  if (r.every === 'month') return `${every} on the ${r.by === 'weekday' ? `${nthText(startDay)} ${WEEKDAYS[d.getDay()]}` : ordinal(d.getDate())}`;
  if (r.every === 'year') return `${every} on ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return every;
}

export function repeatText(r, startDay) {
  if (!r) return '';
  const key = repeatKey(r);
  const words = key === 'other' ? customRepeatText(r, startDay) : repeatChoices(startDay).find(([k]) => k === key)[1];
  return r.until ? `${words}, until ${shortDay(r.until)}${r.until.slice(0, 4) !== todayDay().slice(0, 4) ? ` ${r.until.slice(0, 4)}` : ''}` : words;
}

// ---------- reminders ----------

// Minutes before it starts. An all-day event starts at midnight, so 360 is
// 6 PM the evening before and -480 is 8 AM that day.
export const REMIND_TIMED = [
  [0, 'At the time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'],
  [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'],
  [2880, '2 days before'], [10080, '1 week before']
];
export const REMIND_ALL_DAY = [
  [-480, 'That day at 8 AM'], [360, 'The evening before (6 PM)'], [1800, '2 days before (6 PM)'], [9000, 'A week before (6 PM)']
];
export const DEFAULT_REMIND = { timed: [1440, 30], allDay: [360] };

export function remindText(m, allDay) {
  const known = (allDay ? REMIND_ALL_DAY : REMIND_TIMED).find(([v]) => v === m);
  if (known) return known[1];
  if (m % 1440 === 0) return `${m / 1440} days before`;
  if (m % 60 === 0) return `${m / 60} hours before`;
  return `${m} minutes before`;
}

// ---------- events in words and colour ----------

export const BIRTHDAY_COLOR = '#ff8a3d';
export const FAMILY_COLOR = '#4f8cff';

export function eventColor(ev, people) {
  if (ev.kind === 'birthday') return BIRTHDAY_COLOR;
  const first = people.find((p) => p.id === ev.people[0]);
  return first?.color || FAMILY_COLOR;
}

export const itemKey = (it) => `${it.event}:${it.occ}`;
export const ageOn = (ev, day) => (ev.kind === 'birthday' && ev.birthYear ? Number(day.slice(0, 4)) - ev.birthYear : null);
export const eventTitle = (ev, it) => (ev.kind === 'birthday' ? `${it.title}'s birthday` : it.title);

// When an item is, in words, e.g. "Wednesday, November 11, 4:00 – 5:00 PM"
export function whenText(it, today = todayDay()) {
  if (it.allDay) {
    return it.endDay === it.startDay ? `${dayText(it.startDay, today)}, all day` : `${dayText(it.startDay, today)} – ${dayText(it.endDay, today)}`;
  }
  if (it.endDay !== it.startDay) {
    return `${dayText(it.startDay, today)}, ${timeText(it.startTime)} – ${dayText(it.endDay, today)}, ${timeText(it.endTime)}`;
  }
  return `${dayText(it.startDay, today)}, ${timeText(it.startTime)}${it.endTime !== it.startTime ? ` – ${timeText(it.endTime)}` : ''}`;
}

// Is this item for someone the calendar is showing? (No one picked: everyone.
// Whole-family events are always shown.)
export const showsFor = (ev, only) => !only?.length || !ev.people.length || ev.people.some((id) => only.includes(id));

// The note on the Home button: what's next today, or tomorrow.
export function nextNote(data, now = new Date()) {
  if (!data) return '';
  const today = toDay(now);
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const on = (day) => data.items.filter((it) => it.startDay <= day && it.endDay >= day);
  const name = (it) => {
    const ev = data.events.find((e) => e.id === it.event);
    return ev ? eventTitle(ev, it) : it.title;
  };
  const todays = on(today);
  const next = todays.find((it) => !it.allDay && it.startDay === today && it.startTime >= hhmm);
  if (next) return `Next: ${name(next)}, ${timeText(next.startTime)}`;
  const allDay = todays.find((it) => it.allDay);
  if (allDay) return `Today: ${name(allDay)}`;
  const tomorrow = on(addDays(today, 1))[0];
  return tomorrow ? `Tomorrow: ${name(tomorrow)}` : '';
}
