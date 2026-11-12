import { useEffect, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import { phoneContacts } from './phone.js';
import {
  useContacts, currentContacts, refreshContacts, saveContact, deleteContact, birthdayText, dialable, initials, nameColor, matches,
  MONTHS, DAYS_IN, PHONE_LABELS, EMAIL_LABELS, CALENDAR_CHOICES
} from './data.js';

const blank = () => ({
  name: '', relation: '', kidsName: '', phones: [{ label: 'Mobile', number: '' }], emails: [], address: '',
  birthday: null, birthYear: null, note: '', profileId: null, grownupsOnly: false, calendar: 'everyone', phoneSync: null
});
const calendarText = (c) => CALENDAR_CHOICES.find(([k]) => k === c.calendar)?.[1] || 'Everyone';

// Everyone's numbers, addresses and birthdays. Grown-ups add and change
// them (canEdit) and can call, text, email or map from here; kids just look
// numbers up.
export default function ContactsScreen({ canEdit, onAuthLost }) {
  const { data, offline } = useContacts();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // contact id
  const [editing, setEditing] = useState(null); // a contact being made or changed
  const [gone, setGone] = useState(new Set()); // kept up to date from this phone, but not in its contacts any more

  useEffect(() => {
    const refresh = () => refreshContacts().catch((e) => e.status === 401 && onAuthLost?.());
    // Then bring the ones this phone keeps up to date in line with its contacts.
    refresh().then(() => {
      const { data: d, offline: off } = currentContacts();
      if (canEdit && phoneContacts.available && d && !off) phoneContacts.updateAll(d.contacts).then(setGone);
    });
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!data) {
    return offline
      ? <p className="sync-note">Can't reach the server, and contacts haven't been loaded on this device yet.</p>
      : <div className="spinner" />;
  }

  const people = new Map(data.people.map((p) => [p.id, p]));
  const shown = data.contacts.filter((c) => matches(c, q.trim()));
  const opened = data.contacts.find((c) => c.id === open);
  return (
    <div className="stack con-screen">
      {offline && <p className="sync-note">📴 Can't reach the server: these are the contacts from last time.{canEdit ? ' Changes need the server.' : ''}</p>}

      <div className="row con-top">
        <input className="con-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Find someone" />
        {canEdit && <button className="btn primary" disabled={offline} onClick={() => setEditing(blank())}>+ Add</button>}
      </div>

      <ul className="con-list">
        {shown.map((c) => (
          <li key={c.id}>
            <button className="con-row" onClick={() => setOpen(c.id)}>
              <Avatar c={c} person={people.get(c.profileId)} />
              <span className="con-row-text">
                <b>{c.name}</b>
                {c.relation && <small className="muted">{c.relation}</small>}
              </span>
              {c.phones[0] && <span className="con-row-phone">{c.phones[0].number}</span>}
            </button>
          </li>
        ))}
        {!shown.length && (
          <li className="con-empty muted">
            {q.trim() ? `Nobody called "${q.trim()}"` : canEdit ? 'No contacts yet. + Add puts someone in.' : 'No contacts yet.'}
          </li>
        )}
      </ul>

      {opened && !editing && (
        <ContactSheet c={opened} person={people.get(opened.profileId)} canEdit={canEdit} offline={offline} gone={gone.has(opened.id)}
          onGone={(isGone) => setGone((g) => { const n = new Set(g); if (isGone) n.add(opened.id); else n.delete(opened.id); return n; })}
          onClose={() => setOpen(null)} onEdit={() => setEditing(opened)} />
      )}
      {editing && (
        <ContactEditor start={editing} people={data.people} contacts={data.contacts} offline={offline}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); setOpen(id); }}
          onDeleted={() => { setEditing(null); setOpen(null); }} />
      )}
    </div>
  );
}

function Avatar({ c, person, big }) {
  const cls = big ? 'con-avatar big' : 'con-avatar';
  if (person) return <span className={cls} style={{ background: person.color }}>{person.emoji}</span>;
  return <span className={cls} style={{ background: nameColor(c.name) }}>{initials(c.name) || '?'}</span>;
}

function ContactSheet({ c, person, canEdit, offline, gone, onGone, onClose, onEdit }) {
  const [updating, setUpdating] = useState('');
  async function updateNow() {
    setUpdating('…');
    try {
      const r = await phoneContacts.update(c);
      onGone(r === 'gone');
      setUpdating(r === 'updated' ? 'Updated from your phone ✓' : r === 'same' ? 'Already the same as your phone ✓' : '');
    } catch (e) {
      setUpdating(e.message);
    }
  }
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address.replace(/\n/g, ', '))}`;
  return (
    <Sheet title={c.name} onClose={onClose}>
      <div className="con-head">
        <Avatar c={c} person={person} big />
        <div className="stack tight">
          <b className="con-name">{c.name}</b>
          {c.relation && <span className="muted">{c.relation}</span>}
          {canEdit && c.kidsName && <span className="muted small">The kids call them {c.kidsName}</span>}
          {person && <span className="muted small">Family Track: {person.emoji} {person.name}</span>}
        </div>
      </div>

      {c.phones.map((p, i) => (
        <div key={`p${i}`} className="con-line">
          <span className="con-label">{p.label || 'Phone'}</span>
          <span className="con-value">{p.number}</span>
          {canEdit && (
            <span className="con-actions">
              <a className="btn small" href={`tel:${dialable(p.number)}`}>📞 Call</a>
              <a className="btn small" href={`sms:${dialable(p.number)}`}>💬 Text</a>
            </span>
          )}
        </div>
      ))}
      {(c.emails || []).map((e, i) => (
        <div key={`e${i}`} className="con-line">
          <span className="con-label">{e.label || 'Email'}</span>
          <span className="con-value">{e.address}</span>
          <span className="con-actions"><a className="btn small" href={`mailto:${e.address}`}>✉️ Email</a></span>
        </div>
      ))}
      {c.address && (
        <div className="con-line">
          <span className="con-label">Address</span>
          <span className="con-value pre">{c.address}</span>
          {canEdit && <span className="con-actions"><a className="btn small" href={map} target="_blank" rel="noreferrer">🗺️ Map</a></span>}
        </div>
      )}
      {c.birthday && (
        <div className="con-line">
          <span className="con-label">Birthday</span>
          <span className="con-value">🎂 {birthdayText(c)}</span>
          {canEdit && <span className="con-actions muted small">📅 {calendarText(c)}</span>}
        </div>
      )}
      {c.note && <p className="con-note pre">{c.note}</p>}
      {c.grownupsOnly && <p className="muted small">🔒 Only grown-ups see this contact.</p>}
      {canEdit && c.phoneSync === 'here' && (
        <div className="stack tight">
          <p className="muted small">🔄 Kept up to date from this phone's contacts (not the name).</p>
          {gone && <p className="sync-note">This phone's contacts don't have them any more (or Family Track isn't allowed to see contacts). Pick them again in ✏️ Change, or stop keeping them up to date.</p>}
          {phoneContacts.available && <button className="btn" disabled={offline || updating === '…'} onClick={updateNow}>🔄 Update from my phone now</button>}
          {updating && updating !== '…' && <p className="muted small">{updating}</p>}
        </div>
      )}
      {canEdit && c.phoneSync === 'elsewhere' && <p className="muted small">🔄 Kept up to date from another grown-up's phone.</p>}
      {!c.phones.length && !c.address && !c.birthday && !(c.emails || []).length && <p className="muted">Nothing else saved for them yet.</p>}

      {canEdit && <button className="btn" disabled={offline} onClick={onEdit}>✏️ Change</button>}
    </Sheet>
  );
}

function ContactEditor({ start, people, contacts, offline, onClose, onSaved, onDeleted }) {
  const [c, setC] = useState(() => ({
    ...start, kidsName: start.kidsName || '', calendar: start.calendar || 'everyone',
    phones: start.phones.map((p) => ({ ...p })), emails: (start.emails || []).map((e) => ({ ...e }))
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const set = (patch) => setC((x) => ({ ...x, ...patch }));
  const [month, day] = c.birthday ? c.birthday.split('-').map(Number) : [0, 0];
  const thisYear = new Date().getFullYear();
  const taken = new Map(contacts.filter((x) => x.profileId && x.id !== start.id).map((x) => [x.profileId, x.name]));
  const sameName = !start.id && contacts.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());

  const setBirthday = (m, d) => {
    if (!m) return set({ birthday: null, birthYear: null });
    const dd = Math.min(d || 1, DAYS_IN[m - 1]);
    set({ birthday: `${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}` });
  };
  const setList = (key, i, patch) => set({ [key]: c[key].map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const drop = (key, i) => set({ [key]: c[key].filter((_, n) => n !== i) });

  async function fromPhone() {
    setError('');
    try {
      const p = await phoneContacts.pick();
      if (!p) return;
      // What's typed already stays; the phone's fills in the rest.
      const typedPhones = c.phones.filter((x) => x.number.trim());
      const typedEmails = c.emails.filter((x) => x.address.trim());
      set({
        phoneKey: p.key, phoneSync: p.key ? 'here' : c.phoneSync, // kept up to date from here from now on (unless unticked)
        name: c.name.trim() || p.name,
        phones: typedPhones.length ? typedPhones : p.phones.length ? p.phones : c.phones,
        emails: typedEmails.length ? typedEmails : p.emails,
        address: c.address.trim() || p.address,
        ...(c.birthday || !p.birthday ? {} : { birthday: p.birthday, birthYear: p.birthYear })
      });
    } catch (e) {
      setError(e.message || "Couldn't open the phone's contacts");
    }
  }

  const yearBad = c.birthday && c.birthYear != null && c.birthYear !== '' && !(Number(c.birthYear) > 1880 && Number(c.birthYear) <= thisYear);
  const canSave = !busy && !offline && c.name.trim() && !yearBad;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const id = await saveContact({ ...c, birthYear: c.birthYear === '' || c.birthYear == null ? null : Number(c.birthYear) });
      onSaved(id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await deleteContact(start.id);
      onDeleted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={start.id ? `Change ${start.name}` : 'New contact'} onClose={onClose} closeLabel="Cancel">
      {phoneContacts.available && (
        <button type="button" className="btn" onClick={fromPhone}>📱 From my phone's contacts</button>
      )}
      <label>
        Name
        <input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Grandma Rose" maxLength={80} />
      </label>
      {sameName && <p className="muted small">There's already a contact called {sameName.name}.</p>}
      {(start.phoneSync || c.phoneKey) && (
        <label className="inline check">
          <input type="checkbox" checked={c.phoneSync === 'here' || c.phoneSync === 'elsewhere'}
            onChange={(e) => set({ phoneSync: !e.target.checked ? 'off' : c.phoneKey ? 'here' : start.phoneSync })} />
          <span>Keep up to date from {c.phoneKey ? 'my' : "another grown-up's"} phone's contacts
            <span className="muted small"> (numbers, emails, address and birthday; the names here stay yours)</span></span>
        </label>
      )}
      <label>
        <span>What the kids call them <span className="muted small">(optional: the kids see this instead of the name)</span></span>
        <input value={c.kidsName} onChange={(e) => set({ kidsName: e.target.value })} placeholder="Grandpa" maxLength={80} />
      </label>
      <label>
        <span>Who they are <span className="muted small">(optional)</span></span>
        <input value={c.relation} onChange={(e) => set({ relation: e.target.value })} placeholder="Mom's mom, the kids' dentist…" maxLength={60} />
      </label>

      <div className="stack rem-field">
        <b>Phone numbers</b>
        {c.phones.map((p, i) => (
          <div key={i} className="row con-edit-line">
            <select value={PHONE_LABELS.includes(p.label) ? p.label : p.label || 'Other'} onChange={(e) => setList('phones', i, { label: e.target.value })}>
              {[...new Set([...PHONE_LABELS, p.label || 'Other'])].map((l) => <option key={l}>{l}</option>)}
            </select>
            <input type="tel" value={p.number} onChange={(e) => setList('phones', i, { number: e.target.value })} placeholder="Number" maxLength={40} />
            <button type="button" className="btn small" onClick={() => drop('phones', i)} title="Take this number off">✕</button>
          </div>
        ))}
        {c.phones.length < 6 && (
          <button type="button" className="btn small" onClick={() => set({ phones: [...c.phones, { label: c.phones.length ? 'Home' : 'Mobile', number: '' }] })}>+ Number</button>
        )}
      </div>

      <div className="stack rem-field">
        <b>Email</b>
        {c.emails.map((e, i) => (
          <div key={i} className="row con-edit-line">
            <select value={EMAIL_LABELS.includes(e.label) ? e.label : e.label || 'Other'} onChange={(ev) => setList('emails', i, { label: ev.target.value })}>
              {[...new Set([...EMAIL_LABELS, e.label || 'Other'])].map((l) => <option key={l}>{l}</option>)}
            </select>
            <input type="email" value={e.address} onChange={(ev) => setList('emails', i, { address: ev.target.value })} placeholder="Email" maxLength={120} />
            <button type="button" className="btn small" onClick={() => drop('emails', i)} title="Take this email off">✕</button>
          </div>
        ))}
        {c.emails.length < 4 && (
          <button type="button" className="btn small" onClick={() => set({ emails: [...c.emails, { label: 'Home', address: '' }] })}>+ Email</button>
        )}
      </div>

      <label>
        Address
        <textarea rows={3} value={c.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} />
      </label>

      <div className="stack rem-field">
        <b>Birthday</b>
        <div className="row con-edit-line">
          <select value={month} onChange={(e) => setBirthday(Number(e.target.value), day)}>
            <option value={0}>No birthday</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          {month > 0 && (
            <>
              <select value={day} onChange={(e) => setBirthday(month, Number(e.target.value))}>
                {Array.from({ length: DAYS_IN[month - 1] }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
              <input className="con-year" type="number" inputMode="numeric" value={c.birthYear ?? ''} placeholder="Year"
                onChange={(e) => set({ birthYear: e.target.value === '' ? null : e.target.value })} />
            </>
          )}
        </div>
        {month > 0 && (
          <>
            <span className="muted small">On the calendar for</span>
            <div className="row wrap">
              {CALENDAR_CHOICES.map(([k, text]) => (
                <button type="button" key={k} className={`cal-chip${c.calendar === k ? ' on' : ''}`}
                  disabled={k === 'kids' && c.grownupsOnly} onClick={() => set({ calendar: k })}>
                  {text}
                </button>
              ))}
            </div>
            <span className="muted small">
              {yearBad ? 'Check the year (or leave it empty).'
                : c.calendar === 'none' ? "Kept here, but it isn't on anyone's calendar."
                  : c.calendar === 'kids' ? "On the kids' calendar (My Day and My Week) only, with no reminders."
                    : 'Every year, with a reminder to grown-ups the evening before (change that on the calendar). The year is optional: it shows how old they turn.'}
            </span>
          </>
        )}
      </div>

      {people.length > 0 && (
        <div className="stack rem-field">
          <span><b>Family Track account</b> <span className="muted small">(if they have one: their birthday gets their colour)</span></span>
          <div className="row wrap">
            <button type="button" className={`cal-chip${!c.profileId ? ' on' : ''}`} onClick={() => set({ profileId: null })}>None</button>
            {people.map((p) => (
              <button type="button" key={p.id} disabled={taken.has(p.id)} title={taken.has(p.id) ? `Already ${taken.get(p.id)}` : ''}
                className={`cal-chip${c.profileId === p.id ? ' on' : ''}`} onClick={() => set({ profileId: c.profileId === p.id ? null : p.id })}>
                {p.emoji} {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label>
        Note
        <textarea rows={2} value={c.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} placeholder="Gate code, kids' names…" />
      </label>
      <label className="inline check">
        <input type="checkbox" checked={c.grownupsOnly}
          onChange={(e) => set({ grownupsOnly: e.target.checked, ...(e.target.checked && c.calendar === 'kids' ? { calendar: 'none' } : {}) })} />
        Grown-ups only <span className="muted small">(the kids don't see this contact or their birthday)</span>
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={!canSave} onClick={save}>{start.id ? 'Save' : 'Add the contact'}</button>
      {start.id && (sure
        ? (
          <div className="row">
            <button className="btn danger" disabled={busy || offline} onClick={remove}>Delete {start.name}{start.birthday ? ' and their birthday' : ''}</button>
            <button className="btn" onClick={() => setSure(false)}>Keep</button>
          </div>
        )
        : <button className="btn" disabled={busy || offline} onClick={() => setSure(true)}>🗑️ Delete</button>)}
    </Sheet>
  );
}
