import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';

// The family's contacts: grandparents, aunts and uncles, the dentist. Grown-
// ups add and change them; kids can look up a number (not at contacts
// marked grown-ups only, and without emails or notes).
//
// A contact's birthday is on the calendar as a birthday event linked to it
// (events.contact_id). Changing the birthday here changes that event, and
// changing the event's name or date on the calendar changes the contact.

const MAX_PHONES = 6;
const MAX_EMAILS = 4;
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Birthdays with no year are kept on the calendar from 2000 (a leap year, so Feb 29 works).
const NO_YEAR = 2000;
const BIRTHDAY_REMIND = [360]; // 6 PM the evening before, like birthdays made on the calendar
const YEARLY = JSON.stringify({ every: 'year', n: 1, until: null });

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
    name, relation: text(b.relation, 60), phones, emails, address: lines(b.address, 300),
    birthday, birthYear: year, note: lines(b.note, 1000), profileId, grownupsOnly: !!b.grownupsOnly
  };
}

// ---------- the birthday on the calendar ----------

// Make, change or take away the calendar birthday of a contact (as saved).
function syncBirthday(c, accountId) {
  const ev = db.prepare('SELECT * FROM events WHERE contact_id = ?').get(c.id);
  if (!c.birthday) {
    if (ev) {
      db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(ev.id);
      db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    }
    return;
  }
  const now = Date.now();
  const day = `${c.birth_year ?? NO_YEAR}-${c.birthday}`;
  const people = JSON.stringify(c.profile_id ? [c.profile_id] : []);
  if (ev) {
    const moved = ev.start_day !== day;
    db.prepare(`UPDATE events SET title = ?, start_day = ?, end_day = ?, birth_year = ?, people = ?, grownups_only = ?,
      sched_at = ?, changed_at = ? WHERE id = ?`)
      .run(c.name, day, day, c.birth_year, people, c.grownups_only, moved ? now : ev.sched_at, now, ev.id);
    if (moved) db.prepare('DELETE FROM event_changes WHERE event_id = ?').run(ev.id);
  } else {
    db.prepare(`INSERT INTO events (kind, title, all_day, start_day, end_day, repeat, people, grownups_only, remind, remind_who,
      birth_year, sched_at, created_by, created_at, changed_at, contact_id)
      VALUES ('birthday', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(c.name, day, day, YEARLY, people, c.grownups_only, JSON.stringify(BIRTHDAY_REMIND), JSON.stringify({ groups: ['adults'] }),
        c.birth_year, now, accountId, now, now, c.id);
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

const toContact = (c, adult, known) => ({
  id: c.id, name: c.name, relation: c.relation, phones: c.phones, address: c.address,
  birthday: c.birthday, birthYear: c.birth_year, profileId: known.has(c.profile_id) ? c.profile_id : null,
  grownupsOnly: !!c.grownups_only,
  ...(adult ? { emails: c.emails, note: c.note, changedAt: c.changed_at } : {})
});

function everything(account) {
  const adult = isAdult(account);
  const ps = people();
  const known = new Set(ps.map((p) => p.id));
  const contacts = db.prepare('SELECT * FROM contacts').all().map(parse)
    .filter((c) => adult || !c.grownups_only)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((c) => toContact(c, adult, known));
  return { contacts, people: ps };
}

export const contactsRouter = express.Router();

contactsRouter.get('/', (req, res) => res.json(everything(req.account)));

const row = (c) => [c.name, c.relation, JSON.stringify(c.phones), JSON.stringify(c.emails), c.address, c.birthday, c.birthYear,
  c.note, c.profileId, c.grownupsOnly ? 1 : 0];

contactsRouter.post('/', requireAdult, (req, res) => {
  const c = clean(req.body);
  const now = Date.now();
  let id;
  db.transaction(() => {
    id = Number(db.prepare(`INSERT INTO contacts (name, relation, phones, emails, address, birthday, birth_year, note, profile_id,
      grownups_only, created_by, created_at, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...row(c), req.account.id, now, now).lastInsertRowid);
    syncBirthday(contactRow(id), req.account.id);
  })();
  res.json({ ok: true, id, ...everything(req.account) });
});

contactsRouter.put('/:id', requireAdult, (req, res) => {
  const old = contactRow(req.params.id);
  if (!old) throw httpError(404, 'That contact is gone');
  const c = clean(req.body);
  db.transaction(() => {
    db.prepare(`UPDATE contacts SET name = ?, relation = ?, phones = ?, emails = ?, address = ?, birthday = ?, birth_year = ?,
      note = ?, profile_id = ?, grownups_only = ?, changed_at = ? WHERE id = ?`).run(...row(c), Date.now(), old.id);
    syncBirthday(contactRow(old.id), req.account.id);
  })();
  res.json({ ok: true, id: old.id, ...everything(req.account) });
});

contactsRouter.delete('/:id', requireAdult, (req, res) => {
  const id = Number(req.params.id);
  db.transaction(() => {
    syncBirthday({ id, birthday: null });
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  })();
  res.json({ ok: true, ...everything(req.account) });
});
