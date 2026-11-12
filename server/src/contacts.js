import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';

// The family's contacts: grandparents, aunts and uncles, the dentist. Grown-
// ups add and change them; kids can look up a number (not at contacts
// marked grown-ups only, and without emails or notes), under the name the
// kids know them by ("Grandpa") when there is one.
//
// A contact's birthday is on the calendar as a birthday event linked to it
// (events.contact_id), on everyone's calendar, the kids' only, the grown-
// ups' only, or none. Changing the birthday here changes that event, and
// changing the event's name or date on the calendar changes the contact.
//
// A contact can be linked to a grown-up's phone's contacts (each phone its
// own link, contact_links). That phone then keeps the two in step: it fills
// in what either side is missing and asks about what differs. Names are
// never changed either way: they're the family's own.

const MAX_PHONES = 6;
const MAX_EMAILS = 4;
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Birthdays with no year are kept on the calendar from 2000 (a leap year, so Feb 29 works).
const NO_YEAR = 2000;
const BIRTHDAY_REMIND = [360]; // 6 PM the evening before, like birthdays made on the calendar
const YEARLY = JSON.stringify({ every: 'year', n: 1, until: null });
const CALENDARS = ['everyone', 'kids', 'grownups', 'none'];

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v, max) => String(v ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max);
const isAdult = (p) => !!p.is_parent && !p.is_test;

const parse = (c) => c && { ...c, phones: JSON.parse(c.phones), emails: JSON.parse(c.emails) };
const contactRow = (id) => parse(db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(id)));

const people = () => db.prepare('SELECT * FROM profiles WHERE is_test = 0 ORDER BY is_parent DESC, sort, id').all()
  .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, isParent: !!p.is_parent }));

const validMonthDay = (md) => {
  if (!MD.test(md || '')) return false;
  const [m, d] = md.split('-').map(Number);
  return d <= DAYS_IN[m - 1];
};

function clean(b) {
  const name = text(b.name, 80);
  if (!name) throw httpError(400, 'Give them a name');
  const phones = (Array.isArray(b.phones) ? b.phones : [])
    .map((p) => ({ label: text(p?.label, 20), number: text(p?.number, 40) }))
    .filter((p) => /\d/.test(p.number)).slice(0, MAX_PHONES);
  const emails = (Array.isArray(b.emails) ? b.emails : [])
    .map((e) => ({ label: text(e?.label, 20), address: text(e?.address, 120) }))
    .filter((e) => e.address.includes('@')).slice(0, MAX_EMAILS);
  let birthday = b.birthday ? String(b.birthday) : null;
  if (birthday && !validMonthDay(birthday)) throw httpError(400, "That birthday isn't a real date");
  let year = birthday && b.birthYear != null && b.birthYear !== '' ? Number(b.birthYear) : null;
  if (year != null && !(Number.isInteger(year) && year > 1880 && year <= new Date().getFullYear())) throw httpError(400, 'Check the year they were born');
  if (year != null && birthday === '02-29' && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
    throw httpError(400, `${year} had no February 29`);
  }
  const known = new Set(people().map((p) => p.id));
  const profileId = known.has(Number(b.profileId)) ? Number(b.profileId) : null;
  return {
    name, relation: text(b.relation, 60), kidsName: text(b.kidsName, 80), phones, emails, address: lines(b.address, 300),
    birthday, birthYear: year, note: lines(b.note, 1000), profileId, grownupsOnly: !!b.grownupsOnly,
    calendar: CALENDARS.includes(b.calendar) ? b.calendar : 'everyone'
  };
}

// ---------- the birthday on the calendar ----------

// Make, change or take away the calendar birthday of a contact (as saved).
function syncBirthday(c, accountId) {
  const ev = db.prepare('SELECT * FROM events WHERE contact_id = ?').get(c.id);
  // (A grown-ups-only contact's birthday can't be on the kids' calendar.)
  const on = c.calendar === 'kids' && c.grownups_only ? 'none' : c.calendar;
  if (!c.birthday || on === 'none') {
    if (ev) {
      db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(ev.id);
      db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    }
    return;
  }
  const now = Date.now();
  const day = `${c.birth_year ?? NO_YEAR}-${c.birthday}`;
  const people = JSON.stringify(c.profile_id ? [c.profile_id] : []);
  const grownupsOnly = c.grownups_only || on === 'grownups' ? 1 : 0;
  const kidsOnly = on === 'kids' ? 1 : 0;
  if (ev) {
    const moved = ev.start_day !== day;
    // Kids-only birthdays remind nobody (reminders go to grown-ups);
    // back on a grown-up's calendar, the usual reminder comes back.
    const remind = kidsOnly ? '[]' : ev.kids_only && ev.remind === '[]' ? JSON.stringify(BIRTHDAY_REMIND) : ev.remind;
    db.prepare(`UPDATE events SET title = ?, start_day = ?, end_day = ?, birth_year = ?, people = ?, grownups_only = ?, kids_only = ?,
      remind = ?, sched_at = ?, changed_at = ? WHERE id = ?`)
      .run(c.name, day, day, c.birth_year, people, grownupsOnly, kidsOnly, remind,
        moved || remind !== ev.remind ? now : ev.sched_at, now, ev.id);
    if (moved) db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(ev.id);
  } else {
    db.prepare(`INSERT INTO events (kind, title, all_day, start_day, end_day, repeat, people, grownups_only, kids_only, remind, remind_who,
      birth_year, sched_at, created_by, created_at, changed_at, contact_id)
      VALUES ('birthday', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.name, day, day, YEARLY, people, grownupsOnly, kidsOnly, kidsOnly ? '[]' : JSON.stringify(BIRTHDAY_REMIND),
        JSON.stringify({ groups: ['adults'] }), c.birth_year, now, accountId, now, now, c.id);
  }
}

// The calendar changed a linked birthday (ev as cleaned there): the contact follows.
export function birthdayChanged(contactId, ev) {
  const year = ev.birthYear ?? null;
  db.prepare('UPDATE contacts SET name = ?, birthday = ?, birth_year = ?, profile_id = ?, changed_at = ? WHERE id = ?')
    .run(ev.title, ev.startDay.slice(5), year, ev.people[0] ?? null, Date.now(), contactId);
}

// The calendar deleted a linked birthday: the contact keeps everything else.
export function birthdayDeleted(contactId) {
  db.prepare('UPDATE contacts SET birthday = NULL, birth_year = NULL, changed_at = ? WHERE id = ?').run(Date.now(), contactId);
}

// ---------- routes ----------

// What the kids call a contact, if it's different.
export const kidsNames = () => new Map(db.prepare("SELECT id, kids_name FROM contacts WHERE kids_name != ''").all()
  .map((c) => [c.id, c.kids_name]));

// contact id -> Map(device id -> phone key)
function links() {
  const out = new Map();
  for (const l of db.prepare('SELECT * FROM contact_links').all()) {
    if (!out.has(l.contact_id)) out.set(l.contact_id, new Map());
    out.get(l.contact_id).set(l.device_id, l.phone_key);
  }
  return out;
}

const toContact = (c, adult, known, deviceId, linked) => ({
  id: c.id, name: adult ? c.name : c.kids_name || c.name, relation: c.relation, phones: c.phones, address: c.address,
  birthday: c.birthday, birthYear: c.birth_year, profileId: known.has(c.profile_id) ? c.profile_id : null,
  grownupsOnly: !!c.grownups_only,
  ...(adult ? {
    kidsName: c.kids_name, emails: c.emails, note: c.note, calendar: c.calendar, changedAt: c.changed_at,
    // Linked to this device's contacts (with its key), and/or other phones'.
    phoneSync: linked?.has(deviceId) ? 'here' : linked?.size ? 'elsewhere' : null,
    otherPhones: [...(linked?.keys() || [])].filter((d) => d !== deviceId).length,
    ...(linked?.has(deviceId) ? { phoneKey: linked.get(deviceId) } : {})
  } : {})
});

function everything(account, device) {
  const adult = isAdult(account);
  const ps = people();
  const known = new Set(ps.map((p) => p.id));
  const linked = adult ? links() : new Map();
  const contacts = db.prepare('SELECT * FROM contacts').all().map(parse)
    .filter((c) => adult || !c.grownups_only)
    .map((c) => toContact(c, adult, known, device?.id, linked.get(c.id)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { contacts, people: ps };
}

export const contactsRouter = express.Router();

contactsRouter.get('/', (req, res) => res.json(everything(req.account, req.device)));

const row = (c) => [c.name, c.relation, c.kidsName, JSON.stringify(c.phones), JSON.stringify(c.emails), c.address, c.birthday,
  c.birthYear, c.note, c.profileId, c.grownupsOnly ? 1 : 0, c.calendar];

// This phone's link: { phoneSync: true, phoneKey } links it (or moves the
// link to another of the phone's contacts), phoneSync false unlinks it.
// Left out, it stays as it was. Other phones' links aren't touched.
function phoneLink(b, contactId, device) {
  if (!device) return;
  if (b.phoneSync === false) {
    db.prepare('DELETE FROM contact_links WHERE contact_id = ? AND device_id = ?').run(contactId, device.id);
  } else if (b.phoneSync && typeof b.phoneKey === 'string' && b.phoneKey) {
    db.prepare(`INSERT INTO contact_links (contact_id, device_id, phone_key) VALUES (?, ?, ?)
      ON CONFLICT (contact_id, device_id) DO UPDATE SET phone_key = excluded.phone_key`).run(contactId, device.id, b.phoneKey.slice(0, 500));
  }
}

contactsRouter.post('/', requireAdult, (req, res) => {
  const c = clean(req.body);
  const now = Date.now();
  let id;
  db.transaction(() => {
    id = Number(db.prepare(`INSERT INTO contacts (name, relation, kids_name, phones, emails, address, birthday, birth_year, note,
      profile_id, grownups_only, calendar, created_by, created_at, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...row(c), req.account.id, now, now).lastInsertRowid);
    phoneLink(req.body, id, req.device);
    syncBirthday(contactRow(id), req.account.id);
  })();
  res.json({ ok: true, id, ...everything(req.account, req.device) });
});

contactsRouter.put('/:id', requireAdult, (req, res) => {
  const old = contactRow(req.params.id);
  if (!old) throw httpError(404, 'That contact is gone');
  const c = clean(req.body);
  db.transaction(() => {
    db.prepare(`UPDATE contacts SET name = ?, relation = ?, kids_name = ?, phones = ?, emails = ?, address = ?, birthday = ?,
      birth_year = ?, note = ?, profile_id = ?, grownups_only = ?, calendar = ?, changed_at = ?
      WHERE id = ?`).run(...row(c), Date.now(), old.id);
    phoneLink(req.body, old.id, req.device);
    syncBirthday(contactRow(old.id), req.account.id);
  })();
  res.json({ ok: true, id: old.id, ...everything(req.account, req.device) });
});

contactsRouter.delete('/:id', requireAdult, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    syncBirthday({ id, birthday: null });
    db.prepare('DELETE FROM contact_links WHERE contact_id = ?').run(id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  })();
  res.json({ ok: true, ...everything(req.account, req.device) });
});
