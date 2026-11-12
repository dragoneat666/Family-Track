import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';
import { saveContact, PHONE_LABELS, EMAIL_LABELS, DAYS_IN } from './data.js';

// "From my phone's contacts": the phone's own picker, and only the contact
// picked is read (android/.../contacts/ContactsPlugin.java). Android asks
// once whether Family Track may see contacts. Not in a browser.
//
// A contact can be kept up to date from the phone it was picked on: when
// Contacts opens there, each such contact is read again and whatever
// changed on the phone (numbers, emails, address, birthday) is saved. The
// names are never touched: they're the family's own ("Abby", not
// "Beautiful Wife").

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

// What the phone said, the way Family Track keeps it (one of each number).
function tidy(r) {
  const seen = new Set();
  const phones = (r.phones || []).filter((p) => {
    const digits = p.number.replace(/\D/g, '').slice(-10);
    if (seen.has(digits)) return false;
    seen.add(digits);
    return true;
  }).map((p) => ({ label: label(p.label, PHONE_LABELS), number: p.number })).slice(0, 6);
  const seenEmail = new Set();
  const emails = (r.emails || []).filter((e) => {
    const a = e.address.toLowerCase();
    if (seenEmail.has(a)) return false;
    seenEmail.add(a);
    return true;
  }).map((e) => ({ label: label(e.label, EMAIL_LABELS), address: e.address })).slice(0, 4);
  return { name: r.name || '', key: r.key || '', phones, emails, address: r.address || '', ...readBirthday(r.birthday) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const phoneContacts = {
  available: !!Native,

  // The contact picked, ready for the editor, or null if nothing was picked.
  async pick() {
    const r = await Native.pick();
    return r?.picked ? tidy(r) : null;
  },

  // Bring one contact up to date from this phone. 'updated', 'same', or
  // 'gone' (not in the phone's contacts any more, or contacts not allowed).
  async update(c) {
    if (!Native || !c.phoneKey) return 'same';
    const r = await Native.read({ key: c.phoneKey });
    if (!r?.found) return 'gone';
    const p = tidy(r);
    const next = {
      ...c,
      phones: p.phones,
      emails: p.emails,
      // An address or birthday the phone doesn't have stays as it is.
      address: p.address || c.address,
      ...(p.birthday ? { birthday: p.birthday, birthYear: p.birthYear ?? (p.birthday === c.birthday ? c.birthYear : null) } : {})
    };
    const changed = !same(next.phones, c.phones) || !same(next.emails, c.emails || []) || next.address !== c.address
      || next.birthday !== c.birthday || (next.birthYear ?? null) !== (c.birthYear ?? null);
    if (!changed) return 'same';
    await saveContact(next);
    return 'updated';
  },

  // All the contacts this phone keeps up to date, quietly. Returns the ids
  // of the ones gone from the phone.
  async updateAll(contacts) {
    const gone = new Set();
    for (const c of contacts.filter((x) => x.phoneSync === 'here')) {
      try {
        if (await this.update(c) === 'gone') gone.add(c.id);
      } catch { /* next time */ }
    }
    return gone;
  }
};
