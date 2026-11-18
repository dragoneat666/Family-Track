import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Sheet } from '../lists/ui.jsx';
import { DAY_LETTERS, daysText, scheduleText } from '../reminders/data.js';
import WeeksPicker from '../reminders/WeeksPicker.jsx';
import { money, parseMoney, dollarsText, weekdayOf, dateText, weekText, whenText } from './money.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How often, in a few words: "3 times a week", "Tue, Fri", "Mon, every other week".
export const howOften = (c) => (c.days ? scheduleText(c.days, c.everyWeeks) : c.times === 1 ? 'once a week' : `${c.times} times a week`);

// Chores for grown-ups: each kid's money (adding some, and taking some out
// when they spend it), this week's chores to check off (ticking who did it),
// and making, changing and deleting chores.
export default function ChoresScreen({ onAuthLost }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(null); // a chore being checked off
  const [editing, setEditing] = useState(null); // a chore, or {} for a new one
  const [moneyFor, setMoneyFor] = useState(null); // { kid, add }
  const [history, setHistory] = useState(null); // a kid

  async function call(fn) {
    setError('');
    try {
      const r = await fn();
      if (r?.chores) setData(r);
      return r || true;
    } catch (e) {
      if (e.status === 401) onAuthLost?.();
      else setError(e.message);
      return null;
    }
  }
  useEffect(() => {
    call(() => api.get('/api/chores'));
    // A chore checked off from a reminder's question shows here too.
    const again = () => call(() => api.get('/api/chores'));
    window.addEventListener('ft:chores-changed', again);
    return () => window.removeEventListener('ft:chores-changed', again);
  }, []);

  if (!data) return <div className="stack">{error ? <p className="error">{error}</p> : <div className="spinner" />}</div>;

  const kidName = (id) => { const k = data.kids.find((x) => x.id === id); return k ? `${k.emoji} ${k.name}` : 'Someone'; };
  const kidEmojis = (ids) => ids.map((id) => data.kids.find((k) => k.id === id)?.emoji).filter(Boolean).join('');

  return (
    <div className="stack chores">
      {error && <p className="error">{error}</p>}

      <section className="stack">
        <h2 className="chores-h">💰 Money</h2>
        {!data.kids.length && <p className="muted">No kids yet.</p>}
        <div className="chore-kids">
          {data.kids.map((k) => (
            <div key={k.id} className="card chore-kid-card" style={{ '--c': k.color }}>
              <div className="chore-kid-name">{k.emoji} {k.name}</div>
              <div className="chore-balance">{money(k.balance)}</div>
              <div className="muted small">{k.thisWeek ? `+${money(k.thisWeek)} from chores this week` : 'No chores done this week yet'}</div>
              <div className="row wrap">
                <button className="btn small" onClick={() => setMoneyFor({ kid: k, add: true })}>Add</button>
                <button className="btn small" onClick={() => setMoneyFor({ kid: k, add: false })} disabled={k.balance <= 0}>Take out</button>
                <button className="btn small" onClick={() => setHistory(k)}>History</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2 className="chores-h">🧹 This week <span className="muted small">{weekText(data.weekStart)}</span></h2>
        {!data.chores.length && <p className="muted">No chores yet. Add one, like “Dishes”, 3 times a week.</p>}
        <ul className="chore-list">
          {data.chores.map((c) => {
            const full = c.doneThisWeek >= c.times;
            return (
              <li key={c.id} className={`card chore-row${full ? ' full' : ''}${c.dueToday ? ' due' : ''}${c.offWeek ? ' off' : ''}`}>
                <button className="chore-row-text" onClick={() => setEditing(c)} title="Change or delete">
                  <b>{c.name}{c.dueToday && <span className="chore-today">Today</span>}</b>
                  <span className="muted small">
                    {money(c.cents)} each · {howOften(c)}
                    {c.kids.length > 0 && ` · ${kidEmojis(c.kids)}`}
                    {c.reminders?.length > 0 && ` · ⏰ ${c.reminders.map((r) => r.title).join(', ')}`}
                  </span>
                </button>
                {c.offWeek ? (
                  <span className="chore-full">Not this week</span>
                ) : (
                  <>
                    <span className="chore-count">{c.doneThisWeek} / {c.times}</span>
                    {full
                      ? <span className="chore-full">✓ Done for the week</span>
                      : <button className="btn primary" onClick={() => setChecking(c)} disabled={!data.kids.length}>✓ Done</button>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="row"><button className="btn" onClick={() => setEditing({})}>＋ New chore</button></div>
      </section>

      {data.done.length > 0 && (
        <section className="stack">
          <h2 className="chores-h">✅ Done this week</h2>
          <ul className="line-list">
            {data.done.map((d) => (
              <li key={d.id} className="row">
                <span className="line-text"><b>{d.name}</b> <span className="muted small">{weekdayOf(d.day)} · {d.kids.map(kidName).join(', ')} · {money(d.cents)} each</span></span>
                <button className="btn small" onClick={() => window.confirm(`Undo ${d.name}? The money it earned is taken back.`) && call(() => api.del(`/api/chores/done/${d.id}`))}>Undo</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {checking && (
        <Sheet title={`Who did ${checking.name}?`} onClose={() => setChecking(null)} closeLabel="Cancel">
          <CheckOff chore={checking} kids={data.kids}
            onSave={async (kids) => { if (await call(() => api.post(`/api/chores/${checking.id}/done`, { kids }))) setChecking(null); }} />
        </Sheet>
      )}
      {editing && (
        <ChoreEditor chore={editing} kids={data.kids} onClose={() => setEditing(null)}
          onSave={async (body) => {
            const r = await call(() => (editing.id ? api.put(`/api/chores/${editing.id}`, body) : api.post('/api/chores', body)));
            if (r) setEditing(null);
          }}
          onDelete={async () => {
            if (!window.confirm(`Delete ${editing.name}? Money it already earned stays.`)) return;
            if (await call(() => api.del(`/api/chores/${editing.id}`))) setEditing(null);
          }} />
      )}
      {moneyFor && (
        <MoneySheet kid={data.kids.find((k) => k.id === moneyFor.kid.id) || moneyFor.kid} add={moneyFor.add} onClose={() => setMoneyFor(null)}
          onSave={async (cents, note) => {
            const path = moneyFor.add ? '/api/chores/add' : '/api/chores/spend';
            if (await call(() => api.post(path, { profileId: moneyFor.kid.id, cents, note }))) setMoneyFor(null);
          }} />
      )}
      {history && <History kid={history} call={call} onClose={() => setHistory(null)} />}
    </div>
  );
}

// Who did it: tap each kid who helped (the ones who usually do it start
// ticked). Each of them earns the full amount.
export function CheckOff({ chore, kids, onSave, saveLabel = '✓ Done', extra }) {
  const usual = (chore.kids || []).filter((id) => kids.some((k) => k.id === id));
  const [picked, setPicked] = useState(usual.length ? usual : kids.length === 1 ? [kids[0].id] : []);
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <div className="chore-pick">
        {kids.map((k) => (
          <button key={k.id} className={`chore-pick-kid${picked.includes(k.id) ? ' on' : ''}`} style={{ '--c': k.color }} onClick={() => toggle(k.id)}>
            <span className="chore-pick-emoji">{k.emoji}</span>
            <span>{k.name}</span>
            {picked.includes(k.id) && <span className="chore-pick-tick">✓</span>}
          </button>
        ))}
      </div>
      <p className="muted small">Each one ticked gets {money(chore.cents)}.</p>
      <div className="row wrap">
        <button className="btn primary" disabled={!picked.length || busy}
          onClick={async () => { setBusy(true); await onSave(picked); setBusy(false); }}>
          {picked.length ? `${saveLabel}: ${money(chore.cents)}${picked.length > 1 ? ' each' : ''}` : 'Tick who did it'}
        </button>
        {extra}
      </div>
    </>
  );
}

function ChoreEditor({ chore, kids, onSave, onDelete, onClose }) {
  const [name, setName] = useState(chore.name || '');
  const [onDays, setOnDays] = useState(!!chore.days);
  const [days, setDays] = useState(chore.days || []);
  const [every, setEvery] = useState({ everyWeeks: chore.everyWeeks || 1, weekOf: chore.weekOf || null });
  const [times, setTimes] = useState(chore.days ? 1 : chore.times || 1);
  const [amount, setAmount] = useState(chore.cents ? dollarsText(chore.cents) : '1');
  const [usual, setUsual] = useState(chore.kids || []);
  // Linked reminders, as ids ('' = one being picked).
  const [links, setLinks] = useState(() => (chore.reminders || []).map((r) => String(r.id)));
  const [reminders, setReminders] = useState(null);
  const cents = parseMoney(amount);

  useEffect(() => {
    api.get('/api/reminders').then((r) => setReminders(r.reminders)).catch(() => setReminders([]));
  }, []);

  const toggleDay = (d) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort()));
  const toggleKid = (id) => setUsual((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  // Linking a reminder to a chore with no days yet: same days (and weeks) as the reminder.
  function pickReminder(n, id) {
    setLinks((x) => x.map((y, i) => (i === n ? id : y)));
    const r = reminders?.find((x) => String(x.id) === id);
    if (r && !days.length) {
      setDays([...r.days].sort());
      setEvery({ everyWeeks: r.everyWeeks || 1, weekOf: r.weekOf || null });
      if (r.days.length < 7 || r.everyWeeks > 1) setOnDays(true);
    }
  }
  const unlink = (n) => setLinks((x) => x.filter((_, i) => i !== n));
  // What each pick can be: the reminders (or, until they load, the linked ones).
  const choices = reminders || chore.reminders || [];
  const linked = links.filter(Boolean);
  const canLinkMore = !links.includes('') && (reminders === null || reminders.length > linked.length);

  const ok = name.trim() && cents && (!onDays || days.length);
  function save() {
    onSave({
      name, cents, kids: usual, reminderIds: linked.map(Number),
      ...(onDays ? { days, ...every } : { days: null, times })
    });
  }

  return (
    <Sheet title={chore.id ? `Change ${chore.name}` : 'New chore'} onClose={onClose} closeLabel="Cancel">
      <label>Chore
        <input autoFocus={!chore.id} value={name} maxLength={60} placeholder="e.g. Dishes" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">How often
        <div className="row wrap">
          <button className={`btn small${!onDays ? ' primary' : ''}`} onClick={() => setOnDays(false)}>Times a week</button>
          <button className={`btn small${onDays ? ' primary' : ''}`} onClick={() => setOnDays(true)}>On set days</button>
        </div>
      </div>
      {onDays ? (
        <div className="field">On
          <div className="row wrap">
            {DAY_LETTERS.map((letter, d) => (
              <button type="button" key={d} className={`rem-day${days.includes(d) ? ' on' : ''}`} onClick={() => toggleDay(d)}
                aria-label={DAY_NAMES[d]} aria-pressed={days.includes(d)}>{letter}</button>
            ))}
          </div>
          <span className={days.length ? 'muted small' : 'error small'}>{days.length ? `${daysText(days)} (once each day)` : 'Pick at least one day'}</span>
          <WeeksPicker everyWeeks={every.everyWeeks} weekOf={every.weekOf} days={days} onChange={setEvery} />
        </div>
      ) : (
        <div className="field">Any day, this many times a week
          <div className="row">
            <button className="btn" onClick={() => setTimes((t) => Math.max(1, t - 1))} disabled={times <= 1} aria-label="Fewer">−</button>
            <b className="chore-times">{times}</b>
            <button className="btn" onClick={() => setTimes((t) => Math.min(21, t + 1))} disabled={times >= 21} aria-label="More">＋</button>
          </div>
        </div>
      )}

      <label>Earns each time ($)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {!cents && <p className="error small">Type an amount, like 1 or 2.50.</p>}

      {kids.length > 0 && (
        <div className="field">Usually done by (optional)
          <div className="row wrap">
            {kids.map((k) => (
              <button key={k.id} className={`btn small${usual.includes(k.id) ? ' primary' : ''}`} onClick={() => toggleKid(k.id)}>{k.emoji} {k.name}</button>
            ))}
          </div>
          <span className="muted small">They start ticked when you check it off.</span>
        </div>
      )}

      <div className="field">Linked reminders (optional)
        {links.map((id, n) => (
          <div className="row chore-link" key={n}>
            <select value={id} onChange={(e) => pickReminder(n, e.target.value)} aria-label="Linked reminder">
              {id === '' && <option value="">Pick a reminder…</option>}
              {choices.filter((r) => String(r.id) === id || !links.includes(String(r.id))).map((r) => (
                <option key={r.id} value={r.id}>⏰ {r.title}{r.days ? ` · ${scheduleText(r.days, r.everyWeeks)}` : ''}</option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={() => unlink(n)} aria-label="Unlink this reminder">✕</button>
          </div>
        ))}
        {canLinkMore && (
          <div className="row">
            <button type="button" className="btn small" onClick={() => setLinks((x) => [...x, ''])}>
              ⏰ {linked.length ? 'Link another reminder' : 'Link a reminder'}
            </button>
          </div>
        )}
        <span className="muted small">
          {reminders && !reminders.length
            ? 'Make the reminder under Reminders first.'
            : `Marking ${linked.length > 1 ? 'one of them' : 'it'} Done asks whether to check this chore off too${usual.length ? ' for the kids above' : ''}.`}
        </span>
      </div>

      {chore.id && <p className="muted small">A new amount counts from now on. Money already earned stays the same.</p>}
      <div className="row wrap">
        <button className="btn primary" disabled={!ok} onClick={save}>{chore.id ? 'Save' : 'Add chore'}</button>
        {chore.id && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
    </Sheet>
  );
}

// Adding money to a kid's total, or taking some out when they spend it.
function MoneySheet({ kid, add, onSave, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const cents = parseMoney(amount);
  const tooMuch = !add && cents > kid.balance;
  return (
    <Sheet title={add ? `Add to ${kid.name}'s money` : `Take out of ${kid.name}'s money`} onClose={onClose} closeLabel="Cancel">
      <p>{kid.emoji} {kid.name} has <b>{money(kid.balance)}</b>.</p>
      <label>How much ($)
        <input autoFocus inputMode="decimal" value={amount} placeholder="e.g. 5" onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>What for (optional)
        <input value={note} maxLength={80} placeholder={add ? 'e.g. Birthday money' : 'e.g. Lego set'} onChange={(e) => setNote(e.target.value)} />
      </label>
      {tooMuch && <p className="error small">That's more than {kid.name} has.</p>}
      <button className="btn primary" disabled={!cents || tooMuch} onClick={() => onSave(cents, note)}>
        {add ? (cents ? `Add ${money(cents)}` : 'Add') : (cents ? `Take out ${money(cents)}` : 'Take out')}
      </button>
    </Sheet>
  );
}

// A kid's money, newest first. Money added or taken out can be undone here;
// chore money is undone from Done this week (it belongs to the check-off).
function History({ kid, call, onClose }) {
  const [h, setH] = useState(null);
  const load = async () => { const r = await call(() => api.get(`/api/chores/money/${kid.id}`)); if (r?.entries) setH(r); };
  useEffect(() => { load(); }, [kid.id]);

  async function undo(e) {
    const q = e.cents < 0 ? `Put ${money(-e.cents)} back in ${kid.name}'s money?` : `Take the ${money(e.cents)} back out of ${kid.name}'s money?`;
    if (!window.confirm(q)) return;
    if (await call(() => api.del(`/api/chores/spend/${e.id}`))) load();
  }

  return (
    <Sheet title={`${kid.emoji} ${kid.name}'s money`} onClose={onClose} wide>
      {!h && <div className="spinner" />}
      {h && <p className="chore-balance">{money(h.balance)}</p>}
      {h && !h.entries.length && <p className="muted">Nothing yet.</p>}
      {h && h.entries.length > 0 && (
        <ul className="line-list">
          {h.entries.map((e) => (
            <li key={e.id} className="row">
              <span className="line-text">
                <b className={e.cents < 0 ? 'money-out' : 'money-in'}>{e.cents > 0 ? '+' : ''}{money(e.cents)}</b>{' '}
                {e.chore || e.note || (e.cents < 0 ? 'Taken out' : 'Added')}
                <span className="muted small"> · {e.day ? `${weekdayOf(e.day)} ${dateText(e.day)}` : whenText(e.at)}</span>
              </span>
              {!e.doneId && <button className="btn small" onClick={() => undo(e)}>Undo</button>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
