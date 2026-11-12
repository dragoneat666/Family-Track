import { useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import WhoPicker from '../reminders/WhoPicker.jsx';
import { notify } from '../notify.js';
import { gets } from '../reminders/data.js';
import { refreshContacts } from '../contacts/data.js';
import {
  saveEvent, changeDate, repeatChoices, repeatKey, repeatText, remindText, todayDay, addDays, daysBetween, shortDay,
  REMIND_TIMED, REMIND_ALL_DAY, DEFAULT_REMIND
} from './data.js';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const LAST_MIN = 23 * 60 + 59;
const MAX_REMINDERS = 5;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The next time a birthday comes round (today counts). Feb 29 is Feb 28 in other years.
function nextBirthday(day) {
  const today = todayDay();
  const on = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}${day.slice(4) === '-02-29' && !leap ? '-02-28' : day.slice(4)}`;
  };
  const y = Number(today.slice(0, 4));
  return on(y) >= today ? on(y) : on(y + 1);
}

// A new event on that day: at the next hour if it's today, else 9 AM, for an hour.
export function newEvent(day) {
  const startTime = day === todayDay() ? `${pad(Math.min(23, new Date().getHours() + 1))}:00` : '09:00';
  return {
    kind: 'event', title: '', note: '', place: '', allDay: false,
    startDay: day, startTime, endDay: day, endTime: fromMin(Math.min(toMin(startTime) + 60, LAST_MIN)),
    repeat: null, people: [], grownupsOnly: false, remind: [...DEFAULT_REMIND.timed], remindWho: { groups: ['adults'] }, birthYear: null
  };
}

// Making or changing an event or a birthday. With `date` (one date of a
// repeating event), only that date changes: its name, time, place and note.
export default function EventEditor({ start, date, people, me, offline, onClose, onSaved }) {
  const [e, setE] = useState(() => {
    const from = date || start;
    return {
      ...start,
      title: from.title, note: from.note || '', place: from.place || '', allDay: from.allDay,
      startDay: from.startDay, endDay: from.endDay,
      startTime: from.startTime || '09:00', endTime: from.endTime || from.startTime || '10:00',
      people: [...(start.people || [])], remind: [...(start.remind || [])], remindWho: start.remindWho || { groups: ['adults'] }
    };
  });
  const [showAge, setShowAge] = useState(start.kind !== 'birthday' || !start.id || start.birthYear != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setE((x) => ({ ...x, ...patch }));
  const birthday = e.kind === 'birthday';
  const adults = people.filter((p) => p.isParent);
  const thisYear = Number(todayDay().slice(0, 4));
  const bornYear = Number(e.startDay.slice(0, 4));

  function setKind(kind) {
    if (kind === e.kind) return;
    const remind = kind === 'birthday'
      ? (same(e.remind, DEFAULT_REMIND.timed) ? [...DEFAULT_REMIND.allDay] : e.remind)
      : (e.allDay ? e.remind : same(e.remind, DEFAULT_REMIND.allDay) ? [...DEFAULT_REMIND.timed] : e.remind);
    set({ kind, remind, repeat: null, people: kind === 'birthday' ? e.people.slice(0, 1) : e.people });
  }
  function setStartDay(d) {
    if (!d) return;
    const span = Math.max(0, daysBetween(e.startDay, e.endDay));
    const repeat = e.repeat?.until && e.repeat.until < d ? { ...e.repeat, until: null } : e.repeat;
    set({ startDay: d, endDay: addDays(d, span), repeat });
  }
  function setStartTime(t) {
    if (!t) return;
    let dur = toMin(e.endTime) - toMin(e.startTime);
    if (e.endDay !== e.startDay || dur < 0) dur = e.endDay !== e.startDay ? null : 60;
    set(dur == null ? { startTime: t } : { startTime: t, endTime: fromMin(Math.min(toMin(t) + dur, LAST_MIN)) });
  }
  function setAllDay(allDay) {
    const [from, to] = allDay ? ['timed', 'allDay'] : ['allDay', 'timed'];
    const remind = same(e.remind, DEFAULT_REMIND[from]) ? [...DEFAULT_REMIND[to]] : e.remind.filter((m) => allDay || m >= 0);
    set({ allDay, remind });
  }
  function setRepeat(key) {
    const choice = repeatChoices(e.startDay).find(([k]) => k === key);
    if (!choice) return;
    set({ repeat: choice[2] && { ...choice[2], until: e.repeat?.until || null } });
  }
  const togglePerson = (id) => set({
    people: birthday ? (e.people[0] === id ? [] : [id]) : e.people.includes(id) ? e.people.filter((x) => x !== id) : [...e.people, id]
  });
  function pickBirthdayPerson(p) {
    const was = people.find((x) => x.id === e.people[0]);
    togglePerson(p.id);
    if (e.people[0] !== p.id && (!e.title.trim() || e.title === was?.name)) set({ title: p.name });
  }

  const choices = birthday || e.allDay ? REMIND_ALL_DAY : REMIND_TIMED;
  const setRemind = (i, m) => set({ remind: e.remind.map((x, n) => (n === i ? m : x)) });
  const addRemind = () => {
    const next = choices.find(([m]) => !e.remind.includes(m));
    if (next) set({ remind: [...e.remind, next[0]] });
  };
  const removeRemind = (i) => set({ remind: e.remind.filter((_, n) => n !== i) });

  const endsFirst = !birthday && (e.endDay < e.startDay || (!e.allDay && e.endDay === e.startDay && e.endTime < e.startTime));
  const nobodyReminded = !date && e.remind.length > 0 && !e.remindWho.groups?.length && !e.remindWho.ids?.length;
  const canSave = !busy && !offline && e.title.trim() && !endsFirst && !nobodyReminded && e.startDay;

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (date) {
        await changeDate(start.id, date.occ, {
          title: e.title, note: e.note, place: e.place, allDay: e.allDay,
          startDay: e.startDay, startTime: e.startTime, endDay: e.endDay, endTime: e.endTime
        });
      } else {
        // This phone has to be allowed to show notifications for reminders to pop up here.
        if (notify.available && e.remind.length && adults.some((p) => p.id === me && gets(e.remindWho, p))) await notify.allow();
        await saveEvent(birthday
          ? { ...e, allDay: true, endDay: e.startDay, birthYear: showAge && bornYear < thisYear ? bornYear : null }
          : e);
        if (start.contactId) refreshContacts().catch(() => {}); // its name and date are the contact's too
      }
      onSaved(start.id ? null : birthday ? nextBirthday(e.startDay) : e.startDay);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const title = date ? `Change just ${shortDay(date.occ)}` : start.id ? (birthday ? 'Birthday' : 'Event') : birthday ? 'New birthday' : 'New event';
  const repeatOptions = repeatChoices(e.startDay);
  const key = repeatKey(e.repeat);
  return (
    <Sheet title={title} onClose={onClose} closeLabel="Cancel">
      {!start.id && !date && (
        <div className="cal-kinds">
          <button type="button" className={!birthday ? 'on' : ''} onClick={() => setKind('event')}>📅 Event</button>
          <button type="button" className={birthday ? 'on' : ''} onClick={() => setKind('birthday')}>🎂 Birthday</button>
        </div>
      )}

      {birthday ? (
        <>
          <label>
            Whose birthday
            <input value={e.title} onChange={(ev) => set({ title: ev.target.value })} placeholder="Grandma" maxLength={80} />
          </label>
          {people.length > 0 && (
            <div className="stack rem-field">
              <span className="muted small">Someone in the family?</span>
              <div className="row wrap">
                {people.map((p) => (
                  <button type="button" key={p.id} className={`cal-chip${e.people[0] === p.id ? ' on' : ''}`} onClick={() => pickBirthdayPerson(p)}>
                    {p.emoji} {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label>
            <span>Birthday <span className="muted small">(with the year they were born, if you know it)</span></span>
            <input type="date" value={e.startDay} onChange={(ev) => setStartDay(ev.target.value)} />
          </label>
          <label className="inline check">
            <input type="checkbox" checked={showAge && bornYear < thisYear} disabled={bornYear >= thisYear} onChange={(ev) => setShowAge(ev.target.checked)} />
            Show how old they're turning
          </label>
        </>
      ) : (
        <>
          <label>
            What
            <input value={e.title} onChange={(ev) => set({ title: ev.target.value })} placeholder="Dentist" maxLength={80} />
          </label>

          {!date && (
            <div className="stack rem-field">
              <b>Who's it for</b>
              <div className="row wrap">
                <button type="button" className={`cal-chip${!e.people.length ? ' on' : ''}`} onClick={() => set({ people: [] })}>👪 Whole family</button>
                {people.map((p) => (
                  <button type="button" key={p.id} className={`cal-chip${e.people.includes(p.id) ? ' on' : ''}`} onClick={() => togglePerson(p.id)}
                    style={{ '--c': p.color }}>
                    {p.emoji} {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="inline check">
            <input type="checkbox" checked={e.allDay} onChange={(ev) => setAllDay(ev.target.checked)} />
            All day
          </label>
          <div className="cal-when">
            <span>Starts</span>
            <input type="date" value={e.startDay} onChange={(ev) => setStartDay(ev.target.value)} />
            {!e.allDay && <input type="time" value={e.startTime} onChange={(ev) => setStartTime(ev.target.value)} />}
            <span>Ends</span>
            <input type="date" value={e.endDay} min={e.startDay} onChange={(ev) => ev.target.value && set({ endDay: ev.target.value })} />
            {!e.allDay && <input type="time" value={e.endTime} onChange={(ev) => ev.target.value && set({ endTime: ev.target.value })} />}
          </div>
          {endsFirst && <span className="error small">It ends before it starts.</span>}

          {!date && (
            <div className="stack rem-field">
              <b>Repeats</b>
              <select value={key} onChange={(ev) => setRepeat(ev.target.value)}>
                {repeatOptions.map(([k, words]) => <option key={k} value={k}>{words}</option>)}
                {key === 'other' && <option value="other">{repeatText({ ...e.repeat, until: null }, e.startDay)}</option>}
              </select>
              {e.repeat && (
                <label className="inline check">
                  Until
                  <input type="date" value={e.repeat.until || ''} min={e.startDay} onChange={(ev) => set({ repeat: { ...e.repeat, until: ev.target.value || null } })} />
                  {e.repeat.until
                    ? <button type="button" className="btn small" onClick={() => set({ repeat: { ...e.repeat, until: null } })}>No end</button>
                    : <span className="muted small">(no end)</span>}
                </label>
              )}
            </div>
          )}

          <label>
            <span>Where <span className="muted small">(optional)</span></span>
            <input value={e.place} onChange={(ev) => set({ place: ev.target.value })} placeholder="Main St. office" maxLength={120} />
          </label>
        </>
      )}

      <label>
        <span>Note <span className="muted small">(optional)</span></span>
        <textarea value={e.note} onChange={(ev) => set({ note: ev.target.value })} rows={2} maxLength={500} />
      </label>

      {!date && !birthday && (
        <label className="inline check">
          <input type="checkbox" checked={e.grownupsOnly} onChange={(ev) => set({ grownupsOnly: ev.target.checked })} />
          Grown-ups only (the kids don't see it)
        </label>
      )}

      {!date && (
        <div className="stack rem-field">
          <b>Remind</b>
          {e.remind.map((m, i) => (
            <div className="row" key={i}>
              <select value={m} onChange={(ev) => setRemind(i, Number(ev.target.value))}>
                {!choices.some(([v]) => v === m) && <option value={m}>{remindText(m, birthday || e.allDay)}</option>}
                {choices.filter(([v]) => v === m || !e.remind.includes(v)).map(([v, words]) => <option key={v} value={v}>{words}</option>)}
              </select>
              <button type="button" className="btn small" onClick={() => removeRemind(i)} aria-label="No reminder here">✕</button>
            </div>
          ))}
          {e.remind.length < MAX_REMINDERS && choices.some(([m]) => !e.remind.includes(m)) && (
            <button type="button" className="btn small rem-add-time" onClick={addRemind}>+ {e.remind.length ? 'Another reminder' : 'Add a reminder'}</button>
          )}
          {e.remind.length > 0 && adults.length > 0 && (
            <>
              <span className="muted small">Who gets reminded</span>
              <WhoPicker value={e.remindWho} onChange={(remindWho) => set({ remindWho })} people={adults} me={me} everyone={false} />
              {nobodyReminded && <span className="error small">Pick who gets reminded.</span>}
            </>
          )}
          {!e.remind.length && <span className="muted small">No reminders.</span>}
        </div>
      )}

      {offline && <p className="sync-note">Can't reach the server, so this can't be saved right now.</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={!canSave} onClick={save}>
        {date ? `Save ${shortDay(date.occ)}` : start.id ? 'Save' : birthday ? 'Add the birthday' : 'Add to the calendar'}
      </button>
    </Sheet>
  );
}
