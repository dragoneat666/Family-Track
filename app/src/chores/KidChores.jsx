import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, weekdayOf, dateText, whenText } from './money.js';

// A kid's Chores page: their money, this week's chores (and how many are
// left), and what they've earned and spent. Only grown-ups check chores off.
export default function KidChores({ profile, onExit }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/chores').then(setData).catch((e) => setError(e.message));
    api.get(`/api/chores/money/${profile.id}`).then(setHistory).catch(() => {});
  }, [profile.id]);

  const me = data?.kids.find((k) => k.id === profile.id);

  return (
    <div className="kid-page kid-chores" style={{ '--c': profile.color }}>
      <header className="kid-page-header">
        <button data-back className="btn" onClick={onExit}>← Back</button>
        <h1>🧹 Chores</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="spinner" />}
      {data && (
        <>
          <div className="kid-money">
            <span className="kid-money-label">My money</span>
            <span className="kid-money-amount">{money(me?.balance ?? 0)}</span>
            <span className="kid-money-week">{me?.thisWeek ? `I earned ${money(me.thisWeek)} this week!` : 'Do a chore to earn money!'}</span>
          </div>

          <h2 className="kid-chores-h">This week’s chores</h2>
          {!data.chores.length && <p className="muted">No chores yet.</p>}
          <div className="kid-chore-list">
            {data.chores.map((c) => {
              const left = Math.max(0, c.times - c.doneThisWeek);
              return (
                <div key={c.id} className={`kid-chore${left ? '' : ' full'}`}>
                  <span className="kid-chore-name">{c.name}</span>
                  <span className="kid-chore-pay">{money(c.cents)}</span>
                  <span className="kid-chore-left">{left ? `${left} ${left === 1 ? 'time' : 'times'} left` : 'All done ✓'}</span>
                </div>
              );
            })}
          </div>
          <p className="muted">Did a chore? Ask a grown-up to check it off.</p>

          {history?.entries.length > 0 && (
            <>
              <h2 className="kid-chores-h">My money so far</h2>
              <ul className="kid-money-list">
                {history.entries.slice(0, 30).map((e) => (
                  <li key={e.id}>
                    <b className={e.cents < 0 ? 'money-out' : 'money-in'}>{e.cents > 0 ? '+' : ''}{money(e.cents)}</b>
                    <span>{e.chore || e.note || (e.cents < 0 ? 'Spent' : 'Added')}</span>
                    <span className="muted small">{e.day ? `${weekdayOf(e.day)} ${dateText(e.day)}` : whenText(e.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
