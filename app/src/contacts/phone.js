import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';
import { saveContact, currentContacts, birthdayText, PHONE_LABELS, EMAIL_LABELS, DAYS_IN } from './data.js';

// Family Track's contacts and this phone's contacts (android/.../contacts):
//  - From my phone's contacts: the phone's own picker; only the contact
//    picked is read.
//  - Each grown-up's phone can link a family contact to its own contact for
//    them (the server keeps one link per phone). Names are never changed
//    either way: "Abby" here can be "Beautiful Wife" on the phone.
//  - When Contacts opens, linked contacts are read again and anything the
//    phone has that Family Track doesn't is filled in here. Nothing is
//    written to the phone without a grown-up asking.
//  - Check with my phone: for every linked contact, fills in what either
//    side is missing (writing to the phone too) and lists what differs, to
//    pick which is right. It also looks for unlinked family contacts on the
//    phone by their numbers (after switching phones, say), to link them.
// Android asks once to see contacts, and once more to change them. Not in a browser.

const Native = isNative ? registerPlugin('FamilyContacts') : null;

const label = (l, choices) => choices.find((c) => c.toLowerCase() === String(l || '').toLowerCase()) || (l ? String(l).slice(0, 20) : choices[0]);
const MAX_PHONES = 6, MAX_EMAILS = 4;

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
// The way the phone keeps a birthday.
const phoneBirthday = (birthday, year) => (year ? `${year}-${birthday}` : `--${birthday}`);

const digits = (n) => String(n).replace(/\D/g, '').slice(-10);
const lower = (s) => String(s).trim().toLowerCase();
const flat = (a) => String(a || '').toLowerCase().replace(/[\s,]+/g, ' ').trim();

// What the phone said, the way Family Track keeps it (one of each number).
function tidy(r) {
  const seen = new Set();
  const phones = (r.phones || []).filter((p) => {
    const d = digits(p.number);
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  }).map((p) => ({ label: label(p.label, PHONE_LABELS), number: p.number }));
  const seenEmail = new Set();
  const emails = (r.emails || []).filter((e) => {
    const a = lower(e.address);
    if (seenEmail.has(a)) return false;
    seenEmail.add(a);
    return true;
  }).map((e) => ({ label: label(e.label, EMAIL_LABELS), address: e.address }));
  return { name: r.name || '', key: r.key || '', phones, emails, address: r.address || '', ...readBirthday(r.birthday) };
}

// How Family Track's contact c and the phone's contact p differ:
//   toApp   what the phone has that c is missing (a patch for c), or null
//   toPhone what c has that the phone is missing ({ addPhones, addEmails, address, birthday }), or null
//   diffs   [{ field: 'address' | 'birthday', app, phone, appText, phoneText }] where both have one and they differ
export function compare(c, p) {
  const appPhones = new Set(c.phones.map((x) => digits(x.number)));
  const phonePhones = new Set(p.phones.map((x) => digits(x.number)));
  const appEmails = new Set((c.emails || []).map((x) => lower(x.address)));
  const phoneEmails = new Set(p.emails.map((x) => lower(x.address)));
  const toApp = {}, toPhone = {}, diffs = [];

  const newPhones = p.phones.filter((x) => !appPhones.has(digits(x.number)));
  if (newPhones.length && c.phones.length < MAX_PHONES) toApp.phones = [...c.phones, ...newPhones].slice(0, MAX_PHONES);
  const newEmails = p.emails.filter((x) => !appEmails.has(lower(x.address)));
  if (newEmails.length && (c.emails || []).length < MAX_EMAILS) toApp.emails = [...(c.emails || []), ...newEmails].slice(0, MAX_EMAILS);
  const addPhones = c.phones.filter((x) => !phonePhones.has(digits(x.number)));
  if (addPhones.length) toPhone.addPhones = addPhones;
  const addEmails = (c.emails || []).filter((x) => !phoneEmails.has(lower(x.address)));
  if (addEmails.length) toPhone.addEmails = addEmails;

  if (!c.address && p.address) toApp.address = p.address;
  else if (c.address && !p.address) toPhone.address = c.address.replace(/\n/g, ', ');
  else if (c.address && flat(c.address) !== flat(p.address)) {
    diffs.push({ field: 'address', app: c.address, phone: p.address, appText: c.address, phoneText: p.address });
  }

  if (!c.birthday && p.birthday) Object.assign(toApp, { birthday: p.birthday, birthYear: p.birthYear });
  else if (c.birthday && !p.birthday) toPhone.birthday = phoneBirthday(c.birthday, c.birthYear);
  else if (c.birthday && p.birthday) {
    const cy = c.birthYear ?? null, py = p.birthYear ?? null;
    if (c.birthday === p.birthday && cy === py) { /* the same */ }
    else if (c.birthday === p.birthday && !cy) toApp.birthYear = py; // the phone knows the year
    else if (c.birthday === p.birthday && !py) toPhone.birthday = phoneBirthday(c.birthday, cy);
    else {
      diffs.push({
        field: 'birthday', app: { birthday: c.birthday, birthYear: cy }, phone: { birthday: p.birthday, birthYear: py },
        appText: birthdayText(c), phoneText: birthdayText(p)
      });
    }
  }
  return {
    toApp: Object.keys(toApp).length ? toApp : null,
    toPhone: Object.keys(toPhone).length ? toPhone : null,
    diffs
  };
}

// What a fill-in says, for the summary ("2 numbers, birthday").
export function whatText(patch) {
  const out = [];
  const n = (patch.addPhones || patch.phones || []).length, e = (patch.addEmails || patch.emails || []).length;
  if (patch.addPhones?.length || patch.phones) out.push(patch.addPhones ? `${n} ${n === 1 ? 'number' : 'numbers'}` : 'numbers');
  if (patch.addEmails?.length || patch.emails) out.push(patch.addEmails ? `${e} ${e === 1 ? 'email' : 'emails'}` : 'emails');
  if (patch.address) out.push('address');
  if (patch.birthday || patch.birthYear) out.push(patch.birthday ? 'birthday' : 'birth year');
  return out.join(', ');
}

export const phoneContacts = {
  available: !!Native,

  // The contact picked, ready for the editor, or null if nothing was picked.
  async pick() {
    const r = await Native.pick();
    return r?.picked ? tidy(r) : null;
  },

  // This phone's contact for c, or null if it's gone (or contacts aren't allowed).
  async read(c) {
    if (!Native || !c.phoneKey) return null;
    const r = await Native.read({ key: c.phoneKey });
    return r?.found ? tidy(r) : null;
  },

  // Save to the phone: { key } or { name }, plus what to add or set. Returns { key, account }.
  write(body) {
    return Native.write(body);
  },

  // Link c to this phone's contact with that key.
  link(c, key) {
    return saveContact({ ...c, phoneSync: 'here', phoneKey: key });
  },
  unlink(c) {
    return saveContact({ ...c, phoneSync: 'off' });
  },

  // Put c in the phone's contacts as `name`, and link it. Returns the account it went into.
  async add(c, name) {
    const r = await Native.write({
      name, addPhones: c.phones, addEmails: c.emails || [],
      address: c.address ? c.address.replace(/\n/g, ', ') : null,
      birthday: c.birthday ? phoneBirthday(c.birthday, c.birthYear) : null
    });
    if (r.key) await this.link(c, r.key);
    return r.account;
  },

  // When Contacts opens: fill in here what linked contacts' phone entries
  // have and Family Track doesn't (nothing is written to the phone). Returns
  // { gone, differ }: ids no longer on the phone, and ids that differ or
  // that the phone is missing things for.
  async quiet(contacts) {
    const gone = new Set(), differ = new Set();
    for (const c of contacts.filter((x) => x.phoneSync === 'here')) {
      try {
        const p = await this.read(c);
        if (!p) { gone.add(c.id); continue; }
        const d = compare(c, p);
        if (d.toApp) await saveContact({ ...c, ...d.toApp });
        if (d.toPhone || d.diffs.length) differ.add(c.id);
      } catch { /* next time */ }
    }
    return { gone, differ };
  },

  // Check with my phone (all linked contacts, or just `only`): fills in
  // both ways, returns what it did and what's left to pick.
  async check(contacts, { only = null } = {}) {
    const out = { toApp: [], toPhone: [], diffs: [], gone: [], matches: [], failed: [] };
    const list = only ? contacts.filter((c) => only.includes(c.id)) : contacts;
    for (const c of list.filter((x) => x.phoneSync === 'here')) {
      try {
        const p = await this.read(c);
        if (!p) { out.gone.push(c); continue; }
        const d = compare(c, p);
        if (d.toApp) {
          await saveContact({ ...c, ...d.toApp });
          out.toApp.push({ c, what: whatText(d.toApp) });
        }
        if (d.toPhone) {
          await this.write({ key: c.phoneKey, ...d.toPhone });
          out.toPhone.push({ c, what: whatText(d.toPhone) });
        }
        for (const diff of d.diffs) out.diffs.push({ id: c.id, name: c.name, ...diff });
      } catch (e) {
        out.failed.push({ c, message: e.message });
        if (e.code === 'denied') break; // no point asking again for each one
      }
    }
    // Family contacts not linked to this phone: is one of their numbers in its contacts?
    for (const c of list.filter((x) => x.phoneSync !== 'here' && x.phones.length)) {
      for (const ph of c.phones) {
        try {
          const r = await Native.findByNumber({ number: ph.number });
          if (r?.found) {
            out.matches.push({ c, key: r.key, phoneName: r.name, number: ph.number });
            break;
          }
        } catch { /* skip */ }
      }
    }
    return out;
  },

  // A difference picked: 'app' writes Family Track's to the phone, 'phone' saves the phone's here.
  async settle(diff, use) {
    // (As it is now: something else about it may have been saved since.)
    const c = currentContacts().data?.contacts.find((x) => x.id === diff.id);
    if (!c) throw new Error('That contact is gone');
    const { field } = diff;
    if (use === 'app') {
      await this.write({
        key: c.phoneKey,
        ...(field === 'address' ? { address: c.address.replace(/\n/g, ', ') } : { birthday: phoneBirthday(c.birthday, c.birthYear) })
      });
    } else {
      await saveContact({ ...c, ...(field === 'address' ? { address: diff.phone } : diff.phone) });
    }
  }
};
