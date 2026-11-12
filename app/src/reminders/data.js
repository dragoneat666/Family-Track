import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';

// What the Reminders screen (and its Home button) shows: everything comes in
// one go from GET /api/reminders and is kept on the device, so there's still
// something to see with no server in reach. Making or changing a reminder
// needs the server.
//
// After every change this phone's notification plan is fetched again, so
// alarms here are right straight away (other phones catch up within about
// 15 minutes, or when the app is opened there).

const listeners = new Set();
let snapshot = { key: '', data: null, offline: false };

const keyNow = () => `ft.reminders.${api.serverUrl}|${api.knownAccount?.id ?? ''}`;

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

export function useReminders() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

// Fetch it all again. With sendFirst, Done tapped on this phone's
// notifications goes to the server before (if it hadn't yet), so it shows.
export async function refreshReminders({ sendFirst = false } = {}) {
  try {
    got(await api.get('/api/reminders', { timeout: 8000 }));
  } catch (e) {
    if (e.status === 401) throw e;
    publish({ offline: true });
    return;
  }
  if (sendFirst && notify.available) {
    const { fetched } = await notify.sync();
    if (fetched) await api.get('/api/reminders').then(got, () => {});
  }
}

const afterChange = (data) => {
  got(data);
  notify.sync();
};

export async function saveReminder(r) {
  const body = {
    title: r.title, note: r.note, times: r.times, days: r.days, who: r.who,
    each: r.each, nudges: r.nudges, paused: r.paused, doneWho: r.doneWho || null
  };
  afterChange(r.id ? await api.put(`/api/reminders/${r.id}`, body) : await api.post('/api/reminders', body));
}

export async function deleteReminder(id) {
  afterChange(await api.del(`/api/reminders/${id}`));
}

// Done (or undone) for one time today. forId: whose, when everyone taps their own.
export async function markDone(reminder, occ, { forId = null, undo = false } = {}) {
  await api.post('/api/reminders/done', { id: reminder, occ, for: forId, undo });
  afterChange(await api.get('/api/reminders'));
}

// Is it for that person? (Same as the server's.)
export function gets(who, p) {
  if (!who || who.all) return true;
  if (who.groups?.includes(p.isParent ? 'adults' : 'kids')) return true;
  return !!who.ids?.includes(p.id);
}

// What the Home button says: something not done, or what's next today.
export function todayNote(data, now = Date.now()) {
  if (!data) return '';
  if (!data.reminders.length) return '';
  const byId = new Map(data.reminders.map((r) => [r.id, r]));
  const open = (t) => {
    const r = byId.get(t.reminder);
    if (!r) return false;
    return r.each ? r.for.some((id) => !t.done.some((d) => d.profile === id || d.profile === 0)) : !t.done.some((d) => d.profile === 0);
  };
  const late = data.today.filter((t) => t.at <= now && open(t)).length;
  if (late) return `${late} not done yet`;
  const next = data.today.find((t) => t.at > now && open(t));
  if (next) return `Next: ${clockText(next.at)}`;
  return data.today.length ? 'All done today ✓' : '';
}

// ---------- words ----------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// "20:05" -> "8:05 PM"
export function timeText(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const clockText = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function daysText(days) {
  const d = [...days].sort();
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Weekdays';
  if (d.join() === '0,6') return 'Weekends';
  return d.map((n) => DAY_NAMES[n]).join(', ');
}

const andList = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// { all } -> "Everyone"; { groups: ['adults'], ids: [3] } -> "Adults and Sam"
export function whoText(who, people) {
  if (!who || who.all) return 'Everyone';
  const names = [];
  if (who.groups?.includes('adults')) names.push('Adults');
  if (who.groups?.includes('kids')) names.push('Kids');
  for (const id of who.ids || []) {
    const p = people.find((x) => x.id === id);
    if (p) names.push(p.name);
  }
  return andList(names) || 'Nobody';
}

export function nudgesText(nudges) {
  if (!nudges?.length) return 'no reminding again';
  return `again after ${andList(nudges.map((m) => (m % 60 === 0 && m >= 60 ? `${m / 60} h` : `${m} min`)))} if not done`;
}
