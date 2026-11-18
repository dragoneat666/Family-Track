import { httpError } from './auth.js';
import { today } from './config.js';

// Weeks for things that come round on set days: reminders, and chores on set
// days. Weeks start on Sunday. "Every 2 weeks" (or 3, up to 12) goes by a
// week it's on (week_of, that week's Sunday): it's on that week, and every
// so many weeks before and after it.

export const MAX_EVERY = 12;
const pad = (n) => String(n).padStart(2, '0');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const fromDay = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Whole days from a to b (YYYY-MM-DD), whatever the clocks did in between.
const daysApart = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// The Sunday the week of `day` (YYYY-MM-DD) starts on.
export function weekStart(day = today()) {
  const date = fromDay(day);
  date.setDate(date.getDate() - date.getDay());
  return dayKey(date);
}

// Is the week of `day` one it's on?
export function onWeek(day, every, weekOf) {
  if (!(every > 1) || !weekOf) return true;
  const weeks = Math.round(daysApart(weekOf, weekStart(day)) / 7);
  return ((weeks % every) + every) % every === 0;
}

// { everyWeeks, weekOf } from what was sent: 1 and null for every week; else
// the week it's on (this week unless said), kept as the first week it's on
// from this week (so the same repeat always looks the same).
export function cleanEvery(every, weekOf) {
  const n = every == null || every === '' ? 1 : Math.round(Number(every));
  if (!(n >= 1 && n <= MAX_EVERY)) throw httpError(400, `Every 1 to ${MAX_EVERY} weeks`);
  if (n === 1) return { everyWeeks: 1, weekOf: null };
  if (weekOf != null && weekOf !== '' && !(DAY.test(String(weekOf)) && !Number.isNaN(fromDay(String(weekOf)).getTime()))) {
    throw httpError(400, 'Bad starting week');
  }
  const now = weekStart();
  const from = weekOf ? weekStart(String(weekOf)) : now;
  const weeks = Math.round(daysApart(now, from) / 7);
  const ahead = ((weeks % n) + n) % n; // weeks from this one to the first it's on
  const first = fromDay(now);
  first.setDate(first.getDate() + 7 * ahead);
  return { everyWeeks: n, weekOf: dayKey(first) };
}

// The same weeks? (Two week_ofs for the same repeat can be different weeks.)
export const sameWeeks = (n1, w1, n2, w2) => (n1 || 1) === (n2 || 1) && ((n1 || 1) === 1 || onWeek(w1, n2, w2));
