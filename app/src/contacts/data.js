import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { refreshCalendar } from '../calendar/data.js';

// The Contacts screen's data: everything comes in one go from
// GET /api/contacts and is kept on the device, so numbers can still be
// looked up with no server in reach. Adding or changing one needs the server.

const listeners = new Set();
let snapshot = { key: '', data: null, offline: false };

const keyNow = () => `ft.contacts.${api.serverUrl}|${api.knownAccount?.id ?? ''}`;

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

function got({ contacts, people }) {
  const data = { contacts, people };
  try { localStorage.setItem(current().key, JSON.stringify(data)); } catch { /* full or private: fine */ }
  publish({ data, offline: false });
}

export function useContacts() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

export async function refreshContacts() {
  try {
    got(await api.get('/api/contacts', { timeout: 8000 }));
  } catch (e) {
    if (e.status === 401) throw e;
    publish({ offline: true });
  }
}

// A birthday added, changed or taken away also changes the calendar.
const afterChange = (r) => {
  got(r);
  refreshCalendar().catch(() => {});
  return r.id;
};

export async function saveContact(c) {
  const body = {
    name: c.name, relation: c.relation, phones: c.phones, emails: c.emails, address: c.address,
    birthday: c.birthday, birthYear: c.birthday ? c.birthYear : null, note: c.note, profileId: c.profileId, grownupsOnly: c.grownupsOnly
  };
  return afterChange(c.id ? await api.put(`/api/contacts/${c.id}`, body) : await api.post('/api/contacts', body));
}

export async function deleteContact(id) {
  afterChange(await api.del(`/api/contacts/${id}`));
}

// ---------- showing them ----------

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const PHONE_LABELS = ['Mobile', 'Home', 'Work', 'Other'];
export const EMAIL_LABELS = ['Home', 'Work', 'Other'];

// "March 4, 1956 (turns 70 this year)" / "March 4".
export function birthdayText(c, today = new Date()) {
  if (!c.birthday) return '';
  const [m, d] = c.birthday.split('-').map(Number);
  let s = `${MONTHS[m - 1]} ${d}`;
  if (c.birthYear) {
    const thisYear = today.getFullYear();
    const had = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
    const age = thisYear - c.birthYear - (had ? 0 : 1);
    s += `, ${c.birthYear} (${age})`;
  }
  return s;
}

// What a phone number looks like to dial: digits and a leading +.
export const dialable = (n) => n.replace(/[^\d+]/g, '');

// Initials for the round picture: "Grandma Rose" -> "GR".
export function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

// A steady colour per name, for contacts without an account.
const COLORS = ['#4f8cff', '#ff6b9a', '#26a69a', '#ff8a3d', '#7c5cff', '#2bb673', '#e0533d', '#00a3c4'];
export function nameColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export const matches = (c, q) => {
  if (!q) return true;
  const s = q.toLowerCase();
  const digits = q.replace(/\D/g, '');
  return c.name.toLowerCase().includes(s) || c.relation.toLowerCase().includes(s)
    || (digits.length >= 3 && c.phones.some((p) => p.number.replace(/\D/g, '').includes(digits)));
};
