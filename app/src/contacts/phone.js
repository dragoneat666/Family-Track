import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';
import { PHONE_LABELS, EMAIL_LABELS, DAYS_IN } from './data.js';

// "From my phone's contacts": the phone's own picker, and only the contact
// picked is read (android/.../contacts/ContactsPlugin.java). Android asks
// once whether Family Track may see contacts. Not in a browser.

const Native = isNative ? registerPlugin('FamilyContacts') : null;

const label = (l, choices) => choices.find((c) => c.toLowerCase() === String(l || '').toLowerCase()) || (l ? String(l).slice(0, 20) : choices[0]);

// "1956-03-04", "--03-04", "19560304" -> { birthday: '03-04', birthYear: 1956 | null }
export function readBirthday(s) {
  const m = /^(\d{4}|-)-?(\d{2})-?(\d{2})/.exec(String(s || '').trim());
  if (!m) return { birthday: null, birthYear: null };
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN[month - 1]) return { birthday: null, birthYear: null };
  const year = m[1] === '-' ? null : Number(m[1]);
  // Some phones keep a made-up year (1604) for "no year".
  const realYear = year && year > 1880 && year <= new Date().getFullYear() ? year : null;
  return { birthday: m[2] + '-' + m[3], birthYear: realYear };
}

export const phoneContacts = {
  available: !!Native,

  // The contact picked, ready for the editor, or null if nothing was picked.
  async pick() {
    const r = await Native.pick();
    if (!r?.picked) return null;
    const seen = new Set();
    const phones = (r.phones || []).filter((p) => {
      const digits = p.number.replace(/\D/g, '').slice(-10);
      if (seen.has(digits)) return false;
      seen.add(digits);
      return true;
    }).map((p) => ({ label: label(p.label, PHONE_LABELS), number: p.number }));
    const seenEmail = new Set();
    const emails = (r.emails || []).filter((e) => {
      const a = e.address.toLowerCase();
      if (seenEmail.has(a)) return false;
      seenEmail.add(a);
      return true;
    }).map((e) => ({ label: label(e.label, EMAIL_LABELS), address: e.address }));
    return { name: r.name || '', phones, emails, address: r.address || '', ...readBirthday(r.birthday) };
  }
};
