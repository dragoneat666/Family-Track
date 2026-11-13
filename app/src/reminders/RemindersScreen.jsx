import { useEffect, useRef, useState } from 'react';
import { notify } from '../notify.js';
import { Sheet } from '../lists/ui.jsx';
import WhoPicker from './WhoPicker.jsx';
import {
  useReminders, refreshReminders, saveReminder, deleteReminder, markDone, gets,
  timeText, clockText, daysText, whoText, nudgesText, DAY_LETTERS
} from './data.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NUDGE_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const minutesText = (m) => (m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? 'hour' : 'hours'}`);

const blank = () => ({
  title: '', note: '', times: ['08:00'], days: [0, 1, 2, 3, 4, 5, 6], who: { all: true }, each: false, nudges: [30, 60], paused: false
});

// Reminders at set times, like pills: today's, with who did them, and every
// reminder there is. A grown-up makes them; they pop up as notifications on
// the phones of whoever they're for, with a Done button.
export default function RemindersScreen({ account, onAuthLost }) {
  const { data, offline } = useReminders();
  const [editing, setEditing] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const refresh = () => refreshReminders({ sendFirst: true }).catch((e) => e.status === 401 && onAuthLost?.());
    refresh();
    const tick = setInterval(() => setNow(Date.now()), 30 * 1000);
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); refresh(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!data) {
    return offline
      ? <p className="sync-note">Can't reach the server, and reminders haven't been loaded on this device yet.</p>
      : <div className="spinner" />;
  }

  const byId = new Map(data.reminders.map((r) => [r.id, r]));
  const today = data.today.filter((t) => byId.has(t.reminder));
  return (
    <div className="stack rem-screen">
      {offline && <p className="sync-note">📴 Can't reach the server: this is how things were last time. Changes need the server.</p>}

      {today.length > 0 && (
        <section className="card stack">
          <h2 className="rem-heading">Today</h2>
          <div className="rem-today-list">
            {today.map((t) => <TodayRow key={`${t.reminder}-${t.occ}`} t={t} r={byId.get(t.reminder)} people={data.people} now={now} offline={offline} me={account.id} />)}
          </div>
        </section>
      )}

      <section className="stack">
        <div className="row spread">
          <h2 className="rem-heading">All reminders</h2>
          <button className="btn primary" disabled={offline} onClick={() => setEditing(blank())}>+ New</button>
        </div>
        {!data.reminders.length && (
          <div className="card stack">
            <b>No reminders yet.</b>
            <p className="muted">
              Make one for things like pills. At the times you pick, it pops up on the phones of whoever it's for,
              with a Done button. If nobody taps Done, it reminds again a little later, then stops.
            </p>
          </div>
        )}
        {data.reminders.map((r) => (
          <button key={r.id} className={`card rem-card${r.paused ? ' paused' : ''}`} onClick={() => setEditing(r)}>
            <span className="rem-card-title">{r.title}{r.paused && <span className="rem-paused">Paused</span>}</span>
            {r.note && <span className="muted small">{r.note}</span>}
            <span className="small">⏰ {daysText(r.days)} · {r.times.map(timeText).join(', ')}</span>
            <span className="small muted">
              👥 {whoText(r.who, data.people)}{r.each && r.for.length > 1 ? ', each taps their own Done' : ''} · {nudgesText(r.nudges)}
            </span>
            {r.doneWho && <span className="small muted">✓ Done by {whoText(r.doneWho, data.people)}</span>}
          </button>
        ))}
      </section>

      {editing && <ReminderEditor key={editing.id || 'new'} start={editing} people={data.people} me={account.id} offline={offline} onClose={() => setEditing(null)} />}
    </div>
  );
}

// One time of one reminder today: done (by whom, when), not done yet, or
// later. Done only once its time has come, by those who can tap it.
function TodayRow({ t, r, people, now, offline, me }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const late = t.at <= now;
  const mine = (r.doneBy || []).includes(me);
  const name = (id) => people.find((p) => p.id === id)?.name || 'someone';

  async function act(options) {
    setBusy(true);
    setError('');
    try {
      await markDone(r.id, t.occ, options);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const time = <span className="rem-time">{timeText(t.occ.slice(11))}</span>;
  if (r.each && r.for.length > 1) {
    return (
      <div className="rem-today">
        {time}
        <div className="rem-what">
          <b>{r.title}</b>
          <div className="row wrap">
            {r.for.map((id) => {
              const tick = t.done.find((d) => d.profile === id || d.profile === 0);
              return (
                <button
                  key={id} className={`rem-person${tick ? ' done' : late ? ' late' : ''}`} disabled={busy || offline || !mine || (!tick && !late)}
                  title={tick ? `Done at ${clockText(tick.at)}` : late ? 'Tap when done' : 'Not time yet'}
                  onClick={() => act({ forId: id, undo: !!tick })}
                >
                  {tick ? '✓' : '○'} {name(id)}
                </button>
              );
            })}
          </div>
          {error && <span className="error small">{error}</span>}
        </div>
      </div>
    );
  }

  const tick = t.done.find((d) => d.profile === 0);
  return (
    <div className={`rem-today${tick ? ' done' : late ? ' late' : ''}`}>
      {time}
      <div className="rem-what">
        <b>{r.title}</b>
        {tick && <span className="small rem-good">✓ {name(tick.by)}, {clockText(tick.at)}</span>}
        {!tick && late && <span className="small rem-bad">Not done yet</span>}
        {error && <span className="error small">{error}</span>}
      </div>
      {mine && (tick
        ? <button className="btn small" disabled={busy || offline} onClick={() => act({ undo: true })}>Undo</button>
        : late && <button className="btn small primary" disabled={busy || offline} onClick={() => act({})}>Done</button>)}
    </div>
  );
}

function ReminderEditor({ start, people, me, offline, onClose }) {
  const [r, setR] = useState(() => ({ ...start, times: [...start.times], days: [...start.days], nudges: [...start.nudges] }));
  const startedAs = useRef(null);
  if (startedAs.current === null) startedAs.current = JSON.stringify(r);
  const changed = JSON.stringify(r) !== startedAs.current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setR((x) => ({ ...x, ...patch }));
  const recipients = people.filter((p) => gets(r.who, p));
  const [first, second] = r.nudges;

  const setTime = (n, value) => set({ times: r.times.map((t, i) => (i === n ? value : t)) });
  const addTime = () => set({ times: [...r.times, r.times.includes('20:00') ? '12:00' : '20:00'] });
  const removeTime = (n) => set({ times: r.times.filter((_, i) => i !== n) });
  const toggleDay = (d) => set({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort() });
  const setFirst = (m) => set({ nudges: m == null ? [] : second != null && second > m ? [m, second] : [m] });
  const setSecond = (m) => set({ nudges: m == null ? [first] : [first, m] });

  async function save() {
    setBusy(true);
    setError('');
    try {
      // This phone has to be allowed to show notifications for it to pop up here.
      if (notify.available && recipients.some((p) => p.id === me)) await notify.allow();
      await saveReminder({ ...r, times: r.times.filter(Boolean) });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete the reminder "${r.title}"? It stops for everyone.`)) return;
    setBusy(true);
    try {
      await deleteReminder(r.id);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={r.id ? 'Reminder' : 'New reminder'} onClose={onClose} closeLabel="Cancel" discard={changed && !busy && (start.id ? 'Throw away your changes?' : 'Throw away this new reminder?')}>
      <label>
        What
        <input value={r.title} onChange={(e) => set({ title: e.target.value })} placeholder="Morning pills" maxLength={80} />
      </label>
      <label>
        <span>Note <span className="muted small">(optional)</span></span>
        <input value={r.note} onChange={(e) => set({ note: e.target.value })} placeholder="With breakfast" maxLength={200} />
      </label>

      <div className="stack rem-field">
        <b>At</b>
        {r.times.map((t, n) => (
          <div className="row" key={n}>
            <input type="time" value={t} onChange={(e) => setTime(n, e.target.value)} />
            {r.times.length > 1 && <button type="button" className="btn small" onClick={() => removeTime(n)} aria-label="Remove this time">✕</button>}
          </div>
        ))}
        <button type="button" className="btn small rem-add-time" onClick={addTime}>+ Another time</button>
      </div>

      <div className="stack rem-field">
        <b>On</b>
        <div className="row wrap">
          {DAY_LETTERS.map((letter, d) => (
            <button type="button" key={d} className={`rem-day${r.days.includes(d) ? ' on' : ''}`} onClick={() => toggleDay(d)} aria-label={DAY_NAMES[d]} aria-pressed={r.days.includes(d)}>
              {letter}
            </button>
          ))}
        </div>
        <span className={r.days.length ? 'muted small' : 'error small'}>{r.days.length ? daysText(r.days) : 'Pick at least one day'}</span>
      </div>

      <div className="stack rem-field">
        <b>Who gets it</b>
        <WhoPicker value={r.who} onChange={(who) => set({ who })} people={people} me={me} />
        {recipients.length > 1 && (
          <>
            <label className="inline check">
              <input type="checkbox" checked={r.each} onChange={(e) => set({ each: e.target.checked })} />
              Everyone taps their own Done
            </label>
            <span className="muted small">
              {r.each ? 'Each person is reminded until they tap Done themselves.' : 'One Done counts for everyone, whoever taps it first.'}
            </span>
          </>
        )}
      </div>

      <div className="stack rem-field">
        <b>Who can tap Done</b>
        <label className="inline check">
          <input type="checkbox" checked={!r.doneWho} onChange={(e) => set({ doneWho: e.target.checked ? null : { groups: ['adults'], ids: [] } })} />
          Whoever gets it (and any grown-up)
        </label>
        {r.doneWho && <WhoPicker value={r.doneWho} onChange={(doneWho) => set({ doneWho })} people={people} me={me} />}
        <span className="muted small">
          {r.doneWho ? 'Everyone else is still reminded, without a Done button.' : 'Done shows once its time comes.'}
        </span>
      </div>

      <div className="stack rem-field">
        <b>If it isn't done</b>
        <label className="inline check">
          <input type="checkbox" checked={first != null} onChange={(e) => setFirst(e.target.checked ? 30 : null)} />
          Remind again after
          <select value={first ?? 30} disabled={first == null} onChange={(e) => setFirst(Number(e.target.value))}>
            {NUDGE_CHOICES.map((m) => <option key={m} value={m}>{minutesText(m)}</option>)}
          </select>
        </label>
        {first != null && (
          <label className="inline check">
            <input
              type="checkbox" checked={second != null}
              onChange={(e) => setSecond(e.target.checked ? NUDGE_CHOICES.find((m) => m >= first * 2 || m > first + 15) || 240 : null)}
            />
            and again after
            <select value={second ?? ''} disabled={second == null} onChange={(e) => setSecond(Number(e.target.value))}>
              {second == null && <option value="">…</option>}
              {NUDGE_CHOICES.filter((m) => m > first).map((m) => <option key={m} value={m}>{minutesText(m)}</option>)}
            </select>
          </label>
        )}
        <span className="muted small">
          {first == null ? 'It shows once.' : 'Then it stops.'} A notification nobody dealt with goes away when the next time comes round.
        </span>
      </div>

      <label className="inline check">
        <input type="checkbox" checked={r.paused} onChange={(e) => set({ paused: e.target.checked })} />
        Paused: no notifications for now
      </label>

      {!notify.available && <p className="muted small">Reminders pop up on phones and tablets with the Android app.</p>}
      {offline && <p className="sync-note">Can't reach the server, so this can't be saved right now.</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || offline || !r.title.trim() || !r.days.length} onClick={save}>
        {r.id ? 'Save' : 'Make the reminder'}
      </button>
      {r.id && <button className="btn danger" disabled={busy || offline} onClick={remove}>Delete</button>}
    </Sheet>
  );
}
