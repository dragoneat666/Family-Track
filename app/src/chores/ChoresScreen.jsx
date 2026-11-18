import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Sheet } from '../lists/ui.jsx';
import { money, parseMoney, dollarsText, weekdayOf, dateText, weekText, whenText } from './money.js';

// Chores for grown-ups: each kid's money (and taking some out when they
// spend it), this week's chores to check off (ticking who did it), and
// making, changing and deleting chores.
export default function ChoresScreen({ onAuthLost }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(null); // a chore being checked off
  const [editing, setEditing] = useState(null); // a chore, or {} for a new one
  const [spending, setSpending] = useState(null); // a kid
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
  useEffect(() => { call(() => api.get('/api/chores')); }, []);

  if (!data) return <div className="stack">{error ? <p className="error">{error}</p> : <div className="spinner" />}</div>;

  const kidName = (id) => { const k = data.kids.find((x) => x.id === id); return k ? `${k.emoji} ${k.name}` : 'Someone'; };

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
              <div className="muted small">{k.thisWeek ? `+${money(k.thisWeek)} this week` : 'Nothing earned this week yet'}</div>
              <div className="row wrap">
                <button className="btn small" onClick={() => setSpending(k)} disabled={k.balance <= 0}>Take out</button>
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
              <li key={c.id} className={`card chore-row${full ? ' full' : ''}`}>
                <button className="chore-row-text" onClick={() => setEditing(c)} title="Change or delete">
                  <b>{c.name}</b>
                  <span className="muted small">{money(c.cents)} each · {c.times === 1 ? 'once a week' : `${c.times} times a week`}</span>
                </button>
                <span className="chore-count">{c.doneThisWeek} / {c.times}</span>
                {full
                  ? <span className="chore-full">✓ Done for the week</span>
                  : <button className="btn primary" onClick={() => setChecking(c)} disabled={!data.kids.length}>✓ Done</button>}
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
        <CheckOff chore={checking} kids={data.kids} onClose={() => setChecking(null)}
          onSave={async (kids) => { if (await call(() => api.post(`/api/chores/${checking.id}/done`, { kids }))) setChecking(null); }} />
      )}
      {editing && (
        <ChoreEditor chore={editing} onClose={() => setEditing(null)}
          onSave={async (body) => {
            const r = await call(() => (editing.id ? api.put(`/api/chores/${editing.id}`, body) : api.post('/api/chores', body)));
            if (r) setEditing(null);
          }}
          onDelete={async () => {
            if (!window.confirm(`Delete ${editing.name}? Money it already earned stays.`)) return;
            if (await call(() => api.del(`/api/chores/${editing.id}`))) setEditing(null);
          }} />
      )}
      {spending && (
        <TakeOut kid={data.kids.find((k) => k.id === spending.id) || spending} onClose={() => setSpending(null)}
          onSave={async (cents, note) => { if (await call(() => api.post('/api/chores/spend', { profileId: spending.id, cents, note }))) setSpending(null); }} />
      )}
      {history && <History kid={history} call={call} onClose={() => setHistory(null)} />}
    </div>
  );
}

// Who did it: tap each kid who helped. Each of them earns the full amount.
function CheckOff({ chore, kids, onSave, onClose }) {
  const [picked, setPicked] = useState(kids.length === 1 ? [kids[0].id] : []);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Sheet title={`Who did ${chore.name}?`} onClose={onClose} closeLabel="Cancel">
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
      <button className="btn primary" disabled={!picked.length} onClick={() => onSave(picked)}>
        {picked.length ? `✓ Done: ${money(chore.cents)}${picked.length > 1 ? ' each' : ''}` : 'Tick who did it'}
      </button>
    </Sheet>
  );
}

function ChoreEditor({ chore, onSave, onDelete, onClose }) {
  const [name, setName] = useState(chore.name || '');
  const [times, setTimes] = useState(chore.times || 1);
  const [amount, setAmount] = useState(chore.cents ? dollarsText(chore.cents) : '1');
  const cents = parseMoney(amount);
  return (
    <Sheet title={chore.id ? `Change ${chore.name}` : 'New chore'} onClose={onClose} closeLabel="Cancel">
      <label>Chore
        <input autoFocus={!chore.id} value={name} maxLength={60} placeholder="e.g. Dishes" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">Times a week
        <div className="row">
          <button className="btn" onClick={() => setTimes((t) => Math.max(1, t - 1))} disabled={times <= 1} aria-label="Fewer">−</button>
          <b className="chore-times">{times}</b>
          <button className="btn" onClick={() => setTimes((t) => Math.min(21, t + 1))} disabled={times >= 21} aria-label="More">＋</button>
        </div>
      </div>
      <label>Earns each time ($)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {chore.id && <p className="muted small">A new amount counts from now on. Money already earned stays the same.</p>}
      <div className="row wrap">
        <button className="btn primary" disabled={!name.trim() || !cents} onClick={() => onSave({ name, times, cents })}>
          {chore.id ? 'Save' : 'Add chore'}
        </button>
        {chore.id && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
      {!cents && <p className="error small">Type an amount, like 1 or 2.50.</p>}
    </Sheet>
  );
}

function TakeOut({ kid, onSave, onClose }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const cents = parseMoney(amount);
  const tooMuch = cents > kid.balance;
  return (
    <Sheet title={`Take out of ${kid.name}'s money`} onClose={onClose} closeLabel="Cancel">
      <p>{kid.emoji} {kid.name} has <b>{money(kid.balance)}</b>.</p>
      <label>How much ($)
        <input autoFocus inputMode="decimal" value={amount} placeholder="e.g. 5" onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>What for (optional)
        <input value={note} maxLength={80} placeholder="e.g. Lego set" onChange={(e) => setNote(e.target.value)} />
      </label>
      {tooMuch && <p className="error small">That's more than {kid.name} has.</p>}
      <button className="btn primary" disabled={!cents || tooMuch} onClick={() => onSave(cents, note)}>
        {cents ? `Take out ${money(cents)}` : 'Take out'}
      </button>
    </Sheet>
  );
}

// A kid's money, newest first. Money taken out can be undone here; chore
// money is undone from Done this week (it belongs to the check-off).
function History({ kid, call, onClose }) {
  const [h, setH] = useState(null);
  const load = async () => { const r = await call(() => api.get(`/api/chores/money/${kid.id}`)); if (r?.entries) setH(r); };
  useEffect(() => { load(); }, [kid.id]);

  async function undo(e) {
    if (!window.confirm(`Put ${money(-e.cents)} back in ${kid.name}'s money?`)) return;
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
              {!e.doneId && e.cents < 0 && <button className="btn small" onClick={() => undo(e)}>Undo</button>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
